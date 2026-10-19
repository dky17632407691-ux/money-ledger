import * as store from './store.js?v=202610192325'
import {
  state, categoriesOf, ACCOUNT_TYPES, SUBTYPES, typeMeta, notifyChange,
  loadAll, refreshQuotes, requestRender, holdingsOfAccount, accountById,
  accountLabel, accountCash, applyTrade, removeTrade, tradesOfHolding,
  holdingPrice, holdingMarketValue, holdingProfit, holdingDayProfit,
  buildOpeningTrade, fxRate, holdingCurrency,
  goal, saveGoal,
} from './state.js?v=202610192325'
import {
  MARKET_GROUPS, groupOfMarket, normalizeSymbol, marketOf, lookupSymbol,
  displayCode, CURRENCY_SYMBOL, currencyOf,
} from './quotes.js?v=202610192325'
import {
  openSheet, toastOk, toastErr, describeError, confirmDialog, setBusy,
} from './ui.js?v=202610192325'
import {
  escapeHtml, html, parseAmount, toNumber, todayISO, PALETTE, colorByName,
  safeColor, formatAmount, formatSigned, friendlyDate,
} from './util.js?v=202610192325'

/* ============================================================
   各类表单弹层
   ============================================================ */

function accountOptionsHtml(selected, { includeNone = true, noneLabel = '不关联账户' } = {}) {
  const list = state.accounts.filter((a) => !a.is_archived)
  const none = includeNone
    ? `<option value=""${selected ? '' : ' selected'}>${escapeHtml(noneLabel)}</option>`
    : ''
  const opts = list.map((a) => {
    const meta = typeMeta(a.type)
    const label = a.subtype ? `${a.name}（${meta.label}）` : a.name
    return `<option value="${a.id}"${String(selected) === String(a.id) ? ' selected' : ''}>${escapeHtml(label)}</option>`
  }).join('')
  return none + opts
}

/* ---------------- 记一笔 / 编辑流水 ---------------- */

export function openRecordSheet(tx = null) {
  const editing = !!tx
  const hasAccounts = state.accounts.some((a) => !a.is_archived)

  const draft = {
    type: tx ? tx.type : 'expense',
    amount: tx ? String(tx.amount) : '',
    account_id: tx && tx.account_id != null ? String(tx.account_id) : '',
    to_account_id: tx && tx.to_account_id != null ? String(tx.to_account_id) : '',
    category: tx ? (tx.category || '') : '',
    occurred_on: tx ? String(tx.occurred_on).slice(0, 10) : todayISO(),
    note: tx ? (tx.note || '') : '',
  }

  const body = html(`
    <div class="form-grid">
      <div class="segmented" id="rs-types" style="justify-self:start">
        <button class="segmented__btn" type="button" data-type="expense">支出</button>
        <button class="segmented__btn" type="button" data-type="income">收入</button>
        <button class="segmented__btn" type="button" data-type="transfer">转账</button>
      </div>

      <div class="amount-input">
        <span class="amount-input__symbol">¥</span>
        <input id="rs-amount" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off">
      </div>

      <div class="form-row" id="rs-category-wrap">
        <label>分类</label>
        <div class="chips" id="rs-categories"></div>
      </div>

      <div class="form-grid form-grid--2">
        <div class="form-row">
          <label id="rs-account-label">账户</label>
          <select class="select" id="rs-account"></select>
        </div>
        <div class="form-row" id="rs-to-wrap">
          <label>转入账户</label>
          <select class="select" id="rs-to"></select>
        </div>
      </div>

      ${hasAccounts ? '' : '<p class="field__hint">还没有账户，可以先「不关联账户」记账，之后到「资产」页补充账户。</p>'}

      <div class="form-grid form-grid--2">
        <div class="form-row">
          <label>日期</label>
          <input class="input" type="date" id="rs-date">
        </div>
        <div class="form-row">
          <label>备注</label>
          <input class="input" type="text" id="rs-note" maxlength="60" placeholder="选填">
        </div>
      </div>
      <p id="rs-error" class="field__error hidden"></p>
    </div>
  `)

  const foot = html(`
    <div style="display:flex;gap:10px;width:100%">
      ${editing ? '<button class="btn btn--danger-ghost" type="button" data-act="delete" style="flex:0 0 auto">删除</button>' : ''}
      <button class="btn btn--ghost" type="button" data-act="cancel">取消</button>
      <button class="btn btn--primary" type="button" data-act="save">保存</button>
    </div>
  `)

  const sheet = openSheet({
    title: editing ? '编辑这笔记录' : '记一笔',
    body,
    footer: foot,
    onMount: (root) => {
      const typesEl = root.querySelector('#rs-types')
      const amountEl = root.querySelector('#rs-amount')
      const catWrap = root.querySelector('#rs-category-wrap')
      const catEl = root.querySelector('#rs-categories')
      const accountEl = root.querySelector('#rs-account')
      const accountLabel = root.querySelector('#rs-account-label')
      const toWrap = root.querySelector('#rs-to-wrap')
      const toEl = root.querySelector('#rs-to')
      const dateEl = root.querySelector('#rs-date')
      const noteEl = root.querySelector('#rs-note')
      const errEl = root.querySelector('#rs-error')

      amountEl.value = draft.amount
      dateEl.value = draft.occurred_on
      noteEl.value = draft.note
      accountEl.innerHTML = accountOptionsHtml(draft.account_id)
      toEl.innerHTML = accountOptionsHtml(draft.to_account_id, { noneLabel: '请选择转入账户' })
      accountEl.value = draft.account_id
      toEl.value = draft.to_account_id

      function renderCategories() {
        if (draft.type === 'transfer') {
          catWrap.classList.add('hidden')
          return
        }
        catWrap.classList.remove('hidden')
        const kind = draft.type // 'expense' | 'income'
        const list = categoriesOf(kind)
        if (!list.length) {
          catEl.innerHTML = '<span class="field__hint">还没有分类，去「我的 → 分类管理」添加</span>'
          draft.category = draft.category || '其他'
          return
        }
        if (!draft.category || !list.some((c) => c.name === draft.category)) {
          draft.category = list[0].name
        }
        catEl.innerHTML = list.map((c) => `
          <button class="chip${c.name === draft.category ? ' is-active' : ''}" type="button" data-cat="${escapeHtml(c.name)}">
            <span class="chip__emoji">${escapeHtml(c.icon || '📦')}</span>${escapeHtml(c.name)}
          </button>`).join('')
      }

      function syncType() {
        Array.from(typesEl.children).forEach((btn) => {
          btn.classList.toggle('is-active', btn.dataset.type === draft.type)
        })
        const isTransfer = draft.type === 'transfer'
        toWrap.classList.toggle('hidden', !isTransfer)
        accountLabel.textContent = isTransfer ? '转出账户' : '账户'
        if (isTransfer) draft.category = '转账'
        renderCategories()
      }

      typesEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-type]')
        if (!btn) return
        draft.type = btn.dataset.type
        syncType()
      })

      catEl.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-cat]')
        if (!chip) return
        draft.category = chip.dataset.cat
        Array.from(catEl.children).forEach((c) => c.classList.toggle('is-active', c === chip))
      })

      amountEl.focus({ preventScroll: true })

      function showError(msg) {
        errEl.textContent = msg
        errEl.classList.remove('hidden')
      }

      async function save() {
        const amount = parseAmount(amountEl.value)
        if (!Number.isFinite(amount) || amount <= 0) return showError('请输入大于 0 的金额')
        if (draft.type === 'transfer') {
          const from = accountEl.value
          const to = toEl.value
          if (!from || !to) return showError('转账需要选择转出账户和转入账户')
          if (String(from) === String(to)) return showError('转出账户和转入账户不能是同一个')
        }
        errEl.classList.add('hidden')

        const payload = {
          type: draft.type,
          amount: Math.round(amount * 100) / 100,
          account_id: accountEl.value ? Number(accountEl.value) : null,
          to_account_id: draft.type === 'transfer' ? Number(toEl.value) : null,
          category: draft.type === 'transfer' ? '转账' : (draft.category || '其他'),
          occurred_on: dateEl.value || todayISO(),
          note: noteEl.value.trim() || null,
        }

        const saveBtn = foot.querySelector('[data-act="save"]')
        setBusy(saveBtn, true, '保存中…')
        try {
          if (editing) await store.updateTransaction(tx.id, payload)
          else await store.createTransaction(payload)
          toastOk(editing ? '已更新' : '已记录')
          sheet.close()
          notifyChange()
        } catch (err) {
          setBusy(saveBtn, false)
          showError(describeError(err))
        }
      }

      foot.querySelector('[data-act="save"]').addEventListener('click', save)
      foot.querySelector('[data-act="cancel"]').addEventListener('click', () => sheet.close())

      const delBtn = foot.querySelector('[data-act="delete"]')
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '删除这笔记录',
            message: '删除后无法恢复，确定要删除吗？',
            confirmText: '删除',
            danger: true,
          })
          if (!ok) return
          try {
            await store.deleteTransaction(tx.id)
            toastOk('已删除')
            sheet.close()
            notifyChange()
          } catch (err) {
            showError(describeError(err))
          }
        })
      }

      root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
          e.preventDefault()
          save()
        }
      })

      syncType()
    },
  })

  return sheet
}

