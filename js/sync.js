/* GitHub Gist 云同步。
 * 令牌只放在 localStorage（ledger.sync.v1），不进账本、不进仓库。
 * 冲突：整本最后写入获胜（meta.updated_at，相同则比 meta.revision）。
 * 离线时只记 dirty，恢复联网后再拉取并按时间戳合并。
 */

import { getCloudSnapshot, isCloudLoggedIn, noteCloudSave } from './cloud.js'
import { installPersistHook, registerCloudSaver, registerGistSaver } from './persist-hook.js'
import { loadDb, saveDb } from './store.js'
import {
  GIST_DESCRIPTION,
  GIST_FILENAME,
  chooseWinner,
  isPlausibleToken,
  normalizeToken,
  withCloudMeta,
} from './sync-merge.js'

export { GIST_DESCRIPTION, GIST_FILENAME }

const API = 'https://api.github.com'
const API_VERSION = '2026-03-10'
export const SYNC_STORAGE_KEY = 'ledger.sync.v1'
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
let onRemote = null
let onGistId = null
let onStatus = null
let started = false

function emptyMeta() {
  return { token: '', gistId: '', lastSyncedAt: '', lastError: '', dirty: false }
}

function readMeta() {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY)
    if (!raw) return emptyMeta()
    const parsed = JSON.parse(raw)
    return {
      token: typeof parsed.token === 'string' ? parsed.token : '',
      gistId: typeof parsed.gistId === 'string' ? parsed.gistId : '',
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : '',
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : '',
      dirty: !!parsed.dirty,
    }
  } catch {
    return emptyMeta()
  }
}

function writeMeta(meta) {
  const next = {
    token: meta.token || '',
    gistId: meta.gistId || '',
    lastSyncedAt: meta.lastSyncedAt || '',
    lastError: meta.lastError || '',
    dirty: !!meta.dirty,
  }
  localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(next))
}

export function isLoggedIn() {
  return !!readMeta().token
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

export function getGistSnapshot() {
  const meta = readMeta()
  const loggedIn = !!meta.token
  let status = loggedIn ? uiStatus : 'local'
  if (loggedIn && !online() && status !== 'local') status = 'offline'
  if (!loggedIn) status = 'local'
  const label = STATUS_LABEL[status] || STATUS_LABEL.local
  let detail = '未登录，数据只保存在本机'
  if (status === 'syncing') detail = '正在与 GitHub Gist 同步…'
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
    lastSyncedAt: meta.lastSyncedAt,
    lastError: meta.lastError,
    gistId: meta.gistId,
    dirty: meta.dirty,
    mode: 'gist',
  }
}

export function getSyncSnapshot() {
  if (isCloudLoggedIn()) return getCloudSnapshot()
  return getGistSnapshot()
}

function setStatus(status, errorMsg) {
  uiStatus = status
  if (errorMsg !== undefined) {
    const meta = readMeta()
    writeMeta({ ...meta, lastError: errorMsg || '' })
  }
  onStatus?.(getSyncSnapshot())
}

function ghMessage(status) {
  if (status === 401) return '令牌无效或已过期'
  if (status === 403) return '令牌没有 gist 权限，或触发了 GitHub 频率限制'
  if (status === 404) return '找不到云端账本'
  if (status === 422) return '云端拒绝了这次保存，请稍后重试'
  return '云同步失败，请稍后重试'
}

async function gh(path, { method = 'GET', token, body } = {}) {
  let res
  try {
    res = await fetch(`${API}${path}`, {
      method,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
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
    const err = new Error(ghMessage(res.status))
    err.status = res.status
    throw err
  }
  return data
}

function enqueue(task) {
  const run = chain.then(task, task)
  chain = run.then(() => {}, () => {})
  return run
}

function fileOf(gist) {
  return gist?.files?.[GIST_FILENAME] || null
}

async function readDbFromGist(gist, token) {
  const file = fileOf(gist)
  if (!file) throw new Error('云端账本缺少数据文件')
  let text = file.content
  if (file.truncated || text == null) {
    if (!file.raw_url) throw new Error('云端账本内容不完整')
    let res
    try {
      res = await fetch(file.raw_url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.raw+json',
        },
      })
    } catch {
      const err = new Error('网络不可用，已保留本机账本')
      err.offline = true
      throw err
    }
    if (!res.ok) throw new Error('读取云端账本失败')
    text = await res.text()
  }
  let db
  try { db = JSON.parse(text) } catch { throw new Error('云端账本不是有效的 JSON') }
  if (!db || typeof db !== 'object' || !Array.isArray(db.accounts)) {
    throw new Error('云端账本格式无效')
  }
  return db
}

