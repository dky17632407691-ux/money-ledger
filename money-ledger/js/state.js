import * as store from './store.js?v=202610192325'
import { fetchQuotes, fetchFxRates, currencyOf, CURRENCY_LABEL } from './quotes.js?v=202610192325'
import {
  toNumber, monthKeyOf, currentMonthKey, todayISO, colorByName, safeColor,
} from './util.js?v=202610192325'

/* ============================================================
   全局状态与派生计算
   ============================================================ */

const FX_KEY = 'ledger.fx.v1'

/** 汇率缓存：接口挂掉时用上次的值兜底，避免港美股被当成人民币 */
function loadFxCache() {
  const empty = { USD: 0, HKD: 0, at: '' }
  try {
    const raw = localStorage.getItem(FX_KEY)
    if (!raw) return empty
    const obj = JSON.parse(raw) || {}
    const fx = { USD: 0, HKD: 0, at: typeof obj.at === 'string' ? obj.at : '' }
    if (Number(obj.USD) > 0) fx.USD = Number(obj.USD)
    if (Number(obj.HKD) > 0) fx.HKD = Number(obj.HKD)
    return fx
  } catch (err) {
    return empty
  }
}

export const state = {
  user: null,
  accounts: [],
  categories: [],
  transactions: [],
  holdings: [],
  trades: [],
  snapshots: [],
  loading: false,
  loaded: false,

  page: 'dashboard',
  month: currentMonthKey(),          // 流水页 / 概览页当前月份
  statsMonth: currentMonthKey(),     // 统计页当前月份
  chartRange: '3m',                  // 资产走势的时间范围
  showClosed: false,                 // 资产页是否展开清仓记录
  filter: { type: 'all', category: '', accountId: '', keyword: '' },

  // 外币兑人民币汇率（1 外币 = N 人民币），随行情一起刷新并持久化
  fx: loadFxCache(),
  fxError: '',

  // user_settings 表里的轻量配置：goal = 财务目标
  settings: { goal: null },
}

/* ---------------- 汇率 ---------------- */

/** 写入最新汇率并持久化；只更新成功取到的币种，避免一次失败清空缓存 */
export function setFxRates(rates, at) {
  if (!rates) return
  let touched = false
  for (const currency of ['USD', 'HKD']) {
    const v = toNumber(rates[currency])
    if (v > 0 && v !== state.fx[currency]) {
      state.fx[currency] = v
      touched = true
    }
  }
  if (at && at !== state.fx.at) {
    state.fx.at = at
    touched = true
  }
  if (touched) {
    try {
      localStorage.setItem(FX_KEY, JSON.stringify(state.fx))
    } catch (err) {
      // 隐私模式写入失败可忽略，仅影响下次离线兜底
    }
  }
}

export function setFxError(message) {
  state.fxError = message || ''
}

/** 某币种兑人民币汇率；人民币恒为 1；取不到返回 0 */
export function fxRate(currency) {
  if (!currency || currency === 'CNY') return 1
  const r = toNumber(state.fx[currency])
  return r > 0 ? r : 0
}

/** 该持仓的计价币种 */
export function holdingCurrency(h) {
  return currencyOf(h && h.market)
}

/** 需要汇率但当前没有 → 界面要提示，不能假装是人民币 */
export function holdingFxMissing(h) {
  const cur = holdingCurrency(h)
  return cur !== 'CNY' && fxRate(cur) <= 0
}

/** 组合里是否存在汇率缺失的外币持仓 */
export function hasFxMissingHolding() {
  return state.holdings.some((h) => isOpenHolding(h) && holdingFxMissing(h))
}

/** 汇率展示文案，如 “USD 6.6832 · HKD 0.8513” */
export function fxSummary() {
  const parts = []
  const stamp = state.fx.at ? state.fx.at.slice(5, 16) : ''
  for (const cur of ['USD', 'HKD']) {
    const r = fxRate(cur)
    if (r > 0) parts.push(`${cur} ${r.toFixed(4)}`)
  }
  if (!parts.length) return ''
  return parts.join(' · ') + (stamp ? `（${stamp}）` : '')
}

export { CURRENCY_LABEL }

/* ---------------- 变更通知（视图重建） ---------------- */

let changeListener = null   // 数据发生变更：重新拉取 + 重绘
let renderListener = null   // 仅需重绘（如切换月份/筛选）
let navigator = null

export function setChangeListener(fn) {
  changeListener = fn
}

export function setRenderListener(fn) {
  renderListener = fn
}

export function setNavigator(fn) {
  navigator = fn
}

/** 数据已写入数据库，需要重新拉取后再重绘 */
export function notifyChange() {
  if (typeof changeListener === 'function') changeListener()
}

/** 状态变化但数据无需重新拉取，直接重绘 */
export function requestRender() {
  if (typeof renderListener === 'function') renderListener()
}

export function navigate(page) {
  if (typeof navigator === 'function') navigator(page)
}

