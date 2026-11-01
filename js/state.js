/* 内存状态 + 余额 / 盈亏计算 */

import { loadDb, saveDb } from './store.js'
import {
  toNumber, todayISO, currentMonthKey, monthRange, round2, round4, round6, uid,
} from './util.js'
import { currencyOf, fetchQuotes, fetchFxRates } from './quotes.js'

const SHARE_EPS = 1e-6

export const state = {
  db: null,
  tab: 'overview',
  monthKey: currentMonthKey(),
  refreshing: false,
}

export function bootState() {
  state.db = loadDb()
  state.monthKey = currentMonthKey()
}

function persist() {
  saveDb(state.db)
}

export function fxRate(currency) {
  if (!currency || currency === 'CNY') return 1
  const r = toNumber(state.db.fx?.rates?.[currency])
  return r > 0 ? r : 0
}

/** 汇率缺失时禁止按 1:1 乱存 */
export function requireFx(currency) {
  const r = fxRate(currency)
  if (!r) throw new Error(`${currency} 汇率缺失，请先刷新行情后再保存`)
  return r
}

export function accounts(includeArchived = false) {
  return state.db.accounts.filter((a) => includeArchived || !a.is_archived)
}

export function accountById(id) {
  return state.db.accounts.find((a) => a.id === id) || null
}

