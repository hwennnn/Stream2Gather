// A headless guest who joins a room's call and talks: a tone, on and off, until
// stopped. For checking voice by ear or on a real device, which needs someone to hear.
//   node voice-speaker.mjs http://127.0.0.1:18082/r/slug [hz]
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const [url, hz = '440'] = process.argv.slice(2);
if (!url) throw new Error('usage: node voice-speaker.mjs <room url> [hz]');

const wav = join(mkdtempSync(join(tmpdir(), 's2g-speaker-')), 'tone.wav');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=0.6*sin(2*PI*${hz}*t)*lt(mod(t\\,1)\\,0.7):s=48000:d=20`, wav]);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
});
const page = await browser.newPage();
await page.goto(url);
await page.getByRole('button', { name: 'Join' }).first().click();
await page.locator('header').getByRole('button', { name: /Join voice|is in voice/ }).click();
await page.getByRole('button', { name: 'Unmute' }).click();
await page.getByRole('button', { name: 'Mute' }).waitFor();
console.log(`talking at ${hz} Hz in ${url}`);
process.on('SIGTERM', () => void browser.close().then(() => process.exit(0)));
await new Promise(() => {});
