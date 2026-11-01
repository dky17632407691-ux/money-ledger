/* 生活记账本 · 独立本地版 */
import {
  escapeHtml, formatMoney, formatSigned, formatAmount, todayISO, monthLabel,
  shiftMonth, friendlyDate, toNumber, $,
} from './util.js'
import {
  state, bootState, accounts, accountById, accountBalance, netWorthSummary,
  monthTxSummary, transactionsInMonth, expenseByCategory, categories,
  openHoldings, closedHoldings, todayDayProfit, holdingMarketValue,
  holdingUnrealized, addTransaction, deleteTransaction, addCategory,
  archiveCategory, upsertAccount, archiveAccount, applyTrade, refreshAllQuotes,
  fxRate, reloadFromStorage,
} from './state.js'
import {
  MARKET_GROUPS, normalizeSymbol, marketOf, displayCode, marketLabel,
  lookupSymbol, currencyOf, CURRENCY_SYMBOL,
} from './quotes.js'
import { toast, confirmDialog, openSheet, setBoot, hideBoot } from './ui.js'
import { exportJson, importJson, resetDb, STORAGE_KEY } from './store.js'

const BUILD = '202611011200'

function moneyClass(n) {
  if (n > 0) return 'pos'
  if (n < 0) return 'neg'
  return ''
}

/* ===================== 渲染 ===================== */

function render() {
  const page = $('#page')
  if (!page) return
  if (state.tab === 'overview') page.innerHTML = renderOverview()
  else if (state.tab === 'daily') page.innerHTML = renderDaily()
  else if (state.tab === 'assets') page.innerHTML = renderAssets()
  else if (state.tab === 'stats') page.innerHTML = renderStats()
  else page.innerHTML = renderMe()
  bindPage(page)
  syncNav()
}

function syncNav() {
  document.querySelectorAll('.tabbar__btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.tab === state.tab)
  })
}

function renderOverview() {
  const nw = netWorthSummary()
  const ms = monthTxSummary()
  const td = todayDayProfit()
  const todayPL = td.has
    ? `<span class="${moneyClass(td.profit)}">${formatSigned(td.profit)}</span>
       <small>${td.pct == null ? '' : (td.pct * 100).toFixed(2) + '%'}</small>`
    : `<span class="muted">--</span>`
  const accCards = accounts().map((a) => {
    const bal = accountBalance(a)
    return `<button type="button" class="card card--tap" data-edit-account="${a.id}">
      <div class="card__icon" style="background:${escapeHtml(a.color)}22">${a.icon || '💳'}</div>
      <div class="card__body">
        <div class="card__title">${escapeHtml(a.name)}</div>
        <div class="card__sub">${escapeHtml(a.type)}</div>
      </div>
      <div class="card__value">${formatMoney(bal)}</div>
    </button>`
  }).join('')
  return `
  <header class="page-head">
    <div>
      <div class="eyebrow">本地账本 · v${BUILD}</div>
      <h1>概览</h1>
    </div>
    <button type="button" class="btn btn--ghost btn--sm" id="btn-refresh">刷新行情</button>
  </header>
  <section class="hero">
    <div class="hero__label">净资产</div>
    <div class="hero__value">${formatMoney(nw.netWorth)}</div>
    <div class="hero__row">
      <div><span class="muted">资产</span> ${formatMoney(nw.totalAssets)}</div>
      <div><span class="muted">负债</span> ${formatMoney(nw.totalLiabilities)}</div>
    </div>
  </section>
  <section class="grid-2">
    <div class="stat">
      <div class="stat__label">本月收入</div>
      <div class="stat__value pos">${formatMoney(ms.income)}</div>
    </div>
    <div class="stat">
      <div class="stat__label">本月支出</div>
      <div class="stat__value neg">${formatMoney(ms.expense)}</div>
    </div>
    <div class="stat">
      <div class="stat__label">今日盈亏</div>
      <div class="stat__value">${todayPL}</div>
    </div>
    <div class="stat">
      <div class="stat__label">汇率</div>
      <div class="stat__value sm">USD ${fxRate('USD') || '缺'} · HKD ${fxRate('HKD') || '缺'}</div>
    </div>
  </section>
  <section class="block">
    <div class="block__head">
      <h2>账户</h2>
      <button type="button" class="link" id="btn-add-account">+ 账户</button>
    </div>
    <div class="stack">${accCards || '<p class="empty">还没有账户</p>'}</div>
  </section>`
}

