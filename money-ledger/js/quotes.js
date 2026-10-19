import { toNumber } from './util.js?v=20261019i'

/* ============================================================
   行情数据模块
   ------------------------------------------------------------
   数据源：腾讯财经公开行情接口 qt.gtimg.cn
   覆盖：沪市 / 深市（含场内 ETF、LOF）/ 港股 / 美股 / 场外基金
   该接口返回 GBK 编码的 JS 赋值文本，并带 Access-Control-Allow-Origin: *
   因此可在浏览器端直接跨域拉取，无需服务端代理。
   ============================================================ */

const QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q='
const REQUEST_TIMEOUT = 9000

/** 行情市场（对应接口的代码前缀） */
export const MARKETS = {
  sh: { label: '沪市' },
  sz: { label: '深市' },
  hk: { label: '港股' },
  us: { label: '美股' },
  jj: { label: '场外基金' },
}

/** 表单里让用户选择的市场大类 */
export const MARKET_GROUPS = [
  { value: 'a', label: 'A股 / 场内基金', hint: '如 600519、000001、510300' },
  { value: 'hk', label: '港股', hint: '如 00700' },
  { value: 'us', label: '美股', hint: '如 AAPL' },
  { value: 'jj', label: '场外基金', hint: '如 000001（开放式基金净值）' },
]

export function marketLabel(market) {
  return (MARKETS[market] || {}).label || market
}

/* ---------------- 币种与汇率 ---------------- */

/** 各市场的计价币种：沪/深/场外基金为人民币，港股港币，美股美元 */
export function currencyOf(market) {
  if (market === 'hk') return 'HKD'
  if (market === 'us') return 'USD'
  return 'CNY'
}

export const CURRENCY_LABEL = { CNY: '人民币', HKD: '港币', USD: '美元' }
export const CURRENCY_SYMBOL = { CNY: '¥', HKD: 'HK$', USD: 'US$' }

/** 需要折算的外币（CNY 恒为 1，不请求） */
const FX_SYMBOLS = { USD: 'whUSDCNY', HKD: 'whHKDCNY' }

/**
 * 取外币兑人民币汇率。
 * 与股票行情同一接口、同一套跨域策略，返回 [3] 为 1 外币 = N 人民币。
 * @returns {Promise<{rates: Record<string, number>, at: string}>}
 */
export async function fetchFxRates() {
  const keys = Object.values(FX_SYMBOLS)
  const text = await requestQuoteText(QUOTE_ENDPOINT + keys.join(','))
  const rates = {}
  let stamp = ''
  for (const [currency, key] of Object.entries(FX_SYMBOLS)) {
    const m = text.match(new RegExp(`v_${key}="([^"]*)"`))
    if (!m) continue
    const f = m[1].split('~')
    const rate = toNumber(f[3])
    if (rate > 0) {
      rates[currency] = rate
      if (!stamp && f[5]) stamp = formatQuoteTime(f[5])
    }
  }
  if (!Object.keys(rates).length) throw new Error('汇率服务未返回有效数据')
  return { rates, at: stamp || formatQuoteTime('') }
}


/** 由行情市场前缀反推表单里的大类 */
export function groupOfMarket(market) {
  if (market === 'hk') return 'hk'
  if (market === 'us') return 'us'
  if (market === 'jj') return 'jj'
  return 'a'
}

/* ---------------- 代码规范化 ---------------- */

/** 判断 A 股代码归属的交易所：沪市 / 深市 */
export function guessExchange(code) {
  const c = String(code || '').trim().toLowerCase().replace(/^(sh|sz)/, '')
  if (!c) return 'sh'
  if (/^[569]/.test(c)) return 'sh'
  if (/^[0-4]/.test(c)) return 'sz'
  return 'sh'
}

/** 把用户输入的代码整理成接口需要的 symbol */
export function normalizeSymbol(group, input) {
  let s = String(input || '').trim()
  if (!s) return ''
  if (group === 'us') return s.toUpperCase().replace(/\.(OQ|N|O|AM|PK|NASDAQ|NYSE)$/i, '')
  s = s.replace(/\s+/g, '').toLowerCase()
  s = s.replace(/\.(sh|ss|sz|hk|us|of)$/, '')
  s = s.replace(/^(sh|sz|hk|us|jj)/, '')
  if (group === 'hk') return s.padStart(5, '0')
  return s.padStart(6, '0')
}

/** 表单大类 + 代码 → 接口前缀 */
export function marketOf(group, symbol) {
  if (group === 'hk') return 'hk'
  if (group === 'us') return 'us'
  if (group === 'jj') return 'jj'
  return guessExchange(symbol)
}