let logoutHandler = null

export function setLogoutHandler(fn) {
  logoutHandler = fn
}

export function requestLogout() {
  if (typeof logoutHandler === 'function') logoutHandler()
}

/* ---------------- 账户类型元数据 ---------------- */

export const ACCOUNT_TYPES = {
  cash: { label: '现金', icon: '💵', liability: false, order: 1 },
  bank: { label: '银行卡', icon: '🏦', liability: false, order: 2 },
  ewallet: { label: '电子钱包', icon: '📲', liability: false, order: 3 },
  investment: { label: '投资理财', icon: '📈', liability: false, order: 4 },
  receivable: { label: '应收借出', icon: '🤝', liability: false, order: 5 },
  liability: { label: '负债欠款', icon: '💳', liability: true, order: 6 },
}

export const SUBTYPES = {
  investment: [
    { value: 'stock', label: '股票' },
    { value: 'fund', label: '基金' },
    { value: 'bond', label: '债券' },
    { value: 'deposit', label: '定期存款' },
    { value: 'wealth', label: '银行理财' },
    { value: 'gold', label: '黄金/贵金属' },
    { value: 'insurance', label: '保险' },
    { value: 'crypto', label: '数字资产' },
    { value: 'other', label: '其他投资' },
  ],
  liability: [
    { value: 'credit', label: '信用卡' },
    { value: 'mortgage', label: '房贷' },
    { value: 'car', label: '车贷' },
    { value: 'loan', label: '消费贷' },
    { value: 'other', label: '其他负债' },
  ],
}

export function typeMeta(type) {
  return ACCOUNT_TYPES[type] || ACCOUNT_TYPES.bank
}

export function subtypeLabel(type, subtype) {
  const list = SUBTYPES[type] || []
  const hit = list.find((s) => s.value === subtype)
  return hit ? hit.label : ''
}

export function accountLabel(account) {
  if (!account) return '未指定账户'
  const sub = subtypeLabel(account.type, account.subtype)
  return sub ? `${account.name} · ${sub}` : account.name
}

/** 投资 / 负债类账户的余额默认由用户手动维护（市值 / 欠款） */
export function isManualAccount(account) {
  if (!account) return false
  if (hasHoldings(account.id)) return false
  return account.type === 'investment' || account.type === 'liability'
}

/* ---------------- 默认分类 ---------------- */

const DEFAULT_EXPENSE = [
  ['餐饮', '🍜'], ['买菜食材', '🥬'], ['交通出行', '🚌'], ['购物', '🛍️'],
  ['居住房租', '🏠'], ['水电燃气', '💡'], ['通讯网络', '📶'], ['娱乐休闲', '🎮'],
  ['医疗健康', '💊'], ['学习教育', '📚'], ['人情往来', '🎁'], ['旅行', '✈️'],
  ['服饰美妆', '👕'], ['运动健身', '🏃'], ['数码电器', '💻'], ['宠物', '🐾'],
  ['其他支出', '📦'],
]

const DEFAULT_INCOME = [
  ['工资薪酬', '💰'], ['奖金提成', '🎉'], ['投资收益', '📈'], ['兼职副业', '🧰'],
  ['红包礼金', '🧧'], ['报销退款', '🧾'], ['其他收入', '📦'],
]

function buildDefaults(kind, list) {
  return list.map(([name, icon], i) => ({
    kind,
    name,
    icon,
    color: colorByName(name),
    sort_order: i,
    is_archived: false,
  }))
}

export const DEFAULT_CATEGORIES = [
  ...buildDefaults('expense', DEFAULT_EXPENSE),
  ...buildDefaults('income', DEFAULT_INCOME),
]

export function categoriesOf(kind) {
  return state.categories.filter((c) => c.kind === kind && !c.is_archived)
}

export function categoryMeta(kind, name) {
  const hit = state.categories.find((c) => c.kind === kind && c.name === name)
  if (hit) return { icon: hit.icon || '📦', color: safeColor(hit.color, colorByName(name)) }
  return { icon: '📦', color: colorByName(name) }
}

/* ---------------- 数据加载 ---------------- */

export async function loadAll() {
  state.loading = true
  const [accounts, categories, transactions, snapshots, holdings, trades] = await Promise.all([
    store.listAccounts(),
    store.listCategories(),
    store.listTransactions(),
    store.listSnapshots(),
    store.listHoldings(),
    store.listHoldingTrades(),
  ])
  // 设置读取失败只影响目标/自选，不能拖垮整个账本加载
  let settings = []
  try {
    settings = await store.listSettings()
  } catch (err) {
    console.warn('user_settings 读取失败，目标与自选暂不可用', err)
  }
  state.accounts = accounts
  state.categories = categories
  state.transactions = transactions
  state.snapshots = snapshots
  state.holdings = holdings
  state.trades = trades
  applySettings(settings)
  state.loading = false
  state.loaded = true
  return state
}

