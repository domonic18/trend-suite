import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CALC_FORMULAS,
  GENERATORS,
  GENERATOR_BARS_MAX,
  GENERATOR_BARS_MIN,
  calcFormula,
  calcParamsInBounds,
  classifyShape,
  generateBars,
  mulberry32,
} from '../src/index'

/**
 * 课件生成器与计算公式（arch/06 §9）：
 * - **可重放**：同 (generator, seed, bars) 必得逐字节一致的结果（验收③）；
 * - **形态自洽**：生成器产出的 bars 归类回自己的形态（声明形态 == 实际形态）；
 * - **公式可复算**：示例答案能被同一份公式算出来，越界返回 null（不猜）。
 */

test('生成器可重放：同 (generator, seed, bars) 两次生成逐字节一致', () => {
  for (const generator of GENERATORS) {
    const a = generateBars(generator, 20240101, 40)
    const b = generateBars(generator, 20240101, 40)
    assert.deepEqual(a, b, `${generator} 同种子必得同结果`)
  }
})

test('生成器不同种子给出不同结果（否则「可重放」是假的）', () => {
  const a = generateBars('uptrend', 1, 40)
  const b = generateBars('uptrend', 2, 40)
  assert.notDeepEqual(a, b)
})

test('生成器结果落在参数域内：根数、日期、OHLC 自洽', () => {
  const bars = generateBars('uptrend', 7, 25)
  assert.equal(bars.length, 25)
  for (const bar of bars) {
    assert.match(bar.d, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(bar.h >= bar.l, '最高 ≥ 最低')
    assert.ok(bar.h >= bar.o && bar.h >= bar.c, '最高 ≥ 开/收')
    assert.ok(bar.l <= bar.o && bar.l <= bar.c, '最低 ≤ 开/收')
    assert.ok(bar.v > 0)
  }
})

test('形态归类自洽：五个生成器各自归类回自己', () => {
  for (const generator of GENERATORS) {
    for (const bars of [GENERATOR_BARS_MIN, 60, GENERATOR_BARS_MAX]) {
      assert.equal(
        classifyShape(generateBars(generator, 20240101, bars)),
        generator,
        `${generator} @ ${bars} 根应归类为自身`,
      )
    }
  }
})

test('mulberry32 是确定性的种子化 PRNG', () => {
  const a = mulberry32(99)
  const b = mulberry32(99)
  const seqA = [a(), a(), a()]
  const seqB = [b(), b(), b()]
  assert.deepEqual(seqA, seqB)
  assert.ok(seqA.every((value) => value >= 0 && value < 1))
})

test('计算公式可复算：risk-reward / position-size / drawdown-recovery', () => {
  assert.equal(
    calcFormula('risk-reward', { entryPrice: 100, stopPrice: 90, targetPrice: 130 }),
    3,
  )
  // 可承受亏损 1000×2% = 20 元，每股风险 10 元 → 2 股（向下取整）。
  assert.equal(
    calcFormula('position-size', {
      accountEquity: 1000,
      riskPerTradePct: 2,
      entryPrice: 100,
      stopPrice: 90,
    }),
    2,
  )
  assert.equal(calcFormula('drawdown-recovery', { drawdownPct: 50 }), 100)
})

test('计算公式越界返回 null（不猜、不给假答案）', () => {
  assert.equal(calcFormula('risk-reward', { entryPrice: 90, stopPrice: 100, targetPrice: 130 }), null)
  assert.equal(calcFormula('drawdown-recovery', { drawdownPct: 0 }), null)
  assert.equal(calcFormula('drawdown-recovery', { drawdownPct: 100 }), null)
  assert.equal(
    calcFormula('position-size', {
      accountEquity: 1000,
      riskPerTradePct: 9,
      entryPrice: 100,
      stopPrice: 90,
    }),
    null,
  )
})

test('参数域判定与公式复算一致（越界的必判不过）', () => {
  for (const formula of CALC_FORMULAS) {
    assert.equal(
      calcParamsInBounds(formula, {
        accountEquity: 1000,
        riskPerTradePct: 2,
        entryPrice: 100,
        stopPrice: 90,
        targetPrice: 130,
        drawdownPct: 20,
      }),
      true,
      `${formula} 合域参数应通过`,
    )
  }
  assert.equal(calcParamsInBounds('risk-reward', { entryPrice: 100, stopPrice: 90 }), false)
  assert.equal(calcParamsInBounds('drawdown-recovery', { drawdownPct: 120 }), false)
})
