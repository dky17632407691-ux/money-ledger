// 模拟「预览面板受限 iframe」场景：让 localStorage 抛 SecurityError，看应用是否白屏
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9339
const SITE = process.argv[2] || 'https://2111995074905313280.app.workbuddy.host/'

const userDir = path.resolve('.chrome-sandbox-profile')
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
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[console.${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    logs.push(`[exception] ${d.text} ${d.exception?.description || ''}`.slice(0, 400))
  }
}
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method, params }))
})

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

// 模拟 Sandbox iframe 无 allow-same-origin：storage 访问一律抛错
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const boom = () => { throw new DOMException('The operation is insecure.', 'SecurityError') }
    const fake = { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }
    try { Object.defineProperty(window, 'localStorage', { get: () => fake, configurable: true }) } catch (e) {}
    try { Object.defineProperty(window, 'sessionStorage', { get: () => fake, configurable: true }) } catch (e) {}
  })()`,
})

await send('Page.navigate', { url: SITE })
await sleep(5000)

const probe = await send('Runtime.evaluate', {
  expression: `(() => {
    const boot = document.querySelector('#boot')
    const auth = document.querySelector('#auth-view')
    const bodyText = (document.body.innerText || '').trim().slice(0, 120)
    return JSON.stringify({
      bootVisible: !!boot && getComputedStyle(boot).display !== 'none',
      bootText: boot ? (boot.innerText || '').trim().slice(0, 40) : null,
      authHidden: auth ? auth.classList.contains('hidden') : null,
      bodyTextLen: (document.body.innerText || '').trim().length,
      bodyText,
    })
  })()`,
  returnByValue: true,
})

console.log('页面状态:', probe.result?.result?.value)
console.log('控制台输出:')
console.log(logs.slice(0, 20).join('\n') || '(无)')

ws.close()
chrome.kill()
