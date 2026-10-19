import { cloud } from './cloud.js?v=202610192325'

/* ============================================================
   数据访问层
   身份由 SDK 自动附带（登录后 database 请求自动带 session），
   前端一律不手动传 owner_id —— 由数据库 DEFAULT auth.uid() 填充，
   RLS 策略 (owner_id = auth.uid()) 负责权限边界。
   ============================================================ */

let sessionUser = null

export function setSessionUser(user) {
  sessionUser = user || null
}

export function getSessionUser() {
  return sessionUser
}

/** owner_name 是昵称快照，由前端在写入时带上；没有昵称就写 null */
function ownerNameOf() {
  const name = sessionUser && sessionUser.name
  return name ? String(name) : null
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

/**
 * 分页拉全量（PostgREST 单次上限 1000 行）。
 * configure 用于追加过滤 / 排序条件。
 */
async function selectAll(table, columns, configure) {
  const pageSize = 1000
  const out = []
  let from = 0

  for (;;) {
    let query = cloud.database.from(table).select(columns)
    if (typeof configure === 'function') query = configure(query)
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
    if (from > 100000) break
  }
  return out
}

/** 写操作后必须 .select() 才能区分"改了 0 行"和"改成功"（RLS 会静默过滤） */
function assertAffected(rows, message) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(message || '没有找到可修改的记录，可能是记录已被删除或不属于当前账号')
  }
  return rows
}

/* ---------------- 账户 ---------------- */

export function listAccounts() {
  return selectAll('accounts', '*', (q) => q.order('sort_order', { ascending: true }).order('id', { ascending: true }))
}

export function createAccount(payload) {
  return cloud.database
    .from('accounts')
    .insert({ ...payload, owner_name: ownerNameOf() })
    .select()
    .then(unwrap)
    .then((rows) => rows[0])
}