function renderDaily() {
  const ms = monthTxSummary()
  const list = transactionsInMonth()
  let lastDate = ''
  const rows = list.map((t) => {
    let head = ''
    if (t.occurred_on !== lastDate) {
      lastDate = t.occurred_on
      head = `<div class="day-head">${friendlyDate(t.occurred_on)}</div>`
    }
    const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0
    const amt = sign === 0
      ? `<span class="muted">转账 ${formatMoney(t.amount)}</span>`
      : `<span class="${moneyClass(sign)}">${formatSigned(sign * t.amount)}</span>`
    const acc = accountById(t.account_id)
    return `${head}
    <button type="button" class="row" data-del-tx="${t.id}">
      <div class="row__main">
        <div class="row__title">${escapeHtml(t.category || t.type)}</div>
        <div class="row__sub">${escapeHtml(acc?.name || '')}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
      </div>
      <div class="row__value">${amt}</div>
    </button>`
  }).join('')
  return `
  <header class="page-head">
    <div>
      <div class="eyebrow">日常收支</div>
      <h1>
        <button type="button" class="icon-btn" data-shift-month="-1">‹</button>
        ${monthLabel(state.monthKey)}
        <button type="button" class="icon-btn" data-shift-month="1">›</button>
      </h1>
    </div>
    <button type="button" class="btn btn--primary btn--sm" id="btn-add-tx">记一笔</button>
  </header>
  <section class="grid-2">
    <div class="stat"><div class="stat__label">收入</div><div class="stat__value pos">${formatMoney(ms.income)}</div></div>
    <div class="stat"><div class="stat__label">支出</div><div class="stat__value neg">${formatMoney(ms.expense)}</div></div>
  </section>
  <section class="block">
    <div class="stack">${rows || '<p class="empty">本月还没有流水</p>'}</div>
  </section>`
}

function renderAssets() {
  const td = todayDayProfit()
  const holds = openHoldings()
  const cards = holds.map((h) => {
    const mv = holdingMarketValue(h)
    const ur = holdingUnrealized(h)
    const day = h.change_pct != null ? `${toNumber(h.change_pct).toFixed(2)}%` : '--'
    return `<div class="holding">
      <div class="holding__top">
        <div>
          <div class="holding__name">${escapeHtml(h.name || h.symbol)}</div>
          <div class="holding__code">${marketLabel(h.market)} · ${escapeHtml(displayCode(h.market, h.symbol))}</div>
        </div>
        <div class="holding__px">${CURRENCY_SYMBOL[currencyOf(h.market)] || ''}${formatAmount(h.last_price, 3)}
          <small class="${moneyClass(h.change_pct)}">${day}</small>
        </div>
      </div>
      <div class="holding__meta">
        <span>市值 ${formatMoney(mv)}</span>
        <span class="${moneyClass(ur)}">浮盈 ${formatSigned(ur)}</span>
        <span>份额 ${formatAmount(h.shares, 4)}</span>
      </div>
      <div class="holding__meta muted">行情 ${escapeHtml(h.price_time || '--')}</div>
      <div class="holding__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-trade="buy" data-holding="${h.id}">买入</button>
        <button type="button" class="btn btn--ghost btn--sm" data-trade="sell" data-holding="${h.id}">卖出</button>
      </div>
    </div>`
  }).join('')
  const closed = closedHoldings().slice(0, 8).map((h) =>
    `<div class="row"><div class="row__main"><div class="row__title">${escapeHtml(h.name)}</div>
     <div class="row__sub">已清仓 · 已实现 ${formatSigned(h.realized_profit)}</div></div></div>`
  ).join('')
  return `
  <header class="page-head">
    <div>
      <div class="eyebrow">持仓资产</div>
      <h1>资产</h1>
    </div>
    <div class="row-actions">
      <button type="button" class="btn btn--ghost btn--sm" id="btn-refresh">刷新</button>
      <button type="button" class="btn btn--primary btn--sm" id="btn-add-holding">加仓</button>
    </div>
  </header>
  <section class="stat">
    <div class="stat__label">今日盈亏（仅统计行情日=今天的标的）</div>
    <div class="stat__value">${td.has ? `<span class="${moneyClass(td.profit)}">${formatSigned(td.profit)}</span>` : '<span class="muted">--</span>'}</div>
  </section>
  <section class="block">
    <div class="block__head"><h2>持仓</h2></div>
    <div class="stack">${cards || '<p class="empty">还没有持仓，点「加仓」开始</p>'}</div>
  </section>
  ${closed ? `<section class="block"><div class="block__head"><h2>清仓记录</h2></div><div class="stack">${closed}</div></section>` : ''}`
}

