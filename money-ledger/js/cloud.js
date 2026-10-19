import { PUBLIC_CONFIG } from './config.js?v=20261019e'

/**
 * 云服务客户端：全应用只初始化一次，Auth / Database / Storage / LLM 共用同一实例。
 * endpoint、publishableKey 必传；Web 端还需要 oauthRelayBaseUrl（微信登录用）。
 */
function createClient() {
  const sdk = window.WorkBuddyCloud
  if (!sdk || typeof sdk.createWorkBuddyCloud !== 'function') {
    throw new Error('云服务 SDK 未能加载，请检查网络连接后刷新页面重试。')
  }
  return sdk.createWorkBuddyCloud({
    endpoint: PUBLIC_CONFIG.endpoint,
    oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
    publishableKey: PUBLIC_CONFIG.publishableKey,
  })
}

export const cloud = createClient()
