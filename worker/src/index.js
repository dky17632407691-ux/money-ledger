/* 生活记账本云账号 API。
 * 用户名 + 密码，会话令牌放在 D1。免费版 Worker 只有约 10ms CPU，
 * 所以密码用 PBKDF2-SHA256、8000 次（登录时按注册时记下的次数）。
 * 请用较长密码。升级到 Workers Paid 后可以把 ITERATIONS 调高，旧账号仍按原次数校验。
 */

import { chooseWinner } from '../../js/sync-merge.js'
import { normalizeUsername, passwordError } from '../../js/account-auth.js'

const ITERATIONS = 8000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_LEDGER = 400_000
const RATE_WINDOW_MS = 10 * 60 * 1000
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA=='

class HttpError extends Error {
  constructor(status, message, ledger) {
    super(message)
    this.status = status
    this.ledger = ledger
  }
}

function json(status, data) {
  return new Response(data == null ? null : JSON.stringify(data), {
    status,
    headers: data == null ? {} : { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function cors(res) {
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  headers.set('Access-Control-Max-Age', '86400')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  return new Response(res.body, { status: res.status, headers })
}

function bytesToB64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function randomB64(size) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytesToB64(bytes)
}

function randomToken() {
  return randomB64(32).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function safeEqual(a, b) {
  const left = String(a)
  const right = String(b)
  const len = Math.max(left.length, right.length)
  let out = left.length ^ right.length
  for (let i = 0; i < len; i += 1) {
    out |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0)
  }
  return out === 0
}

async function pbkdf2(password, saltB64, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: b64ToBytes(saltB64),
      iterations,
      hash: 'SHA-256',
    },
    key,
    256,
  )
  return bytesToB64(new Uint8Array(bits))
}

function storedIterations(n) {
  const i = Number(n)
  if (!Number.isInteger(i) || i < 4000 || i > 20000) return null
  return i
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('x-forwarding-for')?.split(',')[0]?.trim()
    || 'unknown'
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_LEDGER + 20_000) throw new HttpError(413, '请求太大')
  let text = ''
  try {
    text = await request.text()
  } catch {
    throw new HttpError(400, '无法读取请求')
  }
  if (text.length > MAX_LEDGER + 20_000) throw new HttpError(413, '请求太大')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, '请求不是 JSON')
  }
}

function bearer(request) {
  const header = request.headers.get('Authorization') || ''
  if (!header.startsWith('Bearer ')) return ''
  return header.slice(7).trim()
}

async function requireUser(request, store, now) {
  const token = bearer(request)
  if (!token) throw new HttpError(401, '请先登录')
  const session = await store.getSession(token)
  if (!session || Number(session.expires_at) <= now) {
    if (session) await store.deleteSession(token)
    throw new HttpError(401, '登录已失效，请重新输入用户名和密码')
  }
  return { token, username: session.username }
}

async function issueSession(store, username, now) {
  const token = randomToken()
  const expiresAt = now + SESSION_TTL_MS
  await store.putSession({ token, username, expires_at: expiresAt })
  return {
    token,
    username,
    expires_at: new Date(expiresAt).toISOString(),
  }
}

async function assertRate(store, request, username, now) {
  const ip = clientIp(request)
  const ipCount = await store.bumpRate(`ip:${ip}`, now, RATE_WINDOW_MS)
  const nameCount = username
    ? await store.bumpRate(`name:${username}`, now, RATE_WINDOW_MS)
    : 0
  if (ipCount > 30 || nameCount > 12) {
    throw new HttpError(429, '尝试次数过多，请稍后再试')
  }
}

function validateLedger(ledger) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    throw new HttpError(400, '账本格式无效')
  }
  if (!Array.isArray(ledger.accounts)) throw new HttpError(400, '账本格式无效')
  delete ledger.password
  delete ledger.token
  if (ledger.meta && typeof ledger.meta === 'object' && ledger.meta.cloud && typeof ledger.meta.cloud === 'object') {
    delete ledger.meta.cloud.token
    delete ledger.meta.cloud.password
    delete ledger.meta.cloud.pat
  }
}