/** 把 user_settings 的行铺成 state.settings 里的结构 */
function applySettings(rows) {
  const next = { goal: null }
  for (const row of rows || []) {
    if (row.key === 'goal' && row.value && typeof row.value === 'object') next.goal = row.value
  }
  state.settings = next
}

/** 首次登录（空账本）的用户自动写入默认分类 */
export async function ensureDefaultCategories() {
  if (state.categories.length > 0) return false
  // 已经记过账却没有分类：说明用户主动删光了分类，不再重新灌默认值
  if (state.transactions.length > 0) return false
  const created = await store.createCategories(DEFAULT_CATEGORIES)
  state.categories = Array.isArray(created) ? created : []
  return true
}

export function activeAccounts() {
  return state.accounts.filter((a) => !a.is_archived)
}

export function accountById(id) {
  return state.accounts.find((a) => String(a.id) === String(id)) || null
}

/* ---------------- 持仓与市值 ----------------
   投资账户下可以录入持仓（股票 / 基金），行情由 quotes.js 自动更新，
   账户市值 = Σ(份额 × 最新价)，无需手动维护。
   ------------------------------------------ */

/** 是否仍是「在持」状态：未清仓且份额大于 0 */
export function isOpenHolding(h) {
  if (!h) return false
  if (h.closed_at) return false
  return toNumber(h.shares) > 0
}

/** 全部在持持仓 */
export function openHoldings() {
  return state.holdings.filter(isOpenHolding)
}

/** 已清仓的持仓（按清仓时间倒序） */
export function closedHoldings() {
  return state.holdings
    .filter((h) => !!h.closed_at)
    .sort((a, b) => (String(a.closed_at) < String(b.closed_at) ? 1 : -1))
}

/** 某个账户下的在持持仓 */
export function holdingsOfAccount(accountId) {
  return state.holdings.filter(
    (h) => String(h.account_id) === String(accountId) && isOpenHolding(h)
  )
}

/** 某个账户下的全部持仓（含已清仓），用于判断账户是否启用持仓核算 */
export function allHoldingsOfAccount(accountId) {
  return state.holdings.filter((h) => String(h.account_id) === String(accountId))
}

export function hasHoldings(accountId) {
  return allHoldingsOfAccount(accountId).length > 0
}

/** 该账户是否有在持持仓（决定账户余额是否按持仓市值计价） */
export function hasOpenHoldings(accountId) {
  return holdingsOfAccount(accountId).length > 0
}

/** 单只持仓的最新价：优先行情价，其次成本价 */
export function holdingPrice(h) {
  const last = toNumber(h.last_price)
  if (last > 0) return last
  return toNumber(h.cost_price)
}

/** 最新价是否来自行情（否则只是成本价兜底） */
export function holdingHasQuote(h) {
  return toNumber(h.last_price) > 0
}

/** 持仓市值（人民币）。外币按最新汇率折算；汇率缺失时退回原币计入，由界面提示 */
export function holdingMarketValue(h) {
  const rate = fxRate(holdingCurrency(h)) || 1
  return toNumber(h.shares) * holdingPrice(h) * rate
}

/** 当前持仓的成本总额（人民币）；优先用精确账目 cost_amount，老数据回退到单价 × 份额 */
export function holdingCost(h) {
  const rate = fxRate(holdingCurrency(h)) || 1
  if (h.cost_amount !== null && h.cost_amount !== undefined) {
    const amt = toNumber(h.cost_amount)
    return amt > 0 ? amt * rate : null
  }
  const c = toNumber(h.cost_price)
  if (c <= 0) return null
  return toNumber(h.shares) * c * rate
}

/** 浮动盈亏：没有成本价时返回 null */
export function holdingProfit(h) {
  const cost = holdingCost(h)
  if (cost === null) return null
  return holdingMarketValue(h) - cost
}

/** 当日盈亏（人民币） */
export function holdingDayProfit(h) {
  const prev = toNumber(h.prev_close)
  const last = toNumber(h.last_price)
  if (prev <= 0 || last <= 0) return null
  const rate = fxRate(holdingCurrency(h)) || 1
  return toNumber(h.shares) * (last - prev) * rate
}

/** 当日盈亏的基准市值（人民币），用于算涨跌幅 */
export function holdingDayBase(h) {
  const prev = toNumber(h.prev_close)
  if (prev <= 0) return 0
  const rate = fxRate(holdingCurrency(h)) || 1
  return toNumber(h.shares) * prev * rate
}

/** 某个投资账户的持仓汇总市值；没有持仓时返回 null */
export function accountHoldingsValue(accountId) {
  const list = holdingsOfAccount(accountId)
  if (!list.length) return null
  return list.reduce((sum, h) => sum + holdingMarketValue(h), 0)
}

