import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkFfmpegArgs, planChunks } from './chunk'

test('固定上限切块：每块不超过上限，连续且覆盖全时长', () => {
  const chunks = planChunks({ durationS: 1000, chunkSeconds: 480 })

  assert.equal(chunks.length, 3)
  assert.equal(chunks[0]?.startS, 0)
  assert.equal(chunks[0]?.endS, 480)
  assert.equal(chunks[2]?.endS, 1000)
  for (const chunk of chunks) {
    assert.ok(chunk.endS - chunk.startS <= 480)
  }
  // 块与块首尾相接，不留缝也不重叠
  for (let i = 1; i < chunks.length; i += 1) {
    assert.equal(chunks[i]?.startS, chunks[i - 1]?.endS)
  }
})

test('切点吸附静音点：切在静音上而不是硬切', () => {
  const chunks = planChunks({
    durationS: 1000,
    chunkSeconds: 480,
    silenceCuts: [300, 470],
  })

  assert.equal(chunks[0]?.endS, 470)
})

test('过早的静音点不用：太早会切出过短的块', () => {
  const chunks = planChunks({
    durationS: 1000,
    chunkSeconds: 480,
    silenceCuts: [10, 20],
  })

  assert.equal(chunks[0]?.endS, 480)
})

test('时长不足一块时只切一块', () => {
  const chunks = planChunks({ durationS: 120, chunkSeconds: 480 })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]?.endS, 120)
})

test('零时长不切块', () => {
  assert.deepEqual(planChunks({ durationS: 0 }), [])
})

test('切割参数：按块起点与时长给 ffmpeg', () => {
  const args = chunkFfmpegArgs({ index: 0, startS: 10, endS: 25 }, 'in.wav', 'out.wav')
  const ss = args.indexOf('-ss')
  const t = args.indexOf('-t')

  assert.equal(args[ss + 1], '10.000')
  assert.equal(args[t + 1], '15.000')
  assert.ok(args.includes('16000'))
})
