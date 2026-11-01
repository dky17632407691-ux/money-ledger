/* toast / 弹层 / 确认框 */

import { escapeHtml } from './util.js'

export function toast(msg, type = 'info') {
  let host = document.getElementById('toast-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'toast-host'
    host.className = 'toast-host'
    document.body.appendChild(host)
  }
  const el = document.createElement('div')
  el.className = `toast toast--${type}`
  el.textContent = msg
  host.appendChild(el)
  requestAnimationFrame(() => el.classList.add('toast--show'))
  setTimeout(() => {
    el.classList.remove('toast--show')
    setTimeout(() => el.remove(), 280)
  }, 2400)
}

export function confirmDialog(message, { okText = '确定', cancelText = '取消' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div')
    wrap.className = 'modal-mask'
    wrap.innerHTML = `
      <div class="modal" role="dialog">
        <p class="modal__msg">${escapeHtml(message)}</p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn btn--danger" data-act="ok">${escapeHtml(okText)}</button>
        </div>
      </div>`
    document.body.appendChild(wrap)
    const close = (v) => { wrap.remove(); resolve(v) }
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close(false)
      const btn = e.target.closest('[data-act]')
      if (!btn) return
      close(btn.dataset.act === 'ok')
    })
  })
}

/**
 * 打开底部弹层。返回 { el, close }。
 * 注意：保存分类等回调里必须用这里的 close()，不要引用未定义的 sheet。
 */
export function openSheet(title, bodyHtml, { wide = false } = {}) {
  const mask = document.createElement('div')
  mask.className = 'sheet-mask'
  mask.innerHTML = `
    <div class="sheet${wide ? ' sheet--wide' : ''}" role="dialog" aria-modal="true">
      <div class="sheet__grab"></div>
      <div class="sheet__head">
        <h3 class="sheet__title">${escapeHtml(title)}</h3>
        <button type="button" class="sheet__close" aria-label="关闭">×</button>
      </div>
      <div class="sheet__body">${bodyHtml}</div>
    </div>`
  document.body.appendChild(mask)
  const sheetEl = mask.querySelector('.sheet')
  const close = () => {
    mask.classList.add('sheet-mask--out')
    setTimeout(() => mask.remove(), 200)
  }
  mask.querySelector('.sheet__close').addEventListener('click', close)
  mask.addEventListener('click', (e) => { if (e.target === mask) close() })
  requestAnimationFrame(() => mask.classList.add('sheet-mask--in'))
  return { mask, el: sheetEl, close }
}

export function setBoot(text) {
  const t = document.querySelector('.boot__text')
  if (t) t.textContent = text
}

export function hideBoot() {
  const b = document.getElementById('boot')
  if (b) b.classList.add('hidden')
}
