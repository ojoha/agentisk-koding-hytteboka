// Prints the Friday overview from the book: `node scripts/fredagsoversikt.js [YYYY-MM-DD]`.
// The date is the day the overview is for, today when left out.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fridayOverview } from '../src/overview.js';

const file = fileURLToPath(new URL('../data/hytteboka.json', import.meta.url));
const [date] = process.argv.slice(2);

if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`«${date}» er ikke en dato. Skriv den som 2026-10-16.`);
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`Fant ikke boka i ${file}. Start siden med npm start først.`);
  process.exit(1);
}

// Noon in Norway on the day asked for, so the date means the same in every time zone.
const now = date ? new Date(`${date}T10:00:00Z`) : new Date();
console.log(fridayOverview(JSON.parse(readFileSync(file, 'utf8')), now));
