import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chooseWinner, isPlausibleToken, normalizeToken, withCloudMeta, withAccountCloudMeta,
  GIST_DESCRIPTION, ACCOUNT_CLOUD_APP,
} from '../js/sync-merge.js'

function db(extra) {
  return {
    accounts: [{ id: 'a' }],
    transactions: [],
    meta: { updated_at: '2026-11-01T00:00:00.000Z', revision: 1, pristine: false },
    ...extra,
  }
}

test('blank seed never overwrites a real ledger, even if its clock is newer', () => {
  const cloud = db({ transactions: [{ id: 'tx1' }] })
  const local = db({
    meta: { updated_at: '2026-11-02T00:00:00.000Z', revision: 1, pristine: true },
  })
  assert.equal(chooseWinner(local, cloud), 'cloud')
  assert.equal(chooseWinner(cloud, local), 'local')
})

test('last write wins by updated_at, then revision', () => {
  const older = db()
  const newer = db({ meta: { updated_at: '2026-11-03T00:00:00.000Z', revision: 1, pristine: false } })
  assert.equal(chooseWinner(older, newer), 'cloud')
  assert.equal(chooseWinner(newer, older), 'local')
  const low = db({ meta: { updated_at: '2026-11-01T00:00:00.000Z', revision: 1, pristine: false } })
  const high = db({ meta: { updated_at: '2026-11-01T00:00:00.000Z', revision: 4, pristine: false } })
  assert.equal(chooseWinner(low, high), 'cloud')
  assert.equal(chooseWinner(high, low), 'local')
  assert.equal(chooseWinner(high, { ...high }), 'same')
})

test('missing or invalid cloud stays local', () => {
  assert.equal(chooseWinner(db(), null), 'local')
  assert.equal(chooseWinner(db(), { meta: {} }), 'local')
})

test('legacy ledgers without pristine are treated as real data', () => {
  const legacy = { accounts: [{ id: 'a' }], meta: { updated_at: '2020-01-01T00:00:00.000Z' } }
  const fresh = db({ meta: { updated_at: '2026-11-01T00:00:00.000Z', revision: 0, pristine: true } })
  assert.equal(chooseWinner(legacy, fresh), 'local')
})

test('cloud meta is only the gist id, not a token', () => {
  const stamped = withCloudMeta(db(), 'abc123')
  assert.deepEqual(stamped.meta.cloud, { app: GIST_DESCRIPTION, gist_id: 'abc123' })
  assert.equal(JSON.stringify(stamped).includes('ghp_'), false)
  assert.equal(JSON.stringify(stamped).includes('github_pat_'), false)
})

test('account cloud meta keeps the username and drops secrets', () => {
  const stamped = withAccountCloudMeta(db({ meta: { updated_at: '2026-11-01T00:00:00.000Z', revision: 1, pristine: false, cloud: { gist_id: 'g1', token: 'ghp_secret' } } }), 'alice')
  assert.equal(stamped.meta.cloud.app, ACCOUNT_CLOUD_APP)
  assert.equal(stamped.meta.cloud.username, 'alice')
  assert.equal(stamped.meta.cloud.gist_id, 'g1')
  assert.equal(JSON.stringify(stamped).includes('ghp_'), false)
  assert.equal(JSON.stringify(stamped).includes('password'), false)
})

test('token paste is normalized and shape-checked', () => {
  const token = `exampletoken_${'b'.repeat(20)}`
  assert.equal(normalizeToken(`  Bearer ${token} \n`), token)
  assert.equal(isPlausibleToken(token), true)
  assert.equal(isPlausibleToken('short'), false)
  assert.equal(isPlausibleToken('has space and more than twenty chars'), false)
})