/* ---------------- 账户编辑 ---------------- */

export function openAccountSheet(account = null) {
  const editing = !!account
  const draft = {
    name: account ? account.name : '',
    type: account ? account.type : 'bank',
    subtype: account ? (account.subtype || '') : '',
    initial_balance: account ? String(account.initial_balance ?? 0) : '0',
    manual_balance: account && account.manual_balance != null ? String(account.manual_balance) : '',
    include_in_networth: account ? account.include_in_networth !== false : true,
    note: account ? (account.note || '') : '',
  }

  const typeOptions = Object.entries(ACCOUNT_TYPES)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([value, meta]) => `<option value="${value}">${meta.icon} ${meta.label}</option>`)
    .join('')

  const body = html(`
    <div class="form-grid">
      <div class="form-row">
        <label>账户名称</label>
        <input class="input" id="as-name" type="text" maxlength="24" placeholder="如：招商银行储蓄卡" autocomplete="off">
      </div>

      <div class="form-grid form-grid--2">
        <div class="form-row">
          <label>账户类型</label>
          <select class="select" id="as-type">${typeOptions}</select>
        </div>
        <div class="form-row" id="as-subtype-wrap">
          <label>细分类型</label>
          <select class="select" id="as-subtype"></select>
        </div>
      </div>

      <div class="form-grid form-grid--2" id="as-balance-wrap">
        <div class="form-row">
          <label id="as-init-label">建账时余额</label>
          <input class="input" id="as-init" type="text" inputmode="decimal" autocomplete="off">
        </div>
        <div class="form-row" id="as-manual-wrap">
          <label id="as-manual-label">当前市值</label>
          <input class="input" id="as-manual" type="text" inputmode="decimal" placeholder="留空则按流水自动计算" autocomplete="off">
        </div>
      </div>

      <p class="field__hint" id="as-hint"></p>

      <button class="btn btn--soft hidden" type="button" data-act="add-holding" style="align-self:flex-start">＋ 添加持仓（股票 / 基金）</button>

      <label class="form-row" style="flex-direction:row;align-items:center;gap:10px;cursor:pointer">
        <input type="checkbox" id="as-networth" style="width:17px;height:17px;accent-color:#2f6bff">
        <span style="font-size:13.5px">计入净资产统计</span>
      </label>

      <div class="form-row">
        <label>备注</label>
        <input class="input" id="as-note" type="text" maxlength="60" placeholder="选填" autocomplete="off">
      </div>
      <p id="as-error" class="field__error hidden"></p>
    </div>
  `)

  const foot = html(`
    <div style="display:flex;gap:10px;width:100%">
      ${editing ? '<button class="btn btn--danger-ghost" type="button" data-act="archive" style="flex:0 0 auto">归档</button>' : ''}
      <button class="btn btn--ghost" type="button" data-act="cancel">取消</button>
      <button class="btn btn--primary" type="button" data-act="save">保存</button>
    </div>
  `)

  const sheet = openSheet({
    title: editing ? '编辑账户' : '添加账户',
    body,
    footer: foot,
    onMount: (root) => {
      const nameEl = root.querySelector('#as-name')
      const typeEl = root.querySelector('#as-type')
      const subWrap = root.querySelector('#as-subtype-wrap')
      const subEl = root.querySelector('#as-subtype')
      const initEl = root.querySelector('#as-init')
      const manualEl = root.querySelector('#as-manual')
      const manualWrap = root.querySelector('#as-manual-wrap')
      const netEl = root.querySelector('#as-networth')
      const noteEl = root.querySelector('#as-note')
      const hintEl = root.querySelector('#as-hint')
      const initLabel = root.querySelector('#as-init-label')
      const manualLabel = root.querySelector('#as-manual-label')
      const errEl = root.querySelector('#as-error')
      const holdingBtn = root.querySelector('[data-act="add-holding"]')

      nameEl.value = draft.name
      typeEl.value = draft.type
      initEl.value = draft.initial_balance
      manualEl.value = draft.manual_balance
      netEl.checked = draft.include_in_networth
      noteEl.value = draft.note

      function syncType() {
        const type = typeEl.value
        const meta = typeMeta(type)
        const subs = SUBTYPES[type] || []
        subWrap.classList.toggle('hidden', subs.length === 0)
        subEl.innerHTML = subs
          .map((s) => `<option value="${s.value}">${escapeHtml(s.label)}</option>`)
          .join('')
        if (subs.length) {
          const keep = subs.some((s) => s.value === draft.subtype) ? draft.subtype : subs[0].value
          subEl.value = keep
        }

        if (meta.liability) {
          initLabel.textContent = '建账时欠款'
          manualLabel.textContent = '当前欠款总额'
          manualEl.placeholder = '留空则按流水自动计算'
          hintEl.textContent = '负债账户：刷卡消费会增加欠款，从其他账户转账进来相当于还款。'
          manualEl.disabled = false
          holdingBtn.classList.add('hidden')
        } else if (type === 'investment') {
          const held = editing ? holdingsOfAccount(account.id) : []
          initLabel.textContent = '建账时本金'
          if (held.length) {
            manualLabel.textContent = '当前市值（由持仓汇总）'
            manualEl.value = ''
            manualEl.disabled = true
            manualEl.placeholder = '已由持仓自动计算'
            hintEl.textContent = `该账户有 ${held.length} 项持仓，市值按最新行情自动汇总，不需要手填。`
          } else {
            manualEl.disabled = false
            manualLabel.textContent = '当前市值'
            manualEl.placeholder = '留空则按流水自动计算'
            hintEl.textContent = '想让它自动更新，就点下面加一条持仓；也可以先手填一个市值。'
          }
          holdingBtn.classList.remove('hidden')
        } else {
          initLabel.textContent = '建账时余额'
          manualLabel.textContent = '当前余额（手动）'
          manualEl.placeholder = '留空则按流水自动计算'
          hintEl.textContent = '余额默认为「建账时余额 + 之后所有流水」。只有想强制指定时才填右侧。'
          manualEl.disabled = false
          holdingBtn.classList.add('hidden')
        }
      }

      holdingBtn.addEventListener('click', () => {
        sheet.close()
        openHoldingSheet(null, account ? account.id : null)
      })

      typeEl.addEventListener('change', () => {
        draft.subtype = ''
        syncType()
      })

      function showError(msg) {
        errEl.textContent = msg
        errEl.classList.remove('hidden')
      }

      async function save() {
        const name = nameEl.value.trim()
        if (!name) return showError('请填写账户名称')
        const init = parseAmount(initEl.value)
        if (!Number.isFinite(init)) return showError('建账金额请填写数字')
        const manualRaw = manualEl.value.trim()
        let manual = null
        if (manualRaw !== '') {
          const parsed = parseAmount(manualRaw)
          if (!Number.isFinite(parsed)) return showError('手动金额请填写数字')
          manual = parsed
        }
        errEl.classList.add('hidden')

        const payload = {
          name,
          type: typeEl.value,
          subtype: subEl.value || null,
          initial_balance: init,
          manual_balance: manual,
          include_in_networth: netEl.checked,
          note: noteEl.value.trim() || null,
        }

        const saveBtn = foot.querySelector('[data-act="save"]')
        setBusy(saveBtn, true, '保存中…')
        try {
          if (editing) await store.updateAccount(account.id, payload)
          else {
            payload.sort_order = state.accounts.length
            await store.createAccount(payload)
          }
          toastOk(editing ? '已更新账户' : '账户已创建')
          sheet.close()
          notifyChange()
        } catch (err) {
          setBusy(saveBtn, false)
          showError(describeError(err))
        }
      }

      foot.querySelector('[data-act="save"]').addEventListener('click', save)
      foot.querySelector('[data-act="cancel"]').addEventListener('click', () => sheet.close())

      const archiveBtn = foot.querySelector('[data-act="archive"]')
      if (archiveBtn) {
        archiveBtn.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '归档账户',
            message: `归档后「${escapeHtml(account.name)}」不再出现在记账选择里，历史流水会保留。确定归档吗？`,
            confirmText: '归档',
            danger: true,
          })
          if (!ok) return
          try {
            await store.updateAccount(account.id, { is_archived: true })
            toastOk('账户已归档')
            sheet.close()
            notifyChange()
          } catch (err) {
            showError(describeError(err))
          }
        })
      }

      syncType()
      nameEl.focus({ preventScroll: true })
    },
  })

  return sheet
}