/** 全部持仓的汇总：市值、成本、浮动盈亏、当日盈亏 */
export function portfolioSummary() {
  let count = 0
  let marketValue = 0
  let cost = 0
  let hasCost = false
  let dayProfit = 0
  let dayBase = 0
  let hasDay = false

  for (const h of state.holdings) {
    if (!isOpenHolding(h)) continue
    const account = accountById(h.account_id)
    if (!account || account.is_archived) continue
    count += 1
    const mv = holdingMarketValue(h)
    marketValue += mv

    const c = holdingCost(h)
    if (c !== null) { cost += c; hasCost = true }

    const dp = holdingDayProfit(h)
    if (dp !== null) {
      dayProfit += dp
      dayBase += holdingDayBase(h)
      hasDay = true
    }
  }

  return {
    count,
    marketValue,
    cost: hasCost ? cost : null,
    profit: hasCost ? marketValue - cost : null,
    profitPct: hasCost && cost > 0 ? (marketValue - cost) / cost : null,
    dayProfit: hasDay ? dayProfit : null,
    dayPct: hasDay && dayBase > 0 ? dayProfit / dayBase : null,
  }
}

/** 投资账户里未投入持仓的现金（可用资金） */
export function accountAvailableCash(accountId) {
  return accountCash(accountById(accountId))
}

/* ---------------- 交易（买入 / 卖出）与摊薄成本 ----------------
   采用移动加权平均成本法：
   - 买入：成交金额与手续费一并摊进成本价，成本被「摊薄」
   - 卖出：成本价不变，按卖出净额与持仓成本的差额结算「已实现盈亏」
   - 份额归零即为清仓，写入 closed_at，进入清仓记录
   ------------------------------------------------------------ */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000
const round6 = (n) => Math.round((Number(n) || 0) * 1000000) / 1000000
const SHARE_EPS = 1e-6

/** 持仓成本总额：优先精确账目 cost_amount，老数据回退到 单价 × 份额 */
function holdingCostAmount(h) {
  if (h.cost_amount !== null && h.cost_amount !== undefined) return toNumber(h.cost_amount)
  return toNumber(h.shares) * toNumber(h.cost_price)
}

function tradeSortAsc(a, b) {
  if (a.traded_on !== b.traded_on) return a.traded_on < b.traded_on ? -1 : 1
  return Number(a.id) - Number(b.id)
}

function tradeSortDesc(a, b) {
  if (a.traded_on !== b.traded_on) return a.traded_on < b.traded_on ? 1 : -1
  return Number(b.id) - Number(a.id)
}

/** 单只持仓的全部交易，从旧到新 */
export function tradesOfHolding(holdingId) {
  return state.trades
    .filter((t) => String(t.holding_id) === String(holdingId))
    .sort(tradeSortAsc)
}

/** 某个账户的全部交易，从新到旧 */
export function tradesOfAccount(accountId) {
  return state.trades
    .filter((t) => String(t.account_id) === String(accountId))
    .sort(tradeSortDesc)
}

/** 全部交易，从新到旧 */
export function allTrades() {
  return state.trades.slice().sort(tradeSortDesc)
}

/**
 * 交易对账户可用资金的净影响：已卖出净额 − 已买入总额。
 * 建仓（is_opening）代表建账前既有的仓位，不参与现金核算。
 */
export function accountTradeCash(accountId) {
  // 交易金额与手续费都是「成交币种」的金额（港股港币、美股美元），
  // 而账户现金是人民币，所以要先按币种折算，否则买 10 万港币会当成扣 10 万人民币
  const currencyByHolding = new Map()
  for (const h of state.holdings) {
    currencyByHolding.set(String(h.id), holdingCurrency(h))
  }
  let cash = 0
  for (const t of state.trades) {
    if (String(t.account_id) !== String(accountId)) continue
    if (t.is_opening) continue
    const cur = currencyByHolding.get(String(t.holding_id)) || 'CNY'
    const rate = fxRate(cur) || 1
    const amount = toNumber(t.amount) * rate
    const fee = toNumber(t.fee) * rate
    cash += t.side === 'sell' ? amount - fee : -(amount + fee)
  }
  return round2(cash)
}

/**
 * 账户里还没投入持仓的现金（可用资金）。
 * 有持仓时：账户余额 = 持仓市值 + 可用资金。
 */
export function accountCash(account) {
  if (!account) return 0
  const flow = computeFlows().get(String(account.id)) || 0
  const init = toNumber(account.initial_balance)
  const auto = typeMeta(account.type).liability ? init - flow : init + flow
  const base = (account.manual_balance === null || account.manual_balance === undefined)
    ? auto
    : toNumber(account.manual_balance)
  return round2(base + accountTradeCash(account.id))
}

/** 首笔买入日期，用于算持有天数 */
export function firstTradeDate(holdingId) {
  const list = tradesOfHolding(holdingId)
  if (list.length) return list[0].traded_on
  return null
}