function renderStats() {
  const by = expenseByCategory()
  const total = by.reduce((s, x) => s + x.amount, 0) || 1
  const bars = by.map((x) => {
    const pct = Math.round((x.amount / total) * 100)
    return `<div class="bar">
      <div class="bar__label"><span>${escapeHtml(x.name)}</span><span>${formatMoney(x.amount)} · ${pct}%</span></div>
      <div class="bar__track"><div class="bar__fill" style="width:${pct}%"></div></div>
    </div>`
  }).join('')
  const ms = monthTxSummary()
  return `
  <header class="page-head"><div><div class="eyebrow">统计</div>
    <h1>
      <button type="button" class="icon-btn" data-shift-month="-1">‹</button>
      ${monthLabel(state.monthKey)}
      <button type="button" class="icon-btn" data-shift-month="1">›</button>
    </h1></div></header>
  <section class="grid-2">
    <div class="stat"><div class="stat__label">结余</div><div class="stat__value ${moneyClass(ms.net)}">${formatMoney(ms.net)}</div></div>
    <div class="stat"><div class="stat__label">支出笔数分类</div><div class="stat__value">${by.length}</div></div>
  </section>
  <section class="block">
    <div class="block__head"><h2>支出构成</h2></div>
    <div class="stack">${bars || '<p class="empty">本月暂无支出</p>'}</div>
  </section>`
}

function renderMe() {
  const catsE = categories('expense').map((c) =>
    `<button type="button" class="chip" data-arch-cat="${c.id}">${c.icon || ''} ${escapeHtml(c.name)}</button>`
  ).join('')
  const catsI = categories('income').map((c) =>
    `<button type="button" class="chip" data-arch-cat="${c.id}">${c.icon || ''} ${escapeHtml(c.name)}</button>`
  ).join('')
  return `
  <header class="page-head"><div><div class="eyebrow">设置</div><h1>我的</h1></div></header>
  <section class="block">
    <div class="block__head"><h2>分类管理</h2>
      <div>
        <button type="button" class="link" data-add-cat="expense">+ 支出</button>
        <button type="button" class="link" data-add-cat="income">+ 收入</button>
      </div>
    </div>
    <p class="muted sm">支出</p>
    <div class="chips">${catsE}</div>
    <p class="muted sm" style="margin-top:12px">收入</p>
    <div class="chips">${catsI}</div>
    <p class="hint">点分类可归档（软删除）。新增分类保存后弹窗会正确关闭。</p>
  </section>
  <section class="block">
    <div class="block__head"><h2>数据</h2></div>
    <div class="stack">
      <button type="button" class="btn btn--block" id="btn-export">导出 JSON 备份</button>
      <button type="button" class="btn btn--block btn--ghost" id="btn-import">导入备份</button>
      <button type="button" class="btn btn--block btn--danger" id="btn-reset">清空本地数据</button>
    </div>
    <p class="hint">数据保存在浏览器 localStorage（${STORAGE_KEY}），不经过 WorkBuddy 云库。</p>
    <p class="hint">版本 ${BUILD}</p>
  </section>`
}

/* ===================== 事件 ===================== */