/* ---------------- 新增分类 ---------------- */

export function openCategorySheet(kind = 'expense') {
  const presets = ['🍜', '🚌', '🛍️', '🏠', '💡', '📶', '🎮', '💊', '📚', '🎁', '✈️', '👕',
    '🏃', '💻', '🐾', '💰', '🎉', '📈', '🧰', '🧧', '🧾', '📦', '☕', '🚗']

  const body = html(`
    <div class="form-grid">
      <div class="segmented" id="cs-kind" style="justify-self:start">
        <button class="segmented__btn" type="button" data-kind="expense">支出分类</button>
        <button class="segmented__btn" type="button" data-kind="income">收入分类</button>
      </div>

      <div class="form-row">
        <label>分类名称</label>
        <input class="input" id="cs-name" type="text" maxlength="10" placeholder="如：宠物医疗" autocomplete="off">
      </div>

      <div class="form-row">
        <label>图标</label>
        <div class="chips" id="cs-icons"></div>
        <input class="input" id="cs-icon" type="text" maxlength="4" placeholder="也可以直接粘贴一个表情" style="margin-top:8px">
      </div>

      <div class="form-row">
        <label>颜色</label>
        <div class="chips" id="cs-colors"></div>
      </div>
      <p id="cs-error" class="field__error hidden"></p>
    </div>
  `)

  const foot = html(`
    <div style="display:flex;gap:10px;width:100%">
      <button class="btn btn--ghost" type="button" data-act="cancel">取消</button>
      <button class="btn btn--primary" type="button" data-act="save">添加</button>
    </div>
  `)

  const draft = { kind, icon: presets[0], color: colorByName('新分类') }

  openSheet({
    title: '新增分类',
    body,
    footer: foot,
    onMount: (root) => {
      const kindEl = root.querySelector('#cs-kind')
      const nameEl = root.querySelector('#cs-name')
      const iconsEl = root.querySelector('#cs-icons')
      const iconEl = root.querySelector('#cs-icon')
      const colorsEl = root.querySelector('#cs-colors')
      const errEl = root.querySelector('#cs-error')

      function syncKind() {
        Array.from(kindEl.children).forEach((b) => b.classList.toggle('is-active', b.dataset.kind === draft.kind))
      }

      iconsEl.innerHTML = presets
        .map((p) => `<button class="chip${p === draft.icon ? ' is-active' : ''}" type="button" data-icon="${p}">${p}</button>`)
        .join('')
      colorsEl.innerHTML = PALETTE
        .map((c) => `<button class="chip${c === draft.color ? ' is-active' : ''}" type="button" data-color="${c}" style="width:32px;height:32px;padding:0;justify-content:center"><span style="width:16px;height:16px;border-radius:5px;background:${c};display:block"></span></button>`)
        .join('')

      iconsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-icon]')
        if (!btn) return
        draft.icon = btn.dataset.icon
        iconEl.value = ''
        Array.from(iconsEl.children).forEach((c) => c.classList.toggle('is-active', c === btn))
      })
      colorsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-color]')
        if (!btn) return
        draft.color = btn.dataset.color
        Array.from(colorsEl.children).forEach((c) => c.classList.toggle('is-active', c === btn))
      })
      kindEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-kind]')
        if (!btn) return
        draft.kind = btn.dataset.kind
        syncKind()
      })
      iconEl.addEventListener('input', () => {
        if (iconEl.value.trim()) {
          draft.icon = iconEl.value.trim()
          Array.from(iconsEl.children).forEach((c) => c.classList.remove('is-active'))
        }
      })

      function showError(msg) {
        errEl.textContent = msg
        errEl.classList.remove('hidden')
      }

      async function save() {
        const name = nameEl.value.trim()
        if (!name) return showError('请填写分类名称')
        const exists = state.categories.some((c) => c.kind === draft.kind && c.name === name)
        if (exists) return showError('这个分类已经存在了')
        errEl.classList.add('hidden')

        const saveBtn = foot.querySelector('[data-act="save"]')
        setBusy(saveBtn, true, '添加中…')
        try {
          await store.createCategory({
            kind: draft.kind,
            name,
            icon: draft.icon || '📦',
            color: draft.color,
            sort_order: state.categories.filter((c) => c.kind === draft.kind).length,
            is_archived: false,
          })
          toastOk('分类已添加')
          sheet.close()
          notifyChange()
        } catch (err) {
          setBusy(saveBtn, false)
          showError(err && err.code === '23505' ? '这个分类已经存在了' : describeError(err))
        }
      }

      kindEl.querySelector('[data-kind="' + kind + '"]').classList.add('is-active')
      syncKind()
      foot.querySelector('[data-act="save"]').addEventListener('click', save)
      foot.querySelector('[data-act="cancel"]').addEventListener('click', () => sheet.close())
      nameEl.focus({ preventScroll: true })
    },
  })
}

/* ---------------- 删除分类 ---------------- */

