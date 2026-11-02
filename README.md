# 生活记账本

静态页面，部署在 GitHub Pages。账本先写在浏览器 `localStorage`（本机缓存）。要用手机无痕 / 私人浏览长期打开同一本账，请用 **用户名 + 密码** 登录云账号：关掉标签后缓存会消失，重新输入同一组账号密码即可从云端拉回。

- **版本 / BUILD**：`202611022353`
- **站点**：https://dky17632407691-ux.github.io/money-ledger/
- **云端 API**：https://money-ledger-api.dky17632407691.workers.dev （写在 `js/cloud-config.js` 的 `DEFAULT_API_BASE`，无末尾斜杠）

GitHub Gist 同步还留在「我的 → 高级」，给原来已经用令牌的人。无痕模式请用云账号，不要靠把 PAT 存在 localStorage。

## 用户怎么用

1. 在**已经有账**的电脑上打开站点 → **我的** → **注册**。自己定一个用户名和密码（至少 6 位，建议更长）。没有邮箱找回，忘掉就打不开云端账。云端地址已经写在页面里，私人浏览不用再填。
2. 看到「已同步」后，用手机 Safari **私人浏览**打开同一个网址。
3. **我的** → **登录**，输入同一个用户名和密码。账本会从云端下来。
4. 私人窗口关掉之后，本机不留密码。下次打开，再登录一次即可。

普通浏览可以勾选「在这台设备记住登录」。那只记住会话令牌，不记住密码；清网站数据或换无痕窗口后，仍然要重新输入密码。

多台设备同时改账时，**整本账**以 `meta.updated_at` 较新的一份为准，相同再比 `meta.revision`。空白的新账本不会盖掉云端已有数据。

## 部署 Cloudflare Worker（免费）

Worker 已经在跑：https://money-ledger-api.dky17632407691.workers.dev 。D1 id 写在 `worker/wrangler.toml`（`5d20c700-ce31-41c7-90f5-9bc67302c940`）。改页面默认地址不用重新部署 Worker。

以后如果改了 `worker/` 里的代码，再用已有的库发布，不要新建数据库：

```bash
cd worker
npx wrangler login
npx wrangler d1 migrations apply money-ledger --remote
npx wrangler deploy
```

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
