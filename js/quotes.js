/* 腾讯公开行情（独立实现，行情时间必须保留年份） */

import { toNumber } from './util.js'

const QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q='
const REQUEST_TIMEOUT = 9000

export const MARKET_GROUPS = [
  { value: 'a', label: 'A股 / 场内基金', hint: '如 600519、000001、510300' },
  { value: 'hk', label: '港股', hint: '如 00700' },
  { value: 'us', label: '美股', hint: '如 AAPL' },
]

export function currencyOf(market) {
  if (market === 'hk') return 'HKD'
  if (market === 'us') return 'USD'
  return 'CNY'
}

export const CURRENCY_SYMBOL = { CNY: '¥', HKD: 'HK$', USD: 'US$' }

const FX_SYMBOLS = { USD: 'whUSDCNY', HKD: 'whHKDCNY' }

export function guessExchange(code) {
  const c = String(code || '').trim().toLowerCase().replace(/^(sh|sz|bj)/, '')
  if (!c) return 'sh'
  if (/^[569]/.test(c)) return 'sh'
  if (/^[0-4]/.test(c)) return 'sz'
  return 'sh'
}

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

export function marketOf(group, symbol) {
  if (group === 'hk') return 'hk'
  if (group === 'us') return 'us'
  return guessExchange(symbol)
}

export function displayCode(market, symbol) {
  if (market === 'us' || market === 'hk') return symbol
  return `${market}${symbol}`
}

export function marketLabel(market) {
  if (market === 'sh' || market === 'sz' || market === 'bj') return 'A股'
  if (market === 'hk') return '港股'
  if (market === 'us') return '美股'
  return market
}

/**
 * 把行情原始时间整理成 `YYYY-MM-DD HH:mm`
 * A股腾讯返回如 20261030161455 —— 必须保留年份，否则今日盈亏无法判断「今天」
 */
export function formatQuoteTime(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  let m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
  m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
  m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // 故意不把「只有月日时分」的残缺时间伪造成今天，避免误判今日盈亏
  return s
}

function decodeText(buffer) {
  for (const encoding of ['gb18030', 'gbk']) {
    try {
      return new TextDecoder(encoding).decode(buffer)
    } catch (_) {}
  }
  return new TextDecoder('utf-8').decode(buffer)
}

function round4(n) {
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null
}

function parseQuote(key, raw) {
  const f = String(raw).split('~')
  if (f.length < 9) return null
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
    if (err && err.name === 'AbortError') throw new Error('行情服务响应超时')
    throw new Error('无法连接行情服务，请检查网络')
  } finally {
    clearTimeout(timer)
  }
}

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

export async function lookupSymbol(group, input) {
  const symbol = normalizeSymbol(group, input)
  if (!symbol) throw new Error('请先填写代码')
  const market = marketOf(group, symbol)
  const { quotes } = await fetchQuotes([{ market, symbol }])
  if (!quotes.length) throw new Error('没有查到该代码，请检查市场与代码')
  return quotes[0]
}
