(function startBudgetApp() {
  'use strict';

  window.BudgetAppV2 = true;

  const {
    getBudgetPeriod,
    getPeriodKey,
    getPeriodSetting,
    getSavingGoalStatus,
    isDateInPeriod,
    isSubscriptionActiveInPeriod,
    parseLocalDate,
    summarizePeriod,
    toDateInputValue
  } = window.BudgetAppCore;

  const STATE_KEY = 'simple-budget-state-v2';
  const LEGACY_KEYS = {
    transactions: 'simple-budget-expenses',
    budget: 'simple-budget-monthly-budget',
    subscriptions: 'simple-budget-subscriptions',
    goal: 'simple-budget-saving-goal',
    monthStartDay: 'simple-budget-month-start-day',
    categories: 'simple-budget-categories',
    income: 'simple-budget-monthly-income',
    favorites: 'simple-budget-favorite-expenses',
    lastExport: 'simple-budget-last-csv-export-at',
    dataChanged: 'simple-budget-data-changed-at'
  };
  const DEFAULT_CATEGORIES = ['食費', '日用品', '趣味', 'その他'];
  const INCOME_CATEGORIES = ['給料', '副収入', '臨時収入', 'その他'];
  const PAYMENT_METHODS = ['unspecified', 'cash', 'card', 'emoney', 'bank', 'other'];
  const PAYMENT_LABELS = {
    unspecified: '未設定',
    cash: '現金',
    card: 'クレジットカード',
    emoney: '電子マネー',
    bank: '口座振替',
    other: 'その他'
  };
  const HISTORY_PREVIEW_LIMIT = 3;
  const MAX_AMOUNT = 999999999999;
  const CHART_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#2dd4bf', '#f97316', '#818cf8'];

  const byId = (id) => document.getElementById(id);
  const form = byId('expenseForm');
  const budgetForm = byId('budgetForm');
  const savingGoalForm = byId('savingGoalForm');
  const subscriptionForm = byId('subscriptionForm');
  const historySection = byId('historySection');
  const expenseDateInput = byId('expenseDate');
  const amountInput = byId('amount');
  const transactionTypeInput = byId('transactionType');
  const categoryInput = byId('category');
  const categoryLabel = byId('categoryLabel');
  const expenseNoteInput = byId('expenseNote');
  const paymentMethodInput = byId('paymentMethod');
  const paymentMethodField = byId('paymentMethodField');
  const expenseSubmitButton = byId('expenseSubmitButton');
  const saveFavoriteButton = byId('saveFavoriteButton');
  const cancelExpenseEditButton = byId('cancelExpenseEditButton');
  const editExpenseNotice = byId('editExpenseNotice');
  const budgetInput = byId('budget');
  const savingGoalInput = byId('savingGoalInput');
  const subscriptionNameInput = byId('subscriptionName');
  const subscriptionAmountInput = byId('subscriptionAmount');
  const subscriptionCycleInput = byId('subscriptionCycle');
  const subscriptionSubmitButton = byId('subscriptionSubmitButton');
  const subscriptionCancelEditButton = byId('subscriptionCancelEditButton');
  const historyList = byId('historyList');
  const favoriteExpensesList = byId('favoriteExpensesList');
  const subscriptionList = byId('subscriptionList');
  const categorySettingsList = byId('categorySettingsList');
  const categoryAddForm = byId('categoryAddForm');
  const categoryAddInput = byId('categoryAddInput');
  const monthStartDayInput = byId('monthStartDay');
  const overviewPanel = byId('overviewPanel');
  const inputPanel = byId('inputPanel');
  const fixedCostPanel = byId('fixedCostPanel');
  const tabButtons = [byId('overviewTab'), byId('inputTab'), byId('fixedCostTab')];
  const goalCelebration = byId('goalCelebration');
  const goalCelebrationClose = byId('goalCelebrationClose');
  const undoToast = byId('undoToast');
  const undoToastMessage = byId('undoToastMessage');
  const undoToastButton = byId('undoToastButton');
  const importCsvInput = byId('importCsvInput');

  let selectedMonthOffset = 0;
  let activePanel = 'overview';
  let isHistoryExpanded = false;
  let editingTransactionId = null;
  let editingSubscriptionId = null;
  let undoAction = null;
  let undoTimer = null;
  let categoryChart = null;
  let loadWarning = '';
  let corruptedStateDetected = false;
  let lastFocusedBeforeModal = null;
  let lastExpenseCategory = DEFAULT_CATEGORIES[0];
  let lastPaymentMethod = 'unspecified';

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function safeJsonParse(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function validAmount(value) {
    const amount = Number(value);
    return Number.isSafeInteger(Math.round(amount)) && amount > 0 && amount <= MAX_AMOUNT;
  }

  function isValidDateInput(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = parseLocalDate(value);
    return !Number.isNaN(date.getTime()) && toDateInputValue(date) === value;
  }

  function normalizeCategoryName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 16);
  }

  function uniqueCategoryNames(values) {
    const result = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const name = normalizeCategoryName(value);
      if (name && !result.includes(name)) result.push(name);
    });
    return result.length > 0 ? result : DEFAULT_CATEGORIES.slice();
  }

  function normalizeSettingsMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
      const amount = Number(raw);
      return /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(amount) && amount >= 0
        ? [[key, Math.round(amount)]]
        : [];
    }));
  }

  function normalizeTransaction(raw, categories, usedIds) {
    if (!raw || typeof raw !== 'object' || !validAmount(Number(raw.amount))) return null;
    const type = raw.type === 'income' ? 'income' : 'expense';
    const dateValue = raw.transactionDate || raw.expenseDate;
    const transactionDate = isValidDateInput(dateValue)
      ? dateValue
      : toDateInputValue(new Date(raw.createdAt || Date.now()));
    const allowedCategories = type === 'income' ? INCOME_CATEGORIES : categories;
    const fallbackCategory = allowedCategories.includes('その他') ? 'その他' : allowedCategories[0];
    let id = typeof raw.id === 'string' && raw.id ? raw.id : createId();
    if (usedIds.has(id)) id = createId();
    usedIds.add(id);
    return {
      id,
      type,
      amount: Math.round(Number(raw.amount)),
      category: allowedCategories.includes(raw.category) ? raw.category : fallbackCategory,
      transactionDate,
      note: String(raw.note || '').trim().slice(0, 60),
      paymentMethod: type === 'expense' && PAYMENT_METHODS.includes(raw.paymentMethod)
        ? raw.paymentMethod
        : 'unspecified',
      createdAt: Number.isNaN(new Date(raw.createdAt).getTime()) ? new Date().toISOString() : raw.createdAt
    };
  }

  function normalizeFavorite(raw, categories, usedIds) {
    if (!raw || typeof raw !== 'object' || !validAmount(Number(raw.amount))) return null;
    const fallbackCategory = categories.includes('その他') ? 'その他' : categories[0];
    let id = typeof raw.id === 'string' && raw.id ? raw.id : createId();
    if (usedIds.has(id)) id = createId();
    usedIds.add(id);
    return {
      id,
      amount: Math.round(Number(raw.amount)),
      category: categories.includes(raw.category) ? raw.category : fallbackCategory,
      note: String(raw.note || '').trim().slice(0, 60),
      paymentMethod: PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : 'unspecified',
      createdAt: Number.isNaN(new Date(raw.createdAt).getTime()) ? new Date().toISOString() : raw.createdAt
    };
  }

  function normalizeSubscription(raw, usedIds) {
    if (!raw || typeof raw !== 'object' || !String(raw.name || '').trim() || !validAmount(Number(raw.amount))) return null;
    let id = typeof raw.id === 'string' && raw.id ? raw.id : createId();
    if (usedIds.has(id)) id = createId();
    usedIds.add(id);
    const createdAt = Number.isNaN(new Date(raw.createdAt).getTime()) ? new Date().toISOString() : raw.createdAt;
    const activeFrom = isValidDateInput(raw.activeFrom)
      ? raw.activeFrom
      : toDateInputValue(new Date(createdAt));
    return {
      id,
      name: String(raw.name).trim().slice(0, 40),
      amount: Math.round(Number(raw.amount)),
      cycle: raw.cycle === 'yearly' ? 'yearly' : 'monthly',
      activeFrom,
      archivedAt: isValidDateInput(raw.archivedAt) ? raw.archivedAt : null,
      createdAt
    };
  }

  function normalizeState(raw) {
    const monthStartDay = Number.isInteger(Number(raw.monthStartDay)) && Number(raw.monthStartDay) >= 1 && Number(raw.monthStartDay) <= 28
      ? Number(raw.monthStartDay)
      : 1;
    const categories = uniqueCategoryNames(raw.categories);
    const usedTransactionIds = new Set();
    const usedFavoriteIds = new Set();
    const usedSubscriptionIds = new Set();
    return {
      version: 2,
      monthStartDay,
      categories,
      transactions: (Array.isArray(raw.transactions) ? raw.transactions : [])
        .map((item) => normalizeTransaction(item, categories, usedTransactionIds)).filter(Boolean),
      favoriteExpenses: (Array.isArray(raw.favoriteExpenses) ? raw.favoriteExpenses : [])
        .map((item) => normalizeFavorite(item, categories, usedFavoriteIds)).filter(Boolean),
      subscriptions: (Array.isArray(raw.subscriptions) ? raw.subscriptions : [])
        .map((item) => normalizeSubscription(item, usedSubscriptionIds)).filter(Boolean),
      monthlyBudgets: normalizeSettingsMap(raw.monthlyBudgets),
      savingGoals: normalizeSettingsMap(raw.savingGoals),
      celebratedPeriods: Array.isArray(raw.celebratedPeriods) ? raw.celebratedPeriods.filter((key) => typeof key === 'string') : [],
      lastCsvExportAt: Number.isNaN(new Date(raw.lastCsvExportAt).getTime()) ? null : raw.lastCsvExportAt,
      dataChangedAt: Number.isNaN(new Date(raw.dataChangedAt).getTime()) ? null : raw.dataChangedAt
    };
  }

  function migrateLegacyState() {
    const monthStartDayRaw = Number(localStorage.getItem(LEGACY_KEYS.monthStartDay));
    const monthStartDay = Number.isInteger(monthStartDayRaw) && monthStartDayRaw >= 1 && monthStartDayRaw <= 28 ? monthStartDayRaw : 1;
    const categories = uniqueCategoryNames(safeJsonParse(localStorage.getItem(LEGACY_KEYS.categories), DEFAULT_CATEGORIES));
    const storedLegacyTransactions = safeJsonParse(localStorage.getItem(LEGACY_KEYS.transactions), []);
    if (localStorage.getItem(LEGACY_KEYS.transactions) !== null && !Array.isArray(storedLegacyTransactions)) {
      loadWarning = '古い保存データの一部を読み込めなかったため、読み込める項目だけを復元しました。';
    }
    const transactions = (Array.isArray(storedLegacyTransactions) ? storedLegacyTransactions : [])
      .map((item) => ({ ...item, type: 'expense', transactionDate: item.expenseDate }));
    const legacyIncome = Number(localStorage.getItem(LEGACY_KEYS.income));
    if (Number.isFinite(legacyIncome) && legacyIncome > 0) {
      transactions.push({
        id: createId(),
        type: 'income',
        amount: Math.round(legacyIncome),
        category: '給料',
        transactionDate: toDateInputValue(new Date()),
        note: '旧バージョンの給料設定から移行',
        paymentMethod: 'unspecified',
        createdAt: new Date().toISOString()
      });
    }
    const periodKey = getPeriodKey(getBudgetPeriod(new Date(), monthStartDay));
    const monthlyBudgets = {};
    const savingGoals = {};
    const legacyBudgetRaw = localStorage.getItem(LEGACY_KEYS.budget);
    const legacyGoalRaw = localStorage.getItem(LEGACY_KEYS.goal);
    if (legacyBudgetRaw !== null && Number(legacyBudgetRaw) >= 0) monthlyBudgets[periodKey] = Math.round(Number(legacyBudgetRaw));
    if (legacyGoalRaw !== null && Number(legacyGoalRaw) >= 0) savingGoals[periodKey] = Math.round(Number(legacyGoalRaw));
    return normalizeState({
      version: 2,
      monthStartDay,
      categories,
      transactions,
      favoriteExpenses: safeJsonParse(localStorage.getItem(LEGACY_KEYS.favorites), []),
      subscriptions: safeJsonParse(localStorage.getItem(LEGACY_KEYS.subscriptions), []),
      monthlyBudgets,
      savingGoals,
      lastCsvExportAt: localStorage.getItem(LEGACY_KEYS.lastExport),
      dataChangedAt: localStorage.getItem(LEGACY_KEYS.dataChanged)
    });
  }

  function loadState() {
    const stored = localStorage.getItem(STATE_KEY);
    if (!stored) return migrateLegacyState();
    try {
      return normalizeState(JSON.parse(stored));
    } catch {
      corruptedStateDetected = true;
      loadWarning = '保存データの一部を読み込めませんでした。既存データは上書きしていません。CSVバックアップがあれば読み込んでください。';
      return migrateLegacyState();
    }
  }

  let state = loadState();

  function cloneState() {
    return JSON.parse(JSON.stringify(state));
  }

  function persistState(previousState = null, markChanged = true) {
    if (markChanged) state.dataChangedAt = new Date().toISOString();
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      return true;
    } catch {
      if (previousState) state = previousState;
      window.alert('データの保存に失敗しました。ブラウザの空き容量や設定を確認してください。');
      return false;
    }
  }

  function getSelectedPeriod() {
    const current = getBudgetPeriod(new Date(), state.monthStartDay);
    const start = new Date(current.start.getFullYear(), current.start.getMonth() + selectedMonthOffset, state.monthStartDay);
    return { start, nextStart: new Date(start.getFullYear(), start.getMonth() + 1, state.monthStartDay) };
  }

  function getSelectedPeriodKey() {
    return getPeriodKey(getSelectedPeriod());
  }

  function getSelectedTransactions() {
    const period = getSelectedPeriod();
    return state.transactions.filter((transaction) => isDateInPeriod(transaction.transactionDate, period));
  }

  function formatYen(value) {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(value);
  }

  function formatToday(date) {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${weekdays[date.getDay()]}）`;
  }

  function formatExpenseDate(value) {
    const date = parseLocalDate(value);
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getMonth() + 1}月${date.getDate()}日（${weekdays[date.getDay()]}）`;
  }

  function formatShortDate(date) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function getRemainingDays() {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const { nextStart } = getBudgetPeriod(todayStart, state.monthStartDay);
    return Math.max(Math.round((nextStart.getTime() - todayStart.getTime()) / 86400000), 1);
  }

  function getCategoryOptions(type) {
    return type === 'income' ? INCOME_CATEGORIES : state.categories;
  }

  function updateTransactionFormMode() {
    const type = transactionTypeInput.value === 'income' ? 'income' : 'expense';
    const options = getCategoryOptions(type);
    const previous = categoryInput.value;
    categoryInput.innerHTML = '';
    options.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categoryInput.appendChild(option);
    });
    categoryInput.value = options.includes(previous)
      ? previous
      : type === 'expense' && options.includes(lastExpenseCategory) ? lastExpenseCategory : options[0];
    categoryLabel.textContent = type === 'income' ? '収入カテゴリ' : '支出カテゴリ';
    paymentMethodField.classList.toggle('hidden', type === 'income');
    saveFavoriteButton.classList.toggle('hidden', type === 'income' || Boolean(editingTransactionId));
    expenseSubmitButton.textContent = editingTransactionId
      ? `${type === 'income' ? '収入' : '支出'}の変更を保存`
      : `${type === 'income' ? '収入' : '支出'}を追加`;
  }

  function getDefaultTransactionDate() {
    if (selectedMonthOffset === 0) return toDateInputValue(new Date());
    const { nextStart } = getSelectedPeriod();
    return toDateInputValue(new Date(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate() - 1));
  }

  function resetTransactionForm({ preserveExpenseDefaults = true } = {}) {
    editingTransactionId = null;
    form.reset();
    transactionTypeInput.value = 'expense';
    expenseDateInput.value = getDefaultTransactionDate();
    paymentMethodInput.value = preserveExpenseDefaults ? lastPaymentMethod : 'unspecified';
    editExpenseNotice.classList.add('hidden');
    cancelExpenseEditButton.classList.add('hidden');
    updateTransactionFormMode();
  }

  function startEditingTransaction(transaction) {
    showPanel('input');
    editingTransactionId = transaction.id;
    transactionTypeInput.value = transaction.type;
    updateTransactionFormMode();
    expenseDateInput.value = transaction.transactionDate;
    amountInput.value = transaction.amount;
    categoryInput.value = transaction.category;
    expenseNoteInput.value = transaction.note;
    paymentMethodInput.value = transaction.paymentMethod;
    editExpenseNotice.textContent = `${transaction.type === 'income' ? '収入' : '支出'}を編集中です`;
    editExpenseNotice.classList.remove('hidden');
    cancelExpenseEditButton.classList.remove('hidden');
    updateTransactionFormMode();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    amountInput.focus({ preventScroll: true });
  }

  function hideUndoToast() {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
    undoAction = null;
    undoToast.classList.add('hidden');
    undoToast.classList.remove('flex');
  }

  function showUndoToast(message, action) {
    if (undoTimer) clearTimeout(undoTimer);
    undoAction = action;
    undoToastMessage.textContent = message;
    undoToast.classList.remove('hidden');
    undoToast.classList.add('flex');
    undoTimer = setTimeout(hideUndoToast, 6000);
  }

  function showPanel(panelName) {
    const previousPanel = activePanel;
    activePanel = panelName;
    if (panelName === 'input' && !editingTransactionId && previousPanel !== 'input') {
      isHistoryExpanded = false;
      resetTransactionForm();
    }
    if (panelName === 'fixedCost') {
      selectedMonthOffset = 0;
    }
    overviewPanel.classList.toggle('hidden', panelName !== 'overview');
    inputPanel.classList.toggle('hidden', panelName !== 'input');
    fixedCostPanel.classList.toggle('hidden', panelName !== 'fixedCost');
    tabButtons.forEach((button) => {
      const active = button.dataset.panel === panelName;
      button.setAttribute('aria-current', active ? 'page' : 'false');
      button.className = active
        ? 'flex flex-col items-center justify-center gap-1 rounded-xl bg-emerald-600 px-2 py-2 text-xs font-semibold text-white transition'
        : 'flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold text-slate-500 transition';
    });
    render();
    if (panelName === 'input' && !editingTransactionId) {
      requestAnimationFrame(() => amountInput.focus());
    }
    if (panelName === 'overview' && categoryChart) requestAnimationFrame(() => categoryChart.resize());
  }

  function updatePeriodNavigation() {
    const { start, nextStart } = getSelectedPeriod();
    const end = new Date(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate() - 1);
    byId('periodLabel').textContent = selectedMonthOffset === 0 ? '今月' : `${start.getFullYear()}年${start.getMonth() + 1}月度`;
    byId('periodDateRange').textContent = `${formatShortDate(start)}〜${formatShortDate(end)}`;
    byId('historyPeriodLabel').textContent = `${byId('periodLabel').textContent}の明細`;
    byId('nextMonthButton').disabled = selectedMonthOffset >= 0;
  }

  function getCategoryTotals(transactions) {
    const totals = Object.fromEntries(state.categories.map((category) => [category, 0]));
    transactions.filter((item) => item.type === 'expense').forEach((item) => {
      totals[item.category] = (totals[item.category] || 0) + item.amount;
    });
    return state.categories.map((category) => totals[category] || 0);
  }

  function updateCategoryChart(categoryTotals, total) {
    if (!window.Chart) return;
    const data = total > 0 ? categoryTotals : [1];
    const colors = total > 0 ? state.categories.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]) : ['#e2e8f0'];
    if (!categoryChart) {
      categoryChart = new Chart(byId('categoryChart'), {
        type: 'doughnut',
        data: { labels: total > 0 ? state.categories : ['データなし'], datasets: [{ data, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { enabled: total > 0, callbacks: { label: (context) => `${context.label}: ${formatYen(context.raw)}` } } } }
      });
      return;
    }
    categoryChart.data.labels = total > 0 ? state.categories : ['データなし'];
    categoryChart.data.datasets[0].data = data;
    categoryChart.data.datasets[0].backgroundColor = colors;
    categoryChart.options.plugins.tooltip.enabled = total > 0;
    categoryChart.update();
  }

  function updateCategoryLegend(categoryTotals, total) {
    const legend = byId('categoryLegend');
    legend.innerHTML = '';
    state.categories.forEach((category, index) => {
      const item = document.createElement('div');
      item.className = 'flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2';
      const label = document.createElement('span');
      label.className = 'flex min-w-0 items-center gap-2 text-slate-600';
      const swatch = document.createElement('span');
      swatch.className = 'h-2.5 w-2.5 shrink-0 rounded-full';
      swatch.style.backgroundColor = CHART_COLORS[index % CHART_COLORS.length];
      const name = document.createElement('span');
      name.className = 'truncate';
      name.textContent = category;
      const percent = document.createElement('span');
      percent.className = 'shrink-0 font-semibold text-slate-800';
      percent.textContent = `${total > 0 ? Math.round((categoryTotals[index] / total) * 100) : 0}%`;
      label.append(swatch, name);
      item.append(label, percent);
      legend.appendChild(item);
    });
  }

  function createHistoryItem(transaction) {
    const item = document.createElement('li');
    item.className = 'flex items-center justify-between gap-3 rounded-lg bg-white p-4 shadow-sm';
    const detail = document.createElement('div');
    detail.className = 'min-w-0';
    const meta = document.createElement('div');
    meta.className = 'flex flex-wrap items-center gap-2';
    const type = document.createElement('span');
    type.className = transaction.type === 'income'
      ? 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800'
      : 'rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700';
    type.textContent = transaction.type === 'income' ? '収入' : '支出';
    const category = document.createElement('span');
    category.className = 'text-xs font-semibold text-slate-600';
    category.textContent = transaction.category;
    const date = document.createElement('span');
    date.className = 'text-xs text-slate-500';
    date.textContent = formatExpenseDate(transaction.transactionDate);
    const amount = document.createElement('p');
    amount.className = transaction.type === 'income' ? 'mt-2 text-xl font-bold text-emerald-700' : 'mt-2 text-xl font-bold text-slate-900';
    amount.textContent = `${transaction.type === 'income' ? '+' : '−'}${formatYen(transaction.amount)}`;
    const extra = document.createElement('p');
    extra.className = 'mt-1 truncate text-xs text-slate-500';
    extra.textContent = [transaction.note, transaction.type === 'expense' ? PAYMENT_LABELS[transaction.paymentMethod] : '']
      .filter((value) => value && value !== PAYMENT_LABELS.unspecified).join(' ・ ');
    extra.classList.toggle('hidden', !extra.textContent);
    const actions = document.createElement('div');
    actions.className = 'flex shrink-0 flex-col gap-2';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.editTransactionId = transaction.id;
    edit.className = 'min-h-11 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700';
    edit.textContent = '編集';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.deleteTransactionId = transaction.id;
    remove.className = 'min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600';
    remove.textContent = '削除';
    meta.append(type, category, date);
    detail.append(meta, amount, extra);
    actions.append(edit, remove);
    item.append(detail, actions);
    return item;
  }

  function renderHistory(transactions) {
    const sorted = transactions.slice().sort((a, b) => {
      const dateDiff = parseLocalDate(b.transactionDate) - parseLocalDate(a.transactionDate);
      return dateDiff || new Date(b.createdAt) - new Date(a.createdAt);
    });
    const visible = isHistoryExpanded ? sorted : sorted.slice(0, HISTORY_PREVIEW_LIMIT);
    byId('itemCount').textContent = isHistoryExpanded || sorted.length <= HISTORY_PREVIEW_LIMIT
      ? `${sorted.length}件`
      : `最新${visible.length}件 / 全${sorted.length}件`;
    byId('emptyState').classList.toggle('hidden', sorted.length > 0);
    historyList.innerHTML = '';
    historyList.className = isHistoryExpanded ? 'max-h-96 space-y-3 overflow-y-auto pr-1' : 'space-y-3';
    visible.forEach((transaction) => historyList.appendChild(createHistoryItem(transaction)));
    byId('historyToggleButton').classList.toggle('hidden', sorted.length <= HISTORY_PREVIEW_LIMIT);
    byId('historyToggleButton').textContent = isHistoryExpanded ? '最新3件だけ表示' : 'すべて表示';
  }

  function renderFavorites() {
    byId('favoriteCount').textContent = `${state.favoriteExpenses.length}件`;
    byId('favoriteEmptyState').classList.toggle('hidden', state.favoriteExpenses.length > 0);
    favoriteExpensesList.innerHTML = '';
    state.favoriteExpenses.forEach((favorite) => {
      const item = document.createElement('li');
      item.className = 'flex items-center gap-2 rounded-lg bg-amber-50 p-3';
      const add = document.createElement('button');
      add.type = 'button';
      add.dataset.favoriteId = favorite.id;
      add.className = 'min-h-11 min-w-0 flex-1 text-left';
      const title = document.createElement('p');
      title.className = 'truncate text-sm font-bold text-slate-900';
      title.textContent = favorite.note || favorite.category;
      const meta = document.createElement('p');
      meta.className = 'mt-1 truncate text-xs text-slate-600';
      meta.textContent = `${formatYen(favorite.amount)} ・ ${favorite.category}`;
      add.append(title, meta);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.deleteFavoriteId = favorite.id;
      remove.className = 'min-h-11 shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm';
      remove.textContent = '削除';
      item.append(add, remove);
      favoriteExpensesList.appendChild(item);
    });
  }

  function getSubscriptionTotals(period = getSelectedPeriod()) {
    const summary = summarizePeriod({ transactions: [], subscriptions: state.subscriptions, period });
    const activeSubscriptions = state.subscriptions.filter((subscription) => {
      return isSubscriptionActiveInPeriod(subscription, period);
    });
    const yearly = Math.round(activeSubscriptions.reduce((sum, subscription) => {
      return sum + (subscription.cycle === 'yearly' ? subscription.amount : subscription.amount * 12);
    }, 0));
    return { monthly: summary.fixedExpense, yearly };
  }

  function renderSubscriptions() {
    const totals = getSubscriptionTotals();
    byId('subscriptionMonthlyTotal').textContent = formatYen(totals.monthly);
    byId('subscriptionYearlyTotal').textContent = formatYen(totals.yearly);
    const active = state.subscriptions.filter((item) => !item.archivedAt);
    byId('subscriptionCount').textContent = `${active.length}件`;
    byId('subscriptionEmptyState').classList.toggle('hidden', active.length > 0);
    subscriptionList.innerHTML = '';
    active.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach((subscription) => {
      const item = document.createElement('li');
      item.className = 'flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-4';
      const detail = document.createElement('div');
      detail.className = 'min-w-0';
      const name = document.createElement('p');
      name.className = 'truncate text-base font-bold text-slate-900';
      name.textContent = subscription.name;
      const meta = document.createElement('p');
      meta.className = 'mt-1 text-xs text-slate-600';
      meta.textContent = `${subscription.cycle === 'yearly' ? '年額' : '月額'} ${formatYen(subscription.amount)} ・ ${subscription.activeFrom}から`;
      detail.append(name, meta);
      const actions = document.createElement('div');
      actions.className = 'flex shrink-0 flex-col gap-2';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.dataset.editSubscriptionId = subscription.id;
      edit.className = 'min-h-11 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm';
      edit.textContent = '編集';
      const archive = document.createElement('button');
      archive.type = 'button';
      archive.dataset.archiveSubscriptionId = subscription.id;
      archive.className = 'min-h-11 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm';
      archive.textContent = '終了';
      actions.append(edit, archive);
      item.append(detail, actions);
      subscriptionList.appendChild(item);
    });
  }

  function renderSettings() {
    if (monthStartDayInput.options.length !== 28) {
      monthStartDayInput.innerHTML = '';
      for (let day = 1; day <= 28; day += 1) {
        const option = document.createElement('option');
        option.value = String(day);
        option.textContent = `${day}日`;
        monthStartDayInput.appendChild(option);
      }
    }
    monthStartDayInput.value = String(state.monthStartDay);
    categorySettingsList.innerHTML = '';
    state.categories.forEach((category, index) => {
      const item = document.createElement('li');
      item.className = 'flex items-center gap-2 rounded-lg bg-slate-50 p-2';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 16;
      input.value = category;
      input.dataset.categoryIndex = String(index);
      input.dataset.originalValue = category;
      input.setAttribute('aria-label', `${category}のカテゴリ名`);
      input.className = 'min-h-11 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.deleteCategoryIndex = String(index);
      remove.setAttribute('aria-label', `${category}を削除`);
      remove.className = 'min-h-11 shrink-0 rounded-md bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm';
      remove.textContent = '削除';
      item.append(input, remove);
      categorySettingsList.appendChild(item);
    });
  }

  function getSavingMessage(status, goal, balance, hasActivity) {
    if (goal <= 0) return { short: '未設定', detail: '残したい金額を設定すると、選択期間の収支に対する達成状況を確認できます。' };
    if (!hasActivity) return { short: '記録待ち', detail: '収入または支出を登録すると、達成状況が表示されます。' };
    if (balance < 0) return { short: '支出超過', detail: '選択期間は支出が収入を上回っています。まずは次の支出を一つ見直してみましょう。' };
    if (status.achieved) return { short: '達成中', detail: '選択期間の収支で目標額を残せています。' };
    return { short: 'あと少し', detail: `あと${formatYen(status.amountLeft)}で目標です。` };
  }

  function renderBackupReminder() {
    const lastExport = state.lastCsvExportAt ? new Date(state.lastCsvExportAt) : null;
    const hasData = state.transactions.length > 0 || state.subscriptions.length > 0 || state.favoriteExpenses.length > 0;
    const daysSince = lastExport ? Math.floor((Date.now() - lastExport.getTime()) / 86400000) : Infinity;
    const shouldShow = hasData && state.dataChangedAt && (!lastExport || daysSince >= 7);
    const text = lastExport
      ? '前回のバックアップから7日以上経過しています。'
      : 'まだバックアップがありません。';
    byId('backupStatusCard').classList.toggle('hidden', !shouldShow);
    byId('backupStatusCard').classList.toggle('flex', shouldShow);
    byId('backupStatusText').textContent = text;
    byId('backupReminder').classList.toggle('hidden', !shouldShow);
    byId('backupReminderText').textContent = text;
    byId('lastCsvExportLabel').textContent = lastExport ? `前回バックアップ: ${formatExpenseDate(toDateInputValue(lastExport))}` : '前回バックアップ: なし';
  }

  function render() {
    updatePeriodNavigation();
    renderSettings();
    const period = getSelectedPeriod();
    const periodKey = getPeriodKey(period);
    const transactions = getSelectedTransactions();
    const summary = summarizePeriod({ transactions: state.transactions, subscriptions: state.subscriptions, period });
    const budget = getPeriodSetting(state.monthlyBudgets, periodKey, 0);
    const goal = getPeriodSetting(state.savingGoals, periodKey, 0);
    const remaining = budget - summary.variableExpense;
    const daily = selectedMonthOffset === 0 ? Math.floor(remaining / getRemainingDays()) : remaining;
    const hasActivity = transactions.length > 0;
    const goalStatus = getSavingGoalStatus({ balance: summary.balance, goal, hasActivity });
    const goalMessage = getSavingMessage(goalStatus, goal, summary.balance, hasActivity);
    const expenseTransactions = transactions.filter((item) => item.type === 'expense');
    const categoryTotals = getCategoryTotals(expenseTransactions);

    byId('monthlyTotal').textContent = formatYen(summary.totalExpense);
    byId('chartCenterTotal').textContent = formatYen(summary.variableExpense);
    byId('monthlyIncomeTotal').textContent = formatYen(summary.income);
    byId('monthlyBalance').textContent = formatYen(summary.balance);
    byId('monthlyBalance').classList.toggle('text-rose-600', summary.balance < 0);
    byId('monthlyBalance').classList.toggle('text-blue-900', summary.balance >= 0);
    byId('remainingBudget').textContent = budget > 0 ? formatYen(remaining) : '未設定';
    byId('dailyAvailable').textContent = budget <= 0 ? '未設定' : remaining < 0 ? '予算オーバー' : formatYen(daily);
    byId('dailyAvailableLabel').textContent = selectedMonthOffset === 0 ? '今日使える変動費' : '月末の予算差額';
    byId('remainingBudget').classList.toggle('text-rose-600', budget > 0 && remaining < 0);
    byId('savingGoalAmount').textContent = goal > 0 ? formatYen(goal) : '未設定';
    byId('savingGoalProgress').textContent = `${goalStatus.percent}%`;
    byId('savingGoalProgressBar').style.width = `${goalStatus.percent}%`;
    byId('savingGoalRemaining').textContent = goal > 0 ? formatYen(goalStatus.amountLeft) : '未設定';
    byId('savingGoalShortMessage').textContent = goalMessage.short;
    byId('savingGoalMessage').textContent = goalMessage.detail;
    const periodWord = selectedMonthOffset === 0 ? '今月' : '選択期間';
    byId('incomeBudgetPeriodLabel').textContent = `${periodWord}の変動費予算`;
    byId('budgetLabel').textContent = `${periodWord}の予算`;
    byId('savingGoalLabel').textContent = `${periodWord}に残したい金額`;
    byId('applySuggestedBudgetButton').textContent = `${periodWord}の予算に反映`;
    budgetInput.value = budget > 0 ? budget : '';
    savingGoalInput.value = goal > 0 ? goal : '';

    const fixedTotals = getSubscriptionTotals(period);
    const suggested = Math.max(summary.income - fixedTotals.monthly, 0);
    byId('incomeFixedCost').textContent = formatYen(fixedTotals.monthly);
    byId('suggestedBudget').textContent = formatYen(suggested);
    byId('overviewIncome').textContent = formatYen(summary.income);
    byId('overviewFixedCost').textContent = formatYen(fixedTotals.monthly);
    byId('overviewSuggestedBudget').textContent = formatYen(suggested);
    const incomeMessage = summary.income > 0
      ? `収入から固定費を引いた変動費予算の候補は${formatYen(suggested)}です。`
      : '収入を登録すると、固定費を引いた予算候補が表示されます。';
    byId('incomeBudgetMessage').textContent = incomeMessage;
    byId('overviewIncomeMessage').textContent = incomeMessage;

    updateCategoryChart(categoryTotals, summary.variableExpense);
    updateCategoryLegend(categoryTotals, summary.variableExpense);
    renderHistory(transactions);
    renderFavorites();
    renderSubscriptions();
    renderBackupReminder();
    updateTransactionFormMode();

    if (selectedMonthOffset === 0 && goalStatus.achieved && !state.celebratedPeriods.includes(periodKey)) {
      state.celebratedPeriods.push(periodKey);
      persistState(null, false);
      byId('goalCelebrationMessage').textContent = `今月の収支は${formatYen(summary.balance)}です。目標を達成しています。`;
      lastFocusedBeforeModal = document.activeElement;
      document.querySelector('main').inert = true;
      goalCelebration.classList.remove('hidden');
      goalCelebration.classList.add('flex');
      requestAnimationFrame(() => goalCelebrationClose.focus());
    }
  }

  function escapeCsvCell(value) {
    let text = String(value ?? '');
    if (/^[\s\t\r\n]*[=+\-@]/.test(text)) text = `'${text}`;
    text = text.replace(/"/g, '""');
    return /[",\r\n]/.test(text) ? `"${text}"` : text;
  }

  function restoreCsvText(value) {
    const text = String(value ?? '');
    return /^'[\s\t\r\n]*[=+\-@]/.test(text) ? text.slice(1) : text;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text).replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === ',' && !quoted) { row.push(cell); cell = ''; continue; }
      if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(cell);
        if (row.some((value) => value.trim())) rows.push(row);
        row = []; cell = ''; continue;
      }
      cell += char;
    }
    if (quoted) throw new Error('CSVの引用符が閉じられていません。');
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    return rows;
  }

  function buildCsvBackup() {
    const headers = ['type', 'id', 'amount', 'category', 'transactionDate', 'transactionType', 'cycle', 'name', 'createdAt', 'periodKey', 'value', 'note', 'paymentMethod', 'activeFrom', 'archivedAt'];
    const rows = [headers, ['config', '', '', '', '', '', '', '', '', '', state.monthStartDay, '', '', '', '']];
    state.categories.forEach((category) => rows.push(['category', '', '', category]));
    Object.entries(state.monthlyBudgets).forEach(([periodKey, value]) => rows.push(['budget', '', '', '', '', '', '', '', '', periodKey, value]));
    Object.entries(state.savingGoals).forEach(([periodKey, value]) => rows.push(['savingGoal', '', '', '', '', '', '', '', '', periodKey, value]));
    state.transactions.forEach((item) => rows.push(['transaction', item.id, item.amount, item.category, item.transactionDate, item.type, '', '', item.createdAt, '', '', item.note, item.paymentMethod]));
    state.favoriteExpenses.forEach((item) => rows.push(['favoriteExpense', item.id, item.amount, item.category, '', 'expense', '', '', item.createdAt, '', '', item.note, item.paymentMethod]));
    state.subscriptions.forEach((item) => rows.push(['subscription', item.id, item.amount, '', '', '', item.cycle, item.name, item.createdAt, '', '', '', '', item.activeFrom, item.archivedAt || '']));
    return rows.map((row) => headers.map((_, index) => escapeCsvCell(row[index] ?? '')).join(',')).join('\r\n');
  }

  function exportCsvBackup() {
    const blob = new Blob([`\uFEFF${buildCsvBackup()}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kakeibo-backup-${toDateInputValue(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    state.lastCsvExportAt = new Date().toISOString();
    state.dataChangedAt = null;
    persistState(null, false);
    renderBackupReminder();
  }

  function importCsvBackup(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('読み込めるデータがありません。');
    const headers = rows[0].map((header) => header.trim());
    if (!headers.includes('type')) throw new Error('このアプリ用のCSVではありません。');
    const records = rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
    const imported = normalizeState({ version: 2, monthStartDay: 1, categories: [], transactions: [], favoriteExpenses: [], subscriptions: [], monthlyBudgets: {}, savingGoals: {} });
    const invalid = [];
    imported.categories = uniqueCategoryNames(records.filter((record) => record.type === 'category').map((record) => restoreCsvText(record.category)));
    imported.monthStartDay = state.monthStartDay;
    records.forEach((record, index) => {
      if (record.type !== 'config' && record.type !== 'monthStartDay') return;
      const value = Number(record.value || record.budget);
      if (Number.isInteger(value) && value >= 1 && value <= 28) imported.monthStartDay = value;
      else invalid.push(`${index + 2}行目: 月の開始日が正しくありません`);
    });
    const currentKey = getPeriodKey(getBudgetPeriod(new Date(), imported.monthStartDay));
    records.forEach((record, index) => {
      const rowNumber = index + 2;
      if (record.type === 'config' || record.type === 'monthStartDay') {
        return;
      }
      if (record.type === 'category') return;
      if (record.type === 'budget' || record.type === 'savingGoal') {
        const value = Number(record.value || record.budget);
        const key = record.periodKey || currentKey;
        if (!Number.isFinite(value) || value < 0) invalid.push(`${rowNumber}行目: 設定金額が正しくありません`);
        else (record.type === 'budget' ? imported.monthlyBudgets : imported.savingGoals)[key] = Math.round(value);
        return;
      }
      if (record.type === 'income' && !record.id) {
        const amount = Number(record.value || record.budget);
        if (validAmount(amount)) imported.transactions.push({ id: createId(), type: 'income', amount, category: '給料', transactionDate: toDateInputValue(new Date()), note: '旧バックアップから移行', createdAt: new Date().toISOString() });
        return;
      }
      if (record.type === 'transaction' || record.type === 'expense') {
        const transactionDate = restoreCsvText(record.transactionDate || record.expenseDate);
        const transactionType = record.type === 'expense' ? 'expense' : record.transactionType;
        if (!isValidDateInput(transactionDate)) {
          invalid.push(`${rowNumber}行目: 収支の日付が正しくありません`);
          return;
        }
        if (transactionType !== 'income' && transactionType !== 'expense') {
          invalid.push(`${rowNumber}行目: 収支の種別が正しくありません`);
          return;
        }
        imported.transactions.push({ id: restoreCsvText(record.id), type: transactionType, amount: record.amount, category: restoreCsvText(record.category), transactionDate, note: restoreCsvText(record.note), paymentMethod: restoreCsvText(record.paymentMethod), createdAt: restoreCsvText(record.createdAt) });
        return;
      }
      if (record.type === 'favoriteExpense') {
        imported.favoriteExpenses.push({ id: restoreCsvText(record.id), amount: record.amount, category: restoreCsvText(record.category), note: restoreCsvText(record.note), paymentMethod: restoreCsvText(record.paymentMethod), createdAt: restoreCsvText(record.createdAt) });
        return;
      }
      if (record.type === 'subscription') {
        imported.subscriptions.push({ id: restoreCsvText(record.id), amount: record.amount, cycle: restoreCsvText(record.cycle), name: restoreCsvText(record.name), createdAt: restoreCsvText(record.createdAt), activeFrom: restoreCsvText(record.activeFrom), archivedAt: restoreCsvText(record.archivedAt) });
        return;
      }
      invalid.push(`${rowNumber}行目: データ種別が正しくありません`);
    });
    if (invalid.length) throw new Error(`CSVに読み込めない行があります。\n${invalid.slice(0, 5).join('\n')}`);
    const expectedCounts = {
      transactions: imported.transactions.length,
      favorites: imported.favoriteExpenses.length,
      subscriptions: imported.subscriptions.length
    };
    const normalized = normalizeState(imported);
    if (
      normalized.transactions.length !== expectedCounts.transactions
      || normalized.favoriteExpenses.length !== expectedCounts.favorites
      || normalized.subscriptions.length !== expectedCounts.subscriptions
    ) {
      throw new Error('CSVに金額・日付・名称が正しくないデータがあります。');
    }
    if (!window.confirm(`CSVを読み込みますか？\n収支明細 ${normalized.transactions.length}件、固定費 ${normalized.subscriptions.length}件で現在のデータを上書きします。`)) return;
    const previous = state;
    state = normalized;
    if (!persistState(previous)) return;
    selectedMonthOffset = 0;
    resetTransactionForm();
    render();
    window.alert('CSVの読み込みが完了しました。');
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const amount = Math.round(Number(amountInput.value));
    if (!validAmount(amount)) { amountInput.setCustomValidity(`1円以上${MAX_AMOUNT.toLocaleString('ja-JP')}円以下で入力してください。`); amountInput.reportValidity(); amountInput.focus(); return; }
    amountInput.setCustomValidity('');
    if (!isValidDateInput(expenseDateInput.value)) { expenseDateInput.focus(); return; }
    const type = transactionTypeInput.value === 'income' ? 'income' : 'expense';
    const previous = cloneState();
    const transaction = {
      id: editingTransactionId || createId(),
      type,
      amount,
      category: getCategoryOptions(type).includes(categoryInput.value) ? categoryInput.value : getCategoryOptions(type)[0],
      transactionDate: expenseDateInput.value,
      note: expenseNoteInput.value.trim().slice(0, 60),
      paymentMethod: type === 'expense' && PAYMENT_METHODS.includes(paymentMethodInput.value) ? paymentMethodInput.value : 'unspecified',
      createdAt: editingTransactionId
        ? state.transactions.find((item) => item.id === editingTransactionId)?.createdAt || new Date().toISOString()
        : new Date().toISOString()
    };
    if (editingTransactionId) {
      const index = state.transactions.findIndex((item) => item.id === editingTransactionId);
      if (index === -1) return;
      state.transactions[index] = transaction;
    } else {
      state.transactions.push(transaction);
    }
    if (!persistState(previous)) { render(); return; }
    if (type === 'expense') { lastExpenseCategory = transaction.category; lastPaymentMethod = transaction.paymentMethod; }
    const wasEditing = Boolean(editingTransactionId);
    resetTransactionForm();
    render();
    showUndoToast(`${type === 'income' ? '収入' : '支出'}を${wasEditing ? '変更' : '登録'}しました`, () => {
      state = previous;
      persistState(null);
      render();
    });
    amountInput.focus();
  });

  amountInput.addEventListener('input', () => amountInput.setCustomValidity(''));
  transactionTypeInput.addEventListener('change', updateTransactionFormMode);
  cancelExpenseEditButton.addEventListener('click', () => { resetTransactionForm(); amountInput.focus(); });

  saveFavoriteButton.addEventListener('click', () => {
    const amount = Math.round(Number(amountInput.value));
    if (!validAmount(amount)) { amountInput.focus(); return; }
    const duplicate = state.favoriteExpenses.some((item) => item.amount === amount && item.category === categoryInput.value && item.note === expenseNoteInput.value.trim());
    if (duplicate) { window.alert('同じ「よく使う支出」がすでにあります。'); return; }
    const previous = cloneState();
    state.favoriteExpenses.push({ id: createId(), amount, category: categoryInput.value, note: expenseNoteInput.value.trim().slice(0, 60), paymentMethod: paymentMethodInput.value, createdAt: new Date().toISOString() });
    if (!persistState(previous)) return;
    renderFavorites();
    showUndoToast('よく使う支出に登録しました', () => { state = previous; persistState(null); render(); });
  });

  favoriteExpensesList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('button[data-delete-favorite-id]');
    const addButton = event.target.closest('button[data-favorite-id]');
    if (!deleteButton && !addButton) return;
    const previous = cloneState();
    if (deleteButton) {
      state.favoriteExpenses = state.favoriteExpenses.filter((item) => item.id !== deleteButton.dataset.deleteFavoriteId);
      if (!persistState(previous)) return;
      renderFavorites();
      showUndoToast('よく使う支出を削除しました', () => { state = previous; persistState(null); render(); });
      return;
    }
    const favorite = state.favoriteExpenses.find((item) => item.id === addButton.dataset.favoriteId);
    if (!favorite) return;
    state.transactions.push({ ...favorite, id: createId(), type: 'expense', transactionDate: toDateInputValue(new Date()), createdAt: new Date().toISOString() });
    if (!persistState(previous)) return;
    selectedMonthOffset = 0;
    render();
    showUndoToast('今日の支出に登録しました', () => { state = previous; persistState(null); render(); });
  });

  historyList.addEventListener('click', (event) => {
    const edit = event.target.closest('button[data-edit-transaction-id]');
    if (edit) { const item = state.transactions.find((transaction) => transaction.id === edit.dataset.editTransactionId); if (item) startEditingTransaction(item); return; }
    const remove = event.target.closest('button[data-delete-transaction-id]');
    if (!remove || !window.confirm('この明細を削除しますか？')) return;
    const previous = cloneState();
    state.transactions = state.transactions.filter((transaction) => transaction.id !== remove.dataset.deleteTransactionId);
    if (!persistState(previous)) return;
    render();
    showUndoToast('明細を削除しました', () => { state = previous; persistState(null); render(); });
  });

  budgetForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const amount = Math.round(Number(budgetInput.value));
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) { budgetInput.focus(); return; }
    const previous = cloneState();
    state.monthlyBudgets[getSelectedPeriodKey()] = amount;
    if (!persistState(previous)) return;
    render();
  });

  savingGoalForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const amount = Math.round(Number(savingGoalInput.value));
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) { savingGoalInput.focus(); return; }
    const previous = cloneState();
    const key = getSelectedPeriodKey();
    state.savingGoals[key] = amount;
    state.celebratedPeriods = state.celebratedPeriods.filter((periodKey) => periodKey !== key);
    if (!persistState(previous)) return;
    render();
  });

  byId('applySuggestedBudgetButton').addEventListener('click', () => {
    const period = getSelectedPeriod();
    const summary = summarizePeriod({ transactions: state.transactions, subscriptions: state.subscriptions, period });
    const suggested = Math.max(summary.income - getSubscriptionTotals(period).monthly, 0);
    if (!window.confirm(`${formatYen(suggested)}を選択期間の変動費予算に反映しますか？`)) return;
    const previous = cloneState();
    state.monthlyBudgets[getSelectedPeriodKey()] = suggested;
    if (!persistState(previous)) return;
    render();
  });

  subscriptionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = subscriptionNameInput.value.trim().slice(0, 40);
    const amount = Math.round(Number(subscriptionAmountInput.value));
    if (!name) { subscriptionNameInput.focus(); return; }
    if (!validAmount(amount)) { subscriptionAmountInput.focus(); return; }
    const previous = cloneState();
    if (editingSubscriptionId) {
      const index = state.subscriptions.findIndex((item) => item.id === editingSubscriptionId);
      if (index === -1) return;
      const current = state.subscriptions[index];
      const cycle = subscriptionCycleInput.value === 'yearly' ? 'yearly' : 'monthly';
      if (current.amount === amount && current.cycle === cycle) {
        state.subscriptions[index] = { ...current, name };
      } else {
        const currentPeriod = getBudgetPeriod(new Date(), state.monthStartDay);
        const previousDay = new Date(currentPeriod.start.getFullYear(), currentPeriod.start.getMonth(), currentPeriod.start.getDate() - 1);
        state.subscriptions[index] = { ...current, archivedAt: toDateInputValue(previousDay) };
        state.subscriptions.push({
          id: createId(),
          name,
          amount,
          cycle,
          activeFrom: toDateInputValue(currentPeriod.start),
          archivedAt: null,
          createdAt: new Date().toISOString()
        });
      }
    } else {
      state.subscriptions.push({ id: createId(), name, amount, cycle: subscriptionCycleInput.value === 'yearly' ? 'yearly' : 'monthly', activeFrom: toDateInputValue(new Date()), archivedAt: null, createdAt: new Date().toISOString() });
    }
    if (!persistState(previous)) return;
    editingSubscriptionId = null;
    subscriptionForm.reset();
    subscriptionCycleInput.value = 'monthly';
    subscriptionSubmitButton.textContent = '固定費を追加';
    subscriptionCancelEditButton.classList.add('hidden');
    render();
  });

  subscriptionCancelEditButton.addEventListener('click', () => {
    editingSubscriptionId = null;
    subscriptionForm.reset();
    subscriptionCycleInput.value = 'monthly';
    subscriptionSubmitButton.textContent = '固定費を追加';
    subscriptionCancelEditButton.classList.add('hidden');
  });

  subscriptionList.addEventListener('click', (event) => {
    const edit = event.target.closest('button[data-edit-subscription-id]');
    if (edit) {
      const item = state.subscriptions.find((subscription) => subscription.id === edit.dataset.editSubscriptionId);
      if (!item) return;
      editingSubscriptionId = item.id;
      subscriptionNameInput.value = item.name;
      subscriptionAmountInput.value = item.amount;
      subscriptionCycleInput.value = item.cycle;
      subscriptionSubmitButton.textContent = '固定費の変更を保存';
      subscriptionCancelEditButton.classList.remove('hidden');
      subscriptionNameInput.focus();
      return;
    }
    const archive = event.target.closest('button[data-archive-subscription-id]');
    if (!archive || !window.confirm('この固定費を今月で終了しますか？過去の集計には残ります。')) return;
    const previous = cloneState();
    const item = state.subscriptions.find((subscription) => subscription.id === archive.dataset.archiveSubscriptionId);
    if (!item) return;
    item.archivedAt = toDateInputValue(new Date());
    if (!persistState(previous)) return;
    render();
    showUndoToast('固定費を終了しました', () => { state = previous; persistState(null); render(); });
  });

  categoryAddForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = normalizeCategoryName(categoryAddInput.value);
    if (!name) { categoryAddInput.focus(); return; }
    if (state.categories.includes(name)) { window.alert('同じカテゴリがすでにあります。'); return; }
    const previous = cloneState();
    state.categories.push(name);
    if (!persistState(previous)) return;
    categoryAddForm.reset();
    render();
  });

  categorySettingsList.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    const index = Number(event.target.dataset.categoryIndex);
    const oldName = event.target.dataset.originalValue;
    const newName = normalizeCategoryName(event.target.value);
    if (!newName || state.categories.includes(newName) || state.categories[index] !== oldName) { render(); return; }
    const previous = cloneState();
    state.categories[index] = newName;
    state.transactions = state.transactions.map((item) => item.type === 'expense' && item.category === oldName ? { ...item, category: newName } : item);
    state.favoriteExpenses = state.favoriteExpenses.map((item) => item.category === oldName ? { ...item, category: newName } : item);
    if (!persistState(previous)) return;
    render();
  });

  categorySettingsList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-delete-category-index]');
    if (!button) return;
    const index = Number(button.dataset.deleteCategoryIndex);
    const name = state.categories[index];
    if (!name || state.categories.length <= 1) { window.alert('カテゴリは最低1つ必要です。'); return; }
    const destination = state.categories.find((category) => category !== name);
    if (!window.confirm(`${name}を削除し、該当明細を「${destination}」へ移動しますか？`)) return;
    const previous = cloneState();
    state.categories.splice(index, 1);
    state.transactions = state.transactions.map((item) => item.type === 'expense' && item.category === name ? { ...item, category: destination } : item);
    state.favoriteExpenses = state.favoriteExpenses.map((item) => item.category === name ? { ...item, category: destination } : item);
    if (!persistState(previous)) return;
    render();
  });

  monthStartDayInput.addEventListener('change', () => {
    const day = Number(monthStartDayInput.value);
    if (!Number.isInteger(day) || day < 1 || day > 28) return;
    const previous = cloneState();
    const oldBudget = getPeriodSetting(state.monthlyBudgets, getSelectedPeriodKey(), 0);
    const oldGoal = getPeriodSetting(state.savingGoals, getSelectedPeriodKey(), 0);
    state.monthStartDay = day;
    selectedMonthOffset = 0;
    const newKey = getSelectedPeriodKey();
    if (oldBudget > 0 && state.monthlyBudgets[newKey] === undefined) state.monthlyBudgets[newKey] = oldBudget;
    if (oldGoal > 0 && state.savingGoals[newKey] === undefined) state.savingGoals[newKey] = oldGoal;
    if (!persistState(previous)) return;
    render();
  });

  tabButtons.forEach((button) => button.addEventListener('click', () => showPanel(button.dataset.panel)));
  byId('previousMonthButton').addEventListener('click', () => { selectedMonthOffset -= 1; isHistoryExpanded = false; render(); });
  byId('nextMonthButton').addEventListener('click', () => { if (selectedMonthOffset < 0) selectedMonthOffset += 1; isHistoryExpanded = false; render(); });
  byId('historyToggleButton').addEventListener('click', () => { isHistoryExpanded = !isHistoryExpanded; render(); });
  undoToastButton.addEventListener('click', () => { const action = undoAction; hideUndoToast(); if (action) action(); });
  goalCelebrationClose.addEventListener('click', () => {
    goalCelebration.classList.add('hidden');
    goalCelebration.classList.remove('flex');
    document.querySelector('main').inert = false;
    if (lastFocusedBeforeModal instanceof HTMLElement) lastFocusedBeforeModal.focus();
    lastFocusedBeforeModal = null;
  });
  goalCelebration.addEventListener('keydown', (event) => { if (event.key === 'Escape') goalCelebrationClose.click(); });
  byId('exportCsvButton').addEventListener('click', exportCsvBackup);
  byId('quickExportCsvButton').addEventListener('click', exportCsvBackup);
  byId('importCsvButton').addEventListener('click', () => importCsvInput.click());
  importCsvInput.addEventListener('change', () => {
    const file = importCsvInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => { try { importCsvBackup(String(reader.result || '')); } catch (error) { window.alert(error.message || 'CSVの読み込みに失敗しました。'); } finally { importCsvInput.value = ''; } });
    reader.addEventListener('error', () => { window.alert('CSVファイルを読み込めませんでした。'); importCsvInput.value = ''; });
    reader.readAsText(file, 'utf-8');
  });

  document.title = 'シンプル家計簿';
  byId('todayLabel').textContent = formatToday(new Date());
  byId('splashScreen').classList.add('splash-hidden');
  historySection.parentElement.insertBefore(historySection, byId('favoriteExpensesHeading').closest('section'));
  resetTransactionForm({ preserveExpenseDefaults: false });
  if (!corruptedStateDetected) persistState(null, false);
  showPanel('overview');
  if (loadWarning) setTimeout(() => window.alert(loadWarning), 0);
})();
