// One person with one browser profile. Each gets their own cookies and their own
// address, and every page they open is watched for errors.
import { readFileSync } from 'node:fs';
import { byId, youtube } from './fixtures.mjs';
import { layoutScript } from './layout.mjs';

const STUB = readFileSync(new URL('./youtube-player.js', import.meta.url), 'utf8');

const seconds = (iso) => {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso) ?? [];
  return [86400, 3600, 60, 1].reduce((sum, unit, i) => sum + Number(match[i + 1] ?? 0) * unit, 0);
};

const playerScript = () => {
  const videos = Object.fromEntries(youtube.videos.map((video) => [
    video.id, { seconds: seconds(video.contentDetails.duration) || 600, error: video.playerError },
  ]));
  return STUB.replace('/*FIXTURE*/ {}', JSON.stringify(videos));
};

const thumbnail = (url) => {
  const id = /\/vi\/([^/]+)\//.exec(url)?.[1] ?? '';
  const hue = [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) * 47 % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="hsl(${hue} 50% 35%)"/></svg>`;
};

/** Offline mode leaves open sockets alone, so cutting one needs a hand on it. */
const socketHook = () => {
  const Native = window.WebSocket;
  const net = { sockets: [], deaf: false, ignoring: false, events: 0 };
  window.__net = net;
  net.send = (t, d, id) => net.sockets.at(-1).send(JSON.stringify({ t, d, id }));
  // Says closed at once, because a clean close waits on a network that may have just gone.
  net.cut = () => net.sockets.forEach((socket) => {
    socket.close();
    socket.dispatchEvent(new CloseEvent('close', { code: 1006 }));
  });
  window.WebSocket = class extends Native {
    #onmessage = null;
    constructor(...args) {
      super(...args);
      net.sockets.push(this);
      super.addEventListener('message', (event) => {
        if (net.deaf || net.ignoring) return;
        net.events += 1;
        this.#onmessage?.(event);
      });
    }
    get onmessage() {
      return this.#onmessage;
    }
    set onmessage(handler) {
      this.#onmessage = handler;
    }
    send(data) {
      if (!net.deaf) super.send(data);
    }
  };
};

/**
 * A first visit on a strict browser: sound needs a click. By hand, because a browser
 * flag lets a browser-opened page through, and page.evaluate counts as a click.
 */
const refuseSoundBeforeClick = () => {
  let clicked = false;
  for (const name of ['pointerdown', 'keydown']) window.addEventListener(name, () => { clicked = true; }, true);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function refusing() {
    if (clicked || this.muted) return play.call(this);
    return Promise.reject(new DOMException('needs a click', 'NotAllowedError'));
  };
};

/** The real one is shared by every context, and on a Mac it is the owner's own clipboard. */
const fakeClipboard = () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: async (text) => sessionStorage.setItem('clipboard', text),
      readText: async () => sessionStorage.getItem('clipboard') ?? '',
    },
  });
};

// What real use prints that isn't a bug. Everything else fails the flow.
const NOISE = [/Failed to load resource/, /net::ERR_/, /WebSocket connection to/, /favicon/];

const watch = (client, page) => {
  const note = (text) => {
    if (!client.expectedErrors?.test(text)) client.errors.push(text);
  };
  page.on('pageerror', (error) => note(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!NOISE.some((pattern) => pattern.test(text))) note(`console: ${text.slice(0, 240)}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500 && !client.expected5xx?.test(response.url())) client.errors.push(`http ${response.status()}: ${response.url()}`);
  });
  page.on('dialog', (dialog) => {
    client.errors.push(`dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
};

export const PHONE = { width: 390, height: 844 };
export const LANDSCAPE = { width: 844, height: 390 };

let addresses = 0;
const nextAddress = () => {
  addresses += 1;
  return `10.77.${Math.floor(addresses / 250)}.${(addresses % 250) + 1}`;
};

/** options: viewport, phone (touch), address (shared with someone), strictAutoplay, realYouTube */
export const openClient = async ({ browser }, name, options = {}) => {
  const { viewport = { width: 1440, height: 900 }, phone = false, address = nextAddress() } = options;
  const context = await browser.newContext({
    viewport,
    isMobile: phone,
    hasTouch: phone,
    locale: 'en-US',
    serviceWorkers: 'block',
    // Sent everywhere, which YouTube's own requests can't take.
    extraHTTPHeaders: options.realYouTube ? {} : { 'x-forwarded-for': address },
  });
  await context.addInitScript(fakeClipboard);
  await context.addInitScript(socketHook);
  await context.addInitScript(layoutScript);
  if (options.strictAutoplay) await context.addInitScript(refuseSoundBeforeClick);

  const client = { name, context, address, errors: [], external: new Set(), page: null, pages: [] };

  if (options.realYouTube) {
    await context.route(/^https?:\/\/localhost/, (route) =>
      route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': address } }));
  } else {
    await context.route(/^https?:\/\/(?!localhost)/, (route) => {
      const url = route.request().url();
      if (url.startsWith('https://www.youtube.com/iframe_api')) {
        return route.fulfill({ contentType: 'text/javascript', body: playerScript() });
      }
      if (/youtube(-nocookie)?\.com\/embed\//.test(url)) {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>player</title><body style="margin:0;background:#111">' });
      }
      if (url.startsWith('https://i.ytimg.com/')) {
        return route.fulfill({ contentType: 'image/svg+xml', body: thumbnail(url) });
      }
      client.external.add(url);
      return route.abort();
    });
  }

  client.open = async () => {
    const page = await context.newPage();
    watch(client, page);
    client.pages.push(page);
    return page;
  };
  client.page = await client.open();

  /** Where the room's player is, or null with nothing playing. */
  client.sample = (page = client.page) => page.evaluate(() => window.__s2g?.sample() ?? null);
  client.video = (id) => byId.get(id);
  /** Stops the network the way a dead connection does, sockets included. */
  client.offline = async () => {
    client.expectedErrors = /dynamically imported module/; // The lazy parts can't load, and the page copes.
    await context.setOffline(true);
    await Promise.all(client.pages.map((page) => page.evaluate(() => window.__net?.cut())));
  };
  client.online = () => context.setOffline(false);
  return client;
};