export async function removeCategory(category) {
  const used = state.transactions.filter((t) => t.category === category.name && t.type === category.kind).length
  const ok = await confirmDialog({
    title: '删除分类',
    message: used > 0
      ? `「${escapeHtml(category.name)}」下还有 ${used} 笔历史流水，删除分类不会删除流水，这些流水会显示为未分类。确定删除吗？`
      : `确定删除分类「${escapeHtml(category.name)}」吗？`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await store.deleteCategory(category.id)
    toastOk('分类已删除')
    notifyChange()
  } catch (err) {
    toastErr(describeError(err))
  }
}

/* ---------------- 持仓编辑 ---------------- */

/** 价格显示：低价标的（基金净值）保留 4 位小数 */
function priceText(v) {
  const n = Math.abs(toNumber(v))
  return formatAmount(v, n > 0 && n < 10 ? 4 : 2)
}

function investAccounts() {
  return state.accounts.filter((a) => !a.is_archived && a.type === 'investment')
}

function previewRow(label, valueHtml) {
  return `<div class="quote-preview__row"><span>${escapeHtml(label)}</span><strong class="num">${valueHtml}</strong></div>`
}

export function openHoldingSheet(holding = null, presetAccountId = null) {
  const editing = !!holding
  const pool = investAccounts()

  if (!pool.length) {
    return openSheet({
      title: '需要先建投资账户',
      center: true,
      body: `<p class="sheet__text">持仓要挂在「投资理财」类型的账户下，市值才能自动汇总进净资产。</p>
             <p class="sheet__text" style="margin-top:10px;color:var(--text-3)">请先到「资产」页添加一个投资账户，例如「证券账户」。</p>`,
    })
  }

  const draft = {
    account_id: holding
      ? String(holding.account_id)
      : (presetAccountId && pool.some((a) => String(a.id) === String(presetAccountId))
        ? String(presetAccountId)
        : String(pool[0].id)),
    group: holding ? groupOfMarket(holding.market) : 'a',
    quote: holding && toNumber(holding.last_price) > 0
      ? {
        name: holding.name || '',
        price: toNumber(holding.last_price),
        prevClose: toNumber(holding.prev_close) || null,
        changePct: toNumber(holding.change_pct),
        priceTime: holding.price_time || '',
      }
      : null,
    loading: false,
  }

  const accountOpts = pool
    .map((a) => `<option value="${a.id}"${String(draft.account_id) === String(a.id) ? ' selected' : ''}>${escapeHtml(a.name)}</option>`)
    .join('')

  const body = html(`
    <div class="form-grid">
      <div class="form-row">
        <label>所属投资账户</label>
        <select class="select" id="hs-account">${accountOpts}</select>
      </div>

      <div class="form-row">
        <label>市场类型</label>
        <div class="segmented" id="hs-market" style="flex-wrap:wrap;justify-self:start"></div>
      </div>

      <div class="form-row">
        <label>代码</label>
        <div class="field__row">
          <input class="input" id="hs-symbol" type="text" autocomplete="off" spellcheck="false"
                 value="${escapeHtml(holding ? holding.symbol : '')}" placeholder="600519">
          <button class="btn btn--ghost" type="button" data-act="lookup">查行情</button>
        </div>
        <p class="field__hint" id="hs-symbol-hint"></p>
      </div>

      <div class="form-row">
        <label>名称</label>
        <input class="input" id="hs-name" type="text" maxlength="24" autocomplete="off"
               placeholder="查询后自动填写，也可以自己改"
               value="${escapeHtml(holding ? (holding.name || '') : '')}">
      </div>

      <div class="form-grid form-grid--2">
        <div class="form-row">
          <label>持有份额 / 股数</label>
          <input class="input" id="hs-shares" type="text" inputmode="decimal" autocomplete="off"
                 placeholder="如 100" value="${holding ? escapeHtml(String(toNumber(holding.shares))) : ''}">
        </div>
        <div class="form-row">
          <label>成本单价（选填）</label>
          <input class="input" id="hs-cost" type="text" inputmode="decimal" autocomplete="off"
                 placeholder="用于算浮动盈亏"
                 value="${holding && holding.cost_price != null ? escapeHtml(String(toNumber(holding.cost_price))) : ''}">
        </div>
      </div>

      <div class="quote-preview" id="hs-preview"></div>
      <p id="hs-error" class="field__error hidden"></p>
    </div>
  `)

  const foot = html(`
    <div style="display:flex;gap:10px;width:100%">
      ${editing ? '<button class="btn btn--danger-ghost" type="button" data-act="delete" style="flex:0 0 auto">删除</button>' : ''}
      <button class="btn btn--ghost" type="button" data-act="cancel">取消</button>
      <button class="btn btn--primary" type="button" data-act="save">保存</button>
    </div>
  `)

  const sheet = openSheet({
    title: editing ? '编辑持仓' : '添加持仓',
    body,
    footer: foot,
    onMount: (root) => {
      const accountEl = root.querySelector('#hs-account')
      const marketEl = root.querySelector('#hs-market')
      const symbolEl = root.querySelector('#hs-symbol')
      const hintEl = root.querySelector('#hs-symbol-hint')
      const nameEl = root.querySelector('#hs-name')
      const sharesEl = root.querySelector('#hs-shares')
      const costEl = root.querySelector('#hs-cost')
      const previewEl = root.querySelector('#hs-preview')
      const errEl = root.querySelector('#hs-error')
      const lookupBtn = root.querySelector('[data-act="lookup"]')
      const saveBtn = foot.querySelector('[data-act="save"]')

      marketEl.innerHTML = MARKET_GROUPS
        .map((g) => `<button class="segmented__btn${g.value === draft.group ? ' is-active' : ''}" type="button" data-group="${g.value}">${escapeHtml(g.label)}</button>`)
        .join('')

      function syncMarket() {
        Array.from(marketEl.children).forEach((b) => {
          b.classList.toggle('is-active', b.dataset.group === draft.group)
        })
        const meta = MARKET_GROUPS.find((g) => g.value === draft.group)
        symbolEl.placeholder = draft.group === 'us' ? 'AAPL' : draft.group === 'hk' ? '00700' : '600519'
        if (!draft.quote) hintEl.textContent = meta ? meta.hint : ''
      }

      function renderPreview() {
        if (draft.loading) {
          previewEl.innerHTML = '<div class="quote-preview__empty">正在获取行情…</div>'
          return
        }
        const shares = parseAmount(sharesEl.value)
        const cost = parseAmount(costEl.value)
        const q = draft.quote
        const price = q && q.price > 0
          ? q.price
          : (Number.isFinite(cost) && cost > 0 ? cost : 0)
        const rows = []

        // 与资产页同一口径：港美股先按当日汇率折成人民币再展示，
        // 汇率没取到就明说，不能把原币金额直接套上 ¥ 当成人民币
        const cur = currencyOf(draft.group)
        const sym = CURRENCY_SYMBOL[cur] || '¥'
        const rate = fxRate(cur)
        const needFx = cur !== 'CNY'
        const fxMissing = needFx && rate <= 0
        const fx = rate > 0 ? rate : 0

        function cnyHtml(native, { signed = false, cls = '', extra = '' } = {}) {
          if (fxMissing) return '<span class="t-muted">汇率待更新</span>'
          const value = native * fx
          const sign = signed ? (value >= 0 ? '+' : '-') : ''
          const body = `${sign}¥${formatAmount(Math.abs(value))}`
          const main = cls ? `<span class="${cls}">${body}</span>` : body
          const nativeText = `${sym}${formatAmount(Math.abs(native))}`
          // 外币时把原币金额并与涨跌幅一起塞进同一对括号，避免出现两组括号
          const tail = needFx
            ? (extra ? `${extra} · ${nativeText}` : nativeText)
            : extra
          return tail ? `${main}（${tail}）` : main
        }

        if (q) {
          const pct = toNumber(q.changePct)
          const cls = pct > 0 ? 't-up' : pct < 0 ? 't-down' : 't-muted'
          rows.push(previewRow('最新价', `${sym}${priceText(q.price)} <span class="${cls}">${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>`))
        }

        if (Number.isFinite(shares) && shares > 0 && price > 0) {
          const mv = shares * price
          rows.push(previewRow('持仓市值', cnyHtml(mv)))

          if (Number.isFinite(cost) && cost > 0) {
            const costValue = shares * cost
            const profit = mv - costValue
            const pct = (profit / costValue) * 100
            const cls = profit > 0 ? 't-up' : profit < 0 ? 't-down' : 't-muted'
            const pctText = fxMissing ? '' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
            rows.push(previewRow('浮动盈亏', cnyHtml(profit, { signed: true, cls, extra: pctText })))
          }

          const dp = q && q.prevClose > 0 ? shares * (q.price - q.prevClose) : null
          if (dp !== null) {
            const cls = dp > 0 ? 't-up' : dp < 0 ? 't-down' : 't-muted'
            rows.push(previewRow('当日盈亏', cnyHtml(dp, { signed: true, cls })))
          }
        }

        if (needFx && !fxMissing) {
          rows.push(previewRow('汇率', `${cur} 1 = ¥${fx.toFixed(4)}`))
        } else if (fxMissing) {
          rows.push(previewRow('汇率', '<span class="t-down">未取到，请先刷新行情</span>'))
        }

        if (q && q.priceTime) {
          rows.push(previewRow('行情时间', escapeHtml(q.priceTime)))
        }

        previewEl.innerHTML = rows.length
          ? rows.join('')
          : '<div class="quote-preview__empty">填入代码与份额后，这里会显示市值与盈亏</div>'
      }

      async function doLookup(auto = false) {
        const raw = symbolEl.value.trim()
        if (!raw) {
          if (!auto) hintEl.textContent = '请先填写代码'
          return
        }
        draft.loading = true
        hintEl.textContent = '正在查询…'
        renderPreview()
        setBusy(lookupBtn, true, '查询中…')
        try {
          const q = await lookupSymbol(draft.group, raw)
          draft.quote = q
          symbolEl.value = q.symbol
          if (q.name) nameEl.value = q.name
          hintEl.textContent = `已获取：${q.name || q.symbol}`
        } catch (err) {
          draft.quote = null
          hintEl.textContent = err.message || '没有查到这只标的'
        } finally {
          draft.loading = false
          setBusy(lookupBtn, false)
          renderPreview()
        }
      }

      let lastLookup = ''
      marketEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-group]')
        if (!btn || btn.dataset.group === draft.group) return
        draft.group = btn.dataset.group
        draft.quote = null
        lastLookup = ''
        syncMarket()
        renderPreview()
      })

      lookupBtn.addEventListener('click', () => { lastLookup = ''; doLookup() })

      symbolEl.addEventListener('blur', () => {
        const raw = symbolEl.value.trim()
        if (raw && raw !== lastLookup) {
          lastLookup = raw
          doLookup(true)
        }
      })

      symbolEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          lastLookup = ''
          doLookup()
        }
      })

      sharesEl.addEventListener('input', renderPreview)
      costEl.addEventListener('input', renderPreview)

      function showError(msg) {
        errEl.textContent = msg
        errEl.classList.remove('hidden')
      }

      async function save() {
        const raw = symbolEl.value.trim()
        if (!raw) return showError('请填写代码')
        const symbol = normalizeSymbol(draft.group, raw)
        if (!symbol) return showError('请填写代码')
        const shares = parseAmount(sharesEl.value)
        if (!Number.isFinite(shares) || shares <= 0) return showError('请填写大于 0 的持有份额')

        let cost = null
        const costRaw = costEl.value.trim()
        if (costRaw !== '') {
          const parsed = parseAmount(costRaw)
          if (!Number.isFinite(parsed) || parsed < 0) return showError('成本单价请填写数字')
          cost = parsed
        }
        errEl.classList.add('hidden')

        // 成本总额用于精确摊薄计算，避免单价四舍五入带来的累计误差；
        // 只有份额或成本价真的改了才重算，否则保留原账目值
        const costNorm = cost === null ? 0 : cost
        const costTouched = !editing
          || toNumber(holding.shares) !== shares
          || toNumber(holding.cost_price) !== costNorm

        const payload = {
          account_id: Number(accountEl.value),
          market: marketOf(draft.group, symbol),
          symbol,
          name: nameEl.value.trim() || (draft.quote && draft.quote.name) || null,
          shares,
          cost_price: cost,
          cost_amount: costTouched
            ? (cost === null ? null : Math.round(shares * cost * 10000) / 10000)
            : (holding.cost_amount ?? null),
        }

        setBusy(saveBtn, true, '保存中…')
        try {
          if (editing) {
            await store.updateHolding(holding.id, payload)
          } else {
            payload.sort_order = state.holdings.length
            const created = await store.createHolding(payload)
            // 首次登记视为「建仓」：记录一笔建仓交易，后续买卖才有成本依据
            if (created && toNumber(created.shares) > 0) {
              try {
                await store.createHoldingTrade(buildOpeningTrade({
                  holdingId: created.id,
                  accountId: created.account_id,
                  market: created.market,
                  symbol: created.symbol,
                  name: created.name,
                  shares: toNumber(created.shares),
                  price: created.cost_price,
                  date: todayISO(),
                }))
              } catch (err) { /* 建仓记录写入失败不影响持仓本身 */ }
            }
          }
          sheet.close()
          await loadAll()
          const res = await refreshQuotes({ force: true, silent: true })
          requestRender()
          toastOk(editing ? '持仓已更新' : '持仓已添加')
          if (res && res.error) toastErr(`行情获取失败：${res.error}`)
        } catch (err) {
          setBusy(saveBtn, false)
          showError(describeError(err))
        }
      }

      foot.querySelector('[data-act="cancel"]').addEventListener('click', () => sheet.close())
      saveBtn.addEventListener('click', save)

      const delBtn = foot.querySelector('[data-act="delete"]')
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '删除持仓',
            message: `确定删除「${escapeHtml(holding.name || holding.symbol)}」这条持仓吗？删除后不影响已有流水记录。`,
            confirmText: '删除',
            danger: true,
          })
          if (!ok) return
          try {
            await store.deleteHolding(holding.id)
            sheet.close()
            await loadAll()
            requestRender()
            toastOk('持仓已删除')
          } catch (err) {
            showError(describeError(err))
          }
        })
      }

      syncMarket()
      renderPreview()
      if (!holding) symbolEl.focus({ preventScroll: true })
    },
  })

  return sheet
}

