/* ============================================================
   受邀手机号白名单（邀请制访问控制）
   ------------------------------------------------------------
   名单存在云端 access_allowlist 表，且只保存「加盐 SHA-256 摘要」：
   前端只读、读不到真实号码；数据库侧没有开放任何写策略，
   所以别人即使拿到链接，也无法把自己加进名单。

   拦截点有三处：
   1. 发送验证码前 —— 不在名单直接不发短信（省短信费，也让陌生人无感）
   2. 验证码通过后 —— 再复核一次，不在名单立刻退出登录
   3. 会话恢复时  —— 老会话同样复核，防止名单变更后仍可继续使用

   名单为空或读取失败时不做限制（fail-open），避免把管理者自己锁在门外。
   ============================================================ */

import * as store from './store.js?v=20261019d'

const SALT = 'life-ledger-invite-v1:'
const CACHE_TTL = 5 * 60 * 1000
const PHONE_KEY = 'ledger.phone.v1'

let cache = { at: 0, ok: false, hashes: new Set(), labels: [] }
let inflight = null

/** 归一化：去掉空格、横线与国际区号，只留数字 */
export function normalizePhone(input) {
  let digits = String(input == null ? '' : input).replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2)
  if (digits.length === 14 && digits.startsWith('086')) digits = digits.slice(3)
  return digits
}

/** 从会话用户对象里取手机号（不同运行时的字段名可能不同） */
export function phoneOfUser(user) {
  if (!user) return ''
  const raw = user.phone || user.phoneNumber || user.phone_number
  return raw ? normalizePhone(raw) : ''
}

/** 手机号 -> 加盐哈希（Web Crypto，仅在安全上下文可用） */
export async function hashPhone(input) {
  const phone = normalizePhone(input)
  if (!phone) return ''
  const subtle = globalThis.crypto && globalThis.crypto.subtle
  if (!subtle) return ''
  const bytes = new TextEncoder().encode(SALT + phone)
  const digest = await subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 拉取名单（5 分钟内走缓存，避免每次登录都请求） */
export async function loadAllowlist({ force = false } = {}) {
  if (!force && cache.ok && Date.now() - cache.at < CACHE_TTL) return cache
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const rows = await store.listAllowlist()
      cache = {
        at: Date.now(),
        ok: true,
        hashes: new Set(rows.map((r) => String(r.phone_hash || '')).filter(Boolean)),
        labels: rows.map((r) => String(r.label || '受邀成员')),
      }
    } catch (err) {
      // 读不到名单时不阻断登录，界面上会提示
      cache = {
        at: Date.now(),
        ok: false,
        hashes: cache.hashes,
        labels: cache.labels,
        failed: true,
      }
    }
    return cache
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/**
 * 校验手机号是否受邀
 * status: invited 在名单内 / blocked 不在名单内 / open 名单为空不限制 / unknown 无法判断
 */
export async function checkInvite(input) {
  const info = await loadAllowlist()
  if (!info.ok) return { status: 'unknown' }
  if (info.hashes.size === 0) return { status: 'open' }
  const hash = await hashPhone(input)
  if (!hash) return { status: 'unknown' }
  return info.hashes.has(hash) ? { status: 'invited' } : { status: 'blocked' }
}

export function allowlistInfo() {
  return { ok: cache.ok, failed: !!cache.failed, count: cache.hashes.size, labels: cache.labels.slice() }
}

/** 记住本次登录所用的手机号，供会话恢复时复核邀请状态 */
export function rememberPhone(input) {
  const phone = normalizePhone(input)
  if (!phone) return
  try {
    localStorage.setItem(PHONE_KEY, phone)
  } catch (err) {
    // 隐私模式等场景写入失败可忽略，下次登录会重新记录
  }
}

export function rememberedPhone() {
  try {
    return normalizePhone(localStorage.getItem(PHONE_KEY) || '')
  } catch (err) {
    return ''
  }
}
