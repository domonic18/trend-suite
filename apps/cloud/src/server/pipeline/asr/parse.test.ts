import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_SEGMENT_MS,
  parseAsrResponse,
  splitLongSegments,
  toGlobalSegments,
} from './parse'

test('解析 MiniMax verbose_json：秒级时间戳换算成毫秒', () => {
  const result = parseAsrResponse({
    text: '大家好欢迎来到今天的课程',
    duration: 12.5,
    n_speakers: 2,
    segments: [
      { id: 1, start: 0, end: 3.2, speaker: 'speaker_0', text: '大家好' },
      { id: 2, start: 3.2, end: 8.75, speaker: 'speaker_1', text: '欢迎来到今天的课程' },
    ],
  })

  assert.equal(result.durationS, 12.5)
  assert.equal(result.speakerCount, 2)
  assert.equal(result.segments.length, 2)
  assert.equal(result.segments[0]?.startMs, 0)
  assert.equal(result.segments[0]?.endMs, 3200)
  assert.equal(result.segments[1]?.startMs, 3200)
  assert.equal(result.segments[1]?.endMs, 8750)
  assert.equal(result.segments[1]?.speaker, 'speaker_1')
  assert.equal(result.text, '大家好欢迎来到今天的课程')
})

test('毫秒制时间戳直接认，不再乘 1000', () => {
  const result = parseAsrResponse({
    segments: [{ start_ms: 1000, end_ms: 2500, text: '按毫秒给的' }],
  })

  assert.equal(result.segments[0]?.startMs, 1000)
  assert.equal(result.segments[0]?.endMs, 2500)
})

test('缺时间戳或空文本的段落被丢弃，全文由段落拼回', () => {
  const result = parseAsrResponse({
    text: '   ',
    segments: [
      { start: 0, end: 1, text: '有效段落' },
      { start: 2, text: '没有结束时间' },
      { start: 3, end: 4, text: '   ' },
    ],
  })

  assert.equal(result.segments.length, 1)
  assert.equal(result.text, '有效段落')
})

test('上游没给分段时，空结果而不是报错', () => {
  const result = parseAsrResponse({ text: '整段文本' })
  assert.equal(result.segments.length, 0)
  assert.equal(result.text, '整段文本')
  assert.equal(result.durationS, null)
})

test('时间戳归一：块内时间加块起点，且单调不重叠', () => {
  const global = toGlobalSegments(
    [
      { startMs: 2000, endMs: 4000, text: '第二段', speaker: null },
      { startMs: 0, endMs: 1500, text: '第一段', speaker: null },
      { startMs: 3000, endMs: 5000, text: '与前一段重叠', speaker: null },
    ],
    100_000,
  )

  assert.equal(global.length, 3)
  assert.equal(global[0]?.startMs, 100_000)
  assert.equal(global[0]?.endMs, 101_500)
  assert.equal(global[1]?.startMs, 102_000)
  // 重叠段落被裁到前一段终点之后，不产生倒挂
  assert.equal(global[2]?.startMs, 104_000)
  assert.equal(global[2]?.endMs, 105_000)
})

test('段落切分：超过 30 秒的段落被切开，每段不超上限', () => {
  const split = splitLongSegments([
    { startMs: 0, endMs: 95_000, text: '一整节课', speaker: null },
    { startMs: 95_000, endMs: 100_000, text: '正常段', speaker: null },
  ])

  assert.ok(split.length >= 4)
  for (const seg of split) {
    assert.ok(seg.endMs - seg.startMs <= MAX_SEGMENT_MS, `段过长：${seg.endMs - seg.startMs}`)
  }
  assert.equal(split[0]?.startMs, 0)
  assert.equal(split[split.length - 1]?.endMs, 100_000)
})
