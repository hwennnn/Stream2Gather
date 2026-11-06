// Puts real browsers in a room's call against a real LiveKit, and proves they hear
// each other: each sends its own tone, and each must hear the other's. A real click
// starts the audio, so there's no autoplay flag here.
// `make e2e-voice` builds what this needs. By hand: BASE=http://localhost:18082 node voice.mjs [shots-dir]
//   E2E_LIVEKIT_CONTAINER  stops this container to check the room survives it
//   E2E_SOAK_MS            how long to stay in a call past token expiry at the end.
//                          E2E_SAMPLE must run longer, or the room has no video left to check
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { instrument } from './voice-page.mjs';

const BASE = process.env.BASE ?? 'http://localhost:18082';
const CONTAINER = process.env.E2E_LIVEKIT_CONTAINER ?? '';
const SOAK_MS = Number(process.env.E2E_SOAK_MS ?? 0);
const SHOTS = process.argv[2];
const ROUNDS = 10;
const ALICE_HZ = 440;
const BOB_HZ = 880;
const work = mkdtempSync(joinPath(tmpdir(), 's2g-voice-'));

const failures = [];
const report = {};
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}  ${detail}`);
};

const p95 = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? null;

/** Pulsed, because a browser's noise suppression removes a steady tone as hum. */
const toneFile = (hz) => {
  const path = joinPath(work, `${hz}.wav`);
  const signal = `0.6*sin(2*PI*${hz}*t)*lt(mod(t\\,0.25)\\,0.2)`;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=${signal}:s=48000:d=20`, path]);
  return path;
};

const browsers = [];
const launch = async (wav) => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
  });
  browsers.push(browser);
  return browser;
};

const viewer = async (browser, { deny } = {}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(instrument);
  if (deny) {
    await page.addInitScript((name) => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refused', name));
    }, deny);
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, errors };
};

const inRoom = async (who, url) => {
  await who.page.goto(url);
  await who.page.getByRole('button', { name: 'Join' }).first().click();
  await who.page.getByRole('tab', { name: /People/ }).waitFor();
};

const status = (who) => who.page.getByRole('group', { name: 'Voice' }).getByRole('status');
const button = (who, name) => who.page.getByRole('button', { name });
const joinButton = (who) => who.page.locator('header').getByRole('button', { name: /Join voice|is in voice|unavailable|another tab/ });

const liveChunkLoaded = (who) =>
  who.page.evaluate(() => performance.getEntriesByType('resource').some(({ name }) => /assets\/live-/.test(name)));

const joinVoice = async (who) => {
  const started = Date.now();
  await joinButton(who).click();
  await status(who).filter({ hasNotText: 'Joining' }).waitFor();
  return Date.now() - started;
};

const unmuteToAudible = async (speaker, listener) => {
  const heard = listener.page.evaluate(() => window.__audibleAfter(3000));
  const started = Date.now();
  await button(speaker, 'Unmute').click();
  return (await heard) - started;
};

const quiet = async (who) => {
  await sleep(400);
  return (await who.page.evaluate(() => window.__peak())) < 0.02;
};

/** How far apart these viewers are, one reading a second, while all of them are playing. */
const spread = async (people, seconds) => {
  const drifts = [];
  for (let second = 0; second < seconds; second += 1) {
    await sleep(1000);
    const samples = await Promise.all(people.map((who) => who.page.evaluate(() => window.__s2g?.sample() ?? null)));
    if (samples.every((sample) => sample?.state === 'playing')) {
      const offsets = samples.map((sample) => sample.time - sample.expected);
      drifts.push((Math.max(...offsets) - Math.min(...offsets)) * 1000);
    }
  }
  return { n: drifts.length, p95: Math.round(p95(drifts)), max: Math.round(Math.max(...drifts)) };
};

/** What someone in the call sees, at desktop and phone sizes, for a person to look at. */
const shots = async (who, name) => {
  if (!SHOTS) return;
  await who.page.screenshot({ path: joinPath(SHOTS, `${name}-desktop.png`) });
  await who.page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  await who.page.screenshot({ path: joinPath(SHOTS, `${name}-phone.png`) });
  await who.page.setViewportSize({ width: 1280, height: 800 });
};

