import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore, handleRequest } from '../worker/src/index.js'

const PASSWORD = 'secret-pass'
const mem = new Map()
const sessionMem = new Map()
const puts = []

globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}
globalThis.sessionStorage = {
  getItem: (k) => (sessionMem.has(k) ? sessionMem.get(k) : null),
  setItem: (k, v) => sessionMem.set(k, String(v)),
  removeItem: (k) => sessionMem.delete(k),
  clear: () => sessionMem.clear(),
}
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
})

const store = createMemoryStore()
globalThis.fetch = async (url, opts = {}) => {
  const headers = new Headers(opts.headers || {})
  if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', '198.51.100.20')
  if (opts.body && headers.get('Authorization')) {
    const token = headers.get('Authorization').replace(/^Bearer\s+/i, '')
    if (String(opts.body).includes(token)) throw new Error('token leaked into request body')
  }
  if ((opts.method || 'GET') === 'PUT') puts.push(String(opts.body || ''))
  return handleRequest(new Request(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body,
  }), store)
}

const {
  CLOUD_REMEMBER_KEY, CLOUD_SESSION_KEY, bootCloud, getCloudSnapshot, isCloudLoggedIn,
  loginCloud, logoutCloud, registerCloud, resetCloudForTests, setApiBase, startCloud, syncCloudNow,
} = await import('../js/cloud.js')
const { loadDb, saveDb } = await import('../js/store.js')

function wipeClient() {
  resetCloudForTests()
  localStorage.clear()
  sessionStorage.clear()
}

test('password login restores the ledger after storage is wiped', { timeout: 15000 }, async () => {
  setApiBase('http://127.0.0.1:8787')
  startCloud({})
  const seeded = loadDb()
  seeded.transactions.push({
    id: 'tx1', type: 'expense', amount: 18, account_id: seeded.accounts[0].id,
    category: '餐饮', occurred_on: '2026-11-02', note: '午饭',
  })
  saveDb(seeded)

  await registerCloud('Alice', PASSWORD)
  assert.equal(isCloudLoggedIn(), true)
  assert.equal(getCloudSnapshot().username, 'alice')
  const row = await store.getLedger('alice')
  assert.equal(JSON.parse(row.body).transactions[0].id, 'tx1')
  assert.equal(row.body.includes(PASSWORD), false)
  const sessionRaw = sessionStorage.getItem(CLOUD_SESSION_KEY)
  assert.match(sessionRaw, /alice/)
  assert.equal(sessionRaw.includes(PASSWORD), false)
  assert.equal(localStorage.getItem(CLOUD_REMEMBER_KEY), null)
  assert.equal(JSON.stringify(loadDb()).includes(PASSWORD), false)
  assert.equal(row.body.includes(JSON.parse(sessionRaw).token), false)

  wipeClient()
  assert.equal(isCloudLoggedIn(), false)
  await assert.rejects(() => loginCloud('alice', 'wrong-pass'), /用户名或密码错误/)
  assert.equal(isCloudLoggedIn(), false)

  const phone = loadDb()
  assert.equal(phone.meta.pristine, true)
  assert.equal(phone.transactions.some((t) => t.id === 'tx1'), false)
  await loginCloud('alice', PASSWORD)
  assert.equal(loadDb().transactions.some((t) => t.id === 'tx1'), true)
  assert.equal(getCloudSnapshot().status, 'synced')

  const second = loadDb()
  second.transactions.push({
    id: 'tx2', type: 'income', amount: 20, account_id: second.accounts[0].id,
    category: '工资', occurred_on: '2026-11-02', note: '',
  })
  saveDb(second)
  await syncCloudNow()
  assert.equal(JSON.parse((await store.getLedger('alice')).body).transactions.some((t) => t.id === 'tx2'), true)

  wipeClient()
  const stale = loadDb()
  stale.meta.pristine = false
  stale.meta.updated_at = '2020-01-01T00:00:00.000Z'
  stale.meta.revision = 4
  stale.transactions = []
  saveDb(stale, { touch: false, sync: false })
  await loginCloud('alice', PASSWORD)
  const restored = loadDb()
  assert.equal(restored.transactions.some((t) => t.id === 'tx1'), true)
  assert.equal(restored.transactions.some((t) => t.id === 'tx2'), true)

  logoutCloud()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(isCloudLoggedIn(), false)
  assert.equal(localStorage.getItem(CLOUD_REMEMBER_KEY), null)
  await loginCloud('alice', PASSWORD, { remember: true })
  assert.match(localStorage.getItem(CLOUD_REMEMBER_KEY), /alice/)
  assert.equal(localStorage.getItem(CLOUD_REMEMBER_KEY).includes(PASSWORD), false)
  resetCloudForTests()
  sessionStorage.clear()
  assert.equal(isCloudLoggedIn(), true)
  assert.equal(cloudUser(), 'alice')

  const quiet = puts.length
  saveDb(loadDb(), { touch: false, sync: false })
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(puts.length, quiet)

  navigator.onLine = false
  const offlineDb = loadDb()
  offlineDb.transactions.push({
    id: 'tx3', type: 'expense', amount: 3, account_id: offlineDb.accounts[0].id,
    category: '交通', occurred_on: '2026-11-02', note: '',
  })
  saveDb(offlineDb)
  assert.equal(getCloudSnapshot().status, 'offline')
  assert.equal(puts.length, quiet)
  navigator.onLine = true
  await syncCloudNow()
  assert.equal(JSON.parse((await store.getLedger('alice')).body).transactions.some((t) => t.id === 'tx3'), true)

  const beforeDebounce = puts.length
  const debounced = loadDb()
  debounced.transactions.push({
    id: 'tx4', type: 'expense', amount: 4, account_id: debounced.accounts[0].id,
    category: '购物', occurred_on: '2026-11-02', note: '',
  })
  saveDb(debounced)
  assert.equal(puts.length, beforeDebounce)
  await new Promise((r) => setTimeout(r, 1200))
  assert.equal(JSON.parse((await store.getLedger('alice')).body).transactions.some((t) => t.id === 'tx4'), true)

  wipeClient()
  await bootCloud()
  assert.equal(isCloudLoggedIn(), false)
})

function cloudUser() {
  return JSON.parse(localStorage.getItem(CLOUD_REMEMBER_KEY)).username
}
