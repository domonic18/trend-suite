/**
 * 课件图表的确定性生成器与计算公式（arch/06 §9）。
 *
 * 铁律「图表数值不由模型生成」：模型只给 generator + seed + bars 根数，
 * 数值一律由这里合成——同 (generator, seed, bars) 复算逐字节一致，
 * 服务端与渲染器同源实现。跨端共享（云端服务端 / 管理台预览 / 学员端），
 * 故落契约包，两端 import 同一份，绝不各写一套。
 */

export const GENERATORS = [
  'uptrend',
  'downtrend',
  'range',
  'uptrend-platform',
  'downtrend-platform',
] as const
export type Generator = (typeof GENERATORS)[number]

export const CALC_FORMULAS = ['position-size', 'risk-reward', 'drawdown-recovery'] as const
export type CalcFormula = (typeof CALC_FORMULAS)[number]

/** 一根 K 线（与 contracts/market.ts 的 klineBar 同形状）。 */
export type WidgetBar = {
  d: string
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** 生成器参数域（arch/06 §9）：bars 20–120，seed 非负整数 < 2³¹。 */
export const GENERATOR_BARS_MIN = 20
export const GENERATOR_BARS_MAX = 120
export const GENERATOR_SEED_MAX = 2 ** 31

/** 形态归类的数值门槛（classifyShape 用；arch/06 §9 只说「形态归类」，此处定死口径）。 */
const SHAPE_SLOPE_THRESHOLD = 0.2
const SHAPE_PLATFORM_RATIO = 0.2
/** 平台形态的判定用「后 40% 区间的净漂移 / 全程净漂移」。 */
const PLATFORM_SEGMENT_RATIO = 0.6

const START_PRICE = 100
const DRIFT = 0.01
const RANGE_AMPLITUDE = 0.03
const NOISE_TREND = 0.004
const NOISE_RANGE = 0.001
const WICK = 0.0025
const VOLUME_BASE = 100_000

/** 种子化 PRNG（mulberry32）：同 seed 必得同一串数——可重放的前提。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 合成 K 线的交易日序列：自 2020-01-02 起的连续工作日（跳过周末）。 */
function barDates(count: number): string[] {
  const out: string[] = []
  let day = Date.UTC(2020, 0, 2)
  while (out.length < count) {
    const date = new Date(day)
    const weekday = date.getUTCDay()
    if (weekday !== 0 && weekday !== 6) out.push(date.toISOString().slice(0, 10))
    day += 86_400_000
  }
  return out
}

/** 各生成器的目标价曲线（不含噪声）。 */
function targetPrice(generator: Generator, i: number, count: number, phase: number): number {
  const platformAt = Math.floor(count * PLATFORM_SEGMENT_RATIO)
  switch (generator) {
    case 'uptrend':
      return START_PRICE * Math.pow(1 + DRIFT, i)
    case 'downtrend':
      return START_PRICE * Math.pow(1 - DRIFT, i)
    case 'range':
      // 两个完整周期 → 全程净漂移与回归斜率都归零（震荡市）
      return START_PRICE * (1 + RANGE_AMPLITUDE * Math.sin((2 * Math.PI * i) / (count / 2) + phase))
    case 'uptrend-platform':
      return i < platformAt
        ? START_PRICE * Math.pow(1 + DRIFT, i)
        : START_PRICE * Math.pow(1 + DRIFT, platformAt - 1)
    case 'downtrend-platform':
      return i < platformAt
        ? START_PRICE * Math.pow(1 - DRIFT, i)
        : START_PRICE * Math.pow(1 - DRIFT, platformAt - 1)
  }
}

/**
 * 生成一段 K 线：同 (generator, seed, count) 必得逐字节一致的结果。
 * 形态由曲线本身决定（classifyShape 只看 bars，不看声明值）。
 */
export function generateBars(generator: Generator, seed: number, count: number): WidgetBar[] {
  const rnd = mulberry32(seed)
  const phase = rnd() * Math.PI * 2
  const dates = barDates(count)
  const noiseAmp = generator === 'range' ? NOISE_RANGE : NOISE_TREND
  const bars: WidgetBar[] = []
  let prevClose = START_PRICE
  for (let i = 0; i < count; i += 1) {
    const target = targetPrice(generator, i, count, phase)
    const close = target * (1 + (rnd() * 2 - 1) * noiseAmp)
    const open = i === 0 ? close * (1 - WICK) : prevClose
    const high = Math.max(open, close) * (1 + WICK)
    const low = Math.min(open, close) * (1 - WICK)
    const volume = Math.round(VOLUME_BASE * (0.6 + 0.8 * rnd()))
    bars.push({
      d: dates[i]!,
      o: round2(open),
      h: round2(high),
      l: round2(low),
      c: round2(close),
      v: volume,
    })
    prevClose = close
  }
  return bars
}

/** 最小二乘斜率：收盘价对下标的斜率（每根 bar 的价格变化）。 */
export function olsSlope(bars: readonly WidgetBar[]): number {
  const n = bars.length
  if (n < 2) return 0
  const meanX = (n - 1) / 2
  const meanY = bars.reduce((sum, bar) => sum + bar.c, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX
    num += dx * (bars[i]!.c - meanY)
    den += dx * dx
  }
  return den === 0 ? 0 : num / den
}

/** 平均真实波幅（TR = max(h−l, |h−prevClose|, |l−prevClose|)）：断言容差的尺度。 */
export function meanTrueRange(bars: readonly WidgetBar[]): number {
  if (bars.length === 0) return 0
  let sum = 0
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i]!
    const prevClose = i === 0 ? bar.o : bars[i - 1]!.c
    sum += Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose))
  }
  return sum / bars.length
}

