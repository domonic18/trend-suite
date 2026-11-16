import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import {
  createModelEntry,
  deleteModelEntry,
  getAsrChannel,
  listModelEntries,
  listTaskBindings,
  normalizeBaseUrl,
  updateModelEntry,
  updateTaskBinding,
} from './service'

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

// 32 字节随机主密钥（base64url），测试专用
const MASTER_KEY = randomBytes(32).toString('base64url')
process.env.AI_KEY_MASTER_KEY = MASTER_KEY
process.env.MEDIA_STORAGE = 'local'

before(async () => {
  if (url) await resetTestDatabase()
})

test('normalizeBaseUrl：剥离端点后缀与结尾斜杠', () => {
  assert.equal(normalizeBaseUrl('https://api.minimax.cn/v1/chat/completions'), 'https://api.minimax.cn')
  assert.equal(normalizeBaseUrl('https://api.minimax.cn/v1/speech_to_text'), 'https://api.minimax.cn')
  assert.equal(normalizeBaseUrl('https://api.example.com/'), 'https://api.example.com')
  // 端点剥掉后留下的 /v1 保留（openai 调用是 {baseUrl}/chat/completions）
  assert.equal(
    normalizeBaseUrl('https://api.example.com/v1/audio/transcriptions/'),
    'https://api.example.com/v1',
  )
})

test('createModelEntry：明文不落库，视图只回掩码', { skip }, async () => {
  const entry = await createModelEntry({
    name: '生产主力',
    purpose: 'llm',
    provider: 'MiniMax',
    protocol: 'openai',
    model: 'MiniMax-M3.1-Flash',
    baseUrl: 'https://api.minimax.cn/v1/',
    apiKey: 'sk-abcdef1234567890',
  })

  assert.equal(entry.apiKeyMasked, 'sk-a*7890')
  assert.equal(entry.baseUrl, 'https://api.minimax.cn/v1')

  // 密文列里不能出现明文
  const { query } = await import('@/server/lib/db')
  const [row] = await query<{ api_key_enc: string }>(
    `SELECT api_key_enc FROM ai_models WHERE id = $1`,
    [entry.id],
  )
  assert.ok(row?.api_key_enc)
  assert.ok(!row.api_key_enc.includes('abcdef1234567890'))
  assert.equal(row.api_key_enc.startsWith('v1:'), true)
})

test('updateModelEntry：空串密钥保留原密钥', { skip }, async () => {
  const entry = await createModelEntry({
    name: '视觉理解',
    purpose: 'vlm',
    provider: 'MiniMax',
    protocol: 'anthropic',
    model: 'MiniMax-VLM-1',
    apiKey: 'vlm-original-key',
  })

  const updated = await updateModelEntry(entry.id, {
    name: '视觉理解 v2',
    apiKey: '',
  })

  assert.equal(updated.name, '视觉理解 v2')
  assert.equal(updated.apiKeyMasked, 'vlm-*-key')
})

test('用途与协议不匹配被 400 拒绝', { skip }, async () => {
  await assert.rejects(
    () =>
      createModelEntry({
        name: '错误组合',
        purpose: 'embedding',
        provider: 'X',
        protocol: 'anthropic',
        model: 'e3',
      }),
    (err: { status?: number }) => err.status === 400,
  )
})

test('同用途默认条目只留一个：新默认顶掉旧的', { skip }, async () => {
  const first = await createModelEntry({
    name: 'ASR 一号',
    purpose: 'asr',
    provider: 'MiniMax',
    protocol: 'minimax',
    model: 'asr-1.0',
    apiKey: 'asr-key-1',
    isDefault: true,
  })
  const second = await createModelEntry({
    name: 'ASR 二号',
    purpose: 'asr',
    provider: 'MiniMax',
    protocol: 'minimax',
    model: 'asr-1.0',
    apiKey: 'asr-key-2',
    isDefault: true,
  })

  const entries = await listModelEntries()
  const asr = entries.filter((e) => e.purpose === 'asr')
  assert.equal(asr.length, 2)
  assert.equal(asr.find((e) => e.id === first.id)?.isDefault, false)
  assert.equal(asr.find((e) => e.id === second.id)?.isDefault, true)
})

