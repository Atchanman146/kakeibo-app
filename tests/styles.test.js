const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const localCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const inlineCss = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
const allCss = `${localCss}\n${inlineCss}`;

const exactUtilities = new Set([
  'absolute', 'block', 'fixed', 'flex', 'grid', 'hidden', 'relative', 'sr-only',
  'truncate', 'uppercase'
]);
const utilityPattern = /^(?:active:|bg-|border(?:-|$)|bottom-|break-|cursor-|disabled:|duration-|flex-|focus:|font-(?:bold|medium|normal|semibold)$|from-|gap-|grid-|h-|hover:|inset-|items-|justify-|leading-|list-|m[trblxy]?-|max-|min-|outline-|overflow-|p[trblxy]?-|pointer-|right-|ring-|rounded-|shadow-|shrink-|space-|text-|to-|top-|tracking-|transition(?:-|$)|w-|z-)/;

function isUtility(token) {
  if (exactUtilities.has(token)) return true;
  return utilityPattern.test(token);
}

function extractUtilityTokens(source) {
  const tokens = new Set();
  for (const match of source.matchAll(/['"`]([^'"`\r\n]+)['"`]/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (token && isUtility(token)) tokens.add(token);
    }
  }
  return tokens;
}

function escapeCssClass(token) {
  return token.replace(/([:.\[\]\/()])/g, '\\$1');
}

test('production page uses the local utility stylesheet instead of Tailwind Play CDN', () => {
  assert.match(html, /<link rel="stylesheet" href="styles\.css">/);
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
});

test('every utility class used by the page and dynamic UI has a local CSS rule', () => {
  const tokens = new Set([...extractUtilityTokens(html), ...extractUtilityTokens(app)]);
  const missing = [...tokens].filter((token) => !allCss.includes(`.${escapeCssClass(token)}`));
  assert.deepEqual(missing, []);
});
