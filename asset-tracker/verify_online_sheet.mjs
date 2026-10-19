// 在线上真实页面注入「记一笔」弹层结构，用线上 CSS 测量是否溢出，并截图
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9334
const SITE = process.argv[2] || 'https://2111995074905313280.app.workbuddy.host/'
const OUT_PNG = process.argv[3] || 'online-sheet.png'

const userDir = path.resolve('.chrome-online-profile')
fs.rmSync(userDir, { recursive: true, force: true })

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' })

async function getJson(p) { return (await fetch(`http://127.0.0.1:${PORT}${p}`)).json() }
let ready = false
for (let i = 0; i < 40; i++) { try { await getJson('/json/version'); ready = true; break } catch { await sleep(250) } }
if (!ready) { console.error('chrome 未启动'); chrome.kill(); process.exit(1) }

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })

let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method, params }))
})

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true })
await send('Page.navigate', { url: SITE })
await sleep(3500)

// 注入与 sheets.js 中 openRecordSheet 一致的弹层结构
const inject = `(() => {
  const html = \`
  <div class="sheet" id="probe-sheet" style="z-index:9999">
    <div class="sheet__backdrop"></div>
    <div class="sheet__panel">
      <div class="sheet__head"><div class="sheet__title">记一笔</div><button class="sheet__close" type="button">×</button></div>
      <div class="sheet__body">
        <div class="form-grid">
          <div class="segmented"><button class="segmented__btn is-active" type="button">支出</button><button class="segmented__btn" type="button">收入</button><button class="segmented__btn" type="button">转账</button></div>
          <div class="amount-input"><span class="amount-input__symbol">¥</span><input type="text" inputmode="decimal" placeholder="0.00"></div>
          <div class="form-row"><label>分类</label><div class="chips">
            <button class="chip" type="button">餐饮</button><button class="chip" type="button">买菜食材</button><button class="chip" type="button">交通出行</button><button class="chip" type="button">购物</button><button class="chip" type="button">游戏</button><button class="chip" type="button">数码电器</button><button class="chip" type="button">宠物</button>
          </div></div>
          <div class="form-grid form-grid--2">
            <div class="form-row"><label>账户</label><select class="select"><option>招商银行</option></select></div>
            <div class="form-row"><label>转入账户</label><select class="select"><option>支付宝</option></select></div>
          </div>
          <div class="form-grid form-grid--2">
            <div class="form-row"><label>日期</label><input class="input" type="date" value="2026-10-19"></div>
            <div class="form-row"><label>备注</label><input class="input" type="text" placeholder="选填"></div>
          </div>
        </div>
      </div>
      <div class="sheet__foot"><div style="display:flex;gap:10px;width:100%"><button class="btn btn--ghost" type="button">取消</button><button class="btn btn--primary" type="button">保存</button></div></div>
    </div>
  </div>\`;
  const d = document.createElement('div');
  d.innerHTML = html;
  document.body.appendChild(d.firstElementChild);
  return 'injected';
})()`
await send('Runtime.evaluate', { expression: inject, returnByValue: true })
await sleep(600)

const measure = `(() => {
  const w = el => el ? Math.round(el.getBoundingClientRect().width) : -1;
  const over = [];
  document.querySelectorAll('#probe-sheet *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 0.5) over.push((el.className || el.tagName) + ' right=' + Math.round(r.right));
  });
  const cs = getComputedStyle(document.querySelector('#probe-sheet .input'));
  return JSON.stringify({
    site: location.hostname,
    innerWidth: window.innerWidth,
    docScrollW: document.documentElement.scrollWidth,
    panel: w(document.querySelector('#probe-sheet .sheet__panel')),
    formGrid: w(document.querySelector('#probe-sheet .form-grid')),
    chips: w(document.querySelector('#probe-sheet .chips')),
    inputFontSize: cs.fontSize,
    overflowCount: over.length,
    overflow: over.slice(0, 6),
  }, null, 1);
})()`
const r = await send('Runtime.evaluate', { expression: measure, returnByValue: true })
console.log('=== 线上页面实测（390x844）===')
console.log(r.result?.result?.value || JSON.stringify(r.result))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
if (shot.result?.data) {
  fs.writeFileSync(OUT_PNG, Buffer.from(shot.result.data, 'base64'))
  console.log('截图: ' + OUT_PNG)
}

ws.close(); chrome.kill(); await sleep(300)
fs.rmSync(userDir, { recursive: true, force: true })
