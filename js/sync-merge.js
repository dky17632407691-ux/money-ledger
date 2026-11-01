/* 云同步的纯函数：最后写入获胜，空白种子账本不能覆盖已有账本。 */

export const GIST_DESCRIPTION = 'money-ledger-cloud-v1'
export const GIST_FILENAME = 'money-ledger.json'

export function isPristine(db) {
  return db?.meta?.pristine === true
}

function stampOf(db) {
  const parsed = Date.parse(db?.meta?.updated_at || '')
  return {
    time: Number.isFinite(parsed) ? parsed : 0,
    revision: Number(db?.meta?.revision) || 0,
    pristine: isPristine(db),
  }
}

/**
 * 比较本机与云端整本账。
 * @returns {'local' | 'cloud' | 'same'}
 */
export function chooseWinner(local, cloud) {
  if (!cloud || typeof cloud !== 'object' || !Array.isArray(cloud.accounts)) return 'local'
  if (!local || typeof local !== 'object' || !Array.isArray(local.accounts)) return 'cloud'
  const left = stampOf(local)
  const right = stampOf(cloud)
  // 刚装上、还没记过账的空账本，不能因为本机时钟更新就把云端账盖掉
  if (left.pristine && !right.pristine) return 'cloud'
  if (!left.pristine && right.pristine) return 'local'
  if (left.time !== right.time) return left.time > right.time ? 'local' : 'cloud'
  if (left.revision !== right.revision) return left.revision > right.revision ? 'local' : 'cloud'
  return 'same'
}

/** 深拷贝账本并写入云端标识。绝不放入令牌。 */
export function withCloudMeta(db, gistId) {
  const copy = JSON.parse(JSON.stringify(db))
  copy.meta = copy.meta && typeof copy.meta === 'object' ? copy.meta : {}
  copy.meta.cloud = {
    app: GIST_DESCRIPTION,
    gist_id: gistId || null,
  }
  return copy
}

export function normalizeToken(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^token\s+/i, '')
    .replace(/\s+/g, '')
}

export function isPlausibleToken(token) {
  return typeof token === 'string'
    && token.length >= 20
    && token.length <= 300
    && /^[A-Za-z0-9_\-]+$/.test(token)
}