function bindPage(page) {
  page.querySelector('#btn-refresh')?.addEventListener('click', async () => {
    try {
      toast('正在刷新行情…')
      await refreshAllQuotes()
      toast('行情已更新', 'ok')
      render()
    } catch (err) {
      toast(err.message || '刷新失败', 'err')
    }
  })
  page.querySelector('#btn-add-tx')?.addEventListener('click', () => openTxSheet())
  page.querySelector('#btn-add-account')?.addEventListener('click', () => openAccountSheet())
  page.querySelector('#btn-add-holding')?.addEventListener('click', () => openTradeSheet('buy'))
  page.querySelectorAll('[data-shift-month]').forEach((b) => {
    b.addEventListener('click', () => {
      state.monthKey = shiftMonth(state.monthKey, Number(b.dataset.shiftMonth))
      render()
    })
  })
  page.querySelectorAll('[data-del-tx]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!(await confirmDialog('删除这笔流水？'))) return
      deleteTransaction(b.dataset.delTx)
      toast('已删除', 'ok')
      render()
    })
  })
  page.querySelectorAll('[data-edit-account]').forEach((b) => {
    b.addEventListener('click', () => openAccountSheet(accountById(b.dataset.editAccount)))
  })
  page.querySelectorAll('[data-trade]').forEach((b) => {
    b.addEventListener('click', () => {
      const h = state.db.holdings.find((x) => x.id === b.dataset.holding)
      openTradeSheet(b.dataset.trade, h)
    })
  })
  page.querySelectorAll('[data-add-cat]').forEach((b) => {
    b.addEventListener('click', () => openCategorySheet(b.dataset.addCat))
  })
  page.querySelectorAll('[data-arch-cat]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!(await confirmDialog('归档该分类？'))) return
      archiveCategory(b.dataset.archCat)
      toast('已归档', 'ok')
      render()
    })
  })
  page.querySelector('#btn-export')?.addEventListener('click', () => {
    const blob = new Blob([exportJson(state.db)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ledger-backup-${todayISO()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('已导出', 'ok')
  })
  page.querySelector('#btn-import')?.addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      try {
        const text = await input.files[0].text()
        importJson(text)
        reloadFromStorage()
        toast('导入成功', 'ok')
        render()
      } catch (err) {
        toast(err.message || '导入失败', 'err')
      }
    }
    input.click()
  })
  page.querySelector('#btn-reset')?.addEventListener('click', async () => {
    if (!(await confirmDialog('确定清空全部本地数据？此操作不可恢复。', { okText: '清空' }))) return
    resetDb()
    reloadFromStorage()
    toast('已清空', 'ok')
    render()
  })
}

/* ===================== 弹层 ===================== */

function openTxSheet() {
  const accOpts = accounts().map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')
  const catOpts = categories('expense').map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')
  const { el, close } = openSheet('记一笔', `
    <form id="tx-form" class="form">
      <div class="seg" role="tablist">
        <button type="button" class="seg__btn is-active" data-type="expense">支出</button>
        <button type="button" class="seg__btn" data-type="income">收入</button>
        <button type="button" class="seg__btn" data-type="transfer">转账</button>
      </div>
      <label class="field">金额（人民币）
        <input name="amount" class="input" type="number" step="0.01" min="0" required placeholder="0.00" inputmode="decimal">
      </label>
      <label class="field">账户
        <select name="account_id" class="input">${accOpts}</select>
      </label>
      <label class="field" id="to-acc-wrap" hidden>转入账户
        <select name="to_account_id" class="input">${accOpts}</select>
      </label>
      <label class="field" id="cat-wrap">分类
        <div class="field__row">
          <select name="category" class="input">${catOpts}</select>
          <button type="button" class="btn btn--ghost" id="tx-new-cat">新分类</button>
        </div>
      </label>
      <label class="field">日期
        <input name="occurred_on" class="input" type="date" value="${todayISO()}" required>
      </label>
      <label class="field">备注
        <input name="note" class="input" placeholder="可选">
      </label>
      <button type="submit" class="btn btn--primary btn--block">保存</button>
    </form>`)
  let type = 'expense'
  const form = el.querySelector('#tx-form')
  const refillCats = () => {
    const sel = form.category
    const list = categories(type === 'income' ? 'income' : 'expense')
    sel.innerHTML = list.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')
  }
  el.querySelectorAll('[data-type]').forEach((b) => {
    b.addEventListener('click', () => {
      type = b.dataset.type
      el.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('is-active', x === b))
      form.querySelector('#to-acc-wrap').hidden = type !== 'transfer'
      form.querySelector('#cat-wrap').hidden = type === 'transfer'
      if (type !== 'transfer') refillCats()
    })
  })
  el.querySelector('#tx-new-cat').addEventListener('click', () => {
    openCategorySheet(type === 'income' ? 'income' : 'expense', () => refillCats())
  })
  let submitting = false
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (submitting) return
    submitting = true
    try {
      const fd = new FormData(form)
      addTransaction({
        type,
        amount: fd.get('amount'),
        account_id: fd.get('account_id'),
        to_account_id: type === 'transfer' ? fd.get('to_account_id') : null,
        category: type === 'transfer' ? '转账' : fd.get('category'),
        occurred_on: fd.get('occurred_on'),
        note: fd.get('note'),
        currency: 'CNY',
      })
      toast('已记账', 'ok')
      close()
      render()
    } catch (err) {
      toast(err.message || '保存失败', 'err')
      submitting = false
    }
  })
}

