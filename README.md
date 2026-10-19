# 我要攒钱

个人记账 + 资产跟踪的网页应用。纯静态前端，无私服；数据存在 WorkBuddy Cloud 云数据库里，多设备登录同一账号即可看到同一份账。

- 线上地址：https://2111995074905313280.app.workbuddy.host/
- 源码目录：`money-ledger/`（`index.html` + `styles.css` + `js/*.js`，ES modules）
- 数据库：WorkBuddy Cloud（`js/config.js` 里配 endpoint / publishableKey，权限由 RLS 控制）

---

## 换到一台新电脑：只做三步

**1. 装两样东西**：WorkBuddy 桌面端（用同一个账号登录）、Git。

**2. 配 GitHub 密钥**（每台电脑一把，互不影响）：

```bash
ssh-keygen -t ed25519 -C "workbuddy-pc" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

把输出那一整行粘贴到 https://github.com/settings/ssh/new ，然后验证：

```bash
ssh -T git@github.com    # 看到 Hi dky17632407691-ux! 就通了
```

**3. 克隆仓库**：

```bash
cd D:\WorkBuddy
git clone git@github.com:dky17632407691-ux/money-ledger.git
```

然后在 WorkBuddy 里对这个目录新建任务，说一句「继续优化我要攒钱，先读 README.md」即可。

> 也可以用 HTTPS 方式：`git clone https://github.com/dky17632407691-ux/money-ledger.git`，密码处填 Personal Access Token。

---

## 日常两条命令

开工（先拉，别跳过）：

```bash
git sync
```

收工（提交并推送）：

```bash
git add -A && git commit -m "改了什么" && git sync
```

`git sync` 是本仓库配好的别名 = `pull --rebase --autostash` + `push`，已开启自动暂存，不会因为没提交而拉不动。

改完就提交，别攒几天。两台电脑都改了同一处才会冲突，冲突时把提示发出来，别硬推。

---

## 四条必须知道的规矩

**1. 发布目录必须是工作区里的真实目录，不能是联接/符号链接。**
从联接目录发布时，tar 会把它当软链接，打包直接失败。历史踩坑记录见 `跨设备协作.md`。

**2. 云端 SDK 用本地文件，不要改回 CDN。**
`js/vendor/workbuddy-cloud-sdk.js`（约 72KB）是项目自带的。早期从 `cdn.jsdelivr.net` 引 `@dev` 版本，CDN 抖动会让整个应用白屏，这个坑已经踩过。

**3. 改了 js/css 必须打版本号，否则手机上看到的是缓存旧版。**

```bash
cd money-ledger
node tools/stamp-version.mjs
```

它会给 `index.html` 入口和所有内部 import 统一打同一个 `?v=`。只改入口、不给内部 import 打版本是无效的——浏览器按完整 URL 缓存 ES 模块。

**4. 数据库结构变更要留档。**
`ALTER TABLE` / `CREATE TABLE` 不会随代码同步，必须在 `migrations/` 下写一个 `YYYYMMDD_说明.md` 一起提交，另一台电脑拉下来才知道要不要补执行。

---

## 项目结构

```
（仓库根）                 ← git 命令都在这一层
├── money-ledger/         ← 真正的源码，发布目录
│   ├── index.html
│   ├── styles.css
│   ├── js/               ← app / views / state / store / sheets / cloud / fx / quotes / access / config ...
│   ├── js/vendor/        ← 本地自带 SDK
│   └── tools/stamp-version.mjs
├── asset-tracker/        ← 数据链路验证脚本（Node + CDP 无头截图/测量），不参与发布
├── migrations/           ← 数据库变更记录
├── 跨设备协作.md          ← git 与部署的详细说明，含踩坑记录
├── 项目盘点.md
├── 第一版功能定义.md
└── .wbapp_*.genie        ← 应用标记（appId 不变则发布仍覆盖同一个应用和域名）
```

---

## 排查工具

`asset-tracker/` 下是本机验证脚本，用 Node 22 + Chrome DevTools Protocol 跑，能精确模拟 390×844 手机视口、截图、测量溢出。改完 UI 想确认效果时很有用，例如：

```bash
cd asset-tracker
node verify_dashboard.mjs      # 概览页布局/掩码/折叠/目标弹层
node verify_holding_preview.mjs # 持仓弹层多币种折算
```

这些脚本纯本地运行，不影响线上。
