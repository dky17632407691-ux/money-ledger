/* 用户名 + 密码的云账号同步。
 * 会话令牌优先放在内存，并写入 sessionStorage，这样同一个无痕标签刷新还在，
 * 关掉标签后就要重新输入密码。可选「记住登录」才写入 localStorage，
 * 而且存的是令牌不是密码；网站数据被清掉之后，重新输入密码即可。
 * 账本正文仍用 localStorage 当本机缓存。
 */

import { passwordError, normalizeUsername } from './account-auth.js'
import { DEFAULT_API_BASE } from './cloud-config.js'
import { installPersistHook, registerCloudSaver } from './persist-hook.js'
import { loadDb, saveDb } from './store.js'
import { chooseWinner, withAccountCloudMeta } from './sync-merge.js'

export const CLOUD_SESSION_KEY = 'ledger.cloud.session.v1'
export const CLOUD_REMEMBER_KEY = 'ledger.cloud.remember.v1'
const META_KEY = 'ledger.cloud.meta.v1'
const API_KEY = 'ledger.cloud.api'
const DEBOUNCE_MS = 1000

const STATUS_LABEL = {
  local: '仅本地',
  synced: '已同步',
  syncing: '同步中',
  offline: '离线',
  error: '同步失败',
}

let uiStatus = 'local'
let timer = 0
let localEpoch = 0
let chain = Promise.resolve()
let memorySession = null
let memoryMeta = emptyMeta()
let explicitApi = null
let onRemote = null
let onStatus = null
let onAuthLost = null
let started = false

function emptyMeta() {
  return { dirty: false, lastSyncedAt: '', lastError: '' }
}

function sessionStorageOf() {
  try {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage
  } catch {
    return null
  }
}

