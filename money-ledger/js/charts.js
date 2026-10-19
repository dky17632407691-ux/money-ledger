import { escapeHtml, formatAmount, formatCompact } from './util.js?v=20261019g'

/* ============================================================
   图表：按容器实际宽度绘制，文本框不缩放
   ============================================================ */

const NUM_FONT = 'font-variant-numeric:tabular-nums'

function mount(el, painter, spec) {
  if (!el) return
  el.__chart = { painter, spec }
  paint(el)
}

/** 空容器自身可能量不到宽度（如刚插入 DOM 或页面被隐藏），向父级回退 */
function measureWidth(el) {
  let width = Math.round(el.clientWidth || 0)
  if (width >= 40) return width
  const parent = el.parentElement
  if (parent) {
    width = Math.round(parent.clientWidth || 0)
    if (width >= 40) return width
  }
  return 600
}

function paint(el) {
  const chart = el.__chart
  if (!chart) return
  const width = measureWidth(el)
  el.innerHTML = chart.painter({ ...chart.spec, width })
}

/** 容器尺寸变化后重新绘制 */
export function reflowCharts(root = document) {
  root.querySelectorAll('.chart-slot').forEach((el) => {
    if (el.__chart) paint(el)
  })
}

/* ---------------- 环形图 ---------------- */

export function mountDonut(el, items, options = {}) {
  mount(el, paintDonut, { items, ...options })
}

