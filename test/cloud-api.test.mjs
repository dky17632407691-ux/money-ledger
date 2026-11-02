import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore, handleRequest } from '../worker/src/index.js'

async function call(store, method, path, { token, body, ip = '203.0.113.10' } = {}) {
  const headers = { 'CF-Connecting-IP': ip }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  const res = await handleRequest(new Request(`https://ledger.test${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }), store)
  const text = await res.text()
  let data = null
  if (text) data = JSON.parse(text)
  return { status: res.status, data, headers: res.headers }
}

function ledger(extra = {}) {
  return {
    accounts: [{ id: 'a' }],
    transactions: [],
    meta: { updated_at: '2026-11-02T00:00:00.000Z', revision: 1, pristine: false },
    ...extra,
  }
}

test('health, register, login, and ledger last-write-wins', async () => {
  const store = createMemoryStore()
  const health = await call(store, 'GET', '/v1/health')
  assert.equal(health.status, 200)
  assert.equal(health.data.ok, true)
  const opt = await handleRequest(new Request('https://ledger.test/v1/login', { method: 'OPTIONS' }), store)
  assert.equal(opt.status, 204)
  assert.equal(opt.headers.get('access-control-allow-origin'), '*')

  const bad = await call(store, 'POST', '/v1/register', { body: { username: 'ab', password: 'secret-pass' } })
  assert.equal(bad.status, 400)

  const created = await call(store, 'POST', '/v1/register', {
    body: { username: 'Alice', password: 'secret-pass' },
  })
  assert.equal(created.status, 201)
  assert.equal(created.data.username, 'alice')
  assert.equal(JSON.stringify(created.data).includes('secret-pass'), false)
  const token = created.data.token
  const user = await store.getUser('alice')
  assert.notEqual(user.hash, 'secret-pass')
  assert.equal(JSON.stringify(user).includes('secret-pass'), false)

  const again = await call(store, 'POST', '/v1/register', {
    body: { username: 'alice', password: 'secret-pass' },
  })
  assert.equal(again.status, 409)

  const wrong = await call(store, 'POST', '/v1/login', {
    body: { username: 'alice', password: 'wrong-pass' },
  })
  assert.equal(wrong.status, 401)
  const missing = await call(store, 'POST', '/v1/login', {
    body: { username: '没有此人', password: 'secret-pass' },
    ip: '203.0.113.11',
  })
  assert.equal(missing.status, 401)

  const fresh = await call(store, 'GET', '/v1/ledger', { token })
  assert.equal(fresh.status, 404)
  assert.equal((await call(store, 'GET', '/v1/ledger')).status, 401)

  const first = ledger({ transactions: [{ id: 'tx1' }] })
  const put = await call(store, 'PUT', '/v1/ledger', { token, body: { ledger: first } })
  assert.equal(put.status, 200)
  const got = await call(store, 'GET', '/v1/ledger', { token })
  assert.equal(got.data.ledger.transactions[0].id, 'tx1')
  assert.equal(JSON.stringify(got.data).includes('secret-pass'), false)
  assert.equal(JSON.stringify(got.data).includes(token), false)

  const leaked = ledger({ note: token, meta: { updated_at: '2026-11-04T00:00:00.000Z', revision: 3, pristine: false } })
  assert.equal((await call(store, 'PUT', '/v1/ledger', { token, body: { ledger: leaked } })).status, 400)

  const older = ledger({
    transactions: [],
    meta: { updated_at: '2020-01-01T00:00:00.000Z', revision: 9, pristine: false },
  })
  const stale = await call(store, 'PUT', '/v1/ledger', { token, body: { ledger: older } })
  assert.equal(stale.status, 409)
  assert.equal(stale.data.ledger.transactions[0].id, 'tx1')

  const blank = ledger({
    transactions: [],
    meta: { updated_at: '2099-01-01T00:00:00.000Z', revision: 1, pristine: true },
  })
  const pristine = await call(store, 'PUT', '/v1/ledger', { token, body: { ledger: blank } })
  assert.equal(pristine.status, 409)

  const newer = ledger({
    transactions: [{ id: 'tx1' }, { id: 'tx2' }],
    meta: { updated_at: '2026-11-03T00:00:00.000Z', revision: 2, pristine: false },
  })
  assert.equal((await call(store, 'PUT', '/v1/ledger', { token, body: { ledger: newer } })).status, 200)
  const after = await call(store, 'GET', '/v1/ledger', { token })
  assert.equal(after.data.ledger.transactions.length, 2)

  const cn = await call(store, 'POST', '/v1/register', {
    body: { username: '我的账', password: 'secret-pass' },
    ip: '203.0.113.20',
  })
  assert.equal(cn.status, 201)
  assert.equal(cn.data.username, '我的账')

  assert.equal((await call(store, 'POST', '/v1/logout', { token })).status, 204)
  assert.equal((await call(store, 'GET', '/v1/ledger', { token })).status, 401)
})

test('login is rate limited per username', async () => {
  const store = createMemoryStore()
  await call(store, 'POST', '/v1/register', {
    body: { username: 'bob', password: 'secret-pass' },
    ip: '203.0.113.30',
  })
  for (let i = 0; i < 11; i += 1) {
    const res = await call(store, 'POST', '/v1/login', {
      body: { username: 'bob', password: 'wrong-pass' },
      ip: '203.0.113.30',
    })
    assert.equal(res.status, 401)
  }
  const blocked = await call(store, 'POST', '/v1/login', {
    body: { username: 'bob', password: 'secret-pass' },
    ip: '203.0.113.30',
  })
  assert.equal(blocked.status, 429)
})
