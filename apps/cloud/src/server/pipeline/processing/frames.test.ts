import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rename } from 'node:fs/promises'
import { mkdtempSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { moveFile, parseFrameStats, parseSceneTimes, passesQualityGate } from './frames'

const STATS_SAMPLE = `frame:0    pts:0       pts_time:0
lavfi.signalstats.YAVG=110.5
lavfi.signalstats.YHIGH=180
lavfi.signalstats.YLOW=40
frame:1    pts:15360   pts_time:15
lavfi.signalstats.YAVG=12
lavfi.signalstats.YHIGH=20
lavfi.signalstats.YLOW=2
`

test('解析 signalstats 输出：每帧一组亮度与对比度', () => {
  const stats = parseFrameStats(STATS_SAMPLE)

  assert.equal(stats.length, 2)
  assert.equal(stats[0]?.index, 0)
  assert.equal(stats[0]?.atMs, 0)
  assert.equal(stats[0]?.luma, 110.5)
  assert.equal(stats[0]?.contrast, 140)
  assert.equal(stats[1]?.index, 1)
  assert.equal(stats[1]?.atMs, 15_000)
})

test('场景切点：按 score ≥ 阈值判定，时间取帧头 pts_time', () => {
  // ffmpeg 8.x 的 scdet 只吐 mafd/score，没有 scd.time。
  const times = parseSceneTimes(
    `frame:0    pts:0       pts_time:0
lavfi.scd.mafd=0.000
lavfi.scd.score=0.000
frame:200  pts:102400  pts_time:8
lavfi.scd.mafd=40.500
lavfi.scd.score=12.500
frame:400  pts:204800  pts_time:16
lavfi.scd.mafd=41.200
lavfi.scd.score=9.750
frame:600  pts:307200  pts_time:24
lavfi.scd.mafd=2.000
lavfi.scd.score=1.250
`,
  )

  assert.deepEqual(times, [8_000, 16_000])
})

test('场景切点：老版本的 scd.time 仍然认', () => {
  const times = parseSceneTimes(
    `lavfi.scd.time=30.5
lavfi.scd.mafd=120
lavfi.scd.time=12.25
lavfi.scd.time=-1
`,
  )

  assert.deepEqual(times, [12_250, 30_500])
})

test('质量门：黑屏与纯色被挡，正常画面放行', () => {
  // 黑屏：亮度太低
  assert.equal(passesQualityGate({ luma: 8, contrast: 60 }), false)
  // 过曝：亮度太高
  assert.equal(passesQualityGate({ luma: 250, contrast: 60 }), false)
  // 纯色：对比度不足
  assert.equal(passesQualityGate({ luma: 120, contrast: 3 }), false)
  // 正常画面
  assert.equal(passesQualityGate({ luma: 120, contrast: 40 }), true)
})

test('moveFile：同卷移动', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mv-same-'))
  const from = join(dir, 'a.jpg')
  const to = join(dir, 'b.jpg')
  writeFileSync(from, 'hello')

  await moveFile(from, to)

  assert.ok(!existsSync(from))
  assert.equal(readFileSync(to, 'utf8'), 'hello')
})

test('moveFile：跨卷回退复制（EXDEV，生产容器 /data 与 /media 异卷的真实故障）', {
  skip: crossDevicePair() ? false : '本机找不到两个不同设备的可写目录，跨设备回退只在生产容器/部分 Linux 上可复现',
}, async () => {
  const [fromDir, toDir] = crossDevicePair()!
  const from = join(fromDir, `mv-exdev-${process.pid}-${Date.now()}.jpg`)
  const to = join(toDir, `mv-exdev-${process.pid}-${Date.now()}.jpg`)
  writeFileSync(from, 'cross-device')

  // 先证明这对目录确实跨设备（rename 会抛 EXDEV），再验证回退可用
  assert.notEqual(statSync(fromDir).dev, statSync(toDir).dev)
  await assert.rejects(() => rename(from, to), { code: 'EXDEV' })

  await moveFile(from, to)

  assert.ok(!existsSync(from))
  assert.equal(readFileSync(to, 'utf8'), 'cross-device')
})

/** 找一对分属不同设备的可写目录；找不到返回 null（跳过用例）。 */
function crossDevicePair(): [string, string] | null {
  const candidates = ['/dev/shm', '/tmp', tmpdir()]
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i]!
      const b = candidates[j]!
      try {
        if (statSync(a).dev !== statSync(b).dev) return [a, b]
      } catch {
        /* 目录不存在（如 macOS 无 /dev/shm） */
      }
    }
  }
  return null
}
