// Writes perf/history.csv: three years of everyday spending, rent and paychecks (about 4,400 rows), for
// `npm run perf`. Deterministic, so runs compare like with like.
import { writeFileSync } from 'node:fs';

let seed = 4;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const stores = ['STARBUCKS', 'CHIPOTLE', 'TARGET', 'WHOLE FOODS', 'SHELL OIL', 'AMAZON MKTP', 'CVS', 'UBER TRIP', 'NETFLIX', 'SPOTIFY',
  'TRADER JOES', 'HOME DEPOT', 'DOORDASH', 'APPLE.COM/BILL', 'COSTCO', 'PANERA', 'SWEETGREEN', 'LYFT', 'WALGREENS', 'BEST BUY'];
const rows = ['Date,Description,Amount'];
const fmt = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
for (let d = new Date(Date.UTC(2023, 9, 1)); d <= new Date(Date.UTC(2026, 8, 28)); d.setUTCDate(d.getUTCDate() + 1)) {
  const n = 2 + Math.floor(rand() * 5);
  for (let i = 0; i < n; i++) rows.push(`${fmt(d)},${stores[Math.floor(rand() * stores.length)]} #${100 + Math.floor(rand() * 900)},-${(3 + rand() * 177).toFixed(2)}`);
  if (d.getUTCDate() === 1) rows.push(`${fmt(d)},OAK APARTMENTS RENT PAYMENT,-1650.00`);
  if (d.getUTCDate() === 1 || d.getUTCDate() === 15) rows.push(`${fmt(d)},ACME CORP PAYROLL DIR DEP,2400.00`);
}
writeFileSync(new URL('./history.csv', import.meta.url), rows.join('\n') + '\n');
console.log(`perf/history.csv: ${rows.length - 1} transactions`);