/**
 * 新增分类弹层 —— 关闭时调用本函数返回的 close()，
 * 绝不引用未定义变量 sheet（原 bug：sheet is not defined）
 */
function openCategorySheet(kind = 'expense', onSaved) {
  const { el, close } = openSheet('新增分类', `
    <form id="cat-form" class="form">
      <label class="field">类型
        <select name="kind" class="input">
          <option value="expense" ${kind === 'expense' ? 'selected' : ''}>支出</option>
          <option value="income" ${kind === 'income' ? 'selected' : ''}>收入</option>
        </select>
      </label>
      <label class="field">名称
        <input name="name" class="input" required maxlength="20" placeholder="如 咖啡">
      </label>
      <label class="field">图标（可选）
        <input name="icon" class="input" maxlength="4" placeholder="☕">
      </label>
      <button type="submit" class="btn btn--primary btn--block">保存</button>
    </form>`)
  el.querySelector('#cat-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    try {
      addCategory(fd.get('kind'), fd.get('name'), fd.get('icon') || '🏷️')
      toast('分类已添加', 'ok')
      close() // 正确关闭：使用 openSheet 返回的 close，不是未定义的 sheet
      onSaved?.()
      if (state.tab === 'me') render()
    } catch (err) {
      toast(err.message || '保存失败', 'err')
    }
  })
}

