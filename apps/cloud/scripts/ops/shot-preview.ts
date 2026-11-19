/**
 * 预览页目检（临时脚本）：用 Chrome DevTools Protocol 驱动无头浏览器，
 * 登录后打开正文预览页，截图 + 点事实锚点再截图。仅本机目检用。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:3940'
const TOKEN = process.argv[2]!
const TARGET_URL = process.argv[3]!
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const userDataDir = mkdtempSync(join(tmpdir(), 'trend-chrome-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9333',
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--window-size=1440,2400',
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

  const text = (await cdp.send(
    'Runtime.evaluate',
    { expression: 'document.body.innerText', returnByValue: true },
    sessionId,
  )) as { result?: { value?: string } }
  writeFileSync('/tmp/preview-text.txt', text.result?.value ?? '')
  console.log('[text] /tmp/preview-text.txt')

  ws.close()
  chrome.kill()
}

main().catch((err) => {
  console.error(err)
  chrome.kill()
  process.exit(1)
})
