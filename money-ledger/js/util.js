/* 通用工具函数 */

export const pad2 = (n) => String(n).padStart(2, '0')

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function currentMonthKey() {
  return todayISO().slice(0, 7)
}

export function monthKeyOf(dateStr) {
  return String(dateStr || '').slice(0, 7)
}

export function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return `${y} 年 ${Number(m)} 月`
}

export function shortMonthLabel(key) {
  const [, m] = key.split('-')
  return `${Number(m)}月`
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/** 返回某个月的 [首日, 末日]（ISO 日期字符串） */
export function monthRange(key) {
  const [y, m] = key.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${key}-01`, end: `${key}-${pad2(last)}` }
}

/** 最近 n 个月的月份 key（含当月），从旧到新 */
export function recentMonthKeys(n, endKey = currentMonthKey()) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(endKey, -i))
  return out
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function dateLabel(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()]
  return `${m}月${d}日 ${wd}`
}

export function friendlyDate(dateStr, todayRef = todayISO()) {
  if (dateStr === todayRef) return '今天'
  const [y, m, d] = todayRef.split('-').map(Number)
  const yesterday = new Date(y, m - 1, d - 1)
  const iso = `${yesterday.getFullYear()}-${pad2(yesterday.getMonth() + 1)}-${pad2(yesterday.getDate())}`
  if (dateStr === iso) return '昨天'
  return dateLabel(dateStr)
}

/* ---------------- 金额 ---------------- */

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 千分位 + 两位小数 */
export function formatAmount(v, decimals = 2) {
  const n = toNumber(v)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const fixed = abs.toFixed(decimals)
  const [int, dec] = fixed.split('.')
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec ? `${sign}${withSep}.${dec}` : `${sign}${withSep}`
}

/** 带 ¥ 符号 */
export function formatMoney(v, decimals = 2) {
  return `¥${formatAmount(v, decimals)}`
}

/** 带正负号的金额（用于流水） */
export function formatSigned(v, decimals = 2) {
  const n = toNumber(v)
  const prefix = n > 0 ? '+' : n < 0 ? '-' : ''
  return `${prefix}¥${formatAmount(Math.abs(n), decimals)}`
}

/** 紧凑显示：1.2万 / 3,456 */
export function formatCompact(v) {
  const n = toNumber(v)
  const abs = Math.abs(n)
  if (abs >= 100000000) return `${(n / 100000000).toFixed(2)}亿`
  if (abs >= 10000) return `${(n / 10000).toFixed(2)}万`
  return formatAmount(n)
}

export function parseAmount(input) {
  if (typeof input === 'number') return input
  const cleaned = String(input ?? '').replace(/[,\s¥￥]/g, '')
  if (cleaned === '') return NaN
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : NaN
}

export function formatPercent(v, decimals = 1) {
  const n = toNumber(v)
  return `${(n * 100).toFixed(decimals)}%`
}

/* ---------------- DOM ---------------- */

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 把 HTML 字符串转成元素 */
export function html(markup) {
  const tpl = document.createElement('template')
  tpl.innerHTML = String(markup).trim()
  return tpl.content.firstElementChild
}

export function qs(sel, root = document) {
  return root.querySelector(sel)
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel))
}

export function uid() {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/* ---------------- 分类配色 ---------------- */

export const PALETTE = [
  '#2f6bff', '#0e9f6e', '#e5484d', '#f0a020', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#64748b',
  '#a855f7', '#22c55e', '#ef4444', '#3b82f6', '#eab308',
]

export function colorByIndex(i) {
  return PALETTE[Math.abs(i) % PALETTE.length]
}

/** 根据名称稳定地取一个颜色 */
export function colorByName(name) {
  let hash = 0
  const s = String(name || '')
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export function safeColor(color, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? color : fallback
}

/* ---------------- 其它 ---------------- */

export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max)
}

export function debounce(fn, ms = 250) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function initialsOf(name) {
  const s = String(name || '').trim()
  if (!s) return '我'
  return s.slice(0, 1).toUpperCase()
}
