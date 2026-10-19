import { cloud } from './cloud.js?v=20261019e'
import * as store from './store.js?v=20261019e'
import {
  state, loadAll, ensureDefaultCategories, setChangeListener, setRenderListener,
  setNavigator, setLogoutHandler, recordTodaySnapshot, activeAccounts,
  netWorthSummary, refreshQuotes, ensureOpeningTrades, openHoldings,
} from './state.js?v=20261019e'
import { PAGES } from './views.js?v=20261019e'
import { reflowCharts } from './charts.js?v=20261019e'
import { openRecordSheet } from './sheets.js?v=20261019e'
import {
  toastOk, toastErr, describeError, setBusy, skeletonCard,
} from './ui.js?v=20261019e'
import { escapeHtml, initialsOf, monthLabel, todayISO, debounce } from './util.js?v=20261019e'
import {
  checkInvite, loadAllowlist, allowlistInfo, phoneOfUser,
  rememberPhone, rememberedPhone,
} from './access.js?v=20261019e'

/* ============================================================
   启动流程
   ============================================================ */

const bootEl = document.getElementById('boot')
const authEl = document.getElementById('auth-view')
const appEl = document.getElementById('app')

const pageEls = {
  dashboard: document.getElementById('page-dashboard'),
  records: document.getElementById('page-records'),
  assets: document.getElementById('page-assets'),
  stats: document.getElementById('page-stats'),
  profile: document.getElementById('page-profile'),
}

const titleEl = document.getElementById('topbar-title')
const subEl = document.getElementById('topbar-sub')

/* ---------------- 视图切换 ---------------- */

function showAuth() {
  bootEl.classList.add('hidden')
  appEl.classList.add('hidden')
  authEl.classList.remove('hidden')
  document.body.style.overflow = ''
}

function showApp() {
  bootEl.classList.add('hidden')
  authEl.classList.add('hidden')
  appEl.classList.remove('hidden')
}