function uniqueError(err) {
  return err?.code === 'UNIQUE' || String(err?.message || err).toLowerCase().includes('unique')
}

async function route(request, store, now) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (request.method === 'GET' && path === '/v1/health') {
    return json(200, { ok: true, service: 'money-ledger' })
  }
  if (request.method === 'POST' && path === '/v1/register') {
    const body = await readJson(request)
    const username = normalizeUsername(body?.username)
    const pwErr = passwordError(body?.password)
    await assertRate(store, request, username || clientIp(request), now)
    if (!username) throw new HttpError(400, '用户名需要 3–32 位字母、数字、下划线或短横线')
    if (pwErr) throw new HttpError(400, pwErr)
    if (await store.getUser(username)) throw new HttpError(409, '用户名已被占用')
    const salt = randomB64(16)
    const hash = await pbkdf2(body.password, salt, ITERATIONS)
    try {
      await store.putUser({
        username,
        salt,
        hash,
        iterations: ITERATIONS,
        created_at: new Date(now).toISOString(),
      })
    } catch (err) {
      if (uniqueError(err)) throw new HttpError(409, '用户名已被占用')
      throw err
    }
    return json(201, await issueSession(store, username, now))
  }
  if (request.method === 'POST' && path === '/v1/login') {
    const body = await readJson(request)
    const username = normalizeUsername(body?.username)
    const pwErr = passwordError(body?.password)
    await assertRate(store, request, username || clientIp(request), now)
    if (!username) throw new HttpError(400, '用户名需要 3–32 位字母、数字、下划线或短横线')
    if (pwErr) throw new HttpError(400, pwErr)
    const user = await store.getUser(username)
    const iterations = user ? storedIterations(user.iterations) : ITERATIONS
    const hash = await pbkdf2(body.password, user && iterations ? user.salt : DUMMY_SALT, iterations || ITERATIONS)
    if (!user || !iterations || !safeEqual(hash, user.hash)) {
      throw new HttpError(401, '用户名或密码错误')
    }
    return json(200, await issueSession(store, username, now))
  }
  if (request.method === 'POST' && path === '/v1/logout') {
    const { token } = await requireUser(request, store, now)
    await store.deleteSession(token)
    return json(204, null)
  }
  if (request.method === 'GET' && path === '/v1/ledger') {
    const { username } = await requireUser(request, store, now)
    const row = await store.getLedger(username)
    if (!row) throw new HttpError(404, '还没有云端账本')
    let ledger
    try {
      ledger = JSON.parse(row.body)
    } catch {
      throw new HttpError(500, '云端账本损坏')
    }
    return json(200, {
      username,
      revision: Number(row.revision) || 0,
      updated_at: row.updated_at,
      ledger,
    })
  }
  if (request.method === 'PUT' && path === '/v1/ledger') {
    const { username, token } = await requireUser(request, store, now)
    const body = await readJson(request)
    const ledger = body?.ledger
    validateLedger(ledger)
    const text = JSON.stringify(ledger)
    if (text.length > MAX_LEDGER) throw new HttpError(413, '账本太大，云端无法保存')
    if (text.includes(token)) throw new HttpError(400, '账本里不能包含登录令牌')
    const existing = await store.getLedger(username)
    if (existing) {
      let stored = null
      try { stored = JSON.parse(existing.body) } catch { stored = null }
      if (stored) {
        const decision = chooseWinner(ledger, stored)
        if (decision === 'cloud') throw new HttpError(409, '云端有更新的账本', stored)
        if (decision === 'same') {
          return json(200, {
            ok: true,
            unchanged: true,
            updated_at: stored.meta?.updated_at || existing.updated_at,
            revision: Number(existing.revision) || 0,
          })
        }
      }
    }
    const revision = Number(ledger.meta?.revision) || 0
    const updatedAt = typeof ledger.meta?.updated_at === 'string' && ledger.meta.updated_at
      ? ledger.meta.updated_at
      : new Date(now).toISOString()
    await store.putLedger({ username, revision, updated_at: updatedAt, body: text })
    return json(200, { ok: true, updated_at: updatedAt, revision })
  }
  throw new HttpError(404, '没有这个接口')
}

