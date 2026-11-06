// The room's own account of itself, checked on every frame. Status surfaces must
// agree, and nothing may be drawn over a player that has a picture.

/** Takes [{ name, text, state? }]. Self-contained, because it also runs inside the page. */
export const disagreements = (surfaces) => {
  const CLAIMS = {
    paused: /\bpaused\b|resume for everyone/i,
    moving: /keeps playing|still watching|playing at|everyone together/i,
    watching: /playing at|everyone together|loading…/i,
    loading: /loading…/i,
    failed: /it.s just you|won.t play here/i,
  };
  const CLASHES = [['paused', 'moving'], ['paused', 'loading'], ['failed', 'watching']];
  const found = [];
  const says = (claim) => surfaces.filter(({ text }) => CLAIMS[claim].test(text));
  for (const [one, other] of CLASHES) {
    for (const a of says(one)) for (const b of says(other)) found.push(`${a.name} "${a.text}" against ${b.name} "${b.text}"`);
  }
  const states = new Set(surfaces.map(({ state }) => state).filter(Boolean));
  if (states.size > 1) found.push(`two states at once: ${[...states].join(', ')}`);
  return found;
};

const watcher = () => {
  const clashes = new Set();
  const over = new Set();
  const seen = new Set();
  let running = true;
  const visible = (element) => element.getClientRects().length > 0;
  const surfaces = () => {
    const lines = [...document.querySelectorAll('[data-room-status]')].filter(visible);
    const stage = document.querySelector('[data-player]')?.parentElement;
    // Resume only shows in a paused room, so it says what the room is whatever the words say.
    const controls = [...document.querySelectorAll('[aria-label="Player controls"] button')].filter(visible);
    return [
      { name: 'controls', text: controls.map((button) => button.textContent).join(', ') },
      ...lines.map((line, index) => ({ name: `line ${index}`, text: line.textContent, state: line.dataset.roomStatus })),
      { name: 'stage', text: stage?.innerText.trim() ?? '' },
    ];
  };
  const name = (element) => `${element.tagName.toLowerCase()} "${element.textContent.trim().slice(0, 40)}"`;
  const checkPlayer = () => {
    const frame = document.querySelector('[data-player] iframe');
    if (!frame) return;
    const { left, top, width, height } = frame.getBoundingClientRect();
    // Playing, paused or buffering. Before that the player has no picture to cover.
    const live = [1, 2, 3].includes(window.__yt?.state);
    const words = frame.closest('[data-player]').parentElement.innerText.trim();
    if (words) over.add(`words on the stage: ${words.slice(0, 60)}`);
    for (let x = 0.1; x < 1; x += 0.2) {
      for (let y = 0.1; y < 1; y += 0.2) {
        const hit = document.elementFromPoint(left + x * width, top + y * height);
        if (hit && hit !== frame && live) over.add(`over a live player: ${name(hit)}`);
      }
    }
  };
  const frame = () => {
    if (!running) return;
    const now = surfaces();
    for (const { state } of now) if (state) seen.add(state);
    for (const clash of window.__disagreements(now)) clashes.add(clash);
    checkPlayer();
    requestAnimationFrame(frame);
  };
  frame();
  window.__truth = {
    stop: () => {
      running = false;
      return { clashes: [...clashes], over: [...over], seen: [...seen] };
    },
  };
};

export const watchTruth = async (page) => {
  await page.evaluate(`window.__disagreements = ${disagreements.toString()}`);
  await page.evaluate(watcher);
};

export const truthReport = (page) => page.evaluate(() => window.__truth.stop());
