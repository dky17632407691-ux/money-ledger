import {
  state, typeMeta, subtypeLabel, accountById, isManualAccount,
  netWorthSummary, assetDistribution, monthTotals, transactionsOfMonth,
  categoryBreakdown, monthlySeries, categoryMeta, snapshotPoints,
  snapshotPointsInRange, SNAPSHOT_RANGES,
  requestRender, notifyChange, navigate, requestLogout,
  recordTodaySnapshot, activeAccounts,
  holdingsOfAccount, hasHoldings, holdingMarketValue, holdingProfit,
  holdingDayProfit, holdingHasQuote, portfolioSummary, quoteStatusText,
  refreshQuotes, openHoldings, closedHoldings, realizedSummary,
  accountCash, tradesOfHolding, holdingDays, firstTradeDate, isOpenHolding,
  fxRate, holdingCurrency, fxSummary, hasFxMissingHolding, holdingPrice,
  holdingFxMissing, goalProgress,
} from './state.js?v=20261019h'
import {
  mountDonut, mountBars, mountArea, mountMultiArea, legendHtml,
  multiLegendHtml, rankingHtml,
} from './charts.js?v=20261019h'
import {
  openRecordSheet, openAccountSheet, openCategorySheet, removeCategory,
  openHelpSheet, openHoldingSheet, openTradeSheet, openTradesSheet,
  openGoalSheet,
} from './sheets.js?v=20261019h'
import { displayCode, marketLabel, CURRENCY_SYMBOL } from './quotes.js?v=20261019h'
import { allowlistInfo, normalizePhone } from './access.js?v=20261019h'
import { confirmDialog, toastOk, toastErr, describeError } from './ui.js?v=20261019h'
import {
  escapeHtml, formatAmount, formatCompact, formatSigned, monthLabel,
  shortMonthLabel, shiftMonth, friendlyDate, toNumber, currentMonthKey, initialsOf,
} from './util.js?v=20261019h'

/* ============================================================
   页面渲染
   ============================================================ */

const KIND_LABEL = { expense: '支出', income: '收入', transfer: '转账' }

function money(v, withSymbol = true) {
  return `${withSymbol ? '¥' : ''}${formatAmount(v)}`
}

function txIconOf(tx) {
  if (tx.type === 'transfer') return { icon: '🔄', color: '#8b5cf6' }
  const meta = categoryMeta(tx.type, tx.category)
  return { icon: meta.icon, color: meta.color }
}

function txTitleOf(tx) {
  if (tx.type === 'transfer') return '账户转账'
  return tx.category || '未分类'
}

function txSubOf(tx) {
  const parts = []
  if (tx.type === 'transfer') {
    const from = accountById(tx.account_id)
    const to = accountById(tx.to_account_id)
    parts.push(`${from ? from.name : '未指定'} → ${to ? to.name : '未指定'}`)
  } else {
    const acc = accountById(tx.account_id)
    parts.push(acc ? acc.name : '未关联账户')
  }
  if (tx.note) parts.push(tx.note)
  return parts.join(' · ')
}

function txAmountHtml(tx) {
  const v = formatAmount(tx.amount)
  if (tx.type === 'expense') return `<span class="list-item__amount t-expense num">-¥${v}</span>`
  if (tx.type === 'income') return `<span class="list-item__amount t-income num">+¥${v}</span>`
  return `<span class="list-item__amount t-muted num">¥${v}</span>`
}

function txRowHtml(tx) {
  const ic = txIconOf(tx)
  return `
    <button class="list-item list-item--btn" type="button" data-act="edit-tx" data-id="${tx.id}">
      <span class="list-item__icon" style="background:${escapeHtml(ic.color)}1a">${escapeHtml(ic.icon)}</span>
      <span class="list-item__main">
        <span class="list-item__title">${escapeHtml(txTitleOf(tx))}</span>
        <span class="list-item__sub">${escapeHtml(txSubOf(tx))}</span>
      </span>
      ${txAmountHtml(tx)}
    </button>`
}

function emptyState(icon, title, hint = '') {
  return `<div class="empty">
    <div class="empty__icon">${escapeHtml(icon)}</div>
    <div class="empty__title">${escapeHtml(title)}</div>
    ${hint ? `<div>${escapeHtml(hint)}</div>` : ''}
  </div>`
}

function statCard(label, valueHtml, hint, dotColor) {
  return `<div class="stat">
    <div class="stat__label">${dotColor ? `<span class="stat__dot" style="background:${dotColor}"></span>` : ''}${escapeHtml(label)}</div>
    <div class="stat__value num ${valueHtml.cls}">${valueHtml.text}</div>
    <div class="stat__hint">${escapeHtml(hint)}</div>
  </div>`
}

function accountRowHtml(account, balance) {
  const meta = typeMeta(account.type)
  const sub = subtypeLabel(account.type, account.subtype)
  const isDebt = meta.liability
  const count = holdingsOfAccount(account.id).length
  const source = count > 0
    ? `持仓自动（${count} 项）`
    : (isManualAccount(account) ? '手动维护' : '按流水自动')
  const subText = [meta.label, sub, source].filter(Boolean).join(' · ')
  return `
    <button class="list-item list-item--btn" type="button" data-act="edit-account" data-id="${account.id}">
      <span class="list-item__icon">${escapeHtml(meta.icon)}</span>
      <span class="list-item__main">
        <span class="list-item__title">${escapeHtml(account.name)}</span>
        <span class="list-item__sub">${escapeHtml(subText)}</span>
      </span>
      <span class="list-item__amount num ${isDebt ? 't-expense' : ''}">${isDebt ? '-' : ''}¥${formatAmount(balance)}</span>
    </button>`
}

/* ---------------- 持仓 ---------------- */

function changeClass(v) {
  const n = toNumber(v)
  if (n > 0) return 't-up'
  if (n < 0) return 't-down'
  return 't-muted'
}

function sharesText(v) {
  const n = toNumber(v)
  return Number.isInteger(n) ? formatAmount(n, 0) : formatAmount(n, 2)
}

/** 价格显示：低价标的（基金净值）保留 4 位小数 */
function priceText(v) {
  const n = Math.abs(toNumber(v))
  return formatAmount(v, n > 0 && n < 10 ? 4 : 2)
}

function signedMoney(v) {
  const n = toNumber(v)
  return `${n >= 0 ? '+' : '-'}¥${formatAmount(Math.abs(n))}`
}

