import { PUBLIC_CONFIG } from './config.js?v=202610192325'

/**
 * 云服务客户端：全应用只初始化一次，Auth / Database / Storage / LLM 共用同一实例。
 * endpoint、publishableKey 必传；Web 端还需要 oauthRelayBaseUrl（微信登录用）。
 *
 * 注意：这里用懒初始化 + Proxy 转发，而不是在模块顶层直接 createClient()。
 * 顶层初始化一旦失败（例如 SDK 脚本没加载到），整个模块图会崩掉，
 * 启动遮罩就永远停住，页面看起来是一片空白。改成懒加载后，
 * 失败会落到具体的调用点，能被上层 try/catch 捕获并给出提示。
 */
let client = null

function getClient() {
  if (client) return client
  const sdk = window.WorkBuddyCloud
  if (!sdk || typeof sdk.createWorkBuddyCloud !== 'function') {
    throw new Error('云服务 SDK 未能加载，请检查网络后刷新页面重试。')
  }
  client = sdk.createWorkBuddyCloud({
    endpoint: PUBLIC_CONFIG.endpoint,
    oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
    publishableKey: PUBLIC_CONFIG.publishableKey,
  })
  return client
}

export const cloud = new Proxy({}, {
  get(_target, prop) {
    const instance = getClient()
    const value = instance[prop]
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