/* ---------------- 买入 / 卖出 ---------------- */

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function sharesUnit(v) {
  const n = toNumber(v)
  return Number.isInteger(n) ? formatAmount(n, 0) : formatAmount(n, 2)
}

/** 预览区的统一行 */
function tradeRow(label, valueHtml, cls = '') {
  return `<div class="quote-preview__row"><span>${escapeHtml(label)}</span><strong class="num ${cls}">${valueHtml}</strong></div>`
}

/**
 * 买入 / 卖出弹层。
 * @param {object} holding 目标持仓
 * @param {'buy'|'sell'} side
 */
export function openTradeSheet(holding, side = 'buy') {
  const buy = side === 'buy'
  const account = accountById(holding.account_id)
  const price = holdingPrice(holding)
  const cost = toNumber(holding.cost_price)
  const heldShares = toNumber(holding.shares)
  const code = displayCode(holding.market, holding.symbol)
  const quoteReady = toNumber(holding.last_price) > 0
  // 成交价、成交额、手续费都是该市场的计价币种，只有账户现金是人民币
  const cur = holdingCurrency(holding)
  const curSym = CURRENCY_SYMBOL[cur] || '¥'
  const fxNow = fxRate(cur) || 1
  const toCny = (v) => v * fxNow

  const pool = state.accounts.filter(
    (a) => !a.is_archived && String(a.id) !== String(holding.account_id)
  )

  const draft = {
    source: 'account',
    linkAccount: pool.length ? String(pool[0].id) : '',
  }

  const linkOpts = pool
    .map((a) => `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`)
    .join('')

  const sellAllBtn = buy ? '' : '<button class="btn btn--ghost" type="button" data-act="all">全部</button>'

  const body = html(`
    <div class="form-grid">
      <div class="trade-head">
        <div class="trade-head__row">
          <span class="trade-head__name">${escapeHtml(holding.name || code)}</span>
          <span class="badge badge--${buy ? 'up' : 'down'}">${buy ? '买入' : '卖出'}</span>
        </div>
        <div class="trade-head__sub">${escapeHtml([code, account ? account.name : ''].filter(Boolean).join(' · '))}</div>
      </div>

      <div class="quote-preview" id="ts-holding"></div>

      <div class="form-grid form-grid--2">
        <div class="form-row">
          <label>成交价</label>
          <input class="input" id="ts-price" type="text" inputmode="decimal" autocomplete="off"
                 value="${escapeHtml(price > 0 ? String(price) : '')}" placeholder="如 1680.00">
          <p class="field__hint" id="ts-price-hint"></p>
        </div>
        <div class="form-row">
          <label>${buy ? '买入数量' : '卖出数量'}</label>
          <div class="field__row">
            <input class="input" id="ts-shares" type="text" inputmode="decimal" autocomplete="off" placeholder="如 100">
            ${sellAllBtn}
          </div>
          <p class="field__hint">${buy ? '按份额 / 股数填写' : `当前可卖 ${sharesUnit(heldShares)} 份`}</p>
        </div>
      </div>

      <div class="form-grid form-grid--2">
        <div class="form-row">
          <label>手续费（选填）</label>
          <input class="input" id="ts-fee" type="text" inputmode="decimal" autocomplete="off" value="0">
        </div>
        <div class="form-row">
          <label>成交日期</label>
          <input class="input" id="ts-date" type="date" value="${todayISO()}">
        </div>
      </div>

      ${pool.length ? `
      <div class="form-row">
        <label>资金处理</label>
        <div class="segmented" id="ts-source" style="justify-self:start">
          <button class="segmented__btn is-active" type="button" data-source="account">${buy ? '用账户可用资金' : '留在账户'}</button>
          <button class="segmented__btn" type="button" data-source="link">${buy ? '从其他账户转入' : '转出到其他账户'}</button>
        </div>
        <div class="hidden" id="ts-link-wrap" style="margin-top:10px">
          <label class="field__label">${buy ? '转入来源账户' : '转出目标账户'}</label>
          <select class="select" id="ts-link-account">${linkOpts}</select>
          <p class="field__hint">将自动生成一条账户转账记录，保持资金流向可追溯</p>
        </div>
      </div>` : ''}

      <div class="form-row">
        <label>备注（选填）</label>
        <input class="input" id="ts-note" type="text" maxlength="40" autocomplete="off"
               placeholder="${buy ? '如：定投加仓' : '如：止盈减仓'}">
      </div>

      <div class="quote-preview" id="ts-preview"></div>
      <p id="ts-error" class="field__error hidden"></p>
    </div>
  `)

  const foot = html(`
    <div style="display:flex;gap:10px;width:100%">
      <button class="btn btn--ghost" type="button" data-act="cancel">取消</button>
      <button class="btn btn--primary" type="button" data-act="save">${buy ? '确认买入' : '确认卖出'}</button>
    </div>
  `)

  const sheet = openSheet({
    title: buy ? '买入 / 加仓' : '卖出 / 减仓',
    body,
    footer: foot,
    onMount: (root) => {
      const priceEl = root.querySelector('#ts-price')
      const priceHint = root.querySelector('#ts-price-hint')
      const sharesEl = root.querySelector('#ts-shares')
      const feeEl = root.querySelector('#ts-fee')
      const dateEl = root.querySelector('#ts-date')
      const noteEl = root.querySelector('#ts-note')
      const holdingEl = root.querySelector('#ts-holding')
      const previewEl = root.querySelector('#ts-preview')
      const errEl = root.querySelector('#ts-error')
      const sourceEl = root.querySelector('#ts-source')
      const linkWrap = root.querySelector('#ts-link-wrap')
      const linkEl = root.querySelector('#ts-link-account')
      const saveBtn = foot.querySelector('[data-act="save"]')

      priceHint.textContent = quoteReady
        ? `最新价 ${priceText(holding.last_price)}，已自动填入`
        : '暂无行情，请手动填写成交价'

      holdingEl.innerHTML = [
        tradeRow('当前持有', `${sharesUnit(heldShares)} 份`),
        cost > 0 ? tradeRow('持仓成本价', `${curSym}${priceText(cost)}`) : '',
        quoteReady ? tradeRow('最新价', `${curSym}${priceText(holding.last_price)}`) : '',
        tradeRow('账户可用资金', `¥${formatAmount(accountCash(account))}`),
      ].filter(Boolean).join('')

      function readInput() {
        const price = parseAmount(priceEl.value)
        const shares = parseAmount(sharesEl.value)
        const fee = feeEl.value.trim() === '' ? 0 : parseAmount(feeEl.value)
        return {
          price: Number.isFinite(price) ? price : NaN,
          shares: Number.isFinite(shares) ? shares : NaN,
          fee: Number.isFinite(fee) ? fee : NaN,
        }
      }

      function renderPreview() {
        const { price, shares, fee } = readInput()
        const rows = []
        if (Number.isFinite(price) && Number.isFinite(shares) && price > 0 && shares > 0) {
          const amount = roundMoney(shares * price)
          const feeValue = Number.isFinite(fee) ? fee : 0
          rows.push(tradeRow('成交金额', `${curSym}${formatAmount(amount)}`))
          if (feeValue > 0) rows.push(tradeRow('手续费', `${curSym}${formatAmount(feeValue)}`))

          if (buy) {
            const newShares = heldShares + shares
            const totalCost = heldShares * cost + amount + feeValue
            const newCost = newShares > 0 ? totalCost / newShares : 0
            rows.push(tradeRow('摊薄后成本价', `${curSym}${priceText(newCost)}`, 't-strong'))
            if (cost > 0) {
              const diff = newCost - cost
              rows.push(tradeRow('成本变动', `<span class="${diff <= 0 ? 't-down' : 't-up'}">${diff >= 0 ? '+' : '-'}${curSym}${priceText(Math.abs(diff))}</span>`))
            }
            rows.push(tradeRow('买入后份额', `${sharesUnit(newShares)} 份`))
            // 人民币账户实际扣的是折后金额，外币成交时一并给出，避免以为扣的是原币数额
            const needLocal = amount + feeValue
            rows.push(tradeRow('需要资金', cur === 'CNY'
              ? `¥${formatAmount(needLocal)}`
              : `${curSym}${formatAmount(needLocal)}（约 ¥${formatAmount(toCny(needLocal))}）`))
          } else {
            const realized = roundMoney(amount - feeValue - shares * cost)
            const realizedCny = toCny(realized)
            rows.push(tradeRow('本次盈亏',
              `<span class="${realized > 0 ? 't-up' : realized < 0 ? 't-down' : 't-muted'}">${cur === 'CNY'
                ? formatSigned(realized)
                : `${formatSigned(realized)}（约 ¥${formatSigned(realizedCny)}）`}</span>`))
            if (cost > 0 && shares * cost > 0) {
              const pct = (realized / (shares * cost)) * 100
              rows.push(tradeRow('本次收益率', `<span class="${pct > 0 ? 't-up' : pct < 0 ? 't-down' : 't-muted'}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>`))
            }
            const rest = heldShares - shares
            rows.push(tradeRow('卖出后份额', rest > 1e-6
              ? `${sharesUnit(rest)} 份`
              : '<span class="t-warn">0 份 · 将清仓</span>'))
          }
        }

        if (draft.source === 'link') {
          const { price, shares, fee } = readInput()
          if (Number.isFinite(price) && Number.isFinite(shares) && price > 0 && shares > 0) {
            const feeValue = Number.isFinite(fee) ? fee : 0
            const net = buy ? roundMoney(shares * price + feeValue) : roundMoney(shares * price - feeValue)
            const target = state.accounts.find((a) => String(a.id) === String(draft.linkAccount))
            rows.push(tradeRow(buy ? '从来源账户转入' : '转出到目标账户',
              `${escapeHtml(target ? target.name : '')} ${buy ? '-' : '+'}¥${formatAmount(net)}`))
          }
        }

        previewEl.innerHTML = rows.length
          ? rows.join('')
          : '<div class="quote-preview__empty">填入成交价与数量后，这里会显示摊薄成本 / 本次盈亏</div>'
      }

      if (sourceEl) {
        sourceEl.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-source]')
          if (!btn) return
          draft.source = btn.dataset.source
          Array.from(sourceEl.children).forEach((b) => b.classList.toggle('is-active', b === btn))
          linkWrap.classList.toggle('hidden', draft.source !== 'link')
          renderPreview()
        })
        if (linkEl) linkEl.addEventListener('change', (e) => { draft.linkAccount = e.target.value; renderPreview() })
      }

      sharesEl.addEventListener('input', renderPreview)
      priceEl.addEventListener('input', renderPreview)
      feeEl.addEventListener('input', renderPreview)

      const allBtn = root.querySelector('[data-act="all"]')
      if (allBtn) {
        allBtn.addEventListener('click', () => {
          sharesEl.value = String(heldShares)
          renderPreview()
        })
      }

      function showError(msg) {
        errEl.textContent = msg
        errEl.classList.remove('hidden')
      }

      async function save() {
        const { price, shares, fee } = readInput()
        if (!Number.isFinite(price) || price <= 0) return showError('请填写大于 0 的成交价')
        if (!Number.isFinite(shares) || shares <= 0) return showError('请填写大于 0 的成交数量')
        if (!buy && shares > heldShares + 1e-6) {
          return showError(`卖出数量不能超过当前持有的 ${sharesUnit(heldShares)} 份`)
        }
        const feeValue = Number.isFinite(fee) ? fee : 0
        const date = dateEl.value || todayISO()
        const note = noteEl.value.trim()
        const amount = roundMoney(shares * price)
        errEl.classList.add('hidden')

        setBusy(saveBtn, true, '提交中…')
        try {
          // 需要跨账户划转资金时，先生成一条转账流水
          if (draft.source === 'link' && draft.linkAccount) {
            const net = buy ? roundMoney(amount + feeValue) : roundMoney(amount - feeValue)
            if (net > 0) {
              await store.createTransaction({
                type: 'transfer',
                amount: net,
                account_id: buy ? Number(draft.linkAccount) : Number(holding.account_id),
                to_account_id: buy ? Number(holding.account_id) : Number(draft.linkAccount),
                category: 'transfer',
                occurred_on: date,
                note: `${buy ? '转入买入' : '卖出转出'} ${holding.name || code}`.slice(0, 40),
              })
            }
          }

          const { holding: after } = await applyTrade({
            holding, side, shares, price, fee: feeValue, date, note,
          })

          sheet.close()
          await loadAll()
          const res = await refreshQuotes({ force: true, silent: true })
          requestRender()

          if (!buy && toNumber(after.shares) <= 0) {
            toastOk(`已清仓 ${holding.name || code}，可在清仓记录中查看`)
          } else {
            toastOk(buy ? '买入已记录，持仓成本已摊薄' : '卖出已记录')
          }
          if (res && res.error) toastErr(`行情获取失败：${res.error}`)
        } catch (err) {
          setBusy(saveBtn, false)
          showError(describeError(err))
        }
      }

      foot.querySelector('[data-act="cancel"]').addEventListener('click', () => sheet.close())
      saveBtn.addEventListener('click', save)

      renderPreview()
      sharesEl.focus({ preventScroll: true })
    },
  })

  return sheet
}