export async function handleRequest(request, store, now = Date.now()) {
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
  try {
    return cors(await route(request, store, now))
  } catch (err) {
    if (err instanceof HttpError) {
      const payload = { error: err.message }
      if (err.ledger) payload.ledger = err.ledger
      return cors(json(err.status, payload))
    }
    console.error('money-ledger api failed', err && err.message)
    return cors(json(500, { error: '服务器暂时不可用' }))
  }
}

export function createMemoryStore() {
  const users = new Map()
  const sessions = new Map()
  const ledgers = new Map()
  const rates = new Map()
  return {
    async getUser(username) {
      return users.get(username) || null
    },
    async putUser(user) {
      if (users.has(user.username)) {
        const err = new Error('UNIQUE constraint failed')
        err.code = 'UNIQUE'
        throw err
      }
      users.set(user.username, { ...user })
    },
    async getSession(token) {
      return sessions.get(token) || null
    },
    async putSession(session) {
      sessions.set(session.token, { ...session })
    },
    async deleteSession(token) {
      sessions.delete(token)
    },
    async getLedger(username) {
      return ledgers.get(username) || null
    },
    async putLedger(row) {
      ledgers.set(row.username, { ...row })
    },
    async bumpRate(key, now, windowMs) {
      const row = rates.get(key)
      if (!row || row.reset_at <= now) {
        rates.set(key, { count: 1, reset_at: now + windowMs })
        return 1
      }
      row.count += 1
      return row.count
    },
  }
}

function createD1Store(db) {
  return {
    async getUser(username) {
      return db.prepare(
        'SELECT username, salt, hash, iterations, created_at FROM users WHERE username = ?',
      ).bind(username).first()
    },
    async putUser(user) {
      try {
        await db.prepare(
          'INSERT INTO users (username, salt, hash, iterations, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(user.username, user.salt, user.hash, user.iterations, user.created_at).run()
      } catch (err) {
        if (uniqueError(err)) {
          const wrapped = new Error('UNIQUE constraint failed')
          wrapped.code = 'UNIQUE'
          throw wrapped
        }
        throw err
      }
    },
    async getSession(token) {
      return db.prepare(
        'SELECT token, username, expires_at FROM sessions WHERE token = ?',
      ).bind(token).first()
    },
    async putSession(session) {
      await db.prepare(
        'INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)',
      ).bind(session.token, session.username, session.expires_at).run()
    },
    async deleteSession(token) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
    },
    async getLedger(username) {
      return db.prepare(
        'SELECT username, revision, updated_at, body FROM ledgers WHERE username = ?',
      ).bind(username).first()
    },
    async putLedger(row) {
      await db.prepare(
        `INSERT INTO ledgers (username, revision, updated_at, body) VALUES (?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET
           revision = excluded.revision,
           updated_at = excluded.updated_at,
           body = excluded.body`,
      ).bind(row.username, row.revision, row.updated_at, row.body).run()
    },
    async bumpRate(key, now, windowMs) {
      const row = await db.prepare(
        'SELECT count, reset_at FROM rate_limits WHERE key = ?',
      ).bind(key).first()
      if (!row || Number(row.reset_at) <= now) {
        await db.prepare(
          `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
           ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
        ).bind(key, now + windowMs).run()
        return 1
      }
      const count = Number(row.count) + 1
      await db.prepare('UPDATE rate_limits SET count = ? WHERE key = ?').bind(count, key).run()
      return count
    },
  }
}

export default {
  async fetch(request, env) {
    if (!env?.DB) return cors(json(500, { error: '服务器未绑定 D1 数据库' }))
    return handleRequest(request, createD1Store(env.DB))
  },
}
