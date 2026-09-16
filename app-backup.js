(function attachBudgetBackup(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BudgetBackup = api;
})(typeof window !== 'undefined' ? window : globalThis, function createBudgetBackup() {
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
        row = [];
        cell = '';
        continue;
      }
      cell += char;
    }

    if (quoted) throw new Error('CSVの引用符が閉じられていません。');
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    return rows;
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

  function buildCsvBackup(state) {
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

  return { buildCsvBackup, parseCsv, restoreCsvText };
});