function subtitleOf(page) {
  if (page === 'dashboard') {
    const { netWorth } = netWorthSummary()
    const today = todayISO().replace(/-/g, '/')
    return `${today} · 净资产 ¥${netWorth.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (page === 'records') return monthLabel(state.month)
  if (page === 'stats') return monthLabel(state.statsMonth)
  if (page === 'assets') return `共 ${activeAccounts().length} 个账户`
  return '账号、分类与数据设置'
}

export function renderPage() {
  const page = PAGES[state.page] ? state.page : 'dashboard'
  state.page = page

  Object.entries(pageEls).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== page)
  })
  document.querySelectorAll('.nav__item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.page === page)
  })

  titleEl.textContent = PAGES[page].title
  subEl.textContent = subtitleOf(page)

  // 记一笔按钮在统计 / 我的页意义不大，隐藏悬浮按钮避免遮挡图表
  const fab = document.getElementById('fab')
  if (fab) fab.classList.toggle('is-hidden', page === 'stats' || page === 'profile')

  PAGES[page].render(pageEls[page])
  reflowCharts(pageEls[page])
}

export function navigate(page) {
  if (!PAGES[page]) return
  const changed = state.page !== page
  state.page = page
  renderPage()
  if (changed) window.scrollTo({ top: 0, behavior: 'smooth' })
  if (page === 'assets' || page === 'dashboard') {
    // 节流刷新行情：45 秒内重复进入不会重复请求
    refreshQuotes({ silent: true }).catch(() => { /* 静默失败，界面保留上次价格 */ })
  }
}

function renderLoading() {
  pageEls[state.page].innerHTML = `<div class="grid">${skeletonCard(4)}${skeletonCard(3)}</div>`
}

function renderUserChip() {
  const chip = document.getElementById('user-chip')
  const user = state.user || {}
  const name = user.name || '记账用户'
  const avatar = user.avatarUrl
    ? `<img src="${escapeHtml(user.avatarUrl)}" alt="">`
    : escapeHtml(initialsOf(name))
  chip.innerHTML = `<span class="user-chip__avatar">${avatar}</span><span class="user-chip__name">${escapeHtml(name)}</span>`
}

/* ---------------- 数据加载 ---------------- */

async function reloadData() {
  await loadAll()
  const seeded = await ensureDefaultCategories()
  if (seeded) {
    toastOk('已为你准备好常用收支分类')
  }
}

async function enterApp(user) {
  state.user = user || null
  store.setSessionUser(user || null)

  showApp()
  renderUserChip()
  renderLoading()

  try {
    await reloadData()
  } catch (err) {
    toastErr(describeError(err))
    pageEls[state.page].innerHTML = `<div class="card"><div class="card__body">
      <p style="font-size:13.5px;color:var(--text-2)">数据加载失败：${escapeHtml(describeError(err))}</p>
      <button class="btn btn--primary" style="margin-top:12px" type="button" id="retry-load">重新加载</button>
    </div></div>`
    const retry = document.getElementById('retry-load')
    if (retry) retry.addEventListener('click', () => enterApp(state.user))
    return
  }

  renderPage()

  // 先更新持仓行情再记录快照，保证快照里的市值是当次最新价
  ;(async () => {
    // 上榜名单用于「我的」页展示，顺带刷新邀请制状态
    loadAllowlist().then(() => {
      applyInviteUi()
      if (state.page === 'profile') renderPage()
    }).catch(() => { /* 名单读取失败不影响主流程 */ })

    // 加入买卖功能之前登记的持仓，补一条建仓记录，盈亏与清仓记录才有依据
    await ensureOpeningTrades().catch(() => { /* 补记录失败不影响主流程 */ })

    if (openHoldings().length > 0) {
      await refreshQuotes({ silent: true }).catch(() => { /* 行情失败不影响主流程 */ })
    }
    if (activeAccounts().length > 0) {
      await recordTodaySnapshot().catch(() => { /* 快照失败不影响主流程 */ })
    }
    if (state.page === 'assets' || state.page === 'dashboard') renderPage()
  })()
}

/* ---------------- 登录页 ---------------- */

let pendingOtp = null
let countdownTimer = null

function setAuthMessage(message, ok = false) {
  const el = document.getElementById('auth-message')
  if (!message) {
    el.classList.add('hidden')
    return
  }
  el.textContent = message
  el.classList.toggle('is-ok', ok)
  el.classList.remove('hidden')
}

function setPhoneError(message) {
  const el = document.getElementById('auth-phone-error')
  el.textContent = message || ''
  el.classList.toggle('hidden', !message)
}

function startCountdown(button) {
  let left = 60
  clearInterval(countdownTimer)
  button.disabled = true
  button.textContent = `${left}s 后重发`
  countdownTimer = setInterval(() => {
    left -= 1
    if (left <= 0) {
      clearInterval(countdownTimer)
      button.disabled = false
      button.textContent = '重新获取'
      return
    }
    button.textContent = `${left}s 后重发`
  }, 1000)
}

async function sendPhoneCode() {
  const phoneEl = document.getElementById('auth-phone')
  const phone = phoneEl.value.trim().replace(/\s/g, '')
  if (!/^1\d{10}$/.test(phone)) {
    setPhoneError('请输入正确的 11 位手机号')
    phoneEl.focus()
    return
  }
  setPhoneError('')
  setAuthMessage('')

  // 邀请制第一道闸：不在名单里的手机号连验证码都不发
  // （既不会产生短信费用，也不会给对方任何“可以注册”的暗示）
  const invite = await checkInvite(phone)
  if (invite.status === 'blocked') {
    setAuthMessage('该手机号不在受邀名单内，暂时无法使用本应用。如需加入，请联系管理员。')
    phoneEl.focus()
    return
  }
  if (invite.status === 'unknown') {
    setAuthMessage('受邀名单暂时读取失败，本次未做邀请校验')
  }

  const btn = document.getElementById('auth-send')
  setBusy(btn, true, '发送中…')
  let sent
  try {
    sent = await cloud.auth.sendOtp({ phone })
  } catch (err) {
    setBusy(btn, false)
    setAuthMessage(describeError(err))
    return
  }
  if (sent.error) {
    setBusy(btn, false)
    setAuthMessage(sent.error.message || '验证码发送失败，请稍后重试')
    return
  }
  pendingOtp = {
    phone,
    verificationId: sent.data.verificationId,
    isExistingUser: sent.data.isExistingUser,
  }
  setAuthMessage('验证码已发送，请查看短信', true)
  startCountdown(btn)
  document.getElementById('auth-code').focus()
}

async function submitPhoneLogin() {
  const phoneEl = document.getElementById('auth-phone')
  const codeEl = document.getElementById('auth-code')
  const phone = phoneEl.value.trim().replace(/\s/g, '')
  const code = codeEl.value.trim()

  if (!/^1\d{10}$/.test(phone)) {
    setPhoneError('请输入正确的 11 位手机号')
    return
  }
  setPhoneError('')
  if (!pendingOtp || pendingOtp.phone !== phone) {
    setAuthMessage('请先获取当前手机号的验证码')
    return
  }
  if (!code) {
    setAuthMessage('请输入收到的验证码')
    codeEl.focus()
    return
  }

  const btn = document.getElementById('auth-submit')
  setBusy(btn, true, '登录中…')
  setAuthMessage('')
  let done
  try {
    done = await cloud.auth.verifyOtp({
      phone: pendingOtp.phone,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: code,
    })
  } catch (err) {
    setBusy(btn, false)
    setAuthMessage(describeError(err))
    return
  }
  setBusy(btn, false)

  if (done.error) {
    setAuthMessage(done.error.message || '验证码校验失败，请重新输入')
    return
  }

  // 邀请制第二道闸：名单可能在发送验证码之后被调整过，登录前再核一次
  const invite = await checkInvite(pendingOtp.phone)
  if (invite.status === 'blocked') {
    clearInterval(countdownTimer)
    pendingOtp = null
    try {
      await cloud.auth.signOut()
    } catch (err) {
      // 退出失败也不能放行，下面直接留在登录页
    }
    setAuthMessage('该手机号不在受邀名单内，已自动退出。如需加入，请联系管理员。')
    return
  }

  rememberPhone(pendingOtp.phone)
  pendingOtp = null
  clearInterval(countdownTimer)
  const user = done.data && done.data.user ? done.data.user : null
  await enterApp(user)
}

/* ---------------- 邀请制界面状态 ---------------- */

/** 名单生效中（名单非空且已成功读到） */
function inviteLocked() {
  const info = allowlistInfo()
  return info.ok && info.count > 0
}

/** 邀请制生效时禁用微信登录：它拿不到手机号，无法做名单校验 */
function applyInviteUi() {
  const locked = inviteLocked()
  const btn = document.getElementById('auth-wechat')
  if (btn) {
    btn.disabled = locked
    btn.title = locked ? '当前为邀请制，请使用受邀手机号登录' : ''
  }
  const note = document.getElementById('auth-invite-note')
  if (note) note.classList.toggle('hidden', !locked)
}

async function startWechatLogin() {
  const btn = document.getElementById('auth-wechat')
  if (inviteLocked()) {
    setAuthMessage('当前为邀请制，请使用受邀手机号登录。')
    return
  }
  setBusy(btn, true, '正在跳转…')
  setAuthMessage('')
  let res
  try {
    res = await cloud.auth.signInWithOAuth({ provider: 'wechat', redirectTo: location.origin })
  } catch (err) {
    setBusy(btn, false)
    setAuthMessage(describeError(err))
    return
  }
  if (res.error) {
    setBusy(btn, false)
    setAuthMessage(res.error.message || '微信登录暂时不可用，请使用手机号验证码登录')
    return
  }
  location.assign(res.data.url)
}

function bindAuthEvents() {
  document.getElementById('auth-phone').addEventListener('input', () => setPhoneError(''))
  document.getElementById('auth-send').addEventListener('click', sendPhoneCode)
  document.getElementById('auth-wechat').addEventListener('click', startWechatLogin)
  document.getElementById('auth-form').addEventListener('submit', (e) => {
    e.preventDefault()
    submitPhoneLogin()
  })
  document.getElementById('auth-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitPhoneLogin()
    }
  })
}

/* ---------------- 登出 ---------------- */

async function doLogout() {
  try {
    await cloud.auth.signOut()
  } catch (err) {
    // 登出失败也回到登录页
  }
  state.user = null
  store.setSessionUser(null)
  state.accounts = []
  state.categories = []
  state.transactions = []
  state.holdings = []
  state.trades = []
  state.snapshots = []
  state.showClosed = false
  state.chartRange = '3m'
  state.loaded = false
  state.page = 'dashboard'
  showAuth()
  setAuthMessage('')
  document.getElementById('auth-code').value = ''
}

/* ---------------- 启动 ---------------- */

/** 微信 / WorkBuddy 授权回调必须在校验登录态之前处理 */
async function handleOAuthCallbackIfAny() {
  const url = new URL(location.href)
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) return false

  const provider = url.searchParams.get('provider')
  if (provider !== 'workbuddy' && provider !== 'wechat') {
    showAuth()
    setAuthMessage('授权回调缺少有效的登录方式，请重新登录。')
    return true
  }
  const handler = provider === 'workbuddy'
    ? cloud.auth.handleWorkBuddyCallback
    : cloud.auth.handleWechatWebCallback
  if (typeof handler !== 'function') {
    showAuth()
    setAuthMessage('暂时无法使用该方式登录，请改用手机号验证码登录。')
    return true
  }

  let result
  try {
    result = await handler.call(cloud.auth)
  } catch (err) {
    showAuth()
    setAuthMessage(describeError(err))
    return true
  }

  const session = result && result.data
  const error = result && result.error
  if (error) {
    showAuth()
    setAuthMessage(error.message || '授权登录失败，请重新登录')
    return true
  }
  if (session) {
    for (const key of ['code', 'state', 'provider']) url.searchParams.delete(key)
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    await enterApp(session.user || null)
    return true
  }
  return false
}

async function continueNormalStartup() {
  let res
  try {
    res = await cloud.auth.getSession()
  } catch (err) {
    showAuth()
    setAuthMessage(describeError(err))
    return
  }
  const session = res && res.data
  if (res && res.error) {
    showAuth()
    return
  }
  if (!session) {
    showAuth()
    return
  }

  // 邀请制第三道闸：老会话同样复核，名单变更后原登录态不再有效
  const user = session.user || null
  const resolvedPhone = phoneOfUser(user) || rememberedPhone()
  if (!resolvedPhone && inviteLocked()) {
    // 拿不到手机号就无法判断是否受邀 —— 不放行，要求重新登录
    try {
      await cloud.auth.signOut()
    } catch (err) {
      // 退出失败也不能放行
    }
    showAuth()
    setAuthMessage('需要重新确认受邀身份，请用受邀手机号重新登录。')
    return
  }
  const invite = await checkInvite(resolvedPhone)
  if (invite.status === 'blocked') {
    try {
      await cloud.auth.signOut()
    } catch (err) {
      // 退出失败也不能放行
    }
    showAuth()
    setAuthMessage('当前账号不在受邀名单内，已自动退出。如需加入，请联系管理员。')
    return
  }
  await enterApp(user)
}

function bindGlobalEvents() {
  document.querySelectorAll('.nav__item').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.page))
  })
  document.getElementById('btn-add').addEventListener('click', () => openRecordSheet())
  document.getElementById('fab').addEventListener('click', () => openRecordSheet())

  const onResize = debounce(() => reflowCharts(pageEls[state.page]), 180)
  window.addEventListener('resize', onResize)

  cloud.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !appEl.classList.contains('hidden')) {
      showAuth()
    }
  })
}

async function bootstrap() {
  setChangeListener(async () => {
    try {
      await loadAll()
      renderPage()
    } catch (err) {
      toastErr(describeError(err))
    }
  })
  setRenderListener(renderPage)
  setNavigator(navigate)
  setLogoutHandler(doLogout)

  bindAuthEvents()
  bindGlobalEvents()

  // 提前拉一次受邀名单：决定微信登录是否放行，并在登录页给出明确提示
  loadAllowlist().then(applyInviteUi).catch(() => { /* 读不到时不阻断登录 */ })

  try {
    const handled = await handleOAuthCallbackIfAny()
    if (!handled) await continueNormalStartup()
  } catch (err) {
    showAuth()
    setAuthMessage(describeError(err))
  }
}

bootstrap()

// 导出给调试用
window.__ledger = { state, renderPage, navigate }