test('ASR 渠道：未配置时禁用占位；配置默认条目后即刻生效', { skip }, async () => {
  // 清掉本文件其他用例留下的 asr 条目，占位判定只与本用例有关
  const { query } = await import('@/server/lib/db')
  await query(`DELETE FROM ai_models WHERE purpose = 'asr'`)

  const before = await getAsrChannel()
  assert.equal(before.modelId, null)
  assert.equal(before.status, 'disabled')
  assert.equal(before.protocol, 'minimax')

  await createModelEntry({
    name: '转写渠道',
    purpose: 'asr',
    provider: 'MiniMax',
    protocol: 'minimax',
    model: 'asr-1.0',
    baseUrl: 'https://api.minimax.cn',
    apiKey: 'asr-channel-key',
    isDefault: true,
  })

  const channel = await getAsrChannel()
  assert.equal(channel.provider, 'MiniMax')
  assert.equal(channel.model, 'asr-1.0')
  assert.equal(channel.baseUrl, 'https://api.minimax.cn')
  assert.equal(channel.status, 'active')
  assert.equal(channel.hotwordSupported, false)
  assert.equal(channel.apiKeyMasked, 'asr-*-key')
})

test('任务绑定：主备必须同用途，备用不能与主相同，未知槽位被拒', { skip }, async () => {
  const llmA = await createModelEntry({
    name: 'LLM A',
    purpose: 'llm',
    provider: 'P',
    protocol: 'openai',
    model: 'm1',
    apiKey: 'llm-key-a',
  })
  const llmB = await createModelEntry({
    name: 'LLM B',
    purpose: 'llm',
    provider: 'P',
    protocol: 'openai',
    model: 'm2',
    apiKey: 'llm-key-b',
  })
  const vlm = await createModelEntry({
    name: 'VLM',
    purpose: 'vlm',
    provider: 'P',
    protocol: 'openai',
    model: 'v1',
    apiKey: 'vlm-key',
  })

  const bound = await updateTaskBinding({
    task: 'content.section_draft',
    primaryModelId: llmA.id,
    backupModelId: llmB.id,
  })
  assert.equal(bound.primaryModelId, llmA.id)
  assert.equal(bound.backupModelId, llmB.id)

  const list = await listTaskBindings()
  const slot = list.find((s) => s.task === 'content.section_draft')
  assert.equal(slot?.primaryModelName, 'LLM A')

  await assert.rejects(
    () => updateTaskBinding({ task: 'content.section_draft', primaryModelId: vlm.id, backupModelId: null }),
    (err: { status?: number }) => err.status === 400,
  )
  await assert.rejects(
    () => updateTaskBinding({ task: 'content.section_draft', primaryModelId: llmA.id, backupModelId: llmA.id }),
    (err: { status?: number }) => err.status === 400,
  )
  await assert.rejects(
    () => updateTaskBinding({ task: 'nope.slot', primaryModelId: llmA.id, backupModelId: null }),
    (err: { status?: number }) => err.status === 400,
  )

  // 清理：绑定表有外键，先删条目再验删除
  await updateTaskBinding({ task: 'content.section_draft', primaryModelId: llmB.id, backupModelId: null })
  await deleteModelEntry(llmA.id)
  const entries = await listModelEntries()
  assert.equal(entries.some((e) => e.id === llmA.id), false)
})

test('封存可解封：roundtrip；密文被篡改按未配置处理', { skip }, async () => {
  const { sealSecret, openSecret } = await import('@/server/lib/crypto')
  const sealed = sealSecret('roundtrip-secret')
  assert.equal(openSecret(sealed), 'roundtrip-secret')

  // 篡改密文段：解封失败不抛错，按未配置返回 null
  const parts = sealed.split(':')
  const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${'x'.repeat((parts[3]?.length ?? 4) || 4)}`
  assert.equal(openSecret(tampered), null)
})