function holdingRowHtml(h) {
  const mv = holdingMarketValue(h)
  const profit = holdingProfit(h)
  const cost = toNumber(h.cost_price)
  const pct = toNumber(h.change_pct)
  const account = accountById(h.account_id)
  const code = displayCode(h.market, h.symbol)
  const cur = holdingCurrency(h)
  const sym = CURRENCY_SYMBOL[cur] || '¥'
  const price = holdingPrice(h)

  // 价格与成本是成交币种原值，右侧市值统一为人民币，两者都标清币种避免误读
  const bits = [code, marketLabel(h.market), `${sharesText(h.shares)} 份`]
  if (price > 0) bits.push(`现价 ${sym}${priceText(price)}`)
  if (cost > 0) bits.push(`成本 ${sym}${priceText(cost)}`)
  if (account) bits.push(account.name)
  if (holdingFxMissing(h)) bits.push('汇率待更新')

  const badge = holdingHasQuote(h)
    ? `<span class="badge badge--${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'} num">${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>`
    : '<span class="badge badge--flat">待更新</span>'

  return `
    <div class="holding-item">
      <button class="holding-row" type="button" data-act="edit-holding" data-id="${h.id}">
        <span class="holding-row__main">
          <span class="holding-row__name">${escapeHtml(h.name || code)}</span>
          <span class="holding-row__sub">${escapeHtml(bits.join(' · '))}</span>
        </span>
        <span class="holding-row__right">
          <span class="holding-row__top">
            <span class="holding-row__mv num">¥${formatAmount(mv)}</span>${badge}
          </span>
          ${profit === null
            ? '<span class="holding-row__profit t-muted">未填成本价</span>'
            : `<span class="holding-row__profit num ${changeClass(profit)}">${signedMoney(profit)}</span>`}
        </span>
      </button>
      <div class="holding-item__ops">
        <button class="mini-btn mini-btn--buy" type="button" data-act="buy-holding" data-id="${h.id}">买入</button>
        <button class="mini-btn mini-btn--sell" type="button" data-act="sell-holding" data-id="${h.id}">卖出</button>
        <button class="mini-btn" type="button" data-act="trades-holding" data-id="${h.id}">记录</button>
      </div>
    </div>`
}

/* ============================================================
   概览
   ============================================================ */

/* 净值卡的「隐藏金额」与「折叠明细」记忆在本机（localStorage），
   刷新后保持上次的开关状态 */
const NW_MASK_KEY = 'ledger.nw.mask.v1'
const NW_EXPAND_KEY = 'ledger.nw.expand.v1'
let nwMasked = false
let nwExpanded = true

function nwLoadToggles() {
  nwMasked = localStorage.getItem(NW_MASK_KEY) === '1'
  nwExpanded = localStorage.getItem(NW_EXPAND_KEY) !== '0'
}

function nwSaveToggle(key, on) {
  localStorage.setItem(key, on ? '1' : '0')
}

/** 按账户类型归集资产，固定展示顺序，金额为 0 的类型也显示（和参考布局一致） */
function nwAssetBuckets(balances) {
  const order = ['investment', 'bank', 'ewallet', 'cash', 'receivable']
  const labels = { investment: '证券资产', bank: '存款', ewallet: '电子钱包', cash: '现金', receivable: '借出金额' }
  const buckets = new Map()
  for (const a of state.accounts) {
    if (a.is_archived || !a.include_in_networth) continue
    if (typeMeta(a.type).liability) continue
    const v = balances.get(String(a.id)) || 0
    if (!buckets.has(a.type)) {
      buckets.set(a.type, { label: labels[a.type] || typeMeta(a.type).label, value: 0 })
    }
    buckets.get(a.type).value += v
  }
  return Array.from(buckets.entries())
    .sort((x, y) => {
      const ix = order.indexOf(x[0]); const iy = order.indexOf(y[0])
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy) || y[1].value - x[1].value
    })
    .map(([key, b]) => ({ key, ...b }))
}

/** 负债按「子类型/账户名」归集成行，如 信用卡账单、借款分期 */
function nwLiabilityBuckets(balances) {
  const buckets = new Map()
  for (const a of state.accounts) {
    if (a.is_archived || !a.include_in_networth) continue
    if (!typeMeta(a.type).liability) continue
    const v = balances.get(String(a.id)) || 0
    const label = subtypeLabel(a.type, a.subtype) || a.name || typeMeta(a.type).label
    if (!buckets.has(label)) buckets.set(label, { label, value: 0 })
    buckets.get(label).value += v
  }
  return Array.from(buckets.values())
}

function nwGridHtml(rows) {
  if (!rows.length) return '<div class="nw-grid nw-grid--empty">暂无账户</div>'
  return `<div class="nw-grid">${rows.map((r) => `
    <div class="nw-grid__item">
      <span>${escapeHtml(r.label)}</span>
      <b class="num">${nwMasked ? '******' : formatAmount(r.value)}</b>
    </div>`).join('')}</div>`
}

/* ---------------- 目标 / 进度 / 自选 ---------------- */

/** 半环进度：外环=金额进度，内环=时间进度，中心显示金额完成度 */
function goalArcSvg(amountPct, timePct) {
  const arcPath = (r) => `M${60 - r} 62 A${r} ${r} 0 0 1 ${60 + r} 62`
  const progress = (pct, r, width, color) => {
    if (pct === null || pct === undefined) return ''
    const p = Math.min(1, Math.max(0, pct))
    return `<path d="${arcPath(r)}" fill="none" stroke="${color}" stroke-width="${width}"
      stroke-linecap="round" pathLength="100" stroke-dasharray="${(p * 100).toFixed(1)} 100"/>`
  }
  const center = amountPct === null ? '--' : `${Math.round(amountPct * 100)}%`
  return `<svg class="goal-arc" viewBox="0 0 120 74" role="img" aria-label="目标进度 ${center}">
    <path d="${arcPath(52)}" fill="none" stroke="var(--surface-3)" stroke-width="10" stroke-linecap="round"/>
    <path d="${arcPath(38)}" fill="none" stroke="var(--surface-3)" stroke-width="8" stroke-linecap="round"/>
    ${progress(amountPct, 52, 10, 'var(--primary)')}
    ${progress(timePct, 38, 8, 'var(--warning)')}
    <text x="60" y="58" text-anchor="middle" class="goal-arc__text">${center}</text>
  </svg>`
}

