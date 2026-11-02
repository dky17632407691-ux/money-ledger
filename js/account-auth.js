/* 云账号用户名 / 密码规则。浏览器和 Worker 共用，避免两边不一致。 */

export function normalizeUsername(raw) {
  const name = String(raw ?? '').trim().toLowerCase()
  if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(name)) return ''
  return name
}

export function passwordError(raw) {
  if (typeof raw !== 'string') return '密码至少 6 位'
  if (raw.length < 6) return '密码至少 6 位'
  if (raw.length > 128) return '密码太长'
  return ''
}
