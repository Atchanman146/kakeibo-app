const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCsvBackup, parseCsv, restoreCsvText } = require('../app-backup.js');

test('CSV parser preserves commas, quotes, and line breaks inside quoted cells', () => {
  const rows = parseCsv('type,note\r\ntransaction,"スーパー, 特売"\r\ntransaction,"1行目\n""2行目"""');

  assert.deepEqual(rows, [
    ['type', 'note'],
    ['transaction', 'スーパー, 特売'],
    ['transaction', '1行目\n"2行目"']
  ]);
});

test('CSV backup neutralizes spreadsheet formulas and restores the original text on import', () => {
  const csv = buildCsvBackup({
    monthStartDay: 1,
    categories: ['その他'],
    monthlyBudgets: {},
    savingGoals: {},
    transactions: [{ id: 'tx-formula', amount: 1, category: 'その他', transactionDate: '2026-09-01', type: 'expense', createdAt: '2026-09-01T10:00:00.000Z', note: '=1+1', paymentMethod: 'unspecified' }],
    favoriteExpenses: [],
    subscriptions: []
  });
  const transactionRow = parseCsv(csv).find((row) => row[0] === 'transaction');

  assert.equal(transactionRow[11], "'=1+1");
  assert.equal(restoreCsvText(transactionRow[11]), '=1+1');
});

test('CSV backup keeps transactions, period settings, categories, favorites, and fixed costs', () => {
  const csv = buildCsvBackup({
    monthStartDay: 25,
    categories: ['食費'],
    monthlyBudgets: { '2026-08-25': 80000 },
    savingGoals: { '2026-08-25': 20000 },
    transactions: [{ id: 'tx-1', amount: 1200, category: '食費', transactionDate: '2026-09-01', type: 'expense', createdAt: '2026-09-01T10:00:00.000Z', note: '昼食', paymentMethod: 'card' }],
    favoriteExpenses: [{ id: 'fav-1', amount: 500, category: '食費', createdAt: '2026-08-01T10:00:00.000Z', note: 'コーヒー', paymentMethod: 'cash' }],
    subscriptions: [{ id: 'sub-1', amount: 980, cycle: 'monthly', name: '動画', createdAt: '2026-08-01T10:00:00.000Z', activeFrom: '2026-08-25', archivedAt: null }]
  });
  const rows = parseCsv(csv);

  assert.deepEqual(rows[0], ['type', 'id', 'amount', 'category', 'transactionDate', 'transactionType', 'cycle', 'name', 'createdAt', 'periodKey', 'value', 'note', 'paymentMethod', 'activeFrom', 'archivedAt']);
  assert.ok(rows.some((row) => row[0] === 'config' && row[10] === '25'));
  assert.ok(rows.some((row) => row[0] === 'budget' && row[9] === '2026-08-25' && row[10] === '80000'));
  assert.ok(rows.some((row) => row[0] === 'savingGoal' && row[10] === '20000'));
  assert.ok(rows.some((row) => row[0] === 'transaction' && row[1] === 'tx-1' && row[11] === '昼食'));
  assert.ok(rows.some((row) => row[0] === 'favoriteExpense' && row[1] === 'fav-1'));
  assert.ok(rows.some((row) => row[0] === 'subscription' && row[1] === 'sub-1' && row[13] === '2026-08-25'));
});