function localStorageOf() {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function readJson(storage, key) {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeJson(storage, key, value) {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    /* 无痕模式偶发拒绝写入时，内存里的会话仍然有效 */
  }
}

function removeKey(storage, key) {
  if (!storage) return
  try { storage.removeItem(key) } catch { /* 忽略 */ }
}

export function normalizeApiBase(raw) {
  const text = String(raw ?? '').trim()
  let url
  try { url = new URL(text) } catch { throw new Error('云端地址不是有效的网址') }
  if (url.username || url.password) throw new Error('云端地址不能带账号密码')
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('云端地址必须是 https（本机调试可用 http://127.0.0.1）')
  }
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path === '/' ? '' : path}`
}

function queryApi() {
  try {
    const href = globalThis.location?.href
    if (!href) return ''
    const value = new URL(href).searchParams.get('api')
    if (!value) return ''
    return normalizeApiBase(value)
  } catch {
    return ''
  }
}

function savedApi() {
  const value = readJson(localStorageOf(), API_KEY)
  if (typeof value === 'string' && value) {
    try { return normalizeApiBase(value) } catch { return '' }
  }
  const raw = localStorageOf()?.getItem?.(API_KEY)
  if (!raw) return ''
  try { return normalizeApiBase(raw) } catch { return '' }
}

export function getApiBase() {
  if (explicitApi != null) return explicitApi
  const fromQuery = queryApi()
  if (fromQuery) return fromQuery
  const saved = savedApi()
  if (saved) return saved
  return DEFAULT_API_BASE
}

export function setApiBase(raw, { persist = false } = {}) {
  const text = String(raw ?? '').trim()
  if (!text) {
    explicitApi = null
    if (persist) removeKey(localStorageOf(), API_KEY)
    return ''
  }
  const normalized = normalizeApiBase(text)
  explicitApi = normalized
  if (persist) writeJson(localStorageOf(), API_KEY, normalized)
  return normalized
}

function validSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.token !== 'string' || raw.token.length < 20) return null
  if (typeof raw.username !== 'string' || !raw.username) return null
  const expiresAt = Number(raw.expiresAt)
  if (!Number.isFinite(expiresAt)) return null
  return { token: raw.token, username: raw.username, expiresAt }
}

function takeStoredSession(storage, key) {
  const session = validSession(readJson(storage, key))
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    removeKey(storage, key)
    return null
  }
  return session
}

export function currentSession() {
  const now = Date.now()
  if (memorySession && memorySession.expiresAt <= now) memorySession = null
  const candidates = [
    memorySession,
    takeStoredSession(sessionStorageOf(), CLOUD_SESSION_KEY),
    takeStoredSession(localStorageOf(), CLOUD_REMEMBER_KEY),
  ]
  for (const session of candidates) {
    if (!session || session.expiresAt <= now) continue
    memorySession = session
    writeJson(sessionStorageOf(), CLOUD_SESSION_KEY, session)
    return session
  }
  memorySession = null
  return null
}

export function isCloudLoggedIn() {
  return !!currentSession()
}

export function cloudUsername() {
  return currentSession()?.username || ''
}

function readMeta() {
  const stored = readJson(sessionStorageOf(), META_KEY)
  if (stored && typeof stored === 'object') {
    memoryMeta = {
      dirty: !!stored.dirty,
      lastSyncedAt: typeof stored.lastSyncedAt === 'string' ? stored.lastSyncedAt : '',
      lastError: typeof stored.lastError === 'string' ? stored.lastError : '',
    }
  }
  return memoryMeta
}

function writeMeta(meta) {
  memoryMeta = {
    dirty: !!meta.dirty,
    lastSyncedAt: meta.lastSyncedAt || '',
    lastError: meta.lastError || '',
  }
  writeJson(sessionStorageOf(), META_KEY, memoryMeta)
}

function clearLocalSession() {
  memorySession = null
  memoryMeta = emptyMeta()
  removeKey(sessionStorageOf(), CLOUD_SESSION_KEY)
  removeKey(sessionStorageOf(), META_KEY)
  removeKey(localStorageOf(), CLOUD_REMEMBER_KEY)
}

function online() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function formatClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function getCloudSnapshot() {
  const session = currentSession()
  const meta = readMeta()
  const loggedIn = !!session
  let status = loggedIn ? uiStatus : 'local'
  if (loggedIn && !online() && status !== 'local') status = 'offline'
  if (!loggedIn) status = 'local'
  const label = STATUS_LABEL[status] || STATUS_LABEL.local
  let detail = '未登录。记下用户名和密码，换设备或无痕窗口重新登录即可恢复云端账本'
  if (status === 'syncing') detail = '正在与云端同步…'
  else if (status === 'offline') {
    detail = meta.dirty
      ? '离线，改动已保存在本机，联网后会上传'
      : '当前离线，显示的是本机缓存'
  } else if (status === 'error') detail = meta.lastError || '同步失败，请稍后重试'
  else if (status === 'synced') {
    const clock = formatClock(meta.lastSyncedAt)
    detail = clock ? `上次同步 ${clock}` : '已与云端一致'
  }
  return {
    loggedIn,
    status,
    label,
    detail,
    username: session?.username || '',
    lastSyncedAt: meta.lastSyncedAt,
    lastError: meta.lastError,
    dirty: meta.dirty,
    mode: 'account',
  }
}

function setStatus(status, errorMsg) {
  uiStatus = status
  if (errorMsg !== undefined) writeMeta({ ...readMeta(), lastError: errorMsg || '' })
  onStatus?.(getCloudSnapshot())
}

function enqueue(task) {
  const run = chain.then(task, task)
  chain = run.then(() => {}, () => {})
  return run
}

function fallbackMessage(status) {
  if (status === 401) return '用户名或密码错误'
  if (status === 409) return '云端有更新的账本'
  if (status === 413) return '账本太大，云端无法保存'
  if (status === 429) return '尝试次数过多，请稍后再试'
  if (status === 404) return '云端地址不正确或尚未部署'
  return '云同步失败，请稍后重试'
}

async function api(path, { method = 'GET', token, body, keepalive = false } = {}) {
  const base = getApiBase()
  if (!base) {
    const err = new Error('还没有配置云端地址。请先部署 Worker，并把地址写进 js/cloud-config.js，或填在「服务器地址」里。')
    err.status = 0
    throw err
  }
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      keepalive,
    })
  } catch {
    const err = new Error('网络不可用，已保留本机账本')
    err.offline = true
    throw err
  }
  const text = await res.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = null }
  }
  if (!res.ok) {
    if (res.status === 404 && method === 'GET') return null
    const err = new Error(data?.error || fallbackMessage(res.status))
    err.status = res.status
    if (data?.ledger) err.ledger = data.ledger
    throw err
  }
  return data
}

function adoptSession(data, remember) {
  const session = validSession({
    token: data?.token,
    username: data?.username,
    expiresAt: Date.parse(data?.expires_at || ''),
  })
  if (!session) throw new Error('云端登录响应无效')
  memorySession = session
  writeJson(sessionStorageOf(), CLOUD_SESSION_KEY, session)
  if (remember) writeJson(localStorageOf(), CLOUD_REMEMBER_KEY, session)
  else removeKey(localStorageOf(), CLOUD_REMEMBER_KEY)
}

function applyRemote(db) {
  const session = currentSession()
  const stamped = withAccountCloudMeta(db, session?.username)
  saveDb(stamped, { touch: false, sync: false })
  writeMeta({ dirty: false, lastSyncedAt: new Date().toISOString(), lastError: '' })
  setStatus('synced')
  onRemote?.(loadDb())
}

async function pushLocal() {
  const session = currentSession()
  if (!session) return
  const token = session.token
  const epoch = localEpoch
  const payload = withAccountCloudMeta(loadDb(), session.username)
  try {
    await api('/v1/ledger', {
      method: 'PUT',
      token,
      body: { ledger: payload },
    })
  } catch (err) {
    if (err.status === 409 && err.ledger) {
      const decision = chooseWinner(loadDb(), err.ledger)
      if (decision !== 'local') {
        applyRemote(err.ledger)
        return
      }
    }
    throw err
  }
  if (currentSession()?.token !== token) return
  if (localEpoch !== epoch) {
    writeMeta({ ...readMeta(), dirty: true })
    setStatus('syncing')
    return
  }
  writeMeta({ dirty: false, lastSyncedAt: new Date().toISOString(), lastError: '' })
  setStatus('synced')
}

async function reconcileInner() {
  const session = currentSession()
  if (!session) return
  if (!online()) {
    setStatus('offline')
    const err = new Error('当前离线，改动仍保存在本机')
    err.offline = true
    throw err
  }
  setStatus('syncing')
  const token = session.token
  const remote = await api('/v1/ledger', { token })
  if (currentSession()?.token !== token) return
  if (!remote?.ledger) {
    await pushLocal()
    return
  }
  const decision = chooseWinner(loadDb(), remote.ledger)
  if (decision === 'cloud') {
    applyRemote(remote.ledger)
    return
  }
  if (decision === 'same' && !readMeta().dirty) {
    writeMeta({
      dirty: false,
      lastSyncedAt: readMeta().lastSyncedAt || new Date().toISOString(),
      lastError: '',
    })
    setStatus('synced')
    return
  }
  await pushLocal()
}

function fail(err) {
  if (err?.status === 401) {
    clearLocalSession()
    setStatus('local', '')
    onAuthLost?.(err.message || '登录已失效，请重新输入用户名和密码')
    return
  }
  if (!isCloudLoggedIn()) {
    setStatus('local')
    return
  }
  if (err?.offline || !online()) {
    setStatus('offline')
    return
  }
  setStatus('error', err?.message || '同步失败')
}

function settle(err) {
  if (!isCloudLoggedIn()) {
    setStatus('local', '')
    return
  }
  fail(err)
}

export function noteCloudSave() {
  if (!isCloudLoggedIn()) return
  localEpoch += 1
  writeMeta({ ...readMeta(), dirty: true })
  if (!online()) {
    setStatus('offline')
    return
  }
  setStatus('syncing')
  clearTimeout(timer)
  timer = setTimeout(() => {
    enqueue(() => reconcileInner().catch(fail))
  }, DEBOUNCE_MS)
}

function onHidden() {
  const session = currentSession()
  if (!session || !readMeta().dirty || !online()) return
  clearTimeout(timer)
  const payload = withAccountCloudMeta(loadDb(), session.username)
  api('/v1/ledger', {
    method: 'PUT',
    token: session.token,
    body: { ledger: payload },
    keepalive: true,
  }).catch(() => {})
}

export function startCloud(hooks = {}) {
  onRemote = hooks.onRemote || null
  onStatus = hooks.onStatus || null
  onAuthLost = hooks.onAuthLost || null
  registerCloudSaver(() => isCloudLoggedIn(), () => noteCloudSave())
  installPersistHook()
  if (!started) {
    started = true
    const target = typeof window !== 'undefined' ? window : null
    if (target?.addEventListener) {
      target.addEventListener('online', () => {
        if (!isCloudLoggedIn()) return
        clearTimeout(timer)
        enqueue(() => reconcileInner().catch(fail))
      })
      target.addEventListener('offline', () => {
        if (!isCloudLoggedIn()) return
        setStatus('offline')
      })
      target.addEventListener('pagehide', onHidden)
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          onHidden()
          return
        }
        if (isCloudLoggedIn() && readMeta().dirty && online()) {
          clearTimeout(timer)
          enqueue(() => reconcileInner().catch(fail))
        }
      })
    }
  }
  if (!isCloudLoggedIn()) setStatus('local')
  else if (!online()) setStatus('offline')
  else setStatus(readMeta().dirty || !readMeta().lastSyncedAt ? 'syncing' : 'synced')
}

async function establish(path, username, password, remember, offlineMessage) {
  const name = normalizeUsername(username)
  const pwErr = passwordError(password)
  if (!name) throw new Error('用户名需要 3–32 位字母、数字、下划线或短横线')
  if (pwErr) throw new Error(pwErr)
  if (!online()) throw new Error(offlineMessage)
  setStatus('syncing')
  const data = await api(path, { method: 'POST', body: { username: name, password } })
  adoptSession(data, remember)
  await reconcileInner()
}

export function registerCloud(username, password) {
  return enqueue(async () => {
    try {
      await establish('/v1/register', username, password, false, '当前离线，无法注册')
    } catch (err) {
      settle(err)
      throw err
    }
  })
}

export function loginCloud(username, password, { remember = false } = {}) {
  return enqueue(async () => {
    try {
      await establish('/v1/login', username, password, remember, '当前离线，无法登录')
    } catch (err) {
      settle(err)
      throw err
    }
  })
}

export function logoutCloud() {
  clearTimeout(timer)
  localEpoch += 1
  const token = currentSession()?.token || ''
  clearLocalSession()
  setStatus('local', '')
  if (!token) return
  api('/v1/logout', { method: 'POST', token, keepalive: true }).catch(() => {})
}

export function bootCloud() {
  if (!isCloudLoggedIn()) return Promise.resolve()
  return enqueue(async () => {
    try { await reconcileInner() } catch (err) { fail(err) }
  })
}

export function syncCloudNow() {
  if (!isCloudLoggedIn()) return Promise.reject(new Error('请先登录云账号'))
  clearTimeout(timer)
  return enqueue(async () => {
    try {
      await reconcileInner()
    } catch (err) {
      fail(err)
      throw err
    }
  })
}

export function resetCloudForTests() {
  clearTimeout(timer)
  localEpoch += 1
  memorySession = null
  memoryMeta = emptyMeta()
  uiStatus = 'local'
}