export function categories(kind) {
  return state.db.categories
    .filter((c) => !c.is_archived && (!kind || c.kind === kind))
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function openHoldings() {
  return state.db.holdings.filter((h) => !h.closed_at && toNumber(h.shares) > SHARE_EPS)
}

export function closedHoldings() {
  return state.db.holdings.filter((h) => h.closed_at)
}

function isOpenHolding(h) {
  return !h.closed_at && toNumber(h.shares) > SHARE_EPS
}

function holdingCostAmount(h) {
  if (h.cost_amount != null && h.cost_amount !== '') return toNumber(h.cost_amount)
  return round4(toNumber(h.shares) * toNumber(h.cost_price))
}

export function holdingMarketValue(h) {
  const cur = currencyOf(h.market)
  const rate = fxRate(cur) || 0
  if (!rate && cur !== 'CNY') return 0
  return round2(toNumber(h.last_price) * toNumber(h.shares) * rate)
}

export function holdingUnrealized(h) {
  return round2(holdingMarketValue(h) - holdingCostAmount(h) * (fxRate(currencyOf(h.market)) || (currencyOf(h.market) === 'CNY' ? 1 : 0)))
}

function holdingDayBase(h) {
  const prev = toNumber(h.prev_close)
  if (!prev) return 0
  const cur = currencyOf(h.market)
  const rate = fxRate(cur) || (cur === 'CNY' ? 1 : 0)
  return toNumber(h.shares) * prev * rate
}

function holdingDayProfit(h) {
  const prev = toNumber(h.prev_close)
  const last = toNumber(h.last_price)
  if (!prev || !last) return null
  const cur = currencyOf(h.market)
  const rate = fxRate(cur) || (cur === 'CNY' ? 1 : 0)
  if (!rate) return null
  return round2((last - prev) * toNumber(h.shares) * rate)
}

/** 只取 YYYY-MM-DD；行情时间必须带年份才能命中今天 */
function stockDayOf(priceTime) {
  const s = String(priceTime || '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) ? s.slice(0, 10) : ''
}

export function todayDayProfit() {
  const today = todayISO()
  let total = 0
  let base = 0
  let has = false
  for (const h of state.db.holdings) {
    if (!isOpenHolding(h)) continue
    const acc = accountById(h.account_id)
    if (!acc || acc.is_archived) continue
    if (stockDayOf(h.price_time) !== today) continue
    const dp = holdingDayProfit(h)
    if (dp === null) continue
    total += dp
    base += holdingDayBase(h)
    has = true
  }
  return { profit: has ? round2(total) : null, pct: has && base > 0 ? total / base : null, has }
}

/** 账户可用现金（建账 + 日常流水 + 买卖现金流） */
function accountCashFlow(accountId) {
  let n = 0
  for (const t of state.db.transactions) {
    if (t.type === 'income' && t.account_id === accountId) n += toNumber(t.amount)
    else if (t.type === 'expense' && t.account_id === accountId) n -= toNumber(t.amount)
    else if (t.type === 'transfer') {
      if (t.account_id === accountId) n -= toNumber(t.amount)
      if (t.to_account_id === accountId) n += toNumber(t.amount)
    }
  }
  for (const tr of state.db.holding_trades) {
    if (tr.is_opening) continue
    const cashAcc = cashAccountIdForTrade(tr)
    if (cashAcc !== accountId) continue
    const rate = toNumber(tr.fx_rate) || fxRate(currencyOf(tr.market)) || (currencyOf(tr.market) === 'CNY' ? 1 : 0)
    const cny = round2(toNumber(tr.amount) * rate)
    if (tr.side === 'buy') n -= cny
    else n += cny
  }
  return n
}

function cashAccountIdForTrade(tr) {
  const acc = accountById(tr.account_id)
  if (!acc) return tr.account_id
  return acc.cash_account_id || acc.id
}

export function accountBalance(acc) {
  if (!acc) return 0
  if (acc.manual_balance != null && acc.manual_balance !== '') return toNumber(acc.manual_balance)
  const holdings = openHoldings().filter((h) => h.account_id === acc.id)
  if (acc.type === 'invest' || holdings.length) {
    const mv = holdings.reduce((s, h) => s + holdingMarketValue(h), 0)
    const cash = toNumber(acc.initial_balance) + accountCashFlow(acc.id)
    // 关联资金账户上的买卖现金另计；投资账户本身展示市值 + 本账户现金
    return round2(mv + cash)
  }
  let auto = toNumber(acc.initial_balance) + accountCashFlow(acc.id)
  if (acc.type === 'liability') auto = toNumber(acc.initial_balance) - accountCashFlow(acc.id)
  return round2(auto)
}

export function netWorthSummary() {
  let totalAssets = 0
  let totalLiabilities = 0
  for (const a of accounts()) {
    if (!a.include_in_networth) continue
    const bal = accountBalance(a)
    if (a.type === 'liability') totalLiabilities += Math.abs(bal)
    else totalAssets += bal
  }
  return {
    totalAssets: round2(totalAssets),
    totalLiabilities: round2(totalLiabilities),
    netWorth: round2(totalAssets - totalLiabilities),
  }
}

export function monthTxSummary(monthKey = state.monthKey) {
  const { start, end } = monthRange(monthKey)
  let income = 0
  let expense = 0
  for (const t of state.db.transactions) {
    if (t.occurred_on < start || t.occurred_on > end) continue
    if (t.type === 'income') income += toNumber(t.amount)
    else if (t.type === 'expense') expense += toNumber(t.amount)
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) }
}

export function transactionsInMonth(monthKey = state.monthKey) {
  const { start, end } = monthRange(monthKey)
  return state.db.transactions
    .filter((t) => t.occurred_on >= start && t.occurred_on <= end)
    .sort((a, b) => (a.occurred_on === b.occurred_on ? (b.created_at || '').localeCompare(a.created_at || '') : b.occurred_on.localeCompare(a.occurred_on)))
}

export function expenseByCategory(monthKey = state.monthKey) {
  const { start, end } = monthRange(monthKey)
  const map = new Map()
  for (const t of state.db.transactions) {
    if (t.type !== 'expense') continue
    if (t.occurred_on < start || t.occurred_on > end) continue
    map.set(t.category, round2((map.get(t.category) || 0) + toNumber(t.amount)))
  }
  return Array.from(map.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
}

/* ---------- CRUD ---------- */

export function upsertAccount(data) {
  const now = new Date().toISOString()
  if (data.id) {
    const i = state.db.accounts.findIndex((a) => a.id === data.id)
    if (i < 0) throw new Error('账户不存在')
    state.db.accounts[i] = { ...state.db.accounts[i], ...data, updated_at: now }
  } else {
    state.db.accounts.push({
      id: uid('acc'),
      name: data.name,
      type: data.type || 'bank',
      currency: data.currency || 'CNY',
      initial_balance: toNumber(data.initial_balance),
      manual_balance: data.manual_balance ?? null,
      include_in_networth: data.include_in_networth !== false,
      icon: data.icon || '💳',
      color: data.color || '#3b82f6',
      note: data.note || '',
      sort_order: state.db.accounts.length,
      is_archived: false,
      cash_account_id: data.cash_account_id || null,
      created_at: now,
      updated_at: now,
    })
  }
  persist()
}

export function archiveAccount(id) {
  const a = accountById(id)
  if (!a) return
  a.is_archived = true
  a.updated_at = new Date().toISOString()
  persist()
}

let _txLock = false
export function addTransaction(data) {
  if (_txLock) throw new Error('请勿重复提交')
  _txLock = true
  try {
    const currency = data.currency || 'CNY'
    let amount = toNumber(data.amount)
    let original_amount = data.original_amount != null ? toNumber(data.original_amount) : null
    if (currency !== 'CNY') {
      const rate = requireFx(currency)
      if (original_amount == null) original_amount = amount
      amount = round2(original_amount * rate)
    }
    const now = new Date().toISOString()
    state.db.transactions.push({
      id: uid('tx'),
      type: data.type,
      amount,
      account_id: data.account_id,
      to_account_id: data.to_account_id || null,
      category: data.category || '其他',
      occurred_on: data.occurred_on || todayISO(),
      note: data.note || '',
      currency,
      original_amount,
      created_at: now,
      updated_at: now,
    })
    persist()
  } finally {
    setTimeout(() => { _txLock = false }, 400)
  }
}

export function deleteTransaction(id) {
  state.db.transactions = state.db.transactions.filter((t) => t.id !== id)
  persist()
}

export function addCategory(kind, name, icon = '🏷️', color = '#64748b') {
  const n = String(name || '').trim()
  if (!n) throw new Error('请填写分类名称')
  const exists = state.db.categories.some(
    (c) => !c.is_archived && c.kind === kind && c.name === n,
  )
  if (exists) throw new Error('该分类已存在')
  state.db.categories.push({
    id: uid('cat'),
    kind,
    name: n,
    icon,
    color,
    sort_order: state.db.categories.length,
    is_archived: false,
    created_at: new Date().toISOString(),
  })
  persist()
}

export function archiveCategory(id) {
  const c = state.db.categories.find((x) => x.id === id)
  if (!c) return
  c.is_archived = true
  persist()
}

export function applyTrade(payload) {
  const { side, market, symbol, name, shares, price, fee = 0, account_id, traded_on, is_opening = false, note = '' } = payload
  const sh = toNumber(shares)
  const px = toNumber(price)
  const fe = toNumber(fee)
  if (sh <= 0 || px <= 0) throw new Error('份额和价格必须大于 0')
  const cur = currencyOf(market)
  const rate = is_opening ? (fxRate(cur) || (cur === 'CNY' ? 1 : 0)) : requireFx(cur)
  if (!rate) throw new Error('汇率缺失，无法记账')

  let holding = openHoldings().find(
    (h) => h.account_id === account_id && h.market === market && h.symbol === symbol,
  )
  const now = new Date().toISOString()
  let amount = 0
  let realized = 0

  if (side === 'buy') {
    amount = round4(sh * px + fe)
    if (!holding) {
      holding = {
        id: uid('hld'),
        account_id,
        market,
        symbol,
        name: name || symbol,
        shares: sh,
        cost_price: round4(amount / sh),
        cost_amount: amount,
        last_price: px,
        prev_close: px,
        change_pct: 0,
        price_time: traded_on || todayISO(),
        quoted_at: now,
        note: '',
        sort_order: 0,
        realized_profit: 0,
        closed_at: null,
        created_at: now,
        updated_at: now,
      }
      state.db.holdings.push(holding)
    } else {
      const oldCost = holdingCostAmount(holding)
      const newShares = round6(toNumber(holding.shares) + sh)
      const newCost = round4(oldCost + amount)
      holding.shares = newShares
      holding.cost_amount = newCost
      holding.cost_price = newShares > 0 ? round4(newCost / newShares) : 0
      holding.name = name || holding.name
      holding.last_price = px
      holding.updated_at = now
    }
  } else {
    if (!holding) throw new Error('没有可卖出的持仓')
    if (sh > toNumber(holding.shares) + SHARE_EPS) throw new Error('卖出份额超过持仓')
    amount = round4(sh * px - fe)
    const costUnit = toNumber(holding.cost_price)
    const costPart = round4(costUnit * sh)
    realized = round4(amount - costPart)
    holding.realized_profit = round2(toNumber(holding.realized_profit) + realized * rate)
    holding.shares = round6(toNumber(holding.shares) - sh)
    holding.cost_amount = round4(holdingCostAmount(holding) - costPart)
    holding.last_price = px
    holding.updated_at = now
    if (toNumber(holding.shares) <= SHARE_EPS) {
      holding.shares = 0
      holding.cost_amount = 0
      holding.closed_at = now
    }
  }

  state.db.holding_trades.push({
    id: uid('trd'),
    holding_id: holding.id,
    account_id,
    market,
    symbol,
    name: holding.name,
    side,
    shares: sh,
    price: px,
    fee: fe,
    amount,
    realized_profit: side === 'sell' ? realized : null,
    is_opening: !!is_opening,
    traded_on: traded_on || todayISO(),
    fx_rate: rate,
    note,
    created_at: now,
  })
  persist()
  return holding
}

export async function refreshAllQuotes() {
  if (state.refreshing) return
  state.refreshing = true
  try {
    try {
      const fx = await fetchFxRates()
      state.db.fx = { rates: { ...state.db.fx.rates, ...fx.rates }, at: fx.at }
    } catch (err) {
      console.warn('fx', err)
    }
    const items = openHoldings().map((h) => ({ market: h.market, symbol: h.symbol }))
    if (items.length) {
      const { quotes } = await fetchQuotes(items)
      const now = new Date().toISOString()
      for (const q of quotes) {
        for (const h of openHoldings()) {
          if (h.market === q.market && h.symbol === q.symbol) {
            h.last_price = q.price
            if (q.prevClose) h.prev_close = q.prevClose
            if (q.changePct != null) h.change_pct = q.changePct
            // priceTime 已由 formatQuoteTime 保留年份，例如 2026-10-30 16:14
            if (q.priceTime) h.price_time = q.priceTime
            if (q.name) h.name = q.name
            h.quoted_at = now
            h.updated_at = now
          }
        }
      }
    }
    // 行情只写本地缓存，不推进云端修订，避免刷新行情盖掉另一台设备刚记的账
    saveDb(state.db, { touch: false, sync: false })
  } finally {
    state.refreshing = false
  }
}

export function reloadFromStorage() {
  state.db = loadDb()
}
