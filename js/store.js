/* localStorage 持久化，当作本机缓存。云账号见 cloud.js，Gist 见 sync.js。密码和令牌不进这份账本。 */

import { uid } from './util.js'

const KEY = 'ledger.standalone.v1'

let afterSave = null

/** 本地写入成功后通知云同步。sync:false 的写入不会触发。 */
export function setAfterSave(fn) {
  afterSave = fn
}

const DEFAULT_CATEGORIES = [
  { kind: 'expense', name: '餐饮', icon: '🍜', color: '#f97316' },
  { kind: 'expense', name: '交通', icon: '🚇', color: '#3b82f6' },
  { kind: 'expense', name: '购物', icon: '🛒', color: '#ec4899' },
  { kind: 'expense', name: '居住', icon: '🏠', color: '#8b5cf6' },
  { kind: 'expense', name: '娱乐', icon: '🎮', color: '#14b8a6' },
  { kind: 'expense', name: '医疗', icon: '💊', color: '#ef4444' },
  { kind: 'expense', name: '其他', icon: '📦', color: '#64748b' },
  { kind: 'income', name: '工资', icon: '💼', color: '#22c55e' },
  { kind: 'income', name: '奖金', icon: '🎁', color: '#84cc16' },
  { kind: 'income', name: '投资收益', icon: '📈', color: '#06b6d4' },
  { kind: 'income', name: '其他', icon: '💰', color: '#64748b' },
]

function emptyDb() {
  const now = new Date().toISOString()
  const cashId = uid('acc')
  const investId = uid('acc')
  return {
    version: 1,
    accounts: [
      {
        id: cashId,
        name: '现金/银行卡',
        type: 'bank',
        currency: 'CNY',
        initial_balance: 0,
        manual_balance: null,
        include_in_networth: true,
        icon: '💳',
        color: '#3b82f6',
        note: '',
        sort_order: 0,
        is_archived: false,
        cash_account_id: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: investId,
        name: '证券账户',
        type: 'invest',
        currency: 'CNY',
        initial_balance: 0,
        manual_balance: null,
        include_in_networth: true,
        icon: '📊',
        color: '#8b5cf6',
        note: '',
        sort_order: 1,
        is_archived: false,
        cash_account_id: cashId,
        created_at: now,
        updated_at: now,
      },
    ],
    transactions: [],
    categories: DEFAULT_CATEGORIES.map((c, i) => ({
      id: uid('cat'),
      kind: c.kind,
      name: c.name,
      icon: c.icon,
      color: c.color,
      sort_order: i,
      is_archived: false,
      created_at: now,
    })),
    holdings: [],
    holding_trades: [],
    fx: { rates: {}, at: '' },
    meta: { created_at: now, updated_at: now, revision: 0, pristine: true },
  }
}

export function loadDb() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      const db = emptyDb()
      saveDb(db, { touch: false, sync: false })
      return db
    }
    const db = JSON.parse(raw)
    if (!db.accounts) db.accounts = []
    if (!db.transactions) db.transactions = []
    if (!db.categories) db.categories = []
    if (!db.holdings) db.holdings = []
    if (!db.holding_trades) db.holding_trades = []
    if (!db.fx) db.fx = { rates: {}, at: '' }
    if (!db.meta || typeof db.meta !== 'object') db.meta = {}
    return db
  } catch (err) {
    console.error('loadDb failed', err)
    return emptyDb()
  }
}

/**
 * @param {{ touch?: boolean, sync?: boolean }} [opts]
 * touch 默认 true：推进 updated_at / revision，并取消 pristine。
 * sync 默认 true：防抖上传。已登录云账号时走账号云，否则走 Gist。套用云端或刷新行情时两者都关。
 */
export function saveDb(db, opts = {}) {
  const touch = opts.touch !== false
  const sync = opts.sync !== false
  db.meta = db.meta || {}
  if (touch) {
    db.meta.updated_at = new Date().toISOString()
    db.meta.revision = (Number(db.meta.revision) || 0) + 1
    db.meta.pristine = false
  }
  localStorage.setItem(KEY, JSON.stringify(db))
  if (sync) afterSave?.(db)
}

export function exportJson(db) {
  return JSON.stringify(db, null, 2)
}

export function importJson(text) {
  const db = JSON.parse(text)
  if (!db || typeof db !== 'object' || !Array.isArray(db.accounts)) {
    throw new Error('不是有效的账本备份')
  }
  saveDb(db)
  return db
}

export function resetDb() {
  localStorage.removeItem(KEY)
  const db = emptyDb()
  db.meta.pristine = false
  saveDb(db)
  return db
}

export { KEY as STORAGE_KEY }