function goalBlockHtml() {
  const gp = goalProgress()
  const g = gp.goal
  const amountText = gp.hasTarget ? `¥${formatAmount(gp.targetAmount)}` : '未设置'
  const income = toNumber(g.passive_income)
  const incomeText = income > 0 ? `¥${formatAmount(income)}` : '未设置'
  const dateText = g.target_date ? escapeHtml(g.target_date) : '未设置'
  const amountPctText = gp.amountPct === null ? '--' : `${Math.round(gp.amountPct * 100)}%`
  const timePctText = gp.timePct === null ? '--' : `${Math.round(gp.timePct * 100)}%`

  // 距离目标 = 目标金额 − 总资产；达成了就直接说达成
  let distanceText = '未设置'
  if (gp.distance !== null) {
    distanceText = gp.distance > 0 ? `¥${formatAmount(gp.distance)}` : '已达成 🎉'
  }

  return `
    <div class="goal-row">
      <div class="goal-card">
        <button class="goal-card__item" type="button" data-act="open-goal">
          <span class="goal-card__icon" style="background:#eef3ff">🎯</span>
          <span class="goal-card__text">
            <span class="goal-card__label">目标金额</span>
            <span class="goal-card__value num">${amountText}</span>
          </span>
        </button>
        <button class="goal-card__item" type="button" data-act="open-goal">
          <span class="goal-card__icon" style="background:#fff4e5">🚩</span>
          <span class="goal-card__text">
            <span class="goal-card__label">距离目标</span>
            <span class="goal-card__value num">${distanceText}</span>
          </span>
        </button>
        <button class="goal-card__item" type="button" data-act="open-goal">
          <span class="goal-card__icon" style="background:#fdecec">💰</span>
          <span class="goal-card__text">
            <span class="goal-card__label">年被动收入</span>
            <span class="goal-card__value num">${incomeText}</span>
          </span>
        </button>
        <button class="goal-card__item" type="button" data-act="open-goal">
          <span class="goal-card__icon" style="background:#e6f7f0">📅</span>
          <span class="goal-card__text">
            <span class="goal-card__label">目标时间</span>
            <span class="goal-card__value num">${dateText}</span>
          </span>
        </button>
      </div>

      <button class="goal-progress" type="button" data-act="open-goal">
        <span class="goal-progress__head">
          <span>计划目标进度</span>
          <span class="goal-progress__gear">⚙</span>
        </span>
        ${goalArcSvg(gp.amountPct, gp.timePct)}
        <span class="goal-progress__legend">
          <span><i style="background:var(--primary)"></i>金额 ${amountPctText}</span>
          <span><i style="background:var(--warning)"></i>时间 ${timePctText}</span>
        </span>
        <span class="goal-progress__hint">${gp.hasTarget ? '实时追踪进度，及时调整节奏' : '设个目标，这里会显示完成度'}</span>
      </button>
    </div>`
}


