# 生活记账本

静态页面，部署在 GitHub Pages。账本先写在浏览器 `localStorage`（本机缓存）。要用手机无痕 / 私人浏览长期打开同一本账，请用 **用户名 + 密码** 登录云账号：关掉标签后缓存会消失，重新输入同一组账号密码即可从云端拉回。

- **版本 / BUILD**：`202611020430`
- **站点**：https://dky17632407691-ux.github.io/money-ledger/
- **云端 API**：还没有公网地址。页面默认读 `js/cloud-config.js` 里的 `DEFAULT_API_BASE`（当前为空）。部署下面的 Worker 后，把打印出来的 `*.workers.dev` 地址填进去。

GitHub Gist 同步还留在「我的 → 高级」，给原来已经用令牌的人。无痕模式请用云账号，不要靠把 PAT 存在 localStorage。

## 用户怎么用

1. 先按下面的步骤部署一次 Cloudflare Worker，并把地址写进 `js/cloud-config.js`，推到 `main`。这一步只做一次。
2. 在**已经有账**的电脑上打开站点 → **我的** → **注册**。自己定一个用户名和密码（至少 6 位，建议更长）。没有邮箱找回，忘掉就打不开云端账。
3. 看到「已同步」后，用手机 Safari **私人浏览**打开同一个网址。
4. **我的** → **登录**，输入同一个用户名和密码。账本会从云端下来。
5. 私人窗口关掉之后，本机不留密码。下次打开，再登录一次即可。

普通浏览可以勾选「在这台设备记住登录」。那只记住会话令牌，不记住密码；清网站数据或换无痕窗口后，仍然要重新输入密码。

多台设备同时改账时，**整本账**以 `meta.updated_at` 较新的一份为准，相同再比 `meta.revision`。空白的新账本不会盖掉云端已有数据。

## 部署 Cloudflare Worker（免费）

仓库里的 `worker/` 是 Workers + D1。当前环境没有 Cloudflare 账号，所以没有替你创建或部署。需要你自己有一个免费的 Cloudflare 账号（不用绑信用卡）。

```bash
cd worker
npx wrangler login
npx wrangler d1 create money-ledger
```

把命令打印的 `database_id` 填进 `worker/wrangler.toml` 的 `database_id`（替换全 0 的占位符）。然后：

```bash
npx wrangler d1 migrations apply money-ledger --remote
npx wrangler deploy
```

`deploy` 会打印类似 `https://money-ledger-api.<你的子域>.workers.dev` 的地址。把这个地址（不要末尾斜杠）写进 `js/cloud-config.js`：

```js
export const DEFAULT_API_BASE = 'https://money-ledger-api.<你的子域>.workers.dev'
```

提交并推到 `main` 后，GitHub Pages 会更新。私人浏览不依赖 localStorage，所以地址必须写在这个文件里，不要只在页面上临时保存。

页面上的「服务器地址」可以临时指向别的 Worker，方便你还没改代码时试一次。无痕窗口关掉后这个临时地址会丢。

本机试 API（内存，重启就没了）：

```bash
node worker/dev-server.mjs
python -m http.server 8000
```

浏览器打开 `http://127.0.0.1:8000/?api=http://127.0.0.1:8787` 。

不需要把任何密码、令牌或 `wrangler` 登录态提交到仓库。`database_id` 不是密钥，可以留在 `wrangler.toml`。

免费版 Worker 每次请求大约只有 10ms CPU，密码用 PBKDF2-SHA256、8000 次。请把密码设长一点。升级到 Workers Paid 后，可以把 `worker/src/index.js` 里的 `ITERATIONS` 调高（最高 20000，再高要改校验范围）；已经注册的账号仍按注册时的次数校验。

接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/v1/register` | `{ username, password }` → `{ token, username, expires_at }` |
| POST | `/v1/login` | 同上。用户名不区分大小写 |
| POST | `/v1/logout` | `Authorization: Bearer <token>` |
| GET | `/v1/ledger` | 拉整本账。还没有则 404 |
| PUT | `/v1/ledger` | `{ ledger }`。更旧的一份返回 409 和云端账本 |
| GET | `/v1/health` | `{ ok: true }` |

会话大约 30 天。浏览器把令牌放在内存和 `sessionStorage`（同一标签刷新还在）。主路径不靠 cookie，也不靠关掉无痕窗口后还在的 localStorage。

## 原来的 Gist 账本

如果账还在 GitHub Gist 里：用还能看到账的那台设备打开站点，先注册云账号，再在「高级：GitHub Gist」粘贴原来的令牌，点「从 Gist 导入」。导入后的账会按时间与云账号合并。之后手机无痕只用用户名和密码。

Gist 令牌仍然只放在本机 `ledger.sync.v1`，不会写进账本 JSON。创建方式见 [只勾选 gist 的经典令牌](https://github.com/settings/tokens/new?scopes=gist&description=money-ledger-cloud)。已登录云账号时，Gist 不会自动上传。

## 离线

断网时照常记账，先写入本机 `localStorage`（`ledger.standalone.v1`）。状态显示「离线」。恢复联网后大约 1 秒会自动上传；也可以点「立即同步」。关页时会尽量再送一次。

行情刷新只更新本机缓存，不单独推进云端版本。

## 功能

- 日常收支（收入 / 支出 / 转账）
- 持仓资产（A股 / 港股 / 美股），腾讯公开行情
- 今日盈亏（行情时间带完整年份，如 `2026-10-30 16:14`）
- 分类管理、账户管理、导入 / 导出 JSON 备份
- 云账号同步（用户名 + 密码）
- 可选的 GitHub Gist 同步

## 本地打开

ES Module 不能可靠地用 `file://` 双击打开。请用任意静态服务器：

```bash
python -m http.server 8000
```

浏览器打开 http://localhost:8000/

Windows 也可双击 `start.bat`。

## GitHub Pages

仓库根目录即站点根（`index.html`）。资源均为相对路径。Pages 使用 `main` 分支 / root。根目录保留空文件 `.nojekyll`。

## 相对原版的简化

- 无邀请白名单、无邮箱找回密码
- 无货币基金自动申赎、香港退休基金净值同步、场外基金专项
- 无资产日快照走势图、资产日历 K 线回算、财务目标
- 图表仅简单支出条形占比
- 删交易不会联动复杂货基冲销（本版无货基模块）
