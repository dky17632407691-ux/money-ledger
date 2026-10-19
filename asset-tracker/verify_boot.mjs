// 验证：屏蔽 jsDelivr（模拟 CDN 不可用）后，页面是否还能正常启动而不是停在启动遮罩
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9342
const SITE = process.argv[2] || 'http://127.0.0.1:8899/index.html'

const userDir = path.resolve('.chrome-boot-profile')
fs.rmSync(userDir, { recursive: true, force: true })

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' })

async function getJson(p) { return (await fetch(`http://127.0.0.1:${PORT}${p}`)).json() }
let ready = false
for (let i = 0; i < 60; i++) { try { await getJson('/json/version'); ready = true; break } catch { await sleep(250) } }
if (!ready) { console.error('chrome 未启动'); chrome.kill(); process.exit(1) }

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })

let id = 0
const pending = new Map()
const logs = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    logs.push(`[exception] ${d.text} ${d.exception?.description || ''}`.split('\n')[0].slice(0, 220))
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push('[console.error] ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 220))
  }
}
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method, params }))
})

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setBlockedURLs', { urls: ['*cdn.jsdelivr.net*'] })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

await send('Page.navigate', { url: SITE })
await sleep(6000)

const probe = await send('Runtime.evaluate', {
  expression: `(() => {
    const boot = document.querySelector('#boot')
    const auth = document.querySelector('#auth-view')
    const app = document.querySelector('#app')
    const vis = el => !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'
    return JSON.stringify({
      bootVisible: vis(boot),
      bootText: boot ? (boot.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : null,
      authVisible: vis(auth),
      appVisible: vis(app),
      sdkLoaded: typeof window.WorkBuddyCloud === 'object' && typeof window.WorkBuddyCloud.createWorkBuddyCloud === 'function',
    })
  })()`,
  returnByValue: true,
})

console.log('页面状态:', probe.result?.result?.value)
console.log('错误日志:', logs.length ? '\n' + logs.slice(0, 8).join('\n') : '(无)')

ws.close()
chrome.kill()