/** 形态归类：只依据 bars 本身（声明值不参与）——「声明形态 == 实际形态」才判得过。 */
export function classifyShape(bars: readonly WidgetBar[]): Generator {
  if (bars.length < 2) return 'range'
  const slope = olsSlope(bars)
  const scale = meanTrueRange(bars)
  const normalized = scale === 0 ? 0 : slope / scale
  const first = bars[0]!.c
  const last = bars[bars.length - 1]!.c
  const drift = first === 0 ? 0 : (last - first) / first
  const segmentStart = Math.floor(bars.length * PLATFORM_SEGMENT_RATIO)
  const segmentBase = bars[segmentStart]!.c
  const segmentDrift = segmentBase === 0 ? 0 : (last - segmentBase) / segmentBase
  const platformRatio = drift === 0 ? 0 : Math.abs(segmentDrift / drift)

  if (normalized > SHAPE_SLOPE_THRESHOLD) {
    return platformRatio < SHAPE_PLATFORM_RATIO ? 'uptrend-platform' : 'uptrend'
  }
  if (normalized < -SHAPE_SLOPE_THRESHOLD) {
    return platformRatio < SHAPE_PLATFORM_RATIO ? 'downtrend-platform' : 'downtrend'
  }
  return 'range'
}

// ---------------------------------------------------------------- calc-trainer 公式白名单

/** 参数域描述（不含跨字段约束，那部分由公式函数判定）。 */
export type CalcParamBound = {
  exclusiveMin?: number
  exclusiveMax?: number
  min?: number
  max?: number
}

export const CALC_PARAM_DOMAINS: Record<CalcFormula, Record<string, CalcParamBound>> = {
  'position-size': {
    accountEquity: { exclusiveMin: 0 },
    riskPerTradePct: { exclusiveMin: 0, max: 5 },
    entryPrice: { exclusiveMin: 0 },
    stopPrice: { exclusiveMin: 0 },
  },
  'risk-reward': {
    entryPrice: { exclusiveMin: 0 },
    stopPrice: { exclusiveMin: 0 },
    targetPrice: { exclusiveMin: 0 },
  },
  'drawdown-recovery': {
    drawdownPct: { exclusiveMin: 0, exclusiveMax: 100 },
  },
}

/** 公式参数名（契约校验用：inputs 的键必须落此集合）。 */
export const CALC_PARAM_KEYS: Record<CalcFormula, string[]> = {
  'position-size': ['accountEquity', 'riskPerTradePct', 'entryPrice', 'stopPrice'],
  'risk-reward': ['entryPrice', 'stopPrice', 'targetPrice'],
  'drawdown-recovery': ['drawdownPct'],
}

/**
 * 按公式复算示例值。参数越界或跨字段约束不成立 → 返回 null（判不过，不猜）。
 * - position-size：可承受亏损额 ÷ 每股风险 = 股数（向下取整）
 * - risk-reward：止盈空间 ÷ 止损空间
 * - drawdown-recovery：回撤 d% 后回到原点所需涨幅
 */
export function calcFormula(formula: CalcFormula, inputs: Record<string, number>): number | null {
  switch (formula) {
    case 'position-size': {
      const { accountEquity, riskPerTradePct, entryPrice, stopPrice } = inputs
      if (
        accountEquity === undefined ||
        riskPerTradePct === undefined ||
        entryPrice === undefined ||
        stopPrice === undefined
      ) {
        return null
      }
      if (accountEquity <= 0 || riskPerTradePct <= 0 || riskPerTradePct > 5) return null
      if (entryPrice <= stopPrice || stopPrice <= 0) return null
      return Math.floor((accountEquity * (riskPerTradePct / 100)) / (entryPrice - stopPrice))
    }
    case 'risk-reward': {
      const { entryPrice, stopPrice, targetPrice } = inputs
      if (entryPrice === undefined || stopPrice === undefined || targetPrice === undefined) return null
      if (entryPrice <= stopPrice || stopPrice <= 0 || targetPrice <= entryPrice) return null
      return (targetPrice - entryPrice) / (entryPrice - stopPrice)
    }
    case 'drawdown-recovery': {
      const { drawdownPct } = inputs
      if (drawdownPct === undefined) return null
      if (drawdownPct <= 0 || drawdownPct >= 100) return null
      return (100 / (100 - drawdownPct) - 1) * 100
    }
  }
}

/** 参数是否落在公式声明的域内（含跨字段约束）。 */
export function calcParamsInBounds(formula: CalcFormula, inputs: Record<string, number>): boolean {
  const domain = CALC_PARAM_DOMAINS[formula]
  for (const key of CALC_PARAM_KEYS[formula]) {
    const value = inputs[key]
    const bound = domain[key]
    if (value === undefined || bound === undefined) return false
    if (!Number.isFinite(value)) return false
    if (bound.exclusiveMin !== undefined && !(value > bound.exclusiveMin)) return false
    if (bound.exclusiveMax !== undefined && !(value < bound.exclusiveMax)) return false
    if (bound.min !== undefined && !(value >= bound.min)) return false
    if (bound.max !== undefined && !(value <= bound.max)) return false
  }
  return calcFormula(formula, inputs) !== null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
