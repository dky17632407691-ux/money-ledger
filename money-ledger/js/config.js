/**
 * 云服务公开配置（publicConfig）
 * 由云服务开通时下发，是唯一可以放进前端的云端配置。
 * publishableKey 只标识"是哪个应用"，本身不携带任何权限；
 * endpoint 必须在客户端初始化时传入，不能硬编码到别处或从 location 推断。
 */
export const PUBLIC_CONFIG = {
  resourceId: 'wbcs_3MQIbAy3H4rz4J15A9y7Ro',
  endpoint: 'https://life-ledger-62150.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_RVZ3hgyNOgb5pzjqZUuab7_hjRpSzGVWCzSuonUknLDabLdCOWJZI8u',
}
