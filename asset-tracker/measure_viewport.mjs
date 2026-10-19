// 用 CDP 精确模拟 iPhone 视口，测量弹层布局是否溢出，并截图
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333
const URL_TO_OPEN = process.argv[2] || 'http://127.0.0.1:8848/_test_sheet.html'
const OUT_PNG = process.argv[3] || '_probe390.png'
const WIDTH = Number(process.argv[4] || 390)
const HEIGHT = Number(process.argv[5] || 844)

const userDir = path.resolve('.chrome-probe-profile')
fs.rmSync(userDir, { recursive: true, force: true })

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' })

async function getJson(p) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`)
  return res.json()
}

let version
for (let i = 0; i < 40; i++) {
  try { version = await getJson('/json/version'); break } catch { await sleep(250) }
}
if (!version) { console.error('chrome 未启动'); chrome.kill(); process.exit(1) }

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })

let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: 3, mobile: true,
})
await send('Emulation.setTouchEmulationEnabled', { enabled: true })
await send('Page.navigate', { url: URL_TO_OPEN })
await sleep(2500)

const expr = `(() => {
  const w = el => el ? Math.round(el.getBoundingClientRect().width) : -1;
  const chain = ['.sheet', '.sheet__panel', '.sheet__head', '.sheet__body', '.form-grid', '.segmented', '.amount-input', '.chips', '.form-grid--2', '.chip'];
  const rows = chain.map(sel => {
    const el = document.querySelector(sel);
    if (!el) return sel + ' (null)';
    const cs = getComputedStyle(el);
    return sel + ' w=' + w(el)
      + ' cssW=' + cs.width + ' minW=' + cs.minWidth
      + ' pad=' + cs.paddingLeft + '/' + cs.paddingRight
      + ' box=' + cs.boxSizing + ' disp=' + cs.display;
  });
  const over = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 0.5) {
      over.push((el.className || el.tagName) + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width));
    }
  });
  return JSON.stringify({
    innerWidth: window.innerWidth,
    docScrollW: document.documentElement.scrollWidth,
    chain: rows,
    overflowCount: over.length,
    overflow: over.slice(0, 6),
  }, null, 1);
})()`

const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
console.log('=== 测量结果（' + WIDTH + 'x' + HEIGHT + '）===')
console.log(res.result?.result?.value || JSON.stringify(res.result))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
if (shot.result?.data) {
  fs.writeFileSync(OUT_PNG, Buffer.from(shot.result.data, 'base64'))
  console.log('截图已保存: ' + OUT_PNG)
}

ws.close()
chrome.kill()
await sleep(300)
fs.rmSync(userDir, { recursive: true, force: true })
