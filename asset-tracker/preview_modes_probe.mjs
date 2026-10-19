// 模拟应用卡片预览的两种可能加载方式，定位「空白」到底由哪种引起
//   A: iframe 嵌入线上 URL（跨域）
//   B: 直接以 file:// 打开本地 index.html（ES module 在 file:// 下会被 CORS 拦截）
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9351
const ONLINE = 'https://2111995074905313280.app.workbuddy.host/'
const LOCAL_FILE = 'file:///C:/Users/dky19/WorkBuddy/2026-10-18-22-07-24/money-ledger/index.html'

const userDir = path.resolve('.chrome-preview-profile')
fs.rmSync(userDir, { recursive: true, force: true })

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
  'about:blank',
], { stdio: 'ignore' })

const j = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json()
let ready = false
for (let i = 0; i < 60; i++) { try { await j('/json/version'); ready = true; break } catch { await sleep(250) } }
if (!ready) { console.error('chrome 未启动'); chrome.kill(); process.exit(1) }

async function runCase(name, htmlForFrame, url) {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, e) => { ws.onopen = r; ws.onerror = e })
  let id = 0; const pend = new Map(); const logs = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      logs.push(`[exception] ${(d.exception?.description || d.text || '').split('\n')[0].slice(0, 200)}`)
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('[console.error] ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 200))
    }
  }
  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id; pend.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 760, deviceScaleFactor: 2, mobile: false })

  if (htmlForFrame) {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlForFrame)
    await send('Page.navigate', { url: dataUrl })
    await sleep(9000)
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const f = document.querySelector('iframe')
        return JSON.stringify({ iframeExists: !!f, loaded: f ? f.dataset.loaded === '1' : null })
      })()`, returnByValue: true,
    })
    console.log(`\n=== ${name} ===`)
    console.log('外层:', r.result?.result?.value)
  } else {
    await send('Page.navigate', { url })
    await sleep(7000)
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const vis = el => !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'
        const boot = document.querySelector('#boot')
        return JSON.stringify({
          bootVisible: vis(boot),
          bootText: boot ? (boot.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 50) : null,
          authVisible: vis(document.querySelector('#auth-view')),
          appVisible: vis(document.querySelector('#app')),
          bodyText: (document.body.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 60),
        })
      })()`, returnByValue: true,
    })
    console.log(`\n=== ${name} ===`)
    console.log('页面:', r.result?.result?.value)
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const out = path.resolve(`${name}.png`)
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log('截图:', out)
  console.log('错误:', logs.length ? '\n  ' + logs.slice(0, 6).join('\n  ') : '(无)')
  ws.close()
}

const frameHtml = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
<iframe src="${ONLINE}" onload="this.dataset.loaded='1'"></iframe>`

await runCase('A_iframe_online', frameHtml, null)
await runCase('B_file_protocol', null, LOCAL_FILE)

chrome.kill()
