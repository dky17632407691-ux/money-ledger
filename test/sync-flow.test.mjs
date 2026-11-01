import test from 'node:test'
import assert from 'node:assert/strict'

const TOKEN = `localtest_${'a'.repeat(24)}`
const gists = new Map()
const bodies = []
let seq = 1

function json(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data == null ? '' : JSON.stringify(data)),
  }
}

function summary(gist) {
  return { id: gist.id, description: gist.description, public: gist.public, updated_at: gist.updated_at }
}

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url)
  const auth = opts.headers?.Authorization || ''
  if (opts.body) {
    const text = String(opts.body)
    bodies.push(text)
    if (text.includes(TOKEN)) throw new Error('token leaked into request body')
  }
  if (auth !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' })
  if (u.hostname !== 'api.github.com') return json(404, { message: 'unexpected host' })
  const method = opts.method || 'GET'
  if (u.pathname === '/gists' && method === 'GET') return json(200, [...gists.values()].map(summary))
  if (u.pathname === '/gists' && method === 'POST') {
    const body = JSON.parse(opts.body)
    const id = `gist${seq++}`
    const content = body.files['money-ledger.json'].content
    const gist = {
      id,
      description: body.description,
      public: body.public,
      updated_at: new Date().toISOString(),
      files: {
        'money-ledger.json': { content, truncated: false },
      },
    }
    gists.set(id, gist)
    return json(201, gist)
  }
  const match = u.pathname.match(/^\/gists\/([^/]+)$/)
  if (!match) return json(404, { message: 'no route' })
  const id = decodeURIComponent(match[1])
  const gist = gists.get(id)
  if (!gist) return json(404, { message: 'Not Found' })
  if (method === 'GET') return json(200, gist)
  if (method === 'PATCH') {
    const body = JSON.parse(opts.body)
    gist.description = body.description
    gist.files['money-ledger.json'].content = body.files['money-ledger.json'].content
    gist.updated_at = new Date().toISOString()
    return json(200, gist)
  }
  return json(404, { message: 'no method' })
}

const { loadDb, saveDb, exportJson } = await import('../js/store.js')
const { login, logout, startSync, syncNow, SYNC_STORAGE_KEY } = await import('../js/sync.js')

function cloudDb() {
  const gist = [...gists.values()][0]
  return JSON.parse(gist.files['money-ledger.json'].content)
}

test('gist sync round-trip, secret token, and last-write-wins', async () => {
  startSync({})
  const seeded = loadDb()
  assert.equal(seeded.meta.pristine, true)
  assert.equal(seeded.meta.revision, 0)

  await assert.rejects(() => login('nope'), /gist/)
  assert.equal(bodies.length, 0)

  await assert.rejects(() => login(`badtoken_${'b'.repeat(24)}`), /无效|过期/)
  const stored = localStorage.getItem(SYNC_STORAGE_KEY)
  assert.ok(!stored || !JSON.parse(stored).token)

  await login(`Bearer ${TOKEN}`)
  assert.equal(gists.size, 1)
  const created = [...gists.values()][0]
  assert.equal(created.public, false)
  assert.equal(created.description, 'money-ledger-cloud-v1')
  assert.equal(cloudDb().meta.cloud.gist_id, created.id)
  assert.equal(JSON.parse(localStorage.getItem(SYNC_STORAGE_KEY)).token, TOKEN)

  const local = loadDb()
  local.transactions.push({
    id: 'tx1', type: 'expense', amount: 12, account_id: local.accounts[0].id,
    category: '餐饮', occurred_on: '2026-11-01', note: '午饭',
  })
  saveDb(local)
  await syncNow()
  assert.equal(cloudDb().transactions[0].id, 'tx1')
  assert.equal(cloudDb().meta.pristine, false)
  assert.equal(JSON.stringify(cloudDb()).includes(TOKEN), false)
  assert.equal(exportJson(loadDb()).includes(TOKEN), false)

  const beforeQuiet = bodies.length
  saveDb(loadDb(), { touch: false, sync: false })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(bodies.length, beforeQuiet)

  localStorage.clear()
  const fresh = loadDb()
  fresh.meta.updated_at = '2099-01-01T00:00:00.000Z'
  saveDb(fresh, { touch: false, sync: false })
  assert.equal(fresh.meta.pristine, true)
  await login(TOKEN)
  assert.equal(gists.size, 1)
  assert.equal(loadDb().transactions.some((t) => t.id === 'tx1'), true)

  const second = loadDb()
  second.transactions.push({
    id: 'tx2', type: 'income', amount: 20, account_id: second.accounts[0].id,
    category: '工资', occurred_on: '2026-11-01', note: '',
  })
  saveDb(second)
  await syncNow()
  assert.equal(cloudDb().transactions.some((t) => t.id === 'tx2'), true)

  localStorage.clear()
  const stale = loadDb()
  stale.meta.pristine = false
  stale.meta.updated_at = '2020-01-01T00:00:00.000Z'
  stale.meta.revision = 2
  stale.transactions = []
  saveDb(stale, { touch: false, sync: false })
  await login(TOKEN)
  const restored = loadDb()
  assert.equal(restored.transactions.some((t) => t.id === 'tx1'), true)
  assert.equal(restored.transactions.some((t) => t.id === 'tx2'), true)

  logout()
  const afterLogout = bodies.length
  saveDb(loadDb())
  await new Promise((r) => setTimeout(r, 1200))
  assert.equal(bodies.length, afterLogout)
  assert.equal(JSON.parse(localStorage.getItem(SYNC_STORAGE_KEY)).token, '')
})
