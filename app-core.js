(function attachBudgetAppCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.BudgetAppCore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function createBudgetAppCore() {
  function parseLocalDate(dateValue) {
    if (dateValue instanceof Date) {
      return new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate());
    }

    if (typeof dateValue !== 'string') return new Date(NaN);
    const [year, month, day] = dateValue.split('-').map(Number);
    if (!year || !month || !day) return new Date(NaN);
    return new Date(year, month - 1, day);
  }

  function getBudgetPeriod(date = new Date(), monthStartDay = 1) {
    const safeStartDay = Number.isInteger(monthStartDay) && monthStartDay >= 1 && monthStartDay <= 28
      ? monthStartDay
      : 1;
    const base = parseLocalDate(date);
    const start = base.getDate() >= safeStartDay
      ? new Date(base.getFullYear(), base.getMonth(), safeStartDay)
      : new Date(base.getFullYear(), base.getMonth() - 1, safeStartDay);
    const nextStart = new Date(start.getFullYear(), start.getMonth() + 1, safeStartDay);
    return { start, nextStart };
  }

  function toDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getPeriodKey(period) {
    return toDateInputValue(period.start);
  }

  function isDateInPeriod(dateValue, period) {
    const date = parseLocalDate(dateValue);
    return !Number.isNaN(date.getTime()) && date >= period.start && date < period.nextStart;
  }

  function getPeriodSetting(settings, periodKey, fallbackValue = 0) {
    if (!settings || typeof settings !== 'object') return fallbackValue;
    const value = Number(settings[periodKey]);
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallbackValue;
  }

  function isSubscriptionActiveInPeriod(subscription, period) {
    const activeFrom = parseLocalDate(subscription.activeFrom || subscription.createdAt);
    const archivedAt = subscription.archivedAt ? parseLocalDate(subscription.archivedAt) : null;
    const startsBeforePeriodEnds = Number.isNaN(activeFrom.getTime()) || activeFrom < period.nextStart;
    const hasNotEndedBeforePeriod = !archivedAt || Number.isNaN(archivedAt.getTime()) || archivedAt >= period.start;
    return startsBeforePeriodEnds && hasNotEndedBeforePeriod;
  }

  function summarizePeriod({ transactions = [], subscriptions = [], period }) {
    const selectedTransactions = transactions.filter((transaction) => {
      return isDateInPeriod(transaction.transactionDate || transaction.expenseDate, period);
    });
    const income = selectedTransactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const variableExpense = selectedTransactions
      .filter((transaction) => transaction.type !== 'income')
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const activeSubscriptions = subscriptions.filter((subscription) => {
      return isSubscriptionActiveInPeriod(subscription, period);
    });
    const monthlyFixed = activeSubscriptions
      .filter((subscription) => subscription.cycle !== 'yearly')
      .reduce((sum, subscription) => sum + Number(subscription.amount || 0), 0);
    const yearlyFixed = activeSubscriptions
      .filter((subscription) => subscription.cycle === 'yearly')
      .reduce((sum, subscription) => sum + Number(subscription.amount || 0), 0);
    const fixedExpense = Math.round(monthlyFixed + yearlyFixed / 12);
    const totalExpense = variableExpense + fixedExpense;

    return {
      income: Math.round(income),
      variableExpense: Math.round(variableExpense),
      fixedExpense,
      totalExpense: Math.round(totalExpense),
      balance: Math.round(income - totalExpense)
    };
  }

  function getSavingGoalStatus({ balance, goal, hasActivity }) {
    const safeGoal = Number.isFinite(Number(goal)) ? Math.max(Math.round(Number(goal)), 0) : 0;
    if (!hasActivity || safeGoal <= 0) {
      return { percent: 0, amountLeft: safeGoal, achieved: false };
    }

    const safeBalance = Math.max(Math.round(Number(balance) || 0), 0);
    const percent = Math.min(Math.floor((safeBalance / safeGoal) * 100), 100);
    return {
      percent,
      amountLeft: Math.max(safeGoal - safeBalance, 0),
      achieved: safeBalance >= safeGoal
    };
  }

  return {
    getBudgetPeriod,
    getPeriodKey,
    getPeriodSetting,
    getSavingGoalStatus,
    isDateInPeriod,
    isSubscriptionActiveInPeriod,
    parseLocalDate,
    summarizePeriod,
    toDateInputValue
  };
});