export function renderDashboard(pageEl) {
  nwLoadToggles()
  const { totalAssets, totalLiabilities, netWorth } = netWorthSummary()
  const { income, expense, net } = monthTotals(state.month)
  const series = monthlySeries(6)
  const dist = assetDistribution()
  const monthTx = transactionsOfMonth(state.month)

  const donutItems = dist.map((d) => ({
    label: d.label,
    value: d.value,
    color: d.liability ? '#e5484d' : '#2f6bff',
  }))
  // 给每个资产类别分配稳定颜色
  const ASSET_COLORS = {
    cash: '#0e9f6e', bank: '#2f6bff', ewallet: '#06b6d4',
    investment: '#8b5cf6', receivable: '#f0a020', liability: '#e5484d',
  }
  donutItems.forEach((d, i) => { d.color = ASSET_COLORS[dist[i].key] || '#64748b' })

  const recent = state.transactions.slice(0, 6)

  /* ---------- 资产走势（近 3 个月） ---------- */
  const trendPoints = snapshotPointsInRange('3m')
  const tLast = trendPoints[trendPoints.length - 1]
  const tPrev = trendPoints[trendPoints.length - 2]
  const tColor = tLast && tPrev
    ? (tLast.netWorth >= tPrev.netWorth ? '#e5484d' : '#0e9f6e')
    : '#2f6bff'

  let trendHint = '还没有快照数据，记录两次即可看到走势'
  if (trendPoints.length >= 2) {
    const diff = tLast.netWorth - trendPoints[0].netWorth
    const pct = trendPoints[0].netWorth !== 0 ? (diff / Math.abs(trendPoints[0].netWorth)) * 100 : null
    trendHint = `近 3 个月净资产 ${diff >= 0 ? '增长' : '减少'} ¥${formatAmount(Math.abs(diff))}${pct !== null ? `（${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%）` : ''}`
  } else if (trendPoints.length === 1) {
    trendHint = '已有 1 条快照，明天再来即可看到走势'
  }

  const trendSeries = [
    { label: '总资产', color: '#2f6bff', width: 1.6, fill: false, values: trendPoints.map((p) => p.totalAssets) },
    { label: '净资产', color: tColor, width: 2.4, values: trendPoints.map((p) => p.netWorth) },
  ]

  const pf = portfolioSummary()

  // 今日盈亏：有行情才显示数值，红涨绿跌；隐藏金额时一并打码
  let dayHtml = '<div class="nw-day__value num t-muted">--</div>'
  if (pf.dayProfit !== null) {
    const cls = pf.dayProfit > 0 ? 't-up' : pf.dayProfit < 0 ? 't-down' : 't-muted'
    const pctText = pf.dayPct !== null ? `（${pf.dayPct >= 0 ? '+' : ''}${(pf.dayPct * 100).toFixed(2)}%）` : ''
    const arrow = pf.dayProfit >= 0 ? '▲' : '▼'
    dayHtml = nwMasked
      ? '<div class="nw-day__value num">******</div>'
      : `<div class="nw-day__value num ${cls}">${signedMoney(pf.dayProfit)}</div>
         <div class="nw-day__pct num ${cls}">${pctText}${arrow}</div>`
  }

  const { balances } = netWorthSummary()
  const assetRows = nwAssetBuckets(balances)
  const liabilityRows = nwLiabilityBuckets(balances)

  const eyeIcon = nwMasked
    ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
  const chevronIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${nwExpanded ? '' : 'is-flipped'}"><polyline points="6 15 12 9 18 15"/></svg>`

  pageEl.innerHTML = `
    <div class="nw-card">
      <div class="nw-card__top">
        <div class="nw-card__main">
          <div class="nw-card__label">净资产(¥)
            <button class="nw-eye${nwMasked ? ' is-off' : ''}" type="button" data-act="nw-mask" aria-label="${nwMasked ? '显示金额' : '隐藏金额'}">${eyeIcon}</button>
          </div>
          <div class="nw-card__value num">${nwMasked ? '******' : formatAmount(netWorth)}</div>
        </div>
        <div class="nw-day">
          <div class="nw-day__label">今日盈亏</div>
          ${dayHtml}
        </div>
      </div>

      <div class="nw-card__body${nwExpanded ? '' : ' is-collapsed'}">
        <div class="nw-section">
          <div class="nw-section__title">资产</div>
          ${nwGridHtml(assetRows)}
        </div>
        ${liabilityRows.length ? `
        <div class="nw-section">
          <div class="nw-section__title">负债</div>
          ${nwGridHtml(liabilityRows)}
        </div>` : ''}
      </div>

      ${(assetRows.length || liabilityRows.length) ? `
      <button class="nw-card__toggle" type="button" data-act="nw-toggle" aria-label="${nwExpanded ? '收起明细' : '展开明细'}">${chevronIcon}</button>` : ''}
    </div>

    ${goalBlockHtml()}

    <div class="grid grid--3">
      ${statCard('本月支出', { text: `¥${formatAmount(expense)}`, cls: 't-expense' }, `共 ${monthTx.filter((t) => t.type === 'expense').length} 笔`, 'var(--expense)')}
      ${statCard('本月收入', { text: `¥${formatAmount(income)}`, cls: 't-income' }, `共 ${monthTx.filter((t) => t.type === 'income').length} 笔`, 'var(--income)')}
      ${statCard('本月结余', { text: `¥${formatAmount(net)}`, cls: net >= 0 ? 't-strong' : 't-expense' }, net >= 0 ? '收支相抵有结余' : '本月支出超过收入', 'var(--primary)')}
    </div>

    <div class="card">
      <div class="card__head">
        <div class="card__title">近 6 个月收支</div>
        <div class="legends" style="display:flex;gap:14px">
          <span style="font-size:12px;color:var(--text-2);display:flex;align-items:center;gap:6px">
            <span class="stat__dot" style="background:var(--income)"></span>收入
          </span>
          <span style="font-size:12px;color:var(--text-2);display:flex;align-items:center;gap:6px">
            <span class="stat__dot" style="background:var(--expense)"></span>支出
          </span>
        </div>
      </div>
      <div class="card__body">
        <div class="chart-slot" id="dash-bars"></div>
      </div>
    </div>

    <div class="card">
      <div class="card__head">
        <div>
          <div class="card__title">资产走势</div>
          <div class="card__sub">${escapeHtml(trendHint)}</div>
        </div>
        <button class="btn btn--sm btn--ghost" type="button" data-act="go-assets">查看资产</button>
      </div>
      <div class="card__body">
        <div class="chart-slot" id="dash-trend"></div>
        <div class="chart-legend">${multiLegendHtml(trendSeries)}</div>
      </div>
    </div>

    <div class="grid grid--sidebar">
      <div class="card">
        <div class="card__head">
          <div class="card__title">资产分布</div>
          <button class="btn btn--sm btn--ghost" type="button" data-act="go-assets">管理资产</button>
        </div>
        <div class="card__body">
          ${dist.length
            ? `<div class="chart-split">
                 <div class="chart-slot" id="dash-donut"></div>
                 <div class="legend" style="flex:1 1 160px;min-width:0">${legendHtml(
                   dist.map((d, i) => ({ label: d.label, value: d.value, color: donutItems[i].color })),
                   (v) => `¥${formatCompact(v)}`
                 )}</div>
               </div>`
            : emptyState('🏦', '还没有资产账户', '去「资产」页添加银行卡、投资账户或负债')}
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <div class="card__title">最近流水</div>
          <button class="btn btn--sm btn--ghost" type="button" data-act="go-records">全部</button>
        </div>
        <div class="card__body card__body--flush">
          ${recent.length
            ? `<div class="list">${recent.map(txRowHtml).join('')}</div>`
            : emptyState('📝', '还没有记账记录', '点击右下角「＋」记录第一笔')}
        </div>
      </div>
    </div>
  `

  mountBars(pageEl.querySelector('#dash-bars'), series.map((s) => ({
    label: shortMonthLabel(s.key), income: s.income, expense: s.expense,
  })))

  mountMultiArea(
    pageEl.querySelector('#dash-trend'),
    trendPoints.map((p) => p.date.slice(5).replace('-', '/')),
    trendSeries,
    { height: 180, gradientPrefix: 'g-dash-asset' }
  )

  if (dist.length) {
    mountDonut(pageEl.querySelector('#dash-donut'), donutItems, {
      centerTitle: '总资产',
      centerValue: formatCompact(totalAssets),
      size: 176,
    })
  }

  pageEl.onclick = (e) => {
    const target = e.target.closest('[data-act]')
    if (!target) return
    const act = target.dataset.act
    if (act === 'add-tx') openRecordSheet()
    else if (act === 'nw-mask') {
      nwMasked = !nwMasked
      nwSaveToggle(NW_MASK_KEY, nwMasked)
      renderDashboard(pageEl)
    } else if (act === 'nw-toggle') {
      nwExpanded = !nwExpanded
      nwSaveToggle(NW_EXPAND_KEY, nwExpanded)
      renderDashboard(pageEl)
    } else if (act === 'go-assets') navigate('assets')
    else if (act === 'go-records') navigate('records')
    else if (act === 'open-goal') openGoalSheet()
  }
}

/* ============================================================
   流水
   ============================================================ */

export function renderRecords(pageEl) {
  const f = state.filter
  const { income, expense, net } = monthTotals(state.month)

  let list = transactionsOfMonth(state.month)
  if (f.type !== 'all') list = list.filter((t) => t.type === f.type)
  if (f.accountId) {
    list = list.filter((t) =>
      String(t.account_id) === String(f.accountId) || String(t.to_account_id) === String(f.accountId))
  }
  if (f.category) list = list.filter((t) => t.category === f.category)
  if (f.keyword) {
    const k = f.keyword.toLowerCase()
    list = list.filter((t) =>
      String(t.note || '').toLowerCase().includes(k) || String(t.category || '').toLowerCase().includes(k))
  }

  const groups = new Map()
  for (const t of list) {
    const key = String(t.occurred_on).slice(0, 10)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  const groupKeys = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1))

  const categoryOptions = Array.from(new Set(transactionsOfMonth(state.month).map((t) => t.category).filter(Boolean)))
    .sort()

  const accountOptions = activeAccounts()

  const listHtml = groupKeys.length
    ? groupKeys.map((date) => {
      const items = groups.get(date)
      const dayIncome = items.filter((t) => t.type === 'income').reduce((s, t) => s + toNumber(t.amount), 0)
      const dayExpense = items.filter((t) => t.type === 'expense').reduce((s, t) => s + toNumber(t.amount), 0)
      return `
        <div class="group-head">
          <strong>${escapeHtml(friendlyDate(date))}</strong>
          <span class="group-sum">
            ${dayIncome > 0 ? `<span class="t-income num">+¥${formatAmount(dayIncome)}</span>` : ''}
            ${dayExpense > 0 ? `<span class="t-expense num">-¥${formatAmount(dayExpense)}</span>` : ''}
          </span>
        </div>
        <div class="list">${items.map(txRowHtml).join('')}</div>`
    }).join('')
    : `<div class="card">${emptyState('🔍', '没有符合条件的记录', '试试切换月份或清空筛选条件')}</div>`

  pageEl.innerHTML = `
    <div class="toolbar">
      <div class="month-nav">
        <button class="month-nav__btn" type="button" data-act="prev-month">‹</button>
        <span class="month-nav__label">${escapeHtml(monthLabel(state.month))}</span>
        <button class="month-nav__btn" type="button" data-act="next-month" ${state.month >= currentMonthKey() ? 'disabled style="opacity:.35"' : ''}>›</button>
      </div>
      <div class="segmented">
        ${['all', 'expense', 'income', 'transfer'].map((t) => `
          <button class="segmented__btn${f.type === t ? ' is-active' : ''}" type="button" data-act="filter-type" data-type="${t}">
            ${t === 'all' ? '全部' : KIND_LABEL[t]}
          </button>`).join('')}
      </div>
      <div class="spacer"></div>
      <button class="btn btn--sm btn--ghost" type="button" data-act="reset-filter">重置</button>
    </div>

    <div class="grid grid--3">
      ${statCard('本月支出', { text: `¥${formatAmount(expense)}`, cls: 't-expense' }, '', 'var(--expense)')}
      ${statCard('本月收入', { text: `¥${formatAmount(income)}`, cls: 't-income' }, '', 'var(--income)')}
      ${statCard('本月结余', { text: `¥${formatAmount(net)}`, cls: net >= 0 ? 't-strong' : 't-expense' }, '', 'var(--primary)')}
    </div>

    <div class="card">
      <div class="card__body" style="display:flex;gap:10px;flex-wrap:wrap">
        <select class="select" style="flex:1;min-width:150px" data-filter="accountId">
          <option value="">全部账户</option>
          ${accountOptions.map((a) => `<option value="${a.id}"${String(f.accountId) === String(a.id) ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
        </select>
        <select class="select" style="flex:1;min-width:150px" data-filter="category">
          <option value="">全部分类</option>
          ${categoryOptions.map((c) => `<option value="${escapeHtml(c)}"${f.category === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        <input class="input" style="flex:2;min-width:180px" type="search" placeholder="搜索备注或分类" value="${escapeHtml(f.keyword)}" data-filter="keyword">
      </div>
    </div>

    ${listHtml}

    <div style="text-align:center;color:var(--text-3);font-size:12px">共 ${list.length} 笔记录</div>
  `

  const keywordInput = pageEl.querySelector('[data-filter="keyword"]')
  let composing = false

  pageEl.querySelectorAll('[data-filter]').forEach((el) => {
    if (el.dataset.filter === 'keyword') {
      el.addEventListener('compositionstart', () => { composing = true })
      el.addEventListener('compositionend', () => { composing = false; state.filter.keyword = el.value; requestRender() })
      el.addEventListener('input', () => {
        if (composing) return
        state.filter.keyword = el.value
        // 保持焦点：只更新列表部分代价高，这里用防抖整页重绘
        window.clearTimeout(el.__t)
        el.__t = window.setTimeout(() => {
          const pos = el.selectionStart
          requestRender()
          const next = document.querySelector('[data-filter="keyword"]')
          if (next) { next.focus(); try { next.setSelectionRange(pos, pos) } catch (_) { /* noop */ } }
        }, 320)
      })
    } else {
      el.addEventListener('change', () => {
        state.filter[el.dataset.filter] = el.value
        requestRender()
      })
    }
  })
  if (keywordInput && state.filter.keyword) {
    // 光标回到末尾
    keywordInput.focus({ preventScroll: true })
    keywordInput.setSelectionRange(keywordInput.value.length, keywordInput.value.length)
  }

  pageEl.onclick = (e) => {
    const target = e.target.closest('[data-act]')
    if (!target || target.disabled) return
    const act = target.dataset.act
    if (act === 'prev-month') {
      state.month = shiftMonth(state.month, -1)
      requestRender()
    } else if (act === 'next-month') {
      state.month = shiftMonth(state.month, 1)
      requestRender()
    } else if (act === 'filter-type') {
      state.filter.type = target.dataset.type
      requestRender()
    } else if (act === 'reset-filter') {
      state.filter = { type: 'all', category: '', accountId: '', keyword: '' }
      requestRender()
    } else if (act === 'edit-tx') {
      const tx = state.transactions.find((t) => String(t.id) === target.dataset.id)
      if (tx) openRecordSheet(tx)
    }
  }
}

/* ============================================================
   资产
   ============================================================ */

export function renderAssets(pageEl) {
  const { totalAssets, totalLiabilities, netWorth, balances } = netWorthSummary()
  const accounts = activeAccounts()
  const assetAccounts = accounts.filter((a) => !typeMeta(a.type).liability)
  const debtAccounts = accounts.filter((a) => typeMeta(a.type).liability)
  const pf = portfolioSummary()
  const realized = realizedSummary()
  const holdings = openHoldings().filter((h) => {
    const a = accountById(h.account_id)
    return a && !a.is_archived
  })
  const closed = closedHoldings()

  /* ---------- 资产走势 ---------- */
  const chartPoints = snapshotPointsInRange(state.chartRange)
  const lastPoint = chartPoints[chartPoints.length - 1]
  const prevPoint = chartPoints[chartPoints.length - 2]
  const netColor = lastPoint && prevPoint
    ? (lastPoint.netWorth >= prevPoint.netWorth ? '#e5484d' : '#0e9f6e')
    : '#2f6bff'

  let trendHint = '还没有快照数据'
  if (chartPoints.length >= 2) {
    const first = chartPoints[0]
    const diff = lastPoint.netWorth - first.netWorth
    const pct = first.netWorth !== 0 ? (diff / Math.abs(first.netWorth)) * 100 : null
    trendHint = `${first.date} → ${lastPoint.date} 净资产 ${diff >= 0 ? '增长' : '减少'} ¥${formatAmount(Math.abs(diff))}${pct !== null ? `（${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%）` : ''}`
  } else if (chartPoints.length === 1) {
    trendHint = '已有 1 条快照，明天再来即可看到变化'
  }

  const assetSeries = [
    { label: '总资产', color: '#2f6bff', width: 1.8, fill: false, values: chartPoints.map((p) => p.totalAssets) },
    { label: '总负债', color: '#f0a020', width: 1.6, fill: false, dashed: true, values: chartPoints.map((p) => p.totalLiabilities) },
    { label: '净资产', color: netColor, width: 2.6, values: chartPoints.map((p) => p.netWorth) },
  ]

  const rangeBtns = SNAPSHOT_RANGES.map((r) =>
    `<button class="segmented__btn${r.value === state.chartRange ? ' is-active' : ''}" type="button" data-range="${r.value}">${r.label}</button>`
  ).join('')

  const groupHtml = (title, accounts_, emptyIcon, emptyText) => `
    <div class="card">
      <div class="card__head">
        <div class="card__title">${escapeHtml(title)}</div>
        <div class="card__sub num">${accounts_.length} 个账户</div>
      </div>
      <div class="card__body card__body--flush">
        ${accounts_.length
          ? `<div class="list">${accounts_.map((a) => accountRowHtml(a, balances.get(String(a.id)) || 0)).join('')}</div>`
          : emptyState(emptyIcon, emptyText)}
      </div>
    </div>`

  const fxText = fxSummary()
  const fxMissing = hasFxMissingHolding()

  const holdingsCard = holdings.length
    ? `
    <div class="card">
      <div class="card__head">
        <div>
          <div class="card__title">投资持仓</div>
          <div class="card__sub" id="quote-status">${escapeHtml(quoteStatusText())}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn--sm btn--ghost" type="button" data-act="refresh-quote">刷新行情</button>
          <button class="btn btn--sm btn--primary" type="button" data-act="add-holding">＋ 添加</button>
        </div>
      </div>
      <div class="card__body">
        <div class="grid grid--3">
          ${statCard('持仓市值', { text: `¥${formatAmount(pf.marketValue)}`, cls: 't-strong' }, `共 ${pf.count} 项持仓`, 'var(--primary)')}
          ${statCard('浮动盈亏',
            { text: pf.profit === null ? '—' : signedMoney(pf.profit), cls: changeClass(pf.profit) },
            pf.profitPct === null ? '未填成本价' : `${pf.profitPct >= 0 ? '+' : ''}${(pf.profitPct * 100).toFixed(2)}%`,
            'var(--up)')}
          ${statCard('今日盈亏',
            { text: pf.dayProfit === null ? '—' : signedMoney(pf.dayProfit), cls: changeClass(pf.dayProfit) },
            pf.dayPct === null ? '暂无行情数据' : `${pf.dayPct >= 0 ? '+' : ''}${(pf.dayPct * 100).toFixed(2)}%`,
            'var(--down)')}
        </div>
        ${realized.total !== 0 || realized.closedCount > 0
          ? `<div class="note-strip">累计已实现盈亏
               <strong class="num ${changeClass(realized.total)}">${formatSigned(realized.total)}</strong>
               <span class="note-strip__sep">·</span>清仓 ${realized.closedCount} 笔
             </div>`
          : ''}
        ${fxMissing
          ? '<div class="note-strip">港美股汇率未取到，市值暂按原币计入，请点「刷新行情」重试</div>'
          : (fxText ? `<div class="note-strip">汇率 ${escapeHtml(fxText)} · 港美股市值已折算为人民币</div>` : '')}
        <div class="divider" style="margin:16px 0 10px"></div>
        <div class="list list--holdings">${holdings.map(holdingRowHtml).join('')}</div>
        <p style="font-size:11.5px;color:var(--text-3);margin:12px 0 0">
          买入会按移动加权平均摊薄成本价，卖出结算已实现盈亏；份额归零即自动进入清仓记录。
        </p>
      </div>
    </div>`
    : ''

  const closedCard = closed.length
    ? `
    <div class="card">
      <div class="card__head">
        <div>
          <div class="card__title">清仓记录</div>
          <div class="card__sub">共 ${closed.length} 笔 · 累计已实现
            <b class="num ${changeClass(realized.total)}">${formatSigned(realized.total)}</b>
          </div>
        </div>
        <button class="btn btn--sm btn--ghost" type="button" data-act="toggle-closed">${state.showClosed ? '收起' : '展开'}</button>
      </div>
      <div class="card__body card__body--flush ${state.showClosed ? '' : 'hidden'}" id="closed-body">
        <div class="list">${closed.map(closedRowHtml).join('')}</div>
      </div>
    </div>`
    : ''

  pageEl.innerHTML = `
    <div class="hero">
      <div class="hero__label">当前净资产</div>
      <div class="hero__value num">¥${formatAmount(netWorth)}</div>
      <div class="hero__meta">
        <div class="hero__meta-item"><span>总资产</span><strong class="num">¥${formatAmount(totalAssets)}</strong></div>
        <div class="hero__meta-item"><span>总负债</span><strong class="num">¥${formatAmount(totalLiabilities)}</strong></div>
        <div class="hero__meta-item"><span>负债率</span><strong class="num">${totalAssets > 0 ? ((totalLiabilities / totalAssets) * 100).toFixed(1) : '0.0'}%</strong></div>
      </div>
    </div>

    <div class="card">
      <div class="card__head">
        <div>
          <div class="card__title">资产走势</div>
          <div class="card__sub">${escapeHtml(trendHint)}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn--sm btn--ghost" type="button" data-act="snapshot">记录今日快照</button>
          <button class="btn btn--sm btn--primary" type="button" data-act="add-account">＋ 添加账户</button>
        </div>
      </div>
      <div class="card__body">
        <div class="segmented" id="range-bar" style="justify-self:start;margin-bottom:14px">${rangeBtns}</div>
        <div class="chart-slot" id="asset-trend"></div>
        <div class="chart-legend">${multiLegendHtml(assetSeries)}</div>
        ${fxText ? '<p class="field__hint" style="margin-top:10px">港美股按当日汇率折算为人民币计入。该口径自本次更新起生效，之前的快照未折算，曲线在切换日会有一个台阶，不是资产真的跳变。</p>' : ''}
      </div>
    </div>

    ${holdingsCard}
    ${closedCard}
    ${groupHtml('资产账户', assetAccounts, '🏦', '还没有资产账户，点右上角「添加账户」开始')}
    ${groupHtml('负债账户', debtAccounts, '💳', '还没有负债账户')}
  `

  mountMultiArea(
    pageEl.querySelector('#asset-trend'),
    chartPoints.map((p) => p.date.slice(5).replace('-', '/')),
    assetSeries,
    { height: 210, gradientPrefix: 'g-asset' }
  )

  pageEl.onclick = async (e) => {
    const target = e.target.closest('[data-act]')
    if (!target) return
    const act = target.dataset.act
    const id = target.dataset.id

    if (act === 'add-account') {
      openAccountSheet()
    } else if (act === 'edit-account') {
      const acc = state.accounts.find((a) => String(a.id) === id)
      if (acc) openAccountSheet(acc)
    } else if (act === 'add-holding') {
      openHoldingSheet()
    } else if (act === 'edit-holding') {
      const hit = state.holdings.find((h) => String(h.id) === id)
      if (hit) openHoldingSheet(hit)
    } else if (act === 'buy-holding' || act === 'sell-holding') {
      const hit = state.holdings.find((h) => String(h.id) === id)
      if (hit) openTradeSheet(hit, act === 'buy-holding' ? 'buy' : 'sell')
    } else if (act === 'trades-holding' || act === 'open-closed') {
      const hit = state.holdings.find((h) => String(h.id) === id)
      if (hit) openTradesSheet(hit)
    } else if (act === 'toggle-closed') {
      state.showClosed = !state.showClosed
      const bodyEl = pageEl.querySelector('#closed-body')
      if (bodyEl) bodyEl.classList.toggle('hidden', !state.showClosed)
      target.textContent = state.showClosed ? '收起' : '展开'
    } else if (act === 'range') {
      const range = target.dataset.range
      if (range && range !== state.chartRange) {
        state.chartRange = range
        requestRender()
      }
    } else if (act === 'refresh-quote') {
      target.disabled = true
      target.textContent = '更新中…'
      const res = await refreshQuotes({ force: true, silent: true })
      if (res && res.error) {
        toastErr(res.error)
        if (target.isConnected) { target.disabled = false; target.textContent = '刷新行情' }
      } else if (res && res.failed && res.failed.length) {
        toastErr(`${res.failed.length} 个标的没取到行情，请检查市场类型与代码`)
        if (target.isConnected) { target.disabled = false; target.textContent = '刷新行情' }
      } else {
        toastOk('行情已更新')
      }
    } else if (act === 'snapshot') {
      try {
        await recordTodaySnapshot()
        toastOk('已记录今日净资产快照')
        notifyChange()
      } catch (err) {
        toastErr(describeError(err))
      }
    }
  }
}

/* ---------------- 清仓记录行 ---------------- */

function closedRowHtml(h) {
  const code = displayCode(h.market, h.symbol)
  // realized_profit 记账币种是成交币种，展示时折成人民币；收益率是比值，不受币种影响
  const fxR = fxRate(holdingCurrency(h)) || 1
  const profit = toNumber(h.realized_profit) * fxR
  const list = tradesOfHolding(h.id)
  const buys = list.filter((t) => t.side === 'buy')
  const sells = list.filter((t) => t.side === 'sell')

  const buyShares = buys.reduce((s, t) => s + toNumber(t.shares), 0)
  const buyCost = buys.reduce((s, t) => s + toNumber(t.amount) + toNumber(t.fee), 0)
  const sellShares = sells.reduce((s, t) => s + toNumber(t.shares), 0)
  const sellAmount = sells.reduce((s, t) => s + toNumber(t.amount) - toNumber(t.fee), 0)

  const avgCost = buyShares > 0 ? buyCost / buyShares : null
  const avgSell = sellShares > 0 ? sellAmount / sellShares : null
  const pct = buyCost > 0 ? (profit / buyCost) * 100 : null
  const days = holdingDays(h)
  const closedOn = h.closed_at ? String(h.closed_at).slice(0, 10) : ''
  const firstOn = firstTradeDate(h.id)

  const meta = [code, marketLabel(h.market)]
  if (days !== null) meta.push(`持有 ${days} 天`)
  if (closedOn) meta.push(`${closedOn} 清仓`)

  const priceLine = []
  if (avgCost !== null) priceLine.push(`买入均价 ${priceText(avgCost)}`)
  if (avgSell !== null) priceLine.push(`卖出均价 ${priceText(avgSell)}`)

  return `
    <button class="closed-row" type="button" data-act="open-closed" data-id="${h.id}">
      <span class="closed-row__main">
        <span class="closed-row__name">${escapeHtml(h.name || code)}</span>
        <span class="closed-row__sub">${escapeHtml(meta.join(' · '))}</span>
        ${priceLine.length ? `<span class="closed-row__sub">${escapeHtml(priceLine.join(' → '))}</span>` : ''}
      </span>
      <span class="closed-row__right">
        <span class="closed-row__profit num ${changeClass(profit)}">${formatSigned(profit)}</span>
        ${pct === null ? '' : `<span class="closed-row__pct num ${changeClass(profit)}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>`}
      </span>
    </button>`
}

/* ============================================================
   统计
   ============================================================ */

export function renderStats(pageEl) {
  const m = state.statsMonth
  const { income, expense, net } = monthTotals(m)
  const expCats = categoryBreakdown(m, 'expense')
  const incCats = categoryBreakdown(m, 'income')
  const series = monthlySeries(6, m)
  const txCount = transactionsOfMonth(m).length
  const avgDay = expense / new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()

  const expDonut = expCats.map((c) => ({ label: c.name, value: c.value, color: c.color }))
  const incDonut = incCats.map((c) => ({ label: c.name, value: c.value, color: c.color }))

  pageEl.innerHTML = `
    <div class="toolbar">
      <div class="month-nav">
        <button class="month-nav__btn" type="button" data-act="prev-month">‹</button>
        <span class="month-nav__label">${escapeHtml(monthLabel(m))}</span>
        <button class="month-nav__btn" type="button" data-act="next-month" ${m >= currentMonthKey() ? 'disabled style="opacity:.35"' : ''}>›</button>
      </div>
      <div class="spacer"></div>
      <span style="font-size:12.5px;color:var(--text-3)">共 ${txCount} 笔记录</span>
    </div>

    <div class="grid grid--3">
      ${statCard('支出合计', { text: `¥${formatAmount(expense)}`, cls: 't-expense' }, `日均 ¥${formatAmount(avgDay)}`, 'var(--expense)')}
      ${statCard('收入合计', { text: `¥${formatAmount(income)}`, cls: 't-income' }, incCats.length ? `主要来源：${incCats[0].name}` : '暂无收入', 'var(--income)')}
      ${statCard('结余', { text: `¥${formatAmount(net)}`, cls: net >= 0 ? 't-strong' : 't-expense' }, income > 0 ? `储蓄率 ${((net / income) * 100).toFixed(0)}%` : '—', 'var(--primary)')}
    </div>

    <div class="card">
      <div class="card__head"><div class="card__title">支出构成</div><div class="card__sub">按分类</div></div>
      <div class="card__body">
        ${expCats.length
          ? `<div class="chart-split">
               <div class="chart-slot" id="stats-exp-donut"></div>
               <div class="legend" style="flex:1 1 160px;min-width:0">${legendHtml(expDonut, (v) => `${((v / expense) * 100).toFixed(1)}% · ¥${formatCompact(v)}`)}</div>
             </div>
             <div class="divider" style="margin:16px 0"></div>
             ${rankingHtml(expCats, { emptyText: '本月还没有支出记录' })}`
          : emptyState('💸', '本月还没有支出记录')}
      </div>
    </div>

    <div class="card">
      <div class="card__head"><div class="card__title">收入构成</div><div class="card__sub">按分类</div></div>
      <div class="card__body">
        ${incCats.length
          ? `<div class="chart-split">
               <div class="chart-slot" id="stats-inc-donut"></div>
               <div class="legend" style="flex:1 1 160px;min-width:0">${legendHtml(incDonut, (v) => `${((v / income) * 100).toFixed(1)}% · ¥${formatCompact(v)}`)}</div>
             </div>
             <div class="divider" style="margin:16px 0"></div>
             ${rankingHtml(incCats, { emptyText: '本月还没有收入记录' })}`
          : emptyState('💰', '本月还没有收入记录')}
      </div>
    </div>

    <div class="card">
      <div class="card__head">
        <div class="card__title">近 6 个月收支对比</div>
        <div style="display:flex;gap:14px">
          <span style="font-size:12px;color:var(--text-2);display:flex;align-items:center;gap:6px">
            <span class="stat__dot" style="background:var(--income)"></span>收入
          </span>
          <span style="font-size:12px;color:var(--text-2);display:flex;align-items:center;gap:6px">
            <span class="stat__dot" style="background:var(--expense)"></span>支出
          </span>
        </div>
      </div>
      <div class="card__body">
        <div class="chart-slot" id="stats-bars"></div>
      </div>
    </div>
  `

  if (expCats.length) {
    mountDonut(pageEl.querySelector('#stats-exp-donut'), expDonut, {
      centerTitle: '支出', centerValue: formatCompact(expense), size: 176,
    })
  }
  if (incCats.length) {
    mountDonut(pageEl.querySelector('#stats-inc-donut'), incDonut, {
      centerTitle: '收入', centerValue: formatCompact(income), size: 176,
    })
  }
  mountBars(pageEl.querySelector('#stats-bars'), series.map((s) => ({
    label: shortMonthLabel(s.key), income: s.income, expense: s.expense,
  })))

  pageEl.onclick = (e) => {
    const target = e.target.closest('[data-act]')
    if (!target || target.disabled) return
    if (target.dataset.act === 'prev-month') {
      state.statsMonth = shiftMonth(state.statsMonth, -1)
      requestRender()
    } else if (target.dataset.act === 'next-month') {
      state.statsMonth = shiftMonth(state.statsMonth, 1)
      requestRender()
    }
  }
}

/* ============================================================
   我的
   ============================================================ */

export function renderProfile(pageEl) {
  const user = state.user || {}
  const name = user.name || '记账用户'
  const phone = normalizePhone(user.phone || user.phoneNumber || '')
  const maskedPhone = phone ? phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : ''
  const identity = maskedPhone || (user.email ? String(user.email) : '已登录')

  const invite = allowlistInfo()
  const inviteCard = `
    <div class="card">
      <div class="card__head">
        <div>
          <div class="card__title">受邀成员</div>
          <div class="card__sub">${invite.ok
            ? (invite.count > 0 ? `共 ${invite.count} 个手机号可登录本应用` : '名单为空，当前不限制登录手机号')
            : '名单暂时读取失败，未做邀请校验'}</div>
        </div>
        <span class="badge badge--flat">${invite.count > 0 ? '邀请制' : '未限制'}</span>
      </div>
      <div class="card__body">
        ${invite.count > 0
          ? `<div class="chips">${invite.labels.map((label) => `<span class="chip"><span class="chip__emoji">✅</span>${escapeHtml(label)}</span>`).join('')}</div>`
          : ''}
        <p style="font-size:11.5px;color:var(--text-3);margin:12px 0 0">
          只有名单内的手机号能获取验证码登录，其他人拿到链接也进不来（微信登录在邀请制下已关闭）。
          名单只保存加盐摘要、不含真实号码，且客户端只能读、不能改。需要增减成员，直接告诉 WorkBuddy 即可。
        </p>
      </div>
    </div>`

  const { netWorth } = netWorthSummary()
  const accounts = activeAccounts()

  const categorySection = (kind, title) => {
    const list = state.categories.filter((c) => c.kind === kind && !c.is_archived)
    return `
      <div class="card">
        <div class="card__head">
          <div class="card__title">${escapeHtml(title)}</div>
          <button class="btn btn--sm btn--soft" type="button" data-act="add-category" data-kind="${kind}">＋ 新增</button>
        </div>
        <div class="card__body">
          ${list.length
            ? `<div class="chips">${list.map((c) => `
                <span class="chip" style="padding-right:6px">
                  <span class="chip__emoji">${escapeHtml(c.icon || '📦')}</span>${escapeHtml(c.name)}
                  <button type="button" data-act="del-category" data-id="${c.id}"
                          style="border:none;background:transparent;color:var(--text-3);font-size:14px;line-height:1;padding:0 2px;cursor:pointer">✕</button>
                </span>`).join('')}</div>`
            : `<div style="font-size:13px;color:var(--text-3)">还没有分类，点「＋ 新增」创建</div>`}
        </div>
      </div>`
  }

  pageEl.innerHTML = `
    <div class="card">
      <div class="card__body" style="display:flex;align-items:center;gap:14px">
        <div class="user-chip__avatar" style="width:52px;height:52px;font-size:20px">
          ${user.avatarUrl
            ? `<img src="${escapeHtml(user.avatarUrl)}" alt="">`
            : escapeHtml(initialsOf(name))}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:16px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(name)}</div>
          <div style="font-size:12.5px;color:var(--text-3)">${escapeHtml(identity)}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card__head"><div class="card__title">数据概览</div></div>
      <div class="card__body">
        <div class="kv"><span class="kv__k">净资产</span><span class="kv__v num">¥${formatAmount(netWorth)}</span></div>
        <div class="kv"><span class="kv__k">资产账户</span><span class="kv__v num">${accounts.length} 个</span></div>
        <div class="kv"><span class="kv__k">流水记录</span><span class="kv__v num">${state.transactions.length} 笔</span></div>
        <div class="kv"><span class="kv__k">资产快照</span><span class="kv__v num">${state.snapshots.length} 条</span></div>
        <div class="kv"><span class="kv__k">收支分类</span><span class="kv__v num">${state.categories.length} 个</span></div>
      </div>
    </div>

    ${inviteCard}

    ${categorySection('expense', '支出分类')}
    ${categorySection('income', '收入分类')}

    <div class="card">
      <div class="card__body" style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn--ghost btn--block" type="button" data-act="help">使用说明</button>
        <button class="btn btn--danger-ghost btn--block" type="button" data-act="logout">退出登录</button>
      </div>
    </div>
  `

  pageEl.onclick = async (e) => {
    const target = e.target.closest('[data-act]')
    if (!target) return
    const act = target.dataset.act
    if (act === 'add-category') {
      openCategorySheet(target.dataset.kind)
    } else if (act === 'del-category') {
      const cat = state.categories.find((c) => String(c.id) === target.dataset.id)
      if (cat) removeCategory(cat)
    } else if (act === 'help') {
      openHelpSheet()
    } else if (act === 'logout') {
      const ok = await confirmDialog({
        title: '退出登录',
        message: '退出后需要重新登录才能查看账本，确定退出吗？',
        confirmText: '退出登录',
        danger: true,
      })
      if (ok) requestLogout()
    }
  }
}

export const PAGES = {
  dashboard: { title: '概览', render: renderDashboard },
  records: { title: '流水', render: renderRecords },
  assets: { title: '资产', render: renderAssets },
  stats: { title: '统计', render: renderStats },
  profile: { title: '我的', render: renderProfile },
}
