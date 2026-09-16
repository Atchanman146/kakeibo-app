const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getBudgetPeriod,
  getPeriodKey,
  getPeriodSetting,
  getSavingGoalStatus,
  isSubscriptionActiveInPeriod,
  summarizePeriod
} = require('../app-core.js');

test('monthly summary combines income, variable expenses, and recurring fixed costs', () => {
  const period = getBudgetPeriod(new Date(2026, 8, 16), 1);
  const summary = summarizePeriod({
    transactions: [
      { type: 'income', amount: 250000, transactionDate: '2026-09-10' },
      { type: 'expense', amount: 30000, transactionDate: '2026-09-12' },
      { type: 'expense', amount: 999999, transactionDate: '2026-08-31' }
    ],
    subscriptions: [
      { amount: 100000, cycle: 'monthly', activeFrom: '2026-01-01' },
      { amount: 12000, cycle: 'yearly', activeFrom: '2026-01-01' },
      { amount: 5000, cycle: 'monthly', activeFrom: '2026-10-01' }
    ],
    period
  });

  assert.deepEqual(summary, {
    income: 250000,
    variableExpense: 30000,
    fixedExpense: 101000,
    totalExpense: 131000,
    balance: 119000
  });
});

test('custom month start includes only dates inside the selected budget period', () => {
  const period = getBudgetPeriod(new Date(2026, 8, 16), 25);

  assert.equal(getPeriodKey(period), '2026-08-25');
  assert.equal(period.start.getTime(), new Date(2026, 7, 25).getTime());
  assert.equal(period.nextStart.getTime(), new Date(2026, 8, 25).getTime());

  const summary = summarizePeriod({
    transactions: [
      { type: 'income', amount: 100000, transactionDate: '2026-08-25' },
      { type: 'expense', amount: 1000, transactionDate: '2026-09-24' },
      { type: 'expense', amount: 5000, transactionDate: '2026-09-25' }
    ],
    subscriptions: [],
    period
  });

  assert.equal(summary.income, 100000);
  assert.equal(summary.variableExpense, 1000);
});

test('saving goal is not achieved before the user has financial activity', () => {
  assert.deepEqual(
    getSavingGoalStatus({ balance: 50000, goal: 10000, hasActivity: false }),
    { percent: 0, amountLeft: 10000, achieved: false }
  );

  assert.deepEqual(
    getSavingGoalStatus({ balance: 12000, goal: 10000, hasActivity: true }),
    { percent: 100, amountLeft: 0, achieved: true }
  );
});

test('period-specific settings do not change other months', () => {
  const settings = {
    '2026-08-01': 40000,
    '2026-09-01': 60000
  };

  assert.equal(getPeriodSetting(settings, '2026-08-01', 0), 40000);
  assert.equal(getPeriodSetting(settings, '2026-09-01', 0), 60000);
  assert.equal(getPeriodSetting(settings, '2026-10-01', 0), 0);
});

test('fixed costs remain historically active even when their monthly equivalent rounds to zero', () => {
  const period = getBudgetPeriod(new Date(2026, 8, 16), 1);

  assert.equal(isSubscriptionActiveInPeriod({ activeFrom: '2026-01-01' }, period), true);
  assert.equal(isSubscriptionActiveInPeriod({ activeFrom: '2026-10-01' }, period), false);
  assert.equal(isSubscriptionActiveInPeriod({ activeFrom: '2026-01-01', archivedAt: '2026-08-31' }, period), false);
});

test('versioned fixed costs preserve the old amount without double-counting the current period', () => {
  const subscriptions = [
    { amount: 80000, cycle: 'monthly', activeFrom: '2026-01-01', archivedAt: '2026-08-31' },
    { amount: 90000, cycle: 'monthly', activeFrom: '2026-09-01', archivedAt: null }
  ];

  const august = summarizePeriod({ transactions: [], subscriptions, period: getBudgetPeriod('2026-08-10', 1) });
  const september = summarizePeriod({ transactions: [], subscriptions, period: getBudgetPeriod('2026-09-10', 1) });

  assert.equal(august.fixedExpense, 80000);
  assert.equal(september.fixedExpense, 90000);
});