/* ---------------- 单只标的的交易明细 ---------------- */

export function openTradesSheet(holding) {
  const list = tradesOfHolding(holding.id).slice().reverse()
  const code = displayCode(holding.market, holding.symbol)
  const cur = holdingCurrency(holding)
  const curSym = CURRENCY_SYMBOL[cur] || '¥'
  // 已实现盈亏按成交币种记账，展示时折成人民币
  const realized = toNumber(holding.realized_profit) * (fxRate(cur) || 1)

  const body = html(`
    <div class="form-grid">
      <div class="trade-head">
        <div class="trade-head__row">
          <span class="trade-head__name">${escapeHtml(holding.name || code)}</span>
          ${holding.closed_at ? '<span class="badge badge--flat">已清仓</span>' : ''}
        </div>
        <div class="trade-head__sub">${escapeHtml(code)} · 共 ${list.length} 笔交易</div>
      </div>

      <div class="quote-preview">
        ${holding.closed_at
          ? tradeRow('累计已实现盈亏',
            `<span class="${realized > 0 ? 't-up' : realized < 0 ? 't-down' : 't-muted'}">${formatSigned(realized)}</span>`)
          : ''}
        ${tradeRow('当前持有', `${sharesUnit(holding.shares)} 份`)}
        ${toNumber(holding.cost_price) > 0 ? tradeRow('持仓成本价', `${curSym}${priceText(holding.cost_price)}`) : ''}
      </div>

      <div class="list list--trades">
        ${list.length
          ? list.map((t) => tradeRowHtml(t, cur)).join('')
          : `<div class="empty"><div class="empty__icon">📄</div><div class="empty__title">还没有交易记录</div></div>`}
      </div>
      <p class="field__hint">删除某条记录后，持仓份额、成本价与已实现盈亏会自动重算。</p>
    </div>
  `)

  const sheet = openSheet({
    title: '交易明细',
    body,
    onMount: (root) => {
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act="del-trade"]')
        if (!btn) return
        const trade = state.trades.find((t) => String(t.id) === btn.dataset.id)
        if (!trade) return
        const ok = await confirmDialog({
          title: '删除交易记录',
          message: `确定删除 ${trade.traded_on} 的这笔${trade.side === 'buy' ? '买入' : '卖出'}记录吗？持仓份额与成本价会按剩余记录重新计算。`,
          confirmText: '删除',
          danger: true,
        })
        if (!ok) return
        try {
          await removeTrade(trade)
          await loadAll()
          requestRender()
          toastOk('记录已删除，持仓已重算')
          sheet.close()
          // 记录变化后重开明细，展示重算后的最新状态
          const fresh = state.holdings.find((h) => String(h.id) === String(holding.id))
          if (fresh) openTradesSheet(fresh)
        } catch (err) {
          toastErr(describeError(err))
        }
      })
    },
  })
}