/** 持有天数：首笔买入 → 清仓日（未清仓则算到今天） */
export function holdingDays(h) {
  const start = firstTradeDate(h.id)
    || (h.created_at ? String(h.created_at).slice(0, 10) : null)
  if (!start) return null
  const end = h.closed_at ? String(h.closed_at).slice(0, 10) : todayISO()
  const days = Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000)
  return Number.isFinite(days) ? Math.max(0, days) : null
}

/** 已实现盈亏汇总（含清仓笔数、盈亏家数） */
export function realizedSummary() {
  let total = 0
  let winCount = 0
  let loseCount = 0
  for (const h of state.holdings) {
    const raw = toNumber(h.realized_profit)
    if (Math.abs(raw) < 0.005) continue
    // 已实现盈亏记的是成交币种，汇总到人民币口径
    const r = raw * (fxRate(holdingCurrency(h)) || 1)
    total += r
    if (r > 0) winCount += 1
    else loseCount += 1
  }
  return { total: round2(total), winCount, loseCount, closedCount: closedHoldings().length }
}

/** 按交易序列回放，重算持仓状态（删改交易记录后使用） */
function replayTrades(list) {
  let shares = 0
  let amount = 0
  let realized = 0
  for (const t of list) {
    const s = toNumber(t.shares)
    if (s <= 0) continue
    const p = toNumber(t.price)
    const fee = toNumber(t.fee)
    if (t.side === 'buy') {
      shares = round6(shares + s)
      amount = round4(amount + s * p + fee)
    } else {
      const sell = Math.min(s, shares)
      const unitCost = shares > 0 ? amount / shares : 0
      realized = round2(realized + (sell * p - fee) - sell * unitCost)
      amount = Math.max(0, round4(amount - sell * unitCost))
      shares = round6(shares - sell)
      if (shares <= SHARE_EPS) { shares = 0; amount = 0 }
    }
  }
  return {
    shares,
    cost_amount: amount,
    cost_price: shares > 0 ? round4(amount / shares) : 0,
    realized_profit: realized,
    closed_at: shares > 0 ? null : new Date().toISOString(),
  }
}

/**
 * 执行一笔买入或卖出，写回持仓与交易记录。
 * @param {object} opts
 * @param {object} opts.holding  目标持仓（state.holdings 中的对象）
 * @param {'buy'|'sell'} opts.side
 * @param {number} opts.shares   成交份额
 * @param {number} opts.price    成交价
 * @param {number} [opts.fee]    手续费
 * @param {string} [opts.date]   成交日期 YYYY-MM-DD
 * @param {string} [opts.note]   备注
 */
export async function applyTrade({ holding, side, shares, price, fee = 0, date, note = '' }) {
  const buy = side === 'buy'
  const oldShares = toNumber(holding.shares)
  const oldAmount = holdingCostAmount(holding)
  if (!buy && shares > oldShares + SHARE_EPS) {
    throw new Error('卖出份额不能超过当前持有的份额')
  }

  const amount = round2(shares * price)
  const feeValue = round2(toNumber(fee))
  let patch
  let tradeRealized = null

  if (buy) {
    // 买入摊薄：成本总额 = 原持仓成本 + 本次成交金额 + 手续费
    const newShares = round6(oldShares + shares)
    const newAmount = round4(oldAmount + amount + feeValue)
    patch = {
      shares: newShares,
      cost_amount: newAmount,
      cost_price: newShares > 0 ? round4(newAmount / newShares) : 0,
      closed_at: null,
    }
  } else {
    // 卖出：按成本总额换算单位成本结算已实现盈亏，单位成本保持不变
    const unitCost = oldShares > 0 ? oldAmount / oldShares : 0
    tradeRealized = round2(amount - feeValue - shares * unitCost)
    const rest = round6(oldShares - shares)
    const closing = rest <= SHARE_EPS
    const restAmount = closing ? 0 : round4(oldAmount - shares * unitCost)
    patch = {
      shares: closing ? 0 : rest,
      cost_amount: restAmount,
      cost_price: closing ? 0 : round4(restAmount / rest),
      realized_profit: round2(toNumber(holding.realized_profit) + tradeRealized),
      closed_at: closing ? new Date().toISOString() : null,
    }
  }

  const updated = await store.updateHolding(holding.id, patch)
  let created
  try {
    created = await store.createHoldingTrade({
      holding_id: holding.id,
      account_id: holding.account_id,
      market: holding.market,
      symbol: holding.symbol,
      name: holding.name || null,
      side,
      shares,
      price,
      fee: feeValue,
      amount,
      realized_profit: tradeRealized,
      is_opening: false,
      traded_on: date || todayISO(),
      note: note ? String(note).slice(0, 60) : null,
    })
  } catch (err) {
    // 交易记录写入失败时把持仓状态改回去，避免账实不符
    try { await store.updateHolding(holding.id, {
      shares: holding.shares,
      cost_price: holding.cost_price,
      cost_amount: holding.cost_amount,
      realized_profit: holding.realized_profit,
      closed_at: holding.closed_at,
    }) } catch (rollbackErr) { /* 忽略回滚失败，下次加载会重新同步 */ }
    throw err
  }

  Object.assign(holding, updated)
  state.trades.push(created)
  return { holding, trade: created }
}