function paintDonut({ width, items, size = 180, thickness = 22, centerTitle = '', centerValue = '' }) {
  const list = (items || []).filter((i) => Number(i.value) > 0)
  const total = list.reduce((s, i) => s + Number(i.value), 0)
  if (!total) return `<div class="chart-empty">暂无数据</div>`

  const dim = Math.max(120, Math.min(size, width))
  const r = (dim - thickness) / 2
  const C = 2 * Math.PI * r
  const cx = dim / 2
  const cy = dim / 2

  let offset = 0
  const segments = list.map((it) => {
    const len = (Number(it.value) / total) * C
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
        stroke="${escapeHtml(it.color || '#2f6bff')}" stroke-width="${thickness}"
        stroke-dasharray="${len.toFixed(3)} ${(C - len).toFixed(3)}"
        stroke-dashoffset="${(-offset).toFixed(3)}"
        transform="rotate(-90 ${cx} ${cy})" />`
    offset += len
    return seg
  }).join('')

  const title = centerTitle
    ? `<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="11.5" fill="#93a0b8">${escapeHtml(centerTitle)}</text>`
    : ''
  const value = centerValue
    ? `<text x="${cx}" y="${cy + (centerTitle ? 16 : 5)}" text-anchor="middle" font-size="17" font-weight="700" fill="#16203a" style="${NUM_FONT}">${escapeHtml(centerValue)}</text>`
    : ''

  return `
    <svg class="chart" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" role="img">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#eef2f8" stroke-width="${thickness}" />
      ${segments}
      ${title}
      ${value}
    </svg>`
}

export function legendHtml(items, formatter = (v) => formatAmount(v)) {
  const list = (items || []).filter((i) => Number(i.value) > 0)
  if (!list.length) return ''
  return list.map((it) => `
    <div class="legend__item">
      <span class="legend__dot" style="background:${escapeHtml(it.color || '#c8d2e2')}"></span>
      <span>${escapeHtml(it.label)}</span>
      <span class="legend__value num">${escapeHtml(formatter(it.value))}</span>
    </div>`).join('')
}

/* ---------------- 收支柱状图（HTML/CSS，天然自适应） ---------------- */

export function mountBars(el, data, options = {}) {
  mount(el, paintBars, { data, ...options })
}

function paintBars({ data, height = 172, showLabels = true }) {
  const rows = data || []
  if (!rows.length) return `<div class="chart-empty">暂无数据</div>`

  const max = Math.max(1, ...rows.map((r) => Math.max(Number(r.income) || 0, Number(r.expense) || 0)))

  const cols = rows.map((r) => {
    const inc = Number(r.income) || 0
    const exp = Number(r.expense) || 0
    const incH = inc > 0 ? Math.max(2, (inc / max) * 100) : 0
    const expH = exp > 0 ? Math.max(2, (exp / max) * 100) : 0
    return `
      <div class="bars__col">
        <div class="bars__pair" style="height:${height}px">
          <div class="bars__bar bars__bar--in" style="height:${incH}%" title="收入 ¥${formatAmount(inc)}"></div>
          <div class="bars__bar bars__bar--out" style="height:${expH}%" title="支出 ¥${formatAmount(exp)}"></div>
        </div>
        ${showLabels ? `<span class="bars__label">${escapeHtml(r.label || '')}</span>` : ''}
      </div>`
  }).join('')

  return `
    <div class="bars" style="--bar-count:${rows.length}">
      <div class="bars__max num">${escapeHtml(formatCompact(max))}</div>
      <div class="bars__grid">${cols}</div>
    </div>`
}

/* ---------------- 折线 / 面积图（SVG，实际像素宽度） ---------------- */

export function mountArea(el, points, options = {}) {
  mount(el, paintArea, { points, ...options })
}

function paintArea({ width, points, height = 176, color = '#2f6bff', formatValue = formatCompact, gradientId = 'g-area' }) {
  const rows = (points || []).filter((p) => p && p.value !== null && p.value !== undefined)
  if (rows.length === 0) return `<div class="chart-empty">暂无数据</div>`
  if (rows.length === 1) {
    return `<div class="chart-empty">再记录一次快照即可看到资产走势</div>`
  }

  const padTop = 18
  const padBottom = 26
  const plotH = Math.max(60, height - padTop - padBottom)
  const plotW = Math.max(40, width - 8)

  const values = rows.map((p) => Number(p.value) || 0)
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    const delta = Math.abs(min) * 0.1 || 100
    min -= delta
    max += delta
  }
  const span = max - min
  const xOf = (i) => (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW) + 4
  const yOf = (v) => padTop + plotH - ((v - min) / span) * plotH

  const linePath = rows.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(values[i]).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${xOf(rows.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L${xOf(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`

  const gridLines = [0, 0.5, 1].map((t) => {
    const y = padTop + plotH * t
    return `<line x1="0" y1="${y.toFixed(1)}" x2="${width}" y2="${y.toFixed(1)}" stroke="#eef2f8" stroke-width="1" stroke-dasharray="3 4"/>`
  }).join('')

  const lastIndex = rows.length - 1
  const maxLabels = width < 380 ? 3 : width < 560 ? 4 : 6
  const step = Math.max(1, Math.ceil(rows.length / maxLabels))
  const xLabels = rows.map((p, i) => {
    if (i !== 0 && i !== lastIndex && i % step !== 0) return ''
    const anchor = i === 0 ? 'start' : i === lastIndex ? 'end' : 'middle'
    const x = i === 0 ? xOf(0) : i === lastIndex ? xOf(lastIndex) : xOf(i)
    return `<text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="${anchor}" font-size="10.5" fill="#93a0b8">${escapeHtml(p.label || '')}</text>`
  }).join('')

  const dots = rows.map((p, i) => {
    const r = i === lastIndex ? 4 : 2.6
    const fill = i === lastIndex ? color : '#ffffff'
    return `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(values[i]).toFixed(1)}" r="${r}" fill="${fill}" stroke="${color}" stroke-width="2"/>`
  }).join('')

  const topLabel = `<text x="${width}" y="10" text-anchor="end" font-size="11" fill="#5a6a86" style="${NUM_FONT}">${escapeHtml(formatValue(max))}</text>`
  const bottomLabel = `<text x="${width}" y="${(padTop + plotH + 12).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#b3bdd0" style="${NUM_FONT}">${escapeHtml(formatValue(min))}</text>`

  return `
    <svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.24"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.01"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${areaPath}" fill="url(#${gradientId})"/>
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${xLabels}
      ${topLabel}
      ${bottomLabel}
    </svg>`
}

/* ---------------- 多序列走势图（总资产 / 总负债 / 净资产） ---------------- */

export function mountMultiArea(el, labels, series, options = {}) {
  mount(el, paintMultiArea, { labels, series, ...options })
}

function paintMultiArea({
  width, labels, series, height = 210,
  formatValue = formatCompact, gradientPrefix = 'gm',
}) {
  const rows = labels || []
  const list = (series || []).filter((s) => s && Array.isArray(s.values) && s.values.length)
  if (!rows.length || !list.length) return `<div class="chart-empty">暂无数据</div>`
  if (rows.length === 1) return '<div class="chart-empty">再记录一次快照即可看到走势</div>'

  const padTop = 18
  const padBottom = 26
  const plotH = Math.max(60, height - padTop - padBottom)
  const plotW = Math.max(40, width - 8)

  let min = Infinity
  let max = -Infinity
  for (const s of list) {
    for (const v of s.values) {
      const n = Number(v) || 0
      if (n < min) min = n
      if (n > max) max = n
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '<div class="chart-empty">暂无数据</div>'
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 100
    min -= d
    max += d
  }
  const raw = max - min
  min -= raw * 0.06
  max += raw * 0.06
  const span = max - min

  const n = rows.length
  const xOf = (i) => (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW) + 4
  const yOf = (v) => padTop + plotH - ((v - min) / span) * plotH

  const gridLines = [0, 0.5, 1].map((t) => {
    const y = padTop + plotH * t
    return `<line x1="0" y1="${y.toFixed(1)}" x2="${width}" y2="${y.toFixed(1)}" stroke="#eef2f8" stroke-width="1" stroke-dasharray="3 4"/>`
  }).join('')

  const lastIndex = n - 1
  const maxLabels = width < 380 ? 3 : width < 560 ? 4 : 6
  const step = Math.max(1, Math.ceil(n / maxLabels))
  const xLabels = rows.map((label, i) => {
    if (i !== 0 && i !== lastIndex && i % step !== 0) return ''
    const anchor = i === 0 ? 'start' : i === lastIndex ? 'end' : 'middle'
    return `<text x="${xOf(i).toFixed(1)}" y="${height - 8}" text-anchor="${anchor}" font-size="10.5" fill="#93a0b8">${escapeHtml(label)}</text>`
  }).join('')

  const defs = list.map((s, si) => `
    <linearGradient id="${gradientPrefix}-${si}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.color}" stop-opacity="${s.fill === false ? 0 : 0.2}"/>
      <stop offset="100%" stop-color="${s.color}" stop-opacity="0.01"/>
    </linearGradient>`).join('')

  const paths = list.map((s, si) => {
    const pts = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(Number(v) || 0).toFixed(1)}`).join(' ')
    const area = s.fill === false
      ? ''
      : `<path d="${pts} L${xOf(lastIndex).toFixed(1)},${(padTop + plotH).toFixed(1)} L${xOf(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z" fill="url(#${gradientPrefix}-${si})"/>`
    const dash = s.dashed ? 'stroke-dasharray="5 4"' : ''
    const dot = `<circle cx="${xOf(lastIndex).toFixed(1)}" cy="${yOf(Number(s.values[lastIndex]) || 0).toFixed(1)}" r="3.4" fill="${s.color}" stroke="#fff" stroke-width="1.6"/>`
    return `${area}<path d="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" stroke-linejoin="round" stroke-linecap="round" ${dash}/>${dot}`
  }).join('')

  const topLabel = `<text x="${width}" y="10" text-anchor="end" font-size="11" fill="#5a6a86" style="${NUM_FONT}">${escapeHtml(formatValue(max))}</text>`
  const bottomLabel = `<text x="${width}" y="${(padTop + plotH + 12).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#b3bdd0" style="${NUM_FONT}">${escapeHtml(formatValue(min))}</text>`

  return `
    <svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
      <defs>${defs}</defs>
      ${gridLines}
      ${paths}
      ${xLabels}
      ${topLabel}
      ${bottomLabel}
    </svg>`
}

/** 多序列图例 */
export function multiLegendHtml(series) {
  const list = (series || []).filter(Boolean)
  if (!list.length) return ''
  return list.map((s) => `
    <span class="legend__inline">
      <span class="legend__dash" style="background:${escapeHtml(s.color)}${s.dashed ? ';opacity:.55' : ''}"></span>
      ${escapeHtml(s.label)}
    </span>`).join('')
}

/* ---------------- 分类排行（横向进度条） ---------------- */

export function rankingHtml(items, options = {}) {
  const { emptyText = '本月暂无记录', limit = 8, formatter = (v) => `¥${formatAmount(v)}` } = options
  const list = (items || []).slice(0, limit)
  if (!list.length) {
    return `<div class="empty"><div class="empty__icon">📊</div><div class="empty__title">${escapeHtml(emptyText)}</div></div>`
  }
  const max = Math.max(...list.map((i) => Number(i.value) || 0), 1)
  return `<div class="ranking">${list.map((it) => `
    <div class="ranking__row">
      <div class="ranking__head">
        <span class="ranking__name">
          <span class="ranking__emoji">${escapeHtml(it.icon || '📦')}</span>
          ${escapeHtml(it.name)}
        </span>
        <span class="ranking__value num">${escapeHtml(formatter(it.value))}
          <em>${escapeHtml(((Number(it.percent) || 0) * 100).toFixed(1))}%</em>
        </span>
      </div>
      <div class="progress"><div class="progress__bar" style="width:${Math.max(3, ((Number(it.value) || 0) / max) * 100).toFixed(1)}%;background:${escapeHtml(it.color || '#2f6bff')}"></div></div>
    </div>`).join('')}</div>`
}
