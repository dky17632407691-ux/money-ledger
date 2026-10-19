// 用真实模块 + 真实 CSS 打开「编辑持仓」弹层，读出预览区文字，核对多币种折算
// 用法: node verify_holding_preview.mjs [站点根地址]
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9336
const SITE = process.argv[2] || 'http://127.0.0.1:8765/'
const OUT_PNG = process.argv[3] || 'holding-preview.png'

const userDir = path.resolve('.chrome-holding-profile')
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
await sleep(3000)

const script = `(async () => {
  // 版本号从 index.html 里取，保证 import 到的是页面正在用的那一份模块实例
  const html = await (await fetch('/index.html', { cache: 'no-store' })).text()
  const ver = (html.match(/js\\/app\\.js\\?v=([^"']+)/) || [])[1] || ''
  const q = ver ? '?v=' + ver : ''
  const stateMod = await import('/js/state.js' + q)
  const { state, setFxRates } = stateMod
  // 造一个投资账户 + 两条真实持仓用的汇率，模拟线上已取到汇率的状态
  state.accounts.push({ id: 'acc-probe', name: '证券账户', type: 'investment', is_archived: false })
  setFxRates({ USD: 6.6855, HKD: 0.9136 }, '2026-10-19 15:00:00')

  const sheets = await import('/js/sheets.js' + q)
  const out = { ver }

  // 0) 资产页整页渲染：用真实的两条持仓核对展示口径
  state.holdings.push(
    { id: 'h1', account_id: 'acc-probe', market: 'us', symbol: 'AAPL', name: '苹果', shares: 20, cost_price: 300, last_price: 343.46, prev_close: 340, change_pct: 1.02, price_time: '2026-10-18 16:00:00' },
    { id: 'h2', account_id: 'acc-probe', market: 'sz', symbol: '161128', name: '标普信息科技LOF', shares: 30, cost_price: 6.8, last_price: 7.424, prev_close: 7.4, change_pct: 0.32, price_time: '2026-10-18 15:00:00' },
  )
  const views = await import('/js/views.js' + q)
  const box = document.createElement('div')
  document.body.appendChild(box)
  try {
    views.renderAssets(box)
    out.assets = box.innerText
  } catch (err) {
    out.assets = '渲染失败: ' + (err && err.message)
  }
  box.remove()
  state.holdings.splice(state.holdings.length - 2, 2)

  // 1) 美股：苹果 20 股，成本 300，现价 343.46
  sheets.openHoldingSheet({
    id: 'h-us', account_id: 'acc-probe', market: 'us', symbol: 'AAPL', name: '苹果',
    shares: 20, cost_price: 300, last_price: 343.46, prev_close: 340, change_pct: 1.02,
    price_time: '2026-10-18 16:00:00',
  })
  out.us = document.querySelector('#hs-preview')?.innerText
  out.usHtml = document.querySelector('#hs-preview')?.innerHTML
  document.querySelector('.sheet')?.remove()

  // 2) 深市场内基金：30 份，成本 6.80，现价 7.4240（人民币，不应折算）
  sheets.openHoldingSheet({
    id: 'h-cny', account_id: 'acc-probe', market: 'sz', symbol: '161128', name: '标普信息科技LOF',
    shares: 30, cost_price: 6.8, last_price: 7.424, prev_close: 7.4, change_pct: 0.32,
    price_time: '2026-10-18 15:00:00',
  })
  out.cny = document.querySelector('#hs-preview')?.innerText
  document.querySelector('.sheet')?.remove()

  // 3) 汇率缺失时不能假装是人民币
  state.fx.USD = 0
  state.fx.HKD = 0
  sheets.openHoldingSheet({
    id: 'h-us2', account_id: 'acc-probe', market: 'us', symbol: 'AAPL', name: '苹果',
    shares: 20, cost_price: 300, last_price: 343.46, prev_close: 340, change_pct: 1.02,
  })
  out.noFx = document.querySelector('#hs-preview')?.innerText
  document.querySelector('.sheet')?.remove()

  return JSON.stringify(out)
})()`

const r = await send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true })
const value = r.result?.result?.value
if (!value) {
  console.log('执行失败:', JSON.stringify(r.result?.exceptionDetails || r.result))
} else {
  const out = JSON.parse(value)
  console.log(`=== 编辑持仓弹层预览（模块版本 ${out.ver}）===`)
  console.log('--- 资产页（真实两条持仓）---')
  console.log((out.assets || '').split('\n').filter(Boolean).join('\n'))
  console.log('--- 美股 AAPL 20股 @343.46 ---')
  console.log(out.us)
  console.log('--- A股/场内基金 161128 30份 @7.424 ---')
  console.log(out.cny)
  console.log('--- 汇率缺失时 ---')
  console.log(out.noFx)
}

ws.close(); chrome.kill(); await sleep(300)
fs.rmSync(userDir, { recursive: true, force: true })
