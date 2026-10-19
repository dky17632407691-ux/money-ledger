// 统一给前端资源打版本号：index.html 的入口 + 所有内部 import 的 ?v=
//
// 为什么需要：浏览器按「完整 URL」缓存 ES 模块。index.html 里只给 app.js 打了 ?v=，
// app.js 里 `import './sheets.js'` 解析出来的仍是 js/sheets.js（不带版本），
// 手机上就会继续用旧模块 —— 表现是「改了但页面没变」。
//
// 用法（在项目根目录）：
//   node tools/stamp-version.mjs          # 用当前时间生成版本号
//   node tools/stamp-version.mjs 20261020a # 指定版本号
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const jsDir = path.join(root, 'js')

function defaultVersion() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`
}

const version = process.argv[2] || defaultVersion()
let changed = 0

for (const name of fs.readdirSync(jsDir)) {
  if (!name.endsWith('.js')) continue
  const file = path.join(jsDir, name)
  const src = fs.readFileSync(file, 'utf8')
  // 先剥掉旧版本再统一打新版本，保证多次执行结果稳定（幂等）
  const next = src.replace(
    /from\s+'(\.\/[A-Za-z0-9_-]+\.js)(\?v=[^']*)?'/g,
    (_m, spec) => `from '${spec}?v=${version}'`,
  )
  if (next !== src) {
    fs.writeFileSync(file, next)
    changed += 1
  }
}

const indexPath = path.join(root, 'index.html')
const html = fs.readFileSync(indexPath, 'utf8')
const nextHtml = html
  .replace(/(href="styles\.css)(\?v=[^"]*)?"/, (_m, head) => `${head}?v=${version}"`)
  .replace(/(src="js\/app\.js)(\?v=[^"]*)?"/, (_m, head) => `${head}?v=${version}"`)
  .replace(/(href="js\/[A-Za-z0-9_-]+\.js)(\?v=[^"]*)?"/g, (_m, head) => `${head}?v=${version}"`)
if (nextHtml !== html) {
  fs.writeFileSync(indexPath, nextHtml)
  changed += 1
}

console.log(`版本号 ${version}，更新 ${changed} 个文件`)