/** 展示用的完整代码，如 sh600519 / hk00700 / usAAPL */
export function displayCode(market, symbol) {
  if (market === 'us') return symbol
  if (market === 'hk') return symbol
  if (market === 'jj') return symbol
  return `${market}${symbol}`
}

/* ---------------- 编码 / 时间 ---------------- */

function decodeText(buffer) {
  for (const encoding of ['gb18030', 'gbk']) {
    try {
      return new TextDecoder(encoding).decode(buffer)
    } catch (err) {
      // 该浏览器不支持此编码，继续尝试下一个
    }
  }
  // 兜底：数字与分隔符都是 ASCII，中文名会有乱码但价格仍可解析
  return new TextDecoder('utf-8').decode(buffer)
}

/** 把行情原始时间整理成 `YYYY-MM-DD HH:mm` */
export function formatQuoteTime(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  let m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (m) return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`
  m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
  m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return s
}

/* ---------------- 解析 ---------------- */

function round4(n) {
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null
}

function parseQuote(key, raw) {
  const f = String(raw).split('~')
  if (f.length < 9) return null

  // 场外基金：代码~名称~0~0~~单位净值~累计净值~日涨跌幅%~净值日期
  if (key.startsWith('jj')) {
    const price = toNumber(f[5])
    if (!price) return null
    const changePct = toNumber(f[7])
    const ratio = 1 + changePct / 100
    return {
      market: 'jj',
      symbol: f[0],
      name: f[1] || '',
      price,
      prevClose: ratio !== 0 ? round4(price / ratio) : null,
      changePct,
      rawTime: f[8] || '',
    }
  }

  // 股票 / 场内基金：…~名称~代码~当前价~昨收~今开~…~时间~涨跌额~涨跌幅%~最高~最低
  const price = toNumber(f[3])
  if (!price) return null
  return {
    market: key.slice(0, 2),
    symbol: f[2],
    name: f[1] || '',
    price,
    prevClose: toNumber(f[4]) || null,
    changePct: toNumber(f[32]),
    rawTime: f[30] || '',
  }
}

/* ---------------- 请求 ---------------- */

async function requestQuoteText(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`行情服务返回 ${res.status}`)
    return decodeText(await res.arrayBuffer())
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('行情服务响应超时，请稍后重试')
    throw new Error('无法连接行情服务，请检查网络后重试')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 批量查询行情。
 * @param {Array<{market: string, symbol: string}>} items
 * @returns {Promise<{quotes: Array, failed: Array, fetchedAt: number}>}
 */
export async function fetchQuotes(items) {
  const uniq = new Map()
  for (const it of items || []) {
    if (!it || !it.market || !it.symbol) continue
    const key = `${it.market}${it.symbol}`
    if (!uniq.has(key)) uniq.set(key, it)
  }
  const keys = Array.from(uniq.keys())
  if (!keys.length) return { quotes: [], failed: [], fetchedAt: Date.now() }

  const text = await requestQuoteText(QUOTE_ENDPOINT + keys.join(','))

  const found = new Map()
  const re = /v_([a-zA-Z]{2})([^=~"]*)="([^"]*)"/g
  let m
  while ((m = re.exec(text)) !== null) {
    const key = `${m[1]}${m[2]}`
    const quote = parseQuote(key, m[3])
    if (quote) found.set(key, quote)
  }

  const quotes = []
  const failed = []
  for (const key of keys) {
    const hit = found.get(key)
    if (hit) {
      // symbol 一律沿用请求时规范化过的值，避免美股返回 AAPL.OQ 之类的后缀污染回写
      const { rawTime, ...rest } = hit
      quotes.push({
        ...rest,
        symbol: uniq.get(key).symbol,
        priceTime: formatQuoteTime(rawTime),
      })
    } else {
      failed.push({ key, symbol: uniq.get(key).symbol, reason: '没有查到该代码的行情' })
    }
  }
  return { quotes, failed, fetchedAt: Date.now() }
}

/**
 * 查询单个标的，用于表单里输入代码后自动补全名称与现价。
 * @returns {Promise<{market: string, symbol: string, name: string, price: number}>}
 */
export async function lookupSymbol(group, input) {
  const symbol = normalizeSymbol(group, input)
  if (!symbol) throw new Error('请先填写代码')
  const market = marketOf(group, symbol)
  const { quotes } = await fetchQuotes([{ market, symbol }])
  if (!quotes.length) throw new Error('没有查到该代码，请检查市场类型与代码是否正确')
  return quotes[0]
}