/** 删除一条交易记录，并按剩余交易重算持仓状态 */
export async function removeTrade(trade) {
  await store.deleteHoldingTrade(trade.id)
  const idx = state.trades.findIndex((t) => String(t.id) === String(trade.id))
  if (idx >= 0) state.trades.splice(idx, 1)

  const h = state.holdings.find((x) => String(x.id) === String(trade.holding_id))
  if (!h) return null
  const rest = tradesOfHolding(h.id)
  const next = rest.length
    ? replayTrades(rest)
    : { shares: 0, cost_amount: 0, cost_price: 0, realized_profit: 0, closed_at: new Date().toISOString() }
  const updated = await store.updateHolding(h.id, next)
  Object.assign(h, updated)
  return updated
}

/**
 * 老数据兼容：已有份额、却没有任何交易记录的持仓，自动补一条建仓记录。
 * 这些仓位是加入买卖功能之前登记的，补上之后盈亏与清仓记录才有依据。
 */
export async function ensureOpeningTrades() {
  const missing = state.holdings.filter(
    (h) => toNumber(h.shares) > 0 && tradesOfHolding(h.id).length === 0
  )
  if (!missing.length) return 0

  let done = 0
  for (const h of missing) {
    try {
      const created = await store.createHoldingTrade(buildOpeningTrade({
        holdingId: h.id,
        accountId: h.account_id,
        market: h.market,
        symbol: h.symbol,
        name: h.name,
        shares: toNumber(h.shares),
        price: toNumber(h.cost_price),
        date: h.created_at ? String(h.created_at).slice(0, 10) : undefined,
      }))
      state.trades.push(created)
      done += 1
    } catch (err) { /* 单条失败不影响其余持仓 */ }
  }
  return done
}

/** 新建持仓时生成「建仓」记录（代表建账前已持有的仓位） */
export function buildOpeningTrade({ holdingId, accountId, market, symbol, name, shares, price, date }) {
  const p = toNumber(price)
  return {
    holding_id: holdingId,
    account_id: accountId,
    market,
    symbol,
    name: name || null,
    side: 'buy',
    shares,
    price: p,
    fee: 0,
    amount: round2(shares * p),
    realized_profit: null,
    is_opening: true,
    traded_on: date || todayISO(),
    note: '建仓',
  }
}

/* ---------------- 行情刷新 ---------------- */

const QUOTE_THROTTLE_MS = 45 * 1000

let lastQuoteAt = 0
let quoteInFlight = null

export const quoteStatus = {
  loading: false,
  lastAt: 0,
  error: '',
  failed: [],
}

export function quoteStatusText() {
  if (quoteStatus.loading) return '正在更新行情…'
  if (quoteStatus.error) return quoteStatus.error
  if (!quoteStatus.lastAt) return '还没有获取过行情'
  const d = new Date(quoteStatus.lastAt)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const n = quoteStatus.failed.length
  return n > 0 ? `更新于 ${hhmm} · ${n} 个标的未取到` : `行情已更新 · ${hhmm}`
}

/**
 * 拉取并回写所有持仓的最新行情。
 * 默认 45 秒内不重复请求，force = true 时强制刷新。
 */
export async function refreshQuotes({ force = false, silent = false } = {}) {
  const targets = openHoldings()
  if (!targets.length) return { updated: 0, failed: [] }
  if (!force && Date.now() - lastQuoteAt < QUOTE_THROTTLE_MS) {
    return { skipped: true, updated: 0, failed: [] }
  }
  if (quoteInFlight) return quoteInFlight

  quoteInFlight = (async () => {
    quoteStatus.loading = true
    quoteStatus.error = ''
    let render = null
    try {
      const { quotes, failed } = await fetchQuotes(
        targets.map((h) => ({ market: h.market, symbol: h.symbol }))
      )

      // 有港美股时同步取汇率；汇率失败不能影响行情本身，单独兜住
      if (targets.some((h) => holdingCurrency(h) !== 'CNY')) {
        try {
          const { rates, at } = await fetchFxRates()
          setFxRates(rates, at)
          setFxError('')
        } catch (err) {
          setFxError('汇率获取失败，港美股按上次汇率折算')
        }
      }
      const byKey = new Map(quotes.map((q) => [`${q.market}${q.symbol}`, q]))
      const nowIso = new Date().toISOString()
      const writes = []

      for (const h of targets) {
        const q = byKey.get(`${h.market}${h.symbol}`)
        if (!q) continue
        h.last_price = q.price
        h.prev_close = q.prevClose
        h.change_pct = q.changePct
        h.price_time = q.priceTime
        h.quoted_at = nowIso
        const patch = {
          id: h.id,
          last_price: q.price,
          prev_close: q.prevClose,
          change_pct: q.changePct,
          price_time: q.priceTime,
          quoted_at: nowIso,
        }
        // 名称留空的（如成分乱码未写入）用行情名补全
        if (!h.name && q.name) {
          h.name = q.name
          patch.name = q.name
        }
        writes.push(patch)
      }

      quoteStatus.failed = failed
      lastQuoteAt = Date.now()
      quoteStatus.lastAt = lastQuoteAt
      render = () => requestRender()

      // 行情缓存回写失败不影响本次展示，下次刷新会再试
      try {
        await store.updateHoldingQuotes(writes)
      } catch (err) {
        // 静默：本地已更新，界面照常展示
      }

      return { updated: quotes.length, failed }
    } catch (err) {
      quoteStatus.error = err && err.message ? err.message : '行情更新失败'
      if (!silent) throw err
      return { updated: 0, failed: [], error: quoteStatus.error }
    } finally {
      quoteStatus.loading = false
      quoteInFlight = null
      if (render) render()
    }
  })()

  return quoteInFlight
}

