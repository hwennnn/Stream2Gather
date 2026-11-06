const API_TIMEOUT_MS = 15_000;

export type Embed = {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  isPaused(): boolean;
  getCurrentTime(): number;
  getDuration(): number;
  getMuted(): boolean;
  setMuted(muted: boolean): void;
  getVolume(): number;
  setVolume(volume: number): void;
  addEventListener(event: string, listener: () => void): void;
  destroy?(): void;
};

export type EmbedOptions = {
  width: string;
  height: string;
  parent: string[];
  autoplay: boolean;
  muted: boolean;
  video?: string;
  channel?: string;
  time?: string;
};

export type TwitchApi = {
  Player: (new (target: HTMLElement, options: EmbedOptions) => Embed) & Record<string, string>;
};

declare global {
  interface Window {
    Twitch?: TwitchApi;
  }
}

let apiReady: Promise<TwitchApi> | null = null;

const requestApi = (): Promise<TwitchApi> =>
  new Promise((resolve, reject) => {
    if (window.Twitch?.Player) {
      resolve(window.Twitch);
      return;
    }
    const script = document.createElement('script');
    const giveUp = (message: string) => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error(message));
    };
    const timer = window.setTimeout(() => giveUp('The Twitch player took too long to load.'), API_TIMEOUT_MS);
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.Twitch?.Player) resolve(window.Twitch);
      else giveUp('The Twitch player could not be loaded.');
    };
    script.onerror = () => giveUp('The Twitch player could not be loaded.');
    script.src = 'https://player.twitch.tv/js/embed/v1.js';
    document.head.append(script);
  });

/** A failure is not kept, so the next video gets a fresh attempt. */
export const loadApi = (): Promise<TwitchApi> => {
  apiReady ??= requestApi().catch((error: unknown) => {
    apiReady = null;
    throw error;
  });
  return apiReady;
};

export const stamp = (seconds: number): string => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 3600)}h${Math.floor((whole % 3600) / 60)}m${whole % 60}s`;
};

/** Where the room would be, for when the embed can't say: a live channel, or none on the page. */
export const createClock = (start: number) => {
  let position = start;
  let since: number | null = null;
  const now = () => (since === null ? position : position + (performance.now() - since) / 1000);
  return {
    now,
    set: (seconds: number) => {
      position = seconds;
      if (since !== null) since = performance.now();
    },
    run: () => {
      since ??= performance.now();
    },
    stop: () => {
      position = now();
      since = null;
    },
  };
};

export const tooSmallNotice = (url: string): HTMLElement => {
  const notice = document.createElement('div');
  notice.className = 'flex h-full w-full flex-col items-center justify-center gap-3 bg-panel px-6 text-center';
  const text = document.createElement('p');
  text.className = 'text-sm text-muted';
  text.textContent = 'Rotate your phone or open on Twitch';
  const link = document.createElement('a');
  link.className = 'btn btn-quiet';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.textContent = 'Open on Twitch';
  notice.append(text, link);
  return notice;
};
