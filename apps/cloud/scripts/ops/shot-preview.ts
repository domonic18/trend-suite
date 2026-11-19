/**
 * 预览页目检（临时脚本）：用 Chrome DevTools Protocol 驱动无头浏览器，
 * 登录后打开正文预览页，截图 + 点事实锚点再截图。仅本机目检用。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3940'
const TOKEN = process.argv[2]!
const TARGET_URL = process.argv[3]!
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
/** 额外 Chrome 启动参数（用 | 分隔，值里可含空格）：如 --host-resolver-rules=… */
const EXTRA_ARGS = (process.env.SHOT_CHROME_ARGS ?? '').split('|').filter(Boolean)

const userDataDir = mkdtempSync(join(tmpdir(), 'trend-chrome-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9333',
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--window-size=1440,2400',
  ...EXTRA_ARGS,
  'about:blank',
])
chrome.stderr.on('data', () => {})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForDevtools(): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:9333/json/version')
      const info = (await res.json()) as { webSocketDebuggerUrl: string }
      return info.webSocketDebuggerUrl
    } catch {
      await sleep(250)
    }
  }
  throw new Error('DevTools 未就绪')
}

class Cdp {
  private id = 0
  private pending = new Map<number, (v: unknown) => void>()
  private ws: WebSocket
  constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown }
      if (msg.id !== undefined) {
        this.pending.get(msg.id)?.(msg.result)
        this.pending.delete(msg.id)
      }
    })
  }
  send(method: string, params: unknown = {}, sessionId?: string): Promise<unknown> {
    this.id += 1
    const id = this.id
    const payload = { id, method, params }
    if (sessionId) Object.assign(payload, { sessionId })
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify(payload))
    })
  }
}

