// What a flow gets to work with. A check that fails in see() ends the flow, since
// what follows needs it; check() records the failure and carries on.
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);

const SEE_MS = 6000;

/** The same words can be in a hidden panel too. Only what shows counts. */
const shown = (locator) => locator.filter({ visible: true }).first();

export const makeTools = ({ browser, stack, fixtures, open }) => (entry, result) => {
  const clients = [];
  const fail = (text) => result.failures.push(text);

  const t = {
    base: stack.base,
    stack,
    fixtures,
    sleep,
    async person(name, options) {
      const client = await open({ browser }, name, options);
      clients.push(client);
      return client;
    },
    /** A soft check: the flow carries on, so one run reports everything. */
    check(label, ok, detail = '') {
      result.checks += 1;
      if (!ok) fail(`${label}${detail === '' ? '' : `: ${detail}`}`);
      return Boolean(ok);
    },
    eq(label, actual, expected) {
      return t.check(label, actual === expected, `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);
    },
    /** The locator must show up. */
    async see(label, locator, timeout = SEE_MS) {
      result.checks += 1;
      try {
        await shown(locator).waitFor({ state: 'visible', timeout });
      } catch {
        throw new Error(`never saw ${label}`);
      }
    },
    /** The same, without ending the flow. */
    async expect(label, locator, timeout = SEE_MS) {
      const seen = await shown(locator).waitFor({ state: 'visible', timeout }).then(() => true, () => false);
      return t.check(`saw ${label}`, seen);
    },
    /** The locator must go away, or never come. */
    async gone(label, locator, timeout = SEE_MS) {
      const hidden = await shown(locator).waitFor({ state: 'hidden', timeout }).then(() => true, () => false);
      return t.check(`${label} is gone`, hidden);
    },
    /** Polls until work returns something truthy, and records whether it did. */
    async until(label, work, timeout = SEE_MS) {
      const deadline = Date.now() + timeout;
      let last;
      while (Date.now() < deadline) {
        last = await work();
        if (last) return t.check(label, true);
        await sleep(100);
      }
      return t.check(label, false, `last value ${JSON.stringify(last)}`);
    },
  };

  return {
    t,
    async finish(out) {
      for (const client of clients) {
        for (const error of new Set(client.errors)) fail(`${client.name}: ${error}`);
        for (const url of client.external) fail(`${client.name} reached outside: ${url}`);
      }
      result.checks += clients.length;
      if (result.failures.length) {
        for (const client of clients) {
          const file = path.join(out, `${slugify(entry.name)}-${client.name}.png`);
          await client.page.screenshot({ path: file }).then(() => result.shots.push(file), () => {});
        }
      }
      await Promise.allSettled(clients.map((client) => client.context.close()));
    },
  };
};