const run = async () => {
  const aliceBrowser = await launch(toneFile(ALICE_HZ));
  const bobBrowser = await launch(toneFile(BOB_HZ));
  const alice = await viewer(aliceBrowser);
  const bob = await viewer(bobBrowser);

  await alice.page.goto(BASE);
  await alice.page.fill('#link', `${BASE}/sample.mp4`);
  await alice.page.click('button[type=submit]');
  await alice.page.waitForURL(/\/r\//);
  const url = alice.page.url();
  await inRoom(bob, url);

  await joinButton(bob).waitFor();
  check('no voice code before anyone asks', !(await liveChunkLoaded(bob)));
  await joinButton(bob).hover();
  await bob.page.waitForFunction(() => performance.getEntriesByType('resource').some(({ name }) => /assets\/live-/.test(name)));
  check('hovering loads the voice code', true);

  // Click to listening, warm, on loopback.
  const joins = [];
  await joinButton(alice).hover();
  await sleep(500);
  for (let round = 0; round < ROUNDS; round += 1) {
    joins.push(await joinVoice(alice));
    if (round < ROUNDS - 1) {
      await button(alice, 'Leave voice').click();
      await joinButton(alice).waitFor();
    }
  }
  report.clickToListeningMs = { p95: p95(joins), max: Math.max(...joins), rounds: ROUNDS };
  check('click to listening under 1.5 s on loopback', p95(joins) < 1500, JSON.stringify(report.clickToListeningMs));
  check('alone in voice says so', /first one here/.test(await status(alice).innerText()));

  await bob.page.getByRole('button', { name: /is in voice\. Join/ }).waitFor();
  check('others are invited by name', true, await joinButton(bob).innerText());
  await joinVoice(bob);
  check('joining asks for no mic', (await bob.page.evaluate(() => window.__micAsks)) === 0);
  await status(bob).filter({ hasText: 'You’re listening' }).waitFor();

  // Unmuting: the first time asks for the mic and publishes, the rest toggle.
  report.firstUnmuteMs = await unmuteToAudible(alice, bob);
  await button(alice, 'Mute').click();
  check('muting goes quiet', await quiet(bob));
  const unmutes = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    unmutes.push(await unmuteToAudible(alice, bob));
    await button(alice, 'Mute').click();
    await sleep(600);
  }
  report.unmuteToAudibleMs = { p95: p95(unmutes), max: Math.max(...unmutes), first: report.firstUnmuteMs, rounds: ROUNDS };
  check('unmute to audible under 500 ms on loopback', p95(unmutes) < 500, JSON.stringify(report.unmuteToAudibleMs));

  // The real proof: both directions, each hearing the other's own tone.
  await button(alice, 'Unmute').click();
  await button(bob, 'Unmute').click();
  await status(bob).filter({ hasText: 'Mic on' }).waitFor();
  await sleep(1500);
  const before = await Promise.all([alice.page.evaluate(() => window.__stats()), bob.page.evaluate(() => window.__stats())]);
  const [aliceHears, bobHears] = await Promise.all([
    alice.page.evaluate(() => window.__pitch(4000)),
    bob.page.evaluate(() => window.__pitch(4000)),
  ]);
  const after = await Promise.all([alice.page.evaluate(() => window.__stats()), bob.page.evaluate(() => window.__stats())]);
  report.audio = {
    aliceHears,
    bobHears,
    aliceBytes: after[0].bytes - before[0].bytes,
    bobBytes: after[1].bytes - before[1].bytes,
    aliceEnergy: after[0].energy - before[0].energy,
    bobEnergy: after[1].energy - before[1].energy,
    path: after[1].pair,
  };
  check('Bob hears Alice’s tone', Math.abs(bobHears - ALICE_HZ) <= 20, `${bobHears} Hz, sent ${ALICE_HZ}`);
  check('Alice hears Bob’s tone', Math.abs(aliceHears - BOB_HZ) <= 20, `${aliceHears} Hz, sent ${BOB_HZ}`);
  check('bytes keep arriving both ways', report.audio.aliceBytes > 5000 && report.audio.bobBytes > 5000, JSON.stringify(report.audio));

  // What the room shows.
  await bob.page.getByRole('tab', { name: /People/ }).click();
  const panel = bob.page.locator('#panel-people');
  await panel.getByText('Speaking').first().waitFor();
  check('talking shows on the person, in words', true);
  await bob.page.locator(".seat[data-speaking='true']:visible").first().waitFor();
  check('and on their seat', true);
  await shots(bob, 'voice-talking');
  await button(bob, 'Mute').click();

  // Ducking, on a file: Alice talks and Bob's video comes down, then back.
  const video = () => bob.page.evaluate(() => document.querySelector('video')?.volume ?? null);
  await bob.page.waitForFunction(() => document.querySelector('video') !== null);
  await button(alice, 'Mute').click();
  await sleep(2000);
  const resting = await video();
  await button(alice, 'Unmute').click();
  await sleep(1500);
  const ducked = await video();
  await button(alice, 'Mute').click();
  await sleep(2500);
  const restored = await video();
  report.ducking = { resting, ducked, restored };
  check('the video ducks to 30% and comes back', Math.abs(ducked - resting * 0.3) < 0.02 && Math.abs(restored - resting) < 0.02, JSON.stringify(report.ducking));

  // Push to talk: Bob holds the button, and only then does Alice hear him.
  await bob.page.getByRole('switch', { name: /Push to talk/ }).check();
  const hold = button(bob, 'Hold to talk');
  await hold.waitFor();
  check('push to talk starts muted', await quiet(alice));
  const box = await hold.boundingBox();
  await bob.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const heard = alice.page.evaluate(() => window.__audibleAfter(3000));
  const pressed = Date.now();
  await bob.page.mouse.down();
  report.pushToTalkMs = (await heard) - pressed;
  await sleep(500);
  await bob.page.mouse.up();
  await sleep(300);
  check('hold to talk talks, and letting go stops', report.pushToTalkMs < 500 && (await quiet(alice)), `${report.pushToTalkMs} ms`);
  await bob.page.getByRole('switch', { name: /Push to talk/ }).uncheck();

  // A second tab takes over the call, and the room never shows two.
  const second = { page: await alice.context.newPage() };
  await second.page.addInitScript(instrument);
  await inRoom(second, url);
  await joinVoice(second);
  await alice.page.getByRole('button', { name: 'Voice moved to another tab' }).waitFor();
  check('the old tab says voice moved', true);
  await second.page.close();

  // Reloading never rejoins, because audio needs a fresh gesture.
  await bob.page.reload();
  await bob.page.getByRole('tab', { name: /People/ }).waitFor().catch(() => {});
  await inRoomAfterReload(bob);
  await sleep(1000);
  check('a reload does not rejoin', (await bob.page.getByRole('group', { name: 'Voice' }).count()) === 0);

  // A blocked or missing mic leaves you listening.
  for (const [deny, copy] of [
    ['NotAllowedError', /mic is blocked/],
    ['NotFoundError', /No microphone found/],
  ]) {
    const guest = await viewer(aliceBrowser, { deny });
    await inRoom(guest, url);
    await joinVoice(guest);
    await button(guest, 'Unmute').click();
    await guest.page.getByText(copy).waitFor();
    check(`${deny} stays listening`, (await button(guest, 'Unmute').count()) === 1, await status(guest).innerText());
    await guest.context.close();
  }

  // Someone who isn't in the room can't get a token.
  const outsider = await viewer(bobBrowser);
  await outsider.page.goto(BASE);
  const slug = new URL(url).pathname.split('/')[2];
  const refused = await outsider.page.evaluate(async (path) => (await fetch(path, { method: 'POST' })).status, `/v1/rooms/${slug}/voice-token`);
  check('a token needs presence', refused === 401 || refused === 403, String(refused));
  await outsider.context.close();

  if (SOAK_MS > 0) {
    await joinVoice(bob);
    await joinVoice(alice);
    await button(alice, 'Unmute').click();
    await sleep(SOAK_MS);
    const soaked = await bob.page.evaluate(() => window.__pitch(3000));
    check('still talking past token expiry', Math.abs(soaked - ALICE_HZ) <= 20, `${soaked} Hz after ${SOAK_MS} ms`);
  }

  // Six people talking must not cost the video its sync. The same six, quiet, are the
  // control: a loaded machine moves both numbers, and only the gap between them is voice.
  const others = await Promise.all([1, 2, 3, 4].map(() => viewer(bobBrowser)));
  for (const who of others) await inRoom(who, url);
  const six = [alice, bob, ...others];
  await sleep(4000);
  report.sixQuiet = await spread(six, 20);
  for (const who of six) {
    if ((await who.page.getByRole('group', { name: 'Voice' }).count()) === 0) await joinVoice(who);
    if (await button(who, 'Unmute').count()) await button(who, 'Unmute').click();
  }
  await sleep(3000);
  report.sixTalking = await spread(six, 20);
  const voices = await bob.page.evaluate(() => document.querySelectorAll('audio').length);
  check('six people are in the call', voices === 5, `Bob hears ${voices} others`);
  check('six talking, the video stays in sync', report.sixTalking.n >= 15 && report.sixTalking.p95 < 80, JSON.stringify(report));
  for (const who of others) await who.context.close();

  // Losing the voice server costs voice and nothing else.
  if (CONTAINER) {
    if ((await bob.page.getByRole('group', { name: 'Voice' }).count()) === 0) await joinVoice(bob);
    const time = () => bob.page.evaluate(() => window.__s2g?.sample().time ?? null);
    execFileSync('docker', ['stop', '-t', '0', CONTAINER]);
    await status(bob).filter({ hasText: 'Reconnecting voice' }).waitFor({ timeout: 20000 }).catch(() => {});
    await joinButton(bob).waitFor({ timeout: 90000 });
    await joinButton(bob).click();
    await bob.page.locator('header').getByRole('button', { name: 'Voice unavailable' }).waitFor({ timeout: 30000 });
    check('with LiveKit down the button says so', true);
    const start = await time();
    await sleep(2000);
    const later = await time();
    check('and the video plays on', later > start, `${start} -> ${later}`);
    execFileSync('docker', ['start', CONTAINER]);
  }

  check('no page errors', [alice, bob].every((who) => who.errors.length === 0), [...alice.errors, ...bob.errors].join(' | '));
};

const inRoomAfterReload = async (who) => {
  const gate = who.page.getByRole('button', { name: 'Join', exact: true });
  if (await gate.count()) await gate.click();
  await who.page.getByRole('tab', { name: /People/ }).waitFor();
};

try {
  await run();
} catch (error) {
  failures.push(String(error));
  console.log(`FAIL  ${error}`);
}
for (const browser of browsers) await browser.close();
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
