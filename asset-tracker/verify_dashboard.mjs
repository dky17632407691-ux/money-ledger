// 概览页「净资产卡」新布局验证：真实模块渲染 → 390px 溢出测量 → 截图 → 交互自测
// 用法: node verify_dashboard.mjs [站点根地址] [输出截图]
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9337
const SITE = process.argv[2] || 'http://127.0.0.1:8765/'
const OUT_PNG = process.argv[3] || 'dashboard-nw.png'

const userDir = path.resolve('.chrome-dash-profile')
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
  const html = await (await fetch('/index.html', { cache: 'no-store' })).text()
  const ver = (html.match(/js\\/app\\.js\\?v=([^"']+)/) || [])[1] || ''
  const q = ver ? '?v=' + ver : ''
  const stateMod = await import('/js/state.js' + q)
  const { state, setFxRates } = stateMod
  setFxRates({ USD: 6.6855, HKD: 0.9136 }, '2026-10-19 15:00:00')

  const mk = (id, type, name, opts = {}) => ({
    id, type, name, is_archived: false, include_in_networth: true,
    initial_balance: opts.init || 0, manual_balance: 'manual' in opts ? opts.manual : null,
    subtype: opts.subtype || null,
  })
  state.accounts.push(
    mk('a1', 'investment', '证券账户', { manual: 0 }),
    mk('a2', 'bank', '招商银行', { manual: 96521.17 }),
    mk('a3', 'ewallet', '微信钱包', { manual: 3200.5 }),
    mk('a4', 'cash', '现金', { manual: 800 }),
    mk('a5', 'liability', '招行信用卡', { init: 0, subtype: 'credit' }),
  )
  state.holdings.push(
    { id: 'h1', account_id: 'a1', market: 'us', symbol: 'AAPL', name: '苹果', shares: 20, cost_price: 300, last_price: 343.46, prev_close: 340, change_pct: 1.02, price_time: '2026-10-18 16:00:00' },
    { id: 'h2', account_id: 'a1', market: 'sz', symbol: '161128', name: '标普信息科技LOF', shares: 30, cost_price: 6.8, last_price: 7.424, prev_close: 7.4, change_pct: 0.32, price_time: '2026-10-18 15:00:00' },
  )

  const views = await import('/js/views.js' + q)

  // 目标与自选直接塞进 state（跳过云端写入），只为看排版
  state.settings.goal = { target_amount: 5000000, passive_income: 1855.01, target_date: '2036-10-08', started_on: '2026-10-19' }
  state.settings.watchlist = [
    { market: 'us', symbol: 'AAPL', name: '苹果' },
    { market: 'sz', symbol: '161128', name: '标普信息科技LOF' },
  ]
  state.watchQuotes = {
    'usAAPL': { market: 'us', symbol: 'AAPL', name: '苹果', price: 343.46, changePct: 1.02 },
    'sz161128': { market: 'sz', symbol: '161128', name: '标普信息科技LOF', price: 7.424, changePct: 0.32 },
  }

  const page = document.createElement('div')
  page.className = 'page'
  page.id = 'probe-page'
  document.body.style.margin = '0'
  document.body.appendChild(page)

  const out = { ver }
  const render = () => { views.renderDashboard(page); return page }
  render()

  const card = page.querySelector('.nw-card')
  out.cardText = card?.innerText
  out.goalText = page.querySelector('.goal-row')?.innerText
  out.watchText = Array.from(page.querySelectorAll('.card')).find((c) => c.textContent.includes('自选列表'))?.innerText
  out.overflow = []
  page.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.right > window.innerWidth + 0.5) {
      out.overflow.push((el.className || el.tagName) + ' right=' + Math.round(r.right))
    }
  })
  out.docScrollW = document.documentElement.scrollWidth
  out.innerWidth = window.innerWidth

  // 截图：展开态（把 app 自身的登录浮层等盖住探针的元素隐藏掉）
  document.querySelectorAll('body > *:not(#probe-page)').forEach((el) => { el.style.display = 'none' })
  document.body.style.background = '#f3f5f9'
  return JSON.stringify(out)
})()`

const r = await send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true })
const value = r.result?.result?.value
if (!value) {
  console.log('执行失败:', JSON.stringify(r.result?.exceptionDetails || r.result))
  ws.close(); chrome.kill(); process.exit(1)
}
const out = JSON.parse(value)
console.log(`=== 概览 · 净资产卡（模块版本 ${out.ver}，${out.innerWidth}px）===`)
console.log(out.cardText)
console.log('--- 目标卡片 ---')
console.log(out.goalText || '(未渲染)')
console.log('--- 自选列表 ---')
console.log(out.watchText || '(未渲染)')
console.log('--- 布局 ---')
console.log(`docScrollW=${out.docScrollW} innerWidth=${out.innerWidth} overflowCount=${out.overflow.length}`)
if (out.overflow.length) console.log(out.overflow.slice(0, 8).join('\n'))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
if (shot.result?.data) {
  fs.writeFileSync(OUT_PNG, Buffer.from(shot.result.data, 'base64'))
  console.log('截图: ' + OUT_PNG)
}

// 交互自测：点眼睛 → 金额打码；点箭头 → 明细折叠
const interact = `(() => {
  const page = document.querySelector('#probe-page')
  const out2 = {}
  page.querySelector('[data-act="nw-mask"]').click()
  out2.masked = page.querySelector('.nw-card__value').textContent
  page.querySelector('[data-act="nw-mask"]').click()
  out2.unmasked = page.querySelector('.nw-card__value').textContent
  page.querySelector('[data-act="nw-toggle"]').click()
  out2.collapsedBodyHidden = getComputedStyle(page.querySelector('.nw-card__body')).display === 'none'
  page.querySelector('[data-act="nw-toggle"]').click()
  out2.expandedBodyShown = getComputedStyle(page.querySelector('.nw-card__body')).display !== 'none'
  out2.maskPersisted = localStorage.getItem('ledger.nw.mask.v1')
  out2.expandPersisted = localStorage.getItem('ledger.nw.expand.v1')

  // 弹层自测：目标表单 / 自选管理
  page.querySelector('.goal-card__item').click()
  out2.goalSheetTitle = document.querySelector('.sheet__title')?.textContent
  out2.goalFields = Array.from(document.querySelectorAll('.sheet .form-row label')).map((l) => l.textContent)
  document.querySelector('.sheet [data-act="cancel"]')?.click()
  page.querySelector('[data-act="open-watch"]').click()
  out2.watchSheetTitle = document.querySelector('.sheet__title')?.textContent
  out2.watchMarkets = Array.from(document.querySelectorAll('#watch-market .segmented__btn')).map((b) => b.textContent)
  document.querySelector('.sheet [data-act="cancel"]')?.click()
  return JSON.stringify(out2)
})()`
const r2 = await send('Runtime.evaluate', { expression: interact, returnByValue: true })
console.log('--- 交互 ---')
console.log(r2.result?.result?.value || JSON.stringify(r2.result?.exceptionDetails))

ws.close(); chrome.kill(); await sleep(300)
fs.rmSync(userDir, { recursive: true, force: true })