function tradeRowHtml(t, currency = 'CNY') {
  const buy = t.side === 'buy'
  const curSym = CURRENCY_SYMBOL[currency] || '¥'
  // 成交价与成交额都是成交币种原值，只有已实现盈亏要折成人民币
  const parts = [
    `${curSym}${priceText(t.price)} × ${sharesUnit(t.shares)}`,
  ]
  if (toNumber(t.fee) > 0) parts.push(`费 ${curSym}${formatAmount(t.fee)}`)
  if (t.note) parts.push(t.note)

  const right = buy
    ? `<span class="t-expense num">-${curSym}${formatAmount(t.amount)}</span>`
    : `<span class="t-income num">+${curSym}${formatAmount(t.amount)}</span>`

  const realizedCny = t.realized_profit === null || t.realized_profit === undefined
    ? null
    : toNumber(t.realized_profit) * (fxRate(currency) || 1)
  const realized = realizedCny === null
    ? ''
    : `<span class="trade-item__realized num ${realizedCny > 0 ? 't-up' : realizedCny < 0 ? 't-down' : 't-muted'}">${formatSigned(realizedCny)}</span>`

  return `
    <div class="trade-item">
      <span class="trade-item__tag trade-item__tag--${buy ? 'buy' : 'sell'}">${buy ? '买' : '卖'}</span>
      <span class="trade-item__main">
        <span class="trade-item__title">${escapeHtml(parts.join(' · '))}</span>
        <span class="trade-item__sub">${escapeHtml(friendlyDate(t.traded_on))}${t.is_opening ? ' · 建仓' : ''}</span>
      </span>
      <span class="trade-item__right">
        ${right}${realized}
      </span>
      <button class="icon-btn" type="button" data-act="del-trade" data-id="${t.id}" title="删除记录" aria-label="删除记录">✕</button>
    </div>`
}