function openAccountSheet(existing = null) {
  const a = existing
  const { el, close } = openSheet(a ? '编辑账户' : '新建账户', `
    <form id="acc-form" class="form">
      <label class="field">名称<input name="name" class="input" required value="${escapeHtml(a?.name || '')}"></label>
      <label class="field">类型
        <select name="type" class="input">
          ${['cash','bank','wallet','invest','receivable','liability'].map((t) =>
            `<option value="${t}" ${a?.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </label>
      <label class="field">建账余额（人民币）
        <input name="initial_balance" class="input" type="number" step="0.01" value="${a ? toNumber(a.initial_balance) : 0}">
      </label>
      <label class="field">图标<input name="icon" class="input" value="${escapeHtml(a?.icon || '💳')}"></label>
      <button type="submit" class="btn btn--primary btn--block">保存</button>
      ${a ? '<button type="button" class="btn btn--danger btn--block" id="acc-arch">归档账户</button>' : ''}
    </form>`)
  el.querySelector('#acc-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    try {
      upsertAccount({
        id: a?.id,
        name: fd.get('name'),
        type: fd.get('type'),
        initial_balance: fd.get('initial_balance'),
        icon: fd.get('icon'),
        cash_account_id: a?.cash_account_id || null,
      })
      toast('已保存', 'ok')
      close()
      render()
    } catch (err) {
      toast(err.message || '失败', 'err')
    }
  })
  el.querySelector('#acc-arch')?.addEventListener('click', async () => {
    if (!(await confirmDialog('归档该账户？'))) return
    archiveAccount(a.id)
    toast('已归档', 'ok')
    close()
    render()
  })
}

function openTradeSheet(side = 'buy', holding = null) {
  const invAcc = accounts().filter((a) => a.type === 'invest')
  const accList = invAcc.length ? invAcc : accounts()
  const accOpts = accList.map((a) =>
    `<option value="${a.id}" ${holding && holding.account_id === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`
  ).join('')
  const group = holding
    ? (holding.market === 'hk' ? 'hk' : holding.market === 'us' ? 'us' : 'a')
    : 'a'
  const { el, close } = openSheet(side === 'buy' ? '买入 / 建仓' : '卖出', `
    <form id="tr-form" class="form">
      <div class="seg">
        <button type="button" class="seg__btn ${side === 'buy' ? 'is-active' : ''}" data-side="buy">买入</button>
        <button type="button" class="seg__btn ${side === 'sell' ? 'is-active' : ''}" data-side="sell">卖出</button>
      </div>
      <label class="field">市场
        <select name="group" class="input" ${holding ? 'disabled' : ''}>
          ${MARKET_GROUPS.map((g) => `<option value="${g.value}" ${g.value === group ? 'selected' : ''}>${g.label}</option>`).join('')}
        </select>
      </label>
      <label class="field">代码
        <div class="field__row">
          <input name="symbol" class="input" required value="${escapeHtml(holding?.symbol || '')}" ${holding ? 'readonly' : ''} placeholder="代码">
          <button type="button" class="btn btn--ghost" id="tr-lookup">查询</button>
        </div>
      </label>
      <label class="field">名称<input name="name" class="input" value="${escapeHtml(holding?.name || '')}"></label>
      <label class="field">账户<select name="account_id" class="input" ${holding ? 'disabled' : ''}>${accOpts}</select></label>
      <label class="field">份额<input name="shares" class="input" type="number" step="any" min="0" required></label>
      <label class="field">价格<input name="price" class="input" type="number" step="any" min="0" required value="${holding ? toNumber(holding.last_price) : ''}"></label>
      <label class="field">手续费<input name="fee" class="input" type="number" step="any" min="0" value="0"></label>
      <label class="field">日期<input name="traded_on" class="input" type="date" value="${todayISO()}"></label>
      <label class="check"><input type="checkbox" name="is_opening"> 建仓（建账前已有，不扣现金）</label>
      <button type="submit" class="btn btn--primary btn--block">确认</button>
    </form>`)
  let curSide = side
  el.querySelectorAll('[data-side]').forEach((b) => {
    b.addEventListener('click', () => {
      curSide = b.dataset.side
      el.querySelectorAll('[data-side]').forEach((x) => x.classList.toggle('is-active', x === b))
    })
  })
  el.querySelector('#tr-lookup').addEventListener('click', async () => {
    try {
      const g = el.querySelector('[name=group]').value
      const q = await lookupSymbol(g, el.querySelector('[name=symbol]').value)
      el.querySelector('[name=symbol]').value = q.symbol
      el.querySelector('[name=name]').value = q.name || ''
      el.querySelector('[name=price]').value = q.price
      toast(`已获取 ${q.name} · 行情时间 ${q.priceTime || '--'}`, 'ok')
    } catch (err) {
      toast(err.message || '查询失败', 'err')
    }
  })
  el.querySelector('#tr-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(e.target)
    try {
      const g = holding ? (holding.market === 'hk' ? 'hk' : holding.market === 'us' ? 'us' : 'a') : fd.get('group')
      const symbol = holding ? holding.symbol : normalizeSymbol(g, fd.get('symbol'))
      const market = holding ? holding.market : marketOf(g, symbol)
      applyTrade({
        side: curSide,
        market,
        symbol,
        name: fd.get('name') || holding?.name || symbol,
        shares: fd.get('shares'),
        price: fd.get('price'),
        fee: fd.get('fee'),
        account_id: holding ? holding.account_id : fd.get('account_id'),
        traded_on: fd.get('traded_on'),
        is_opening: !!fd.get('is_opening'),
      })
      toast('交易已记录', 'ok')
      close()
      render()
    } catch (err) {
      toast(err.message || '失败', 'err')
    }
  })
}

/* ===================== 启动 ===================== */

async function main() {
  setBoot('正在加载本地账本…')
  bootState()
  $('#app')?.classList.remove('hidden')
  document.querySelectorAll('.tabbar__btn').forEach((b) => {
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab
      render()
    })
  })
  $('#fab-add')?.addEventListener('click', () => openTxSheet())
  render()
  hideBoot()
  try {
    await refreshAllQuotes()
    render()
  } catch (_) {}
}

main().catch((err) => {
  setBoot('启动失败：' + (err.message || err))
  console.error(err)
})
