import { escapeHtml, html } from './util.js?v=20261019e'

/* ---------------- Toast ---------------- */

export function toast(message, kind = 'info', duration = 2600) {
  const root = document.getElementById('toast-root')
  if (!root) return
  const node = html(`<div class="toast${kind === 'ok' ? ' toast--ok' : kind === 'err' ? ' toast--err' : ''}">${escapeHtml(message)}</div>`)
  root.appendChild(node)
  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s'
    node.style.opacity = '0'
    node.style.transform = 'translateY(6px)'
    setTimeout(() => node.remove(), 220)
  }, duration)
}

export const toastOk = (m) => toast(m, 'ok')
export const toastErr = (m) => toast(m, 'err', 3400)

/* ---------------- 错误信息 ---------------- */

/** 把数据库 / 网络错误翻译成用户看得懂的话 */
export function describeError(error) {
  if (!error) return '操作失败，请重试'
  const code = error.code || error.status
  const msg = String(error.message || '')

  if (code === '23505') return '这条记录已经存在了'
  if (code === '42501') return '没有权限执行该操作，请重新登录后再试'
  if (code === '42P01') return '数据表尚未就绪，请稍后再试'
  if (code === '23503') return '关联的账户不存在，请重新选择'
  if (code === 'PGRST301' || /jwt|token/i.test(msg)) return '登录状态已过期，请重新登录'
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return '网络连接失败，请检查网络后重试'
  if (/timeout/i.test(msg)) return '请求超时，请稍后重试'
  return msg || '操作失败，请重试'
}

/* ---------------- 弹层 ---------------- */

let openSheets = 0

/**
 * 打开一个弹层。
 * @param {object} options
 * @param {string} options.title       标题
 * @param {Node|string} options.body   内容
 * @param {Node} [options.footer]      底部操作区
 * @param {boolean} [options.center]   是否居中（确认框样式）
 * @param {boolean} [options.dismissible] 点击遮罩 / ESC 是否可关闭
 * @param {(root:HTMLElement)=>void} [options.onMount]
 * @param {()=>void} [options.onClose]
 */
export function openSheet(options) {
  const {
    title = '',
    body = '',
    footer = null,
    center = false,
    dismissible = true,
    onMount,
    onClose,
  } = options

  openSheets += 1

  const root = html(`
    <div class="sheet${center ? ' sheet--center' : ''}">
      <div class="sheet__backdrop"></div>
      <div class="sheet__panel" role="dialog" aria-modal="true">
        <div class="sheet__head">
          <div class="sheet__title">${escapeHtml(title)}</div>
          <button class="sheet__close" type="button" aria-label="关闭">✕</button>
        </div>
        <div class="sheet__body"></div>
      </div>
    </div>
  `)

  const bodyEl = root.querySelector('.sheet__body')
  if (body instanceof Node) bodyEl.appendChild(body)
  else bodyEl.innerHTML = body

  const panel = root.querySelector('.sheet__panel')
  if (footer) {
    const foot = html('<div class="sheet__foot"></div>')
    foot.appendChild(footer)
    panel.appendChild(foot)
  }

  let closed = false
  function close() {
    if (closed) return
    closed = true
    openSheets -= 1
    document.removeEventListener('keydown', onKey)
    root.remove()
    if (openSheets === 0) document.body.style.overflow = ''
    if (typeof onClose === 'function') onClose()
  }
  function onKey(e) {
    if (e.key === 'Escape' && dismissible) close()
  }

  root.querySelector('.sheet__close').addEventListener('click', () => { if (dismissible) close() })
  root.querySelector('.sheet__backdrop').addEventListener('click', () => { if (dismissible) close() })
  document.addEventListener('keydown', onKey)

  document.getElementById('sheet-root').appendChild(root)
  document.body.style.overflow = 'hidden'

  if (typeof onMount === 'function') onMount(root)

  return { root, close, body: bodyEl }
}

/** 二次确认框，返回 Promise<boolean> */
export function confirmDialog(options) {
  const {
    title = '请确认',
    message = '',
    confirmText = '确定',
    cancelText = '取消',
    danger = false,
  } = options

  return new Promise((resolve) => {
    let settled = false
    const foot = html(`
      <div style="display:flex;gap:10px;width:100%">
        <button class="btn btn--ghost" data-act="cancel" type="button">${escapeHtml(cancelText)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok" type="button">${escapeHtml(confirmText)}</button>
      </div>
    `)

    const sheet = openSheet({
      title,
      center: true,
      body: `<p class="sheet__text">${message}</p>`,
      footer: foot,
      // 用户点遮罩 / ESC / ✕ 关闭时视为取消
      onClose: () => {
        if (settled) return
        settled = true
        resolve(false)
      },
    })

    function finish(value) {
      if (settled) return
      settled = true
      resolve(value)
      sheet.close()
    }

    foot.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false))
    foot.querySelector('[data-act="ok"]').addEventListener('click', () => finish(true))
  })
}

/** 按钮忙碌态 */
export function setBusy(button, busy, busyText = '处理中…') {
  if (!button) return
  if (busy) {
    button.dataset.idleText = button.textContent
    button.textContent = busyText
    button.disabled = true
  } else {
    if (button.dataset.idleText) button.textContent = button.dataset.idleText
    button.disabled = false
  }
}

/** 渲染骨架屏 */
export function skeletonCard(rows = 3) {
  const items = Array.from({ length: rows }, (_, i) =>
    `<div class="skeleton" style="height:${i === 0 ? 20 : 14}px;width:${i === 0 ? '42%' : `${88 - i * 12}%`};margin-bottom:10px"></div>`
  ).join('')
  return `<div class="card"><div class="card__body">${items}</div></div>`
}