/* ---------------- 余额与净资产 ---------------- */

/**
 * 计算每个账户的净流入（正数=资金流入该账户）。
 * 支出：从账户流出；收入：流入；转账：从转出账户流出、流入转入账户。
 */
function computeFlows() {
  const flow = new Map()
  const add = (id, v) => {
    if (id === null || id === undefined || id === '') return
    const key = String(id)
    flow.set(key, (flow.get(key) || 0) + v)
  }
  for (const t of state.transactions) {
    const amount = toNumber(t.amount)
    if (t.type === 'expense') add(t.account_id, -amount)
    else if (t.type === 'income') add(t.account_id, amount)
    else if (t.type === 'transfer') {
      add(t.account_id, -amount)
      add(t.to_account_id, amount)
    }
  }
  return flow
}

/**
 * 返回 Map<accountId, value>
 * 资产类账户 value = 余额；负债类账户 value = 欠款金额（正数表示欠款）。
 * 投资账户一旦启用持仓核算，余额 = 持仓市值（自动）+ 账户可用资金，
 * 其中可用资金含买卖交易产生的资金变动；其余账户为手动市值或建账余额 + 流水推算。
 */
export function computeBalances() {
  const flow = computeFlows()
  const result = new Map()
  for (const a of state.accounts) {
    const key = String(a.id)
    const f = flow.get(key) || 0
    const init = toNumber(a.initial_balance)
    const isDebt = typeMeta(a.type).liability
    const auto = isDebt ? init - f : init + f
    const cash = (a.manual_balance === null || a.manual_balance === undefined)
      ? auto
      : toNumber(a.manual_balance)

    const held = accountHoldingsValue(key)
    if (held !== null) {
      result.set(key, held + cash + accountTradeCash(key))
      continue
    }
    if (hasHoldings(key)) {
      // 已清仓：账户余额 = 交易结算后的现金
      result.set(key, cash + accountTradeCash(key))
      continue
    }
    result.set(key, cash)
  }
  return result
}

export function accountValueType(type) {
  return typeMeta(type).liability ? 'liability' : 'asset'
}

/** 净资产汇总 */
export function netWorthSummary() {
  const balances = computeBalances()
  let totalAssets = 0
  let totalLiabilities = 0
  for (const a of state.accounts) {
    if (a.is_archived || !a.include_in_networth) continue
    const v = balances.get(String(a.id)) || 0
    if (typeMeta(a.type).liability) totalLiabilities += v
    else totalAssets += v
  }
  return {
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    balances,
  }
}

/** 资产账户的余额分布（不含负债，负债在净资产里单独扣减） */
export function assetDistribution() {
  const balances = computeBalances()
  const buckets = new Map()
  for (const a of state.accounts) {
    if (a.is_archived || !a.include_in_networth) continue
    if (typeMeta(a.type).liability) continue
    const v = balances.get(String(a.id)) || 0
    if (v === 0) continue
    const meta = typeMeta(a.type)
    const key = a.type
    if (!buckets.has(key)) {
      buckets.set(key, { key, label: meta.label, icon: meta.icon, value: 0 })
    }
    buckets.get(key).value += v
  }
  const list = Array.from(buckets.values())
  const total = list.reduce((s, b) => s + b.value, 0)
  return list
    .map((b) => ({ ...b, percent: total > 0 ? b.value / total : 0 }))
    .sort((a, b) => b.value - a.value)
}

/* ---------------- 收支统计 ---------------- */

export function monthTotals(monthKey) {
  let income = 0
  let expense = 0
  for (const t of state.transactions) {
    if (monthKeyOf(t.occurred_on) !== monthKey) continue
    if (t.type === 'income') income += toNumber(t.amount)
    else if (t.type === 'expense') expense += toNumber(t.amount)
  }
  return { income, expense, net: income - expense }
}

