// Fails when first-load JS outgrows its budget. Run after `npm run build`.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 79_400;

const dist = new URL('../dist/', import.meta.url);
const page = readFileSync(new URL('index.html', dist), 'utf8');

// Everything index.html loads, whatever the build chose to split it into.
const files = [...page.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1]);
if (files.length === 0) throw new Error('index.html loads no scripts');

const size = files.reduce((sum, file) => sum + gzipSync(readFileSync(new URL(file, dist)), { level: 9 }).length, 0);
console.log(`first-load JS: ${size} bytes gzipped, budget ${BUDGET_BYTES}, ${BUDGET_BYTES - size} left (${files.join(', ')})`);
if (size > BUDGET_BYTES) process.exit(1);