async function main() {
  const wsUrl = await waitForDevtools()
  const ws = new WebSocket(wsUrl)
  await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve()))
  const cdp = new Cdp(ws)

  const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as {
    targetId: string
  }
  const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as {
    sessionId: string
  }

  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)

  // 先落到同源页面，注入令牌（sessionStorage），再开预览页
  await cdp.send('Page.navigate', { url: `${BASE}/login` }, sessionId)
  await sleep(2500)
  await cdp.send(
    'Runtime.evaluate',
    { expression: `sessionStorage.setItem('trend-suite.session.token', ${JSON.stringify(TOKEN)})` },
    sessionId,
  )
  await cdp.send('Page.navigate', { url: TARGET_URL }, sessionId)
  await sleep(4000)

  const shot = async (name: string) => {
    const { data } = (await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true },
      sessionId,
    )) as { data: string }
    writeFileSync(`/tmp/${name}.png`, Buffer.from(data, 'base64'))
    console.log(`[shot] /tmp/${name}.png`)
  }

  /** 截取含指定文字的课件盒（只看课件，不看整页长图）。 */
  const shotBox = async (name: string, needle: string, selector = '.widget-box') => {
    const rect = (await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const box = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.innerText.includes(${JSON.stringify(needle)}));
          if (!box) return null;
          const r = box.getBoundingClientRect();
          return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
        })()`,
        returnByValue: true,
      },
      sessionId,
    )) as { result?: { value?: { x: number; y: number; width: number; height: number } | null } }
    const box = rect.result?.value
    if (!box) {
      console.log(`[shot] ${name}: 找不到「${needle}」`)
      return
    }
    const { data } = (await cdp.send(
      'Page.captureScreenshot',
      {
        format: 'png',
        captureBeyondViewport: true,
        clip: { ...box, scale: 1 },
      },
      sessionId,
    )) as { data: string }
    writeFileSync(`/tmp/${name}.png`, Buffer.from(data, 'base64'))
    console.log(`[shot] /tmp/${name}.png`)
  }
  await shot('preview-full')

  // 点事实锚点（正文里的 [[unit:…]] 按钮），看回溯卡是否弹出
  const clicked = (await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const btn = document.querySelector('.unit-anchor');
        if (!btn) return 'no-anchor';
        btn.click();
        return btn.textContent || '';
      })()`,
      returnByValue: true,
    },
    sessionId,
  )) as { result?: { value?: string } }
  console.log('[anchor]', JSON.stringify(clicked.result?.value))
  await sleep(1200)
  await shot('preview-anchor')

  // 点个股锚：看 K 线面板（无行情时应降级为「行情暂不可用」，不画假数）
  const stockClicked = (await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const btn = document.querySelector('.stock-chip');
        if (!btn) return 'no-stock';
        btn.click();
        return btn.textContent || '';
      })()`,
      returnByValue: true,
    },
    sessionId,
  )) as { result?: { value?: string } }
  console.log('[stock]', JSON.stringify(stockClicked.result?.value))
  await sleep(2500)
  await shot('preview-stock')
  await shotBox('preview-stock-kline', '', '.kline-preview')

  const text = (await cdp.send(
    'Runtime.evaluate',
    { expression: 'document.body.innerText', returnByValue: true },
    sessionId,
  )) as { result?: { value?: string } }
  writeFileSync('/tmp/preview-text.txt', text.result?.value ?? '')
  console.log('[text] /tmp/preview-text.txt')

  // 课件：点一个选项看判题反馈（迭代 7 验收①：点得动、判得出）
  const answered = (await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const box = document.querySelectorAll('.widget-box');
        const target = [...box].find((b) => b.innerText.includes('概念选择'));
        const btn = target?.querySelector('.widget-option');
        if (!btn) return 'no-option';
        btn.click();
        return btn.textContent || '';
      })()`,
      returnByValue: true,
    },
    sessionId,
  )) as { result?: { value?: string } }
  console.log('[mcq-answer]', JSON.stringify(answered.result?.value))
  await sleep(1000)
  await shotBox('preview-widget-mcq', '概念选择')

  const mcqFeedback = (await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const box = [...document.querySelectorAll('.widget-box')].find((b) => b.innerText.includes('概念选择'));
        return box?.querySelector('.widget-feedback')?.innerText ?? 'no-feedback';
      })()`,
      returnByValue: true,
    },
    sessionId,
  )) as { result?: { value?: string } }
  console.log('[mcq-feedback]', JSON.stringify(mcqFeedback.result?.value))

  // 形态识别：选图判题（合成 K 线与真实行情同一画法）
  const pattern = (await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const box = [...document.querySelectorAll('.widget-box')].find((b) => b.innerText.includes('形态识别'));
        const tile = box?.querySelector('.widget-tile');
        if (!tile) return 'no-tile';
        tile.click();
        return tile.textContent || '';
      })()`,
      returnByValue: true,
    },
    sessionId,
  )) as { result?: { value?: string } }
  console.log('[pattern-click]', JSON.stringify(pattern.result?.value))
  await sleep(1000)
  await shotBox('preview-widget-pattern', '形态识别')

  // 逐根回放：连点几次「揭示下一根」，看遮罩是否单调推进（不预示后市）
  for (let i = 0; i < 4; i += 1) {
    await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const box = [...document.querySelectorAll('.widget-box')].find((b) => b.innerText.includes('逐根回放'));
          const btn = [...(box?.querySelectorAll('.widget-actions button') ?? [])].find((b) => b.textContent.includes('揭示下一根'));
          if (!btn || btn.disabled) return 'stopped';
          btn.click();
          return 'revealed';
        })()`,
        returnByValue: true,
      },
      sessionId,
    )
    await sleep(400)
  }
  await shotBox('preview-widget-replay', '逐根回放')

  // 回放判断点：选一个选项并提交，看揭晓与锁定（不可回改）
  await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const box = [...document.querySelectorAll('.widget-box')].find((b) => b.innerText.includes('逐根回放'));
        const opt = box?.querySelector('.widget-options .widget-option');
        if (!opt) return 'no-option';
        opt.click();
        return opt.textContent || '';
      })()`,
      returnByValue: true,
    },
    sessionId,
  )
  await sleep(500)
  const replayAnswer = (await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const box = [...document.querySelectorAll('.widget-box')].find((b) => b.innerText.includes('逐根回放'));
        const submit = [...(box?.querySelectorAll('.widget-actions button') ?? [])].find((b) => b.textContent.includes('提交作答'));
        if (!submit || submit.disabled) return 'submit-not-ready';
        submit.click();
        return 'submitted';
      })()`,
      returnByValue: true,
    },
    sessionId,
  )) as { result?: { value?: string } }
  console.log('[replay-answer]', JSON.stringify(replayAnswer.result?.value))
  await sleep(1200)
  await shotBox('preview-widget-replay-answered', '逐根回放')

  const replayText = (await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const box = [...document.querySelectorAll('.widget-box')].find((b) => b.innerText.includes('逐根回放'));
        return box?.innerText ?? 'no-replay';
      })()`,
      returnByValue: true,
    },
    sessionId,
  )) as { result?: { value?: string } }
  console.log('[replay]', JSON.stringify(replayText.result?.value))

  ws.close()
  chrome.kill()
}

main().catch((err) => {
  console.error(err)
  chrome.kill()
  process.exit(1)
})