async function listMyGists(token) {
  const all = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = await gh(`/gists?per_page=100&page=${page}`, { token })
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}

async function findGist(token) {
  const hinted = readMeta().gistId || loadDb()?.meta?.cloud?.gist_id || ''
  if (hinted) {
    try {
      const gist = await gh(`/gists/${encodeURIComponent(hinted)}`, { token })
      if (gist && (gist.description === GIST_DESCRIPTION || fileOf(gist))) return gist
    } catch (err) {
      if (err.status !== 404) throw err
    }
  }
  const matches = (await listMyGists(token))
    .filter((g) => g && g.description === GIST_DESCRIPTION)
    .sort((a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0))
  if (!matches.length) return null
  const full = []
  for (const item of matches.slice(0, 3)) {
    try {
      full.push(await gh(`/gists/${encodeURIComponent(item.id)}`, { token }))
    } catch (err) {
      if (err.status !== 404) throw err
    }
  }
  const usable = full.filter((g) => fileOf(g))
  if (!usable.length) return null
  usable.sort((a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0))
  const ranked = []
  for (const gist of usable) {
    try {
      const db = await readDbFromGist(gist, token)
      ranked.push({ gist, pristine: db?.meta?.pristine === true, time: Date.parse(db?.meta?.updated_at || gist.updated_at || 0) || 0 })
    } catch {
      ranked.push({ gist, pristine: true, time: 0 })
    }
  }
  ranked.sort((a, b) => {
    if (a.pristine !== b.pristine) return a.pristine ? 1 : -1
    return b.time - a.time
  })
  return ranked[0].gist
}

function rememberGistId(gistId) {
  writeMeta({ ...readMeta(), gistId })
  const db = loadDb()
  if (db?.meta?.cloud?.gist_id === gistId && db?.meta?.cloud?.app === GIST_DESCRIPTION) {
    onGistId?.(gistId, db)
    return db
  }
  db.meta = db.meta || {}
  db.meta.cloud = { app: GIST_DESCRIPTION, gist_id: gistId }
  saveDb(db, { touch: false, sync: false })
  onGistId?.(gistId, db)
  return db
}

async function createGist(token, db) {
  const created = await gh('/gists', {
    method: 'POST',
    token,
    body: {
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: { content: JSON.stringify(withCloudMeta(db, null), null, 2) },
      },
    },
  })
  if (!created?.id) throw new Error('创建云端账本失败')
  return created.id
}

async function pushLocal() {
  if (!isLoggedIn()) return
  const tokenAtStart = readMeta().token
  const epoch = localEpoch
  let gistId = readMeta().gistId || loadDb()?.meta?.cloud?.gist_id || ''
  if (!gistId) {
    gistId = await createGist(tokenAtStart, loadDb())
    if (readMeta().token !== tokenAtStart) return
    writeMeta({ ...readMeta(), gistId })
  }
  const payload = withCloudMeta(loadDb(), gistId)
  await gh(`/gists/${encodeURIComponent(gistId)}`, {
    method: 'PATCH',
    token: tokenAtStart,
    body: {
      description: GIST_DESCRIPTION,
      files: {
        [GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) },
      },
    },
  })
  if (readMeta().token !== tokenAtStart) return
  rememberGistId(gistId)
  if (localEpoch !== epoch) {
    writeMeta({ ...readMeta(), gistId, dirty: true })
    setStatus('syncing')
    return
  }
  writeMeta({
    ...readMeta(),
    gistId,
    dirty: false,
    lastSyncedAt: new Date().toISOString(),
    lastError: '',
  })
  setStatus('synced')
}

function applyCloud(db, gistId) {
  const stamped = withCloudMeta(db, gistId)
  saveDb(stamped, { touch: false, sync: false })
  writeMeta({
    ...readMeta(),
    gistId,
    dirty: false,
    lastSyncedAt: new Date().toISOString(),
    lastError: '',
  })
  setStatus('synced')
  onRemote?.(loadDb())
}