export function transactionsOfMonth(monthKey) {
  return state.transactions.filter((t) => monthKeyOf(t.occurred_on) === monthKey)
}

/** 某月某类型下的分类汇总（降序） */
export function categoryBreakdown(monthKey, kind) {
  const map = new Map()
  for (const t of state.transactions) {
    if (t.type !== kind) continue
    if (monthKeyOf(t.occurred_on) !== monthKey) continue
    const name = t.category || '未分类'
    const prev = map.get(name) || 0
    map.set(name, prev + toNumber(t.amount))
  }
  const total = Array.from(map.values()).reduce((s, v) => s + v, 0)
  return Array.from(map.entries())
    .map(([name, value]) => {
      const meta = categoryMeta(kind, name)
      return { name, value, icon: meta.icon, color: meta.color, percent: total > 0 ? value / total : 0 }
    })
    .sort((a, b) => b.value - a.value)
}

/** 最近 n 个月（含 endMonth）的收支，从旧到新 */
export function monthlySeries(n, endMonth = state.month) {
  const out = []
  const [y, m] = endMonth.split('-').map(Number)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const { income, expense } = monthTotals(key)
    out.push({ key, income, expense })
  }
  return out
}

export function earliestTransactionMonth() {
  let min = null
  for (const t of state.transactions) {
    const k = monthKeyOf(t.occurred_on)
    if (!min || k < min) min = k
  }
  return min
}

/* ---------------- 快照 ---------------- */

export function snapshotPoints() {
  return state.snapshots
    .map((s) => ({
      date: s.snapshot_date,
      netWorth: toNumber(s.net_worth),
      totalAssets: toNumber(s.total_assets),
      totalLiabilities: toNumber(s.total_liabilities),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** 资产走势可选时间范围 */
export const SNAPSHOT_RANGES = [
  { value: '1m', label: '近1月', days: 30 },
  { value: '3m', label: '近3月', days: 92 },
  { value: '6m', label: '近半年', days: 183 },
  { value: '1y', label: '近1年', days: 366 },
  { value: 'all', label: '全部', days: 0 },
]

/** 按时间范围裁剪快照点（不足 2 个点时回退为全部） */
export function snapshotPointsInRange(range = '3m') {
  const all = snapshotPoints()
  const hit = SNAPSHOT_RANGES.find((r) => r.value === range)
  if (!hit || !hit.days || all.length <= 2) return all
  const from = new Date()
  from.setDate(from.getDate() - hit.days)
  const fromISO = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
  const filtered = all.filter((p) => p.date >= fromISO)
  return filtered.length >= 2 ? filtered : all.slice(-2)
}

/** 记录 / 更新今天的净资产快照 */
export async function recordTodaySnapshot(note = null) {
  const { totalAssets, totalLiabilities, netWorth, balances } = netWorthSummary()
  const detail = {}
  for (const a of state.accounts) {
    if (a.is_archived || !a.include_in_networth) continue
    const v = balances.get(String(a.id)) || 0
    detail[a.name] = typeMeta(a.type).liability ? -v : v
  }
  const saved = await store.saveSnapshot({
    snapshot_date: todayISO(),
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,
    net_worth: netWorth,
    detail,
    note,
  })
  const idx = state.snapshots.findIndex((s) => s.snapshot_date === saved.snapshot_date)
  if (idx >= 0) state.snapshots[idx] = saved
  else state.snapshots.push(saved)
  state.snapshots.sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1))
  return saved
}

/* ============================================================
   财务目标（存在 user_settings 表）
   ============================================================ */

const EMPTY_GOAL = { target_amount: 0, passive_income: 0, target_date: '', started_on: '' }

export function goal() {
  return { ...EMPTY_GOAL, ...(state.settings.goal || {}) }
}

export async function saveGoal(patch) {
  const next = { ...goal(), ...patch }
  if (!next.started_on) next.started_on = todayISO()
  await store.saveSetting('goal', next)
  state.settings.goal = next
  notifyChange()
  return next
}

/**
 * 目标进度。
 * 金额进度 = 当前净资产 / 目标金额；时间进度 = 从设定日到目标日已过的比例。
 * 没有目标金额时两者都为 null，页面显示引导而不是 0%。
 */
export function goalProgress() {
  const g = goal()
  const target = toNumber(g.target_amount)
  const { netWorth, totalAssets } = netWorthSummary()
  const amountPct = target > 0 ? Math.max(0, netWorth) / target : null
  // 距离目标按用户口径算：目标金额 − 总资产（不是净资产）
  const distance = target > 0 ? target - totalAssets : null

  let timePct = null
  if (g.started_on && g.target_date) {
    const start = new Date(`${g.started_on}T00:00:00`).getTime()
    const end = new Date(`${g.target_date}T00:00:00`).getTime()
    if (end > start) timePct = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)))
  }

  return { goal: g, hasTarget: target > 0, targetAmount: target, totalAssets, distance, amountPct, timePct }
}