/* ---------------- 说明弹层 ---------------- */

export function openHelpSheet() {
  openSheet({
    title: '使用说明',
    body: `
      <div class="sheet__text">
        <p><strong>流水与余额</strong><br>支出会让账户余额减少，收入让余额增加，转账只在不同账户之间移动资金，不影响收支统计。</p>
        <p style="margin-top:12px"><strong>净资产怎么算</strong><br>净资产 = 所有资产账户余额之和 − 所有负债账户欠款之和。账户可以在编辑里设置「不计入净资产统计」。</p>
        <p style="margin-top:12px"><strong>持仓与自动净值</strong><br>在「资产 → 投资持仓」里录入股票或基金（市场类型 + 代码 + 份额 + 成本价），系统会按最新行情自动算市值和盈亏，账户市值、净资产都会跟着变，不用每天手改。<br>打开应用、切到「资产」或「概览」页时会自动更新一次行情；也可以点「刷新行情」手动拉取。行情为公开延时数据，仅供个人记账参考。</p>
        <p style="margin-top:12px"><strong>买入与卖出</strong><br>每只持仓都有「买入 / 卖出」按钮：买入会把成交金额和手续费摊进成本价（移动加权平均），卖出按单位成本结算已实现盈亏；份额卖到零即自动清仓，进入「清仓记录」，保留买入均价、卖出均价、持有天数和最终盈亏。资金处理默认在账户内流转；选择「从其他账户转入 / 转出到其他账户」时会自动生成一条转账流水，保持资金账目可追溯。</p>
        <p style="margin-top:12px"><strong>支持的标的</strong><br>A股与场内 ETF / LOF、港股、美股、场外基金（开放式基金净值）。场外基金给的是每日净值，通常晚间更新；港美股有交易时差，显示的可能是上一交易日的收盘价。</p>
        <p style="margin-top:12px"><strong>资产走势</strong><br>每次打开应用或手动点「记录快照」，都会把当天净资产存一条记录（同一天只保留最新一条）。走势图支持近 1 月 / 3 月 / 半年 / 1 年 / 全部切换，同时对比总资产、总负债与净资产三条线，概览页也有简版走势。</p>
        <p style="margin-top:12px"><strong>数据安全</strong><br>所有数据保存在云端，与你的账号绑定。每条记录在数据库层面都带权限校验，其他账号无法读取或修改。</p>
      </div>`,
  })
}

/* ============================================================
   财务目标 / 自选列表
   ============================================================ */

export function openGoalSheet() {
  const g = goal()
  const body = html(`
    <div class="form-grid">
      <div class="form-row">
        <label>目标金额</label>
        <input class="input" id="goal-amount" type="text" inputmode="decimal" autocomplete="off"
               placeholder="如 5000000" value="${toNumber(g.target_amount) > 0 ? escapeHtml(String(toNumber(g.target_amount))) : ''}">
        <p class="field__hint">用当前净资产除以这个数，就是金额完成度</p>
      </div>
      <div class="form-row">
        <label>年被动收入（选填）</label>
        <input class="input" id="goal-income" type="text" inputmode="decimal" autocomplete="off"
               placeholder="如 60000" value="${toNumber(g.passive_income) > 0 ? escapeHtml(String(toNumber(g.passive_income))) : ''}">
        <p class="field__hint">只是想记下来的一个数，暂不参与计算</p>
      </div>
      <div class="form-row">
        <label>目标时间</label>
        <input class="input" id="goal-date" type="date" value="${escapeHtml(g.target_date || '')}">
        <p class="field__hint">从第一次设定那天算起，用来看时间进度</p>
      </div>
      <p id="goal-error" class="field__error hidden"></p>
    </div>
  `)

  const foot = html(`
    <div style="display:flex;gap:10px;width:100%">
      <button class="btn btn--ghost" type="button" data-act="cancel">取消</button>
      <button class="btn btn--primary" type="button" data-act="save">保存</button>
    </div>
  `)

  const sheet = openSheet({
    title: '财务目标',
    body,
    footer: foot,
    onMount: (root) => {
      const amountEl = root.querySelector('#goal-amount')
      const incomeEl = root.querySelector('#goal-income')
      const dateEl = root.querySelector('#goal-date')
      const errEl = root.querySelector('#goal-error')
      const saveBtn = foot.querySelector('[data-act="save"]')

      async function save() {
        const amount = parseAmount(amountEl.value)
        const income = parseAmount(incomeEl.value)
        if (Number.isFinite(amount) && amount < 0) return showError('目标金额不能是负数')
        if (Number.isFinite(income) && income < 0) return showError('年被动收入不能是负数')

        setBusy(saveBtn, true, '保存中…')
        try {
          await saveGoal({
            target_amount: Number.isFinite(amount) ? amount : 0,
            passive_income: Number.isFinite(income) ? income : 0,
            target_date: dateEl.value || '',
          })
          sheet.close()
          toastOk('目标已保存')
        } catch (err) {
          showError(describeError(err, '保存目标失败'))
        } finally {
          setBusy(saveBtn, false)
        }
      }

      function showError(msg) {
        errEl.textContent = msg
        errEl.classList.remove('hidden')
      }

      saveBtn.addEventListener('click', save)
      foot.querySelector('[data-act="cancel"]').addEventListener('click', () => sheet.close())
    },
  })
}