async function reconcileInner() {
  if (isCloudLoggedIn()) return
  if (!isLoggedIn()) return
  if (!online()) {
    setStatus('offline')
    const err = new Error('当前离线，改动仍保存在本机')
    err.offline = true
    throw err
  }
  setStatus('syncing')
  const token = readMeta().token
  const gist = await findGist(token)
  if (readMeta().token !== token) return
  if (!gist) {
    await pushLocal()
    return
  }
  const cloud = await readDbFromGist(gist, token)
  if (readMeta().token !== token) return
  const local = loadDb()
  const decision = chooseWinner(local, cloud)
  if (decision === 'cloud') {
    applyCloud(cloud, gist.id)
    return
  }
  if (decision === 'same' && !readMeta().dirty && cloud?.meta?.cloud?.gist_id === gist.id) {
    rememberGistId(gist.id)
    writeMeta({
      ...readMeta(),
      gistId: gist.id,
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
  if (!isLoggedIn()) {
    setStatus('local')
    return
  }
  if (err?.offline || !online()) {
    setStatus('offline')
    return
  }
  setStatus('error', err?.message || '同步失败')
}

function noteLocalSave() {
  if (isCloudLoggedIn()) return
  if (!isLoggedIn()) return
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

function pushKeepalive() {
  const meta = readMeta()
  if (!meta.token || !meta.dirty || !meta.gistId || !online()) return
  const payload = withCloudMeta(loadDb(), meta.gistId)
  const body = JSON.stringify({
    description: GIST_DESCRIPTION,
    files: {
      [GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) },
    },
  })
  fetch(`${API}/gists/${encodeURIComponent(meta.gistId)}`, {
    method: 'PATCH',
    keepalive: true,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${meta.token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': API_VERSION,
    },
    body,
  }).catch(() => {})
}

function onHidden() {
  if (isCloudLoggedIn()) return
  if (!isLoggedIn() || !readMeta().dirty) return
  clearTimeout(timer)
  pushKeepalive()
}

export function startSync(hooks = {}) {
  onRemote = hooks.onRemote || null
  onGistId = hooks.onGistId || null
  onStatus = hooks.onStatus || null
  if (!started) {
    started = true
    registerCloudSaver(() => isCloudLoggedIn(), () => noteCloudSave())
    registerGistSaver(() => noteLocalSave())
    installPersistHook()
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', () => {
        if (isCloudLoggedIn() || !isLoggedIn()) return
        clearTimeout(timer)
        enqueue(() => reconcileInner().catch(fail))
      })
      window.addEventListener('offline', () => {
        if (isCloudLoggedIn() || !isLoggedIn()) return
        setStatus('offline')
      })
      window.addEventListener('pagehide', onHidden)
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          onHidden()
          return
        }
        if (!isCloudLoggedIn() && isLoggedIn() && readMeta().dirty && online()) {
          clearTimeout(timer)
          enqueue(() => reconcileInner().catch(fail))
        }
      })
    }
  }
  if (!isLoggedIn()) setStatus('local')
  else if (!online()) setStatus('offline')
  else setStatus(readMeta().dirty || !readMeta().lastSyncedAt ? 'syncing' : 'synced')
}

export function bootSync() {
  if (!isLoggedIn()) return Promise.resolve()
  return enqueue(async () => {
    try { await reconcileInner() } catch (err) { fail(err) }
  })
}

export function syncNow() {
  if (!isLoggedIn()) return Promise.reject(new Error('请先登录云同步'))
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

export function login(raw) {
  const token = normalizeToken(raw)
  if (!isPlausibleToken(token)) {
    return Promise.reject(new Error('请粘贴 GitHub 个人访问令牌（只需 gist 权限）'))
  }
  if (!online()) {
    return Promise.reject(new Error('当前离线，无法登录云同步'))
  }
  return enqueue(async () => {
    setStatus('syncing')
    try {
      await gh('/gists?per_page=1', { token })
      writeMeta({ ...readMeta(), token, lastError: '' })
      await reconcileInner()
    } catch (err) {
      if (isLoggedIn()) fail(err)
      else setStatus('local')
      throw err
    }
  })
}

export function logout() {
  clearTimeout(timer)
  localEpoch += 1
  const meta = readMeta()
  writeMeta({
    token: '',
    gistId: meta.gistId,
    lastSyncedAt: meta.lastSyncedAt,
    lastError: '',
    dirty: false,
  })
  setStatus('local')
}
