export type Hold = 'key' | 'pointer';

const TALK_KEY = 'v';

export const isTyping = (event: Event): boolean =>
  event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]') !== null;

/** A bare press of this key, not a repeat, and not someone typing it. */
const isTalkKey = (event: KeyboardEvent): boolean =>
  event.key.toLowerCase() === TALK_KEY && !event.metaKey && !event.ctrlKey && !event.altKey;

/**
 * Talks while a key or the on-page button is held. A browser can swallow the
 * release, as when focus moves into the player, so anything that might have
 * hidden it counts as letting go. A mic stuck open is the worst way this can fail.
 */
export class PushToTalk {
  private readonly holds = new Set<Hold>();

  constructor(private readonly onChange: (talking: boolean) => void) {}

  press(by: Hold): void {
    if (this.holds.size === 0) this.onChange(true);
    this.holds.add(by);
  }

  release(by: Hold): void {
    if (this.holds.delete(by) && this.holds.size === 0) this.onChange(false);
  }

  releaseAll(): void {
    if (this.holds.size === 0) return;
    this.holds.clear();
    this.onChange(false);
  }

  /** Listens to the page until the returned function is called. */
  attach(): () => void {
    const down = (event: KeyboardEvent) => {
      if (!event.repeat && isTalkKey(event) && !isTyping(event)) this.press('key');
    };
    const up = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === TALK_KEY) this.release('key');
    };
    const letGo = () => this.release('pointer');
    const dropAll = () => this.releaseAll();
    const hidden = () => {
      if (document.visibilityState === 'hidden') this.releaseAll();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('pointerup', letGo);
    window.addEventListener('pointercancel', dropAll);
    window.addEventListener('blur', dropAll);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      this.releaseAll();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('pointerup', letGo);
      window.removeEventListener('pointercancel', dropAll);
      window.removeEventListener('blur', dropAll);
      document.removeEventListener('visibilitychange', hidden);
    };
  }
}
