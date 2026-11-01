/* 通用工具 */

export const pad2 = (n) => String(n).padStart(2, '0')

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function currentMonthKey() {
  return todayISO().slice(0, 7)
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function monthRange(key) {
  const [y, m] = key.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${key}-01`, end: `${key}-${pad2(last)}` }
}

export function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return `${y}年${Number(m)}月`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function friendlyDate(dateStr, todayRef = todayISO()) {
  if (dateStr === todayRef) return '今天'
  const [y, m, d] = todayRef.split('-').map(Number)
  const yesterday = new Date(y, m - 1, d - 1)
  const iso = `${yesterday.getFullYear()}-${pad2(yesterday.getMonth() + 1)}-${pad2(yesterday.getDate())}`
  if (dateStr === iso) return '昨天'
  const [yy, mm, dd] = String(dateStr).split('-').map(Number)
  const wd = WEEKDAYS[new Date(yy, mm - 1, dd).getDay()]
  return `${mm}月${dd}日 ${wd}`
}

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function formatAmount(v, decimals = 2) {
  const n = toNumber(v)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const fixed = abs.toFixed(decimals)
  const [int, dec] = fixed.split('.')
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec ? `${sign}${withSep}.${dec}` : `${sign}${withSep}`
}

export function formatMoney(v, decimals = 2) {
  return `¥${formatAmount(v, decimals)}`
}

export function formatSigned(v, decimals = 2) {
  const n = toNumber(v)
  const prefix = n > 0 ? '+' : n < 0 ? '-' : ''
  return `${prefix}¥${formatAmount(Math.abs(n), decimals)}`
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000
}

export function round6(n) {
  return Math.round((Number(n) || 0) * 1000000) / 1000000
}

export function $(sel, root = document) {
  return root.querySelector(sel)
}

export function $all(sel, root = document) {
  return Array.from(root.querySelectorAll(sel))
}
