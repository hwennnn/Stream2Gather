// Every user flow, from the first visit, against a real server, Postgres and
// Redis. `make flows` runs it. All it needs is Docker, Go, Node, ffmpeg and Chrome.
//   node flows.mjs [--grep text] [--list] [--concurrency n] [--tree path] [--out dir] [--real]
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { openClient } from './lib/client.mjs';
import { startFixtureApi } from './lib/fixtures.mjs';
import { listFlows, runAll } from './lib/runner.mjs';
import { startStack } from './lib/stack.mjs';
import { makeTools } from './lib/tools.mjs';
import { addRealFlows } from './flows/real.mjs';

const { values: args } = parseArgs({
  options: {
    grep: { type: 'string' },
    list: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: process.env.FLOWS_CONCURRENCY ?? '3' },
    tree: { type: 'string', default: process.env.FLOWS_TREE ?? path.resolve(import.meta.dirname, '..') },
    port: { type: 'string', default: process.env.FLOWS_PORT ?? '18090' },
    out: { type: 'string', default: process.env.FLOWS_OUT ?? path.join(tmpdir(), 's2g-flows-out') },
    label: { type: 'string', default: 'flows' },
    keep: { type: 'boolean', default: false },
    real: { type: 'boolean', default: false },
  },
});

for (const file of (await readdir(new URL('./flows/', import.meta.url))).sort()) {
  if (file !== 'real.mjs') await import(`./flows/${file}`);
}
if (args.real) addRealFlows();

if (args.list) {
  console.log(listFlows().join('\n'));
  process.exit(0);
}

const fixtures = await startFixtureApi();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const stack = await startStack({
  tree: path.resolve(args.tree),
  port: Number(args.port),
  cache: path.resolve(import.meta.dirname, '../.data'),
  youtubeUrl: args.real ? undefined : fixtures.url,
  youtubeKey: args.real ? process.env.YOUTUBE_API_KEY : 'fixture',
});

let passed = false;
try {
  passed = await runAll({
    grep: args.grep ? new RegExp(args.grep, 'i') : null,
    concurrency: Number(args.concurrency),
    out: path.resolve(args.out),
    label: args.label,
    makeContext: makeTools({ browser, stack, fixtures, open: openClient }),
  });
} finally {
  await browser.close().catch(() => {});
  await stack.close({ keepLogs: args.keep || !passed });
  await fixtures.close();
  if (!passed) console.log(`server log: ${stack.log}`);
}
process.exit(passed ? 0 : 1);