export function updateAccount(id, patch) {
  return cloud.database
    .from('accounts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .then(unwrap)
    .then((rows) => assertAffected(rows)[0])
}

export function deleteAccount(id) {
  return cloud.database
    .from('accounts')
    .delete()
    .eq('id', id)
    .select()
    .then(unwrap)
    .then((rows) => assertAffected(rows, '该账户不存在或已被删除'))
}

/* ---------------- 流水 ---------------- */

export function listTransactions() {
  return selectAll('transactions', '*', (q) =>
    q.order('occurred_on', { ascending: false }).order('id', { ascending: false })
  )
}

export function createTransaction(payload) {
  return cloud.database
    .from('transactions')
    .insert({ ...payload, owner_name: ownerNameOf() })
    .select()
    .then(unwrap)
    .then((rows) => rows[0])
}

export function updateTransaction(id, patch) {
  return cloud.database
    .from('transactions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .then(unwrap)
    .then((rows) => assertAffected(rows)[0])
}

export function deleteTransaction(id) {
  return cloud.database
    .from('transactions')
    .delete()
    .eq('id', id)
    .select()
    .then(unwrap)
    .then((rows) => assertAffected(rows, '该流水不存在或已被删除'))
}

/* ---------------- 分类 ---------------- */

export function listCategories() {
  return selectAll('categories', '*', (q) => q.order('sort_order', { ascending: true }).order('id', { ascending: true }))
}

export function createCategory(payload) {
  return cloud.database
    .from('categories')
    .insert({ ...payload, owner_name: ownerNameOf() })
    .select()
    .then(unwrap)
    .then((rows) => rows[0])
}

export function createCategories(payloads) {
  if (!payloads.length) return Promise.resolve([])
  const rows = payloads.map((p) => ({ ...p, owner_name: ownerNameOf() }))
  return cloud.database.from('categories').insert(rows).select().then(unwrap)
}

export function deleteCategory(id) {
  return cloud.database
    .from('categories')
    .delete()
    .eq('id', id)
    .select()
    .then(unwrap)
    .then((rows) => assertAffected(rows, '该分类不存在或已被删除'))
}

/* ---------------- 持仓 ---------------- */

export function listHoldings() {
  return selectAll('holdings', '*', (q) =>
    q.order('sort_order', { ascending: true }).order('id', { ascending: true })
  )
}

export function createHolding(payload) {
  return cloud.database
    .from('holdings')
    .insert({ ...payload, owner_name: ownerNameOf() })
    .select()
    .then(unwrap)
    .then((rows) => rows[0])
}

export function updateHolding(id, patch) {
  return cloud.database
    .from('holdings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .then(unwrap)
    .then((rows) => assertAffected(rows, '该持仓不存在或已被删除')[0])
}

/** 批量回写行情缓存（逐条更新，避免不同标的的价位互相覆盖） */
export function updateHoldingQuotes(rows) {
  if (!rows || !rows.length) return Promise.resolve([])
  return Promise.all(rows.map(({ id, ...patch }) => updateHolding(id, patch)))
}

export function deleteHolding(id) {
  return cloud.database
    .from('holdings')
    .delete()
    .eq('id', id)
    .select()
    .then(unwrap)
    .then((rows) => assertAffected(rows, '该持仓不存在或已被删除'))
}

/* ---------------- 持仓交易（买入 / 卖出） ---------------- */

export function listHoldingTrades() {
  return selectAll('holding_trades', '*', (q) =>
    q.order('traded_on', { ascending: true }).order('id', { ascending: true })
  )
}

export function createHoldingTrade(payload) {
  return cloud.database
    .from('holding_trades')
    .insert({ ...payload, owner_name: ownerNameOf() })
    .select()
    .then(unwrap)
    .then((rows) => rows[0])
}

export function deleteHoldingTrade(id) {
  return cloud.database
    .from('holding_trades')
    .delete()
    .eq('id', id)
    .select()
    .then(unwrap)
    .then((rows) => assertAffected(rows, '该交易记录不存在或已被删除'))
}

/* ---------------- 受邀白名单（只读） ----------------
   该表在数据库侧只授予了 SELECT，没有任何写策略：
   客户端只能读名单，无法给任何人添加访问权限。 */

export function listAllowlist() {
  return selectAll('access_allowlist', 'phone_hash, label', (q) => q.order('id', { ascending: true }))
}

/* ---------------- 净资产快照 ---------------- */

export function listSnapshots() {
  return selectAll('asset_snapshots', '*', (q) => q.order('snapshot_date', { ascending: true }))
}

export function findSnapshotByDate(dateISO) {
  return cloud.database
    .from('asset_snapshots')
    .select('*')
    .eq('snapshot_date', dateISO)
    .maybeSingle()
    .then(unwrap)
}

/** 同一天只保留一条快照：存在则更新，否则新建 */
export async function saveSnapshot(payload) {
  const existing = await findSnapshotByDate(payload.snapshot_date)
  if (existing) {
    return cloud.database
      .from('asset_snapshots')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .then(unwrap)
      .then((rows) => assertAffected(rows)[0])
  }
  return cloud.database
    .from('asset_snapshots')
    .insert({ ...payload, owner_name: ownerNameOf() })
    .select()
    .then(unwrap)
    .then((rows) => rows[0])
}

export function deleteSnapshot(id) {
  return cloud.database
    .from('asset_snapshots')
    .delete()
    .eq('id', id)
    .select()
    .then(unwrap)
    .then((rows) => assertAffected(rows, '该快照不存在或已被删除'))
}

/* ---------------- 用户设置（财务目标 / 自选列表等轻量配置） ---------------- */
/* 都存在 user_settings 表里，一个 key 一行，value 是 jsonb。
   以后再加类似「一个小功能配一点数据」的需求，不用再建表。 */

export function listSettings() {
  return selectAll('user_settings', '*', (q) => q.order('key', { ascending: true }))
}

/** 按 key 覆盖写入：有则更新、无则新建 */
export async function saveSetting(key, value) {
  const existing = unwrap(
    await cloud.database.from('user_settings').select('*').eq('key', key).maybeSingle(),
  )
  if (existing) {
    return cloud.database
      .from('user_settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .then(unwrap)
      .then((rows) => assertAffected(rows)[0])
  }
  return cloud.database
    .from('user_settings')
    .insert({ key, value, owner_name: ownerNameOf() })
    .select()
    .then(unwrap)
    .then((rows) => rows[0])
}
