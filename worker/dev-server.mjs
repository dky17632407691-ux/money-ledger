/* 本机调试用的内存版 API，不写磁盘。正式环境用 wrangler deploy。 */
import { createServer } from 'node:http'
import { createMemoryStore, handleRequest } from './src/index.js'

const port = Number(process.env.PORT || 8787)
const store = createMemoryStore()

function toHeaders(raw) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(raw || {})) {
    if (value == null) continue
    const lower = key.toLowerCase()
    if (['connection', 'transfer-encoding', 'keep-alive', 'content-length', 'host'].includes(lower)) continue
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
    else headers.set(key, String(value))
  }
  return headers
}

const server = createServer(async (req, res) => {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: toHeaders(req.headers),
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    })
    const response = await handleRequest(request, store)
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (err) {
    console.error(err)
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('dev server error')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`money-ledger api http://127.0.0.1:${port}`)
})
