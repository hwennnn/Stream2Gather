// A small runner, because a flow here is several browsers and a server, not a
// function. Flows that take the server down run alone, after the rest.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const flows = [];

/** options: { serial, timeout } */
export const flow = (name, options, body) => {
  if (typeof options === 'function') flows.push({ name, options: {}, body: options });
  else flows.push({ name, options, body });
};

const within = (ms, work, label) => {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} took over ${ms / 1000}s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
};

const short = (error) => String(error?.message ?? error).split('\n').filter(Boolean).slice(0, 3).join(' | ');

const runOne = async (entry, makeContext, out) => {
  const result = { name: entry.name, checks: 0, failures: [], shots: [], ms: 0 };
  const started = Date.now();
  const context = makeContext(entry, result);
  try {
    await within(entry.options.timeout ?? 90_000, entry.body(context.t), 'flow');
  } catch (error) {
    result.failures.push(short(error));
  }
  try {
    await context.finish(out);
  } catch (error) {
    result.failures.push(`cleanup: ${short(error)}`);
  }
  result.ms = Date.now() - started;
  const mark = result.failures.length ? 'FAIL' : 'ok  ';
  console.log(`${mark} ${entry.name}  (${result.checks} checks, ${(result.ms / 1000).toFixed(1)}s)`);
  for (const failure of result.failures) console.log(`       - ${failure}`);
  return result;
};

/**
 * Bugs we know about, one per line as `id | pattern`, matched against "flow: failure".
 * They still print and still count as failed; they only stop the run going red, so a
 * new bug can't hide among old ones. A line nothing matches is called out for removal.
 */
const readKnown = async () => {
  const text = await readFile(new URL('../known-failures.txt', import.meta.url), 'utf8').catch(() => '');
  return text.split('\n').filter((line) => line.trim() && !line.startsWith('#')).map((line) => {
    const [id, pattern] = line.split(' | ');
    return { id, pattern: new RegExp(pattern, 'i'), used: false };
  });
};

const knownFor = (known, text) => {
  const match = known.find(({ pattern }) => pattern.test(text));
  if (match) match.used = true;
  return match?.id;
};

const pool = async (entries, width, work) => {
  const queue = [...entries];
  await Promise.all(Array.from({ length: width }, async () => {
    while (queue.length) await work(queue.shift());
  }));
};

/** "2/3" is the second of three shards, taking every third flow so the slow files spread out. */
const inShard = (shard) => {
  if (!shard) return () => true;
  const [index, total] = shard.split('/').map(Number);
  return (_, position) => position % total === index - 1;
};

export const runAll = async ({ grep, shard, retries = 0, concurrency, out, makeContext, label }) => {
  await mkdir(out, { recursive: true });
  const known = await readKnown();
  const chosen = flows.filter(({ name }) => !grep || grep.test(name)).filter(inShard(shard));
  const results = [];
  const once = async (entry) => results.push(await runOne(entry, makeContext, out));
  const started = Date.now();
  await pool(chosen.filter((entry) => !entry.options.serial), concurrency, once);
  await pool(chosen.filter((entry) => entry.options.serial), 1, once);

  // A loaded machine can miss a timing. A regression fails again, alone, so it stays red;
  // a flow that recovers is named as flaky, because it can still be a real intermittent bug.
  const isNew = (result) => result.failures.some((failure) => !knownFor(known, `${result.name}: ${failure}`));
  const flaky = [];
  for (let round = 0; round < retries; round += 1) {
    for (const first of results.filter(isNew)) {
      const again = await runOne(chosen.find(({ name }) => name === first.name), makeContext, out);
      results[results.indexOf(first)] = again;
      if (!isNew(again)) flaky.push({ name: first.name, failures: first.failures });
    }
  }

  const failed = results.filter((result) => result.failures.length);
  const checks = results.reduce((sum, result) => sum + result.checks, 0);
  const failedChecks = results.reduce((sum, result) => sum + result.failures.length, 0);
  const seconds = Math.round((Date.now() - started) / 1000);
  const summary = { label, flows: results.length, flowsFailed: failed.length, flaky: flaky.length, checks, checksFailed: failedChecks, seconds };
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ summary, results, flaky }, null, 1));
  console.log(`\n${label}: ${results.length - failed.length} of ${results.length} flows passed, ` +
    `${checks} checks, ${failedChecks} failures, ${seconds}s`);
  let fresh = 0;
  for (const result of failed) {
    for (const failure of result.failures) {
      const id = knownFor(known, `${result.name}: ${failure}`);
      if (!id) fresh += 1;
      console.log(`  ${id ?? 'NEW'}  ${result.name}: ${failure.slice(0, 160)}`);
    }
  }
  for (const { name, failures } of flaky) {
    console.log(`  FLAKY  ${name}: ${failures[0].slice(0, 160)}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Flaky flow::${name}: ${failures[0].slice(0, 160)}`);
  }
  if (!grep && !shard) for (const { id, used } of known) if (!used) console.log(`  STALE ${id}: nothing failed this way, remove its line`);
  console.log(`${fresh} new failures\nreport: ${path.join(out, 'report.json')}`);
  return fresh === 0;
};

export const listFlows = () => flows.map(({ name }) => name);
