# 生活记账本

纯前端静态应用，部署在 GitHub Pages。账本默认写在浏览器 `localStorage`，不登录也能完整使用。登录后通过 **GitHub 私人 Gist** 在手机和电脑之间同步同一本账。

- **版本 / BUILD**：`202611011430`
- **站点**：https://dky17632407691-ux.github.io/money-ledger/

## 云同步

同步密钥是一个只含 `gist` 权限的 GitHub 个人访问令牌（Personal Access Token）。令牌只存在本机 `localStorage` 键 `ledger.sync.v1`，不会写入账本 JSON、Gist 文件或这个仓库。请不要把令牌发给别人：拿到令牌的人可以读写你账号下的 Gist。

云端是一个 **secret gist**，描述固定为 `money-ledger-cloud-v1`，里面只有 `money-ledger.json`。Gist id 会记在本机，并写进账本的 `meta.cloud.gist_id`，方便另一台设备用同一个令牌找到它。

### 创建令牌

1. 打开 [生成经典令牌（已勾选 gist）](https://github.com/settings/tokens/new?scopes=gist&description=money-ledger-cloud)。
2. Note 可填 `money-ledger-cloud`。Expiration 按你自己的习惯选。**只勾选 `gist`**，不要勾选 `repo` 或其他权限。
3. 生成后立刻复制（GitHub 只显示一次）。形如 `ghp_…`。
4. 细粒度令牌也可以：在 [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new) 里把账户权限 **Gists** 设为 Read and write。令牌形如 `github_pat_…`。

### 在这台设备登录

打开站点 → **我的** → 把令牌贴进「云同步」→ **登录并同步**。状态会显示：已同步 / 同步中 / 离线 / 同步失败。

### 在第二台设备恢复同一本账

1. 先在**已经有账**的那台设备登录，确认状态为「已同步」。
2. 在手机或另一台电脑打开 https://dky17632407691-ux.github.io/money-ledger/ 。
3. 进入 **我的**，粘贴**同一个令牌**，点登录并同步。
4. 账本会从云端拉下来。之后两边记账都会在约 1 秒后上传。

### 离线

断网时照常记账，数据先写入本机 `localStorage`（`ledger.standalone.v1`）。状态显示「离线」。恢复联网后会自动上传；也可以点「立即同步」。

### 冲突（最后写入获胜）

两边同时改账时，**整本账**以 `meta.updated_at` 较新的一份为准；时间相同再比 `meta.revision`。不会按单笔流水合并。

还没记过账的空白账本（`meta.pristine`）不会因为本机时钟更新而盖掉云端已有数据。请先在有数据的设备登录，再在新设备登录。

行情刷新只更新本机缓存，不单独推进云端版本，避免一次刷新把另一台设备刚记的账盖掉。

## 功能

- 日常收支（收入 / 支出 / 转账）
- 持仓资产（A股 / 港股 / 美股），腾讯公开行情
- 今日盈亏（行情时间带完整年份，如 `2026-10-30 16:14`）
- 分类管理（新增分类弹窗正确关闭）
- 账户管理、导入 / 导出 JSON 备份
- 可选的 GitHub Gist 云同步（未登录时仍是纯本地）

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

- 无邀请白名单、无自建后端（同步直接请求 `api.github.com`）
- 无货币基金自动申赎、香港退休基金净值同步、场外基金专项
- 无资产日快照走势图、资产日历 K 线回算、财务目标
- 图表仅简单支出条形占比
- 删交易不会联动复杂货基冲销（本版无货基模块）
