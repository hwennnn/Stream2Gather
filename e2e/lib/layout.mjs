// Measures what a viewer's eye would catch, in the DOM. These run inside the
// page, so they stick to what the browser reports and know nothing about classes.
import { ui } from './app.mjs';

/** Runs inside the page: what is painted inside a surface, as boxes. */
const inPage = () => {
  const alpha = (color) => {
    const match = /rgba?\(([^)]+)\)/.exec(color);
    if (!match) return 1;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean);
    return parts.length > 3 ? Number(parts[3]) : 1;
  };
  const isHidden = (el) => {
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
      if (node.hasAttribute('hidden')) return true;
      if (style.position === 'absolute' && node.offsetWidth <= 1 && style.overflow === 'hidden') return true;
    }
    return false;
  };
  /** The part of a box that survives every scroller and clip above it. */
  const clipped = (rect, el) => {
    const out = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const box = node.getBoundingClientRect();
      out.left = Math.max(out.left, box.left);
      out.right = Math.min(out.right, box.right);
      out.top = Math.max(out.top, box.top);
      out.bottom = Math.min(out.bottom, box.bottom);
    }
    return out;
  };
  const named = (el) => (el.getAttribute?.('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40);

  const ink = (root, panelWidth) => {
    const boxes = [];
    const add = (rect, el, what) => {
      const box = clipped(rect, el);
      if (box.right - box.left > 0.5 && box.bottom - box.top > 0.5) boxes.push({ ...box, what });
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.textContent.trim() || isHidden(node.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) add(rect, node.parentElement, `text "${node.textContent.trim().slice(0, 30)}"`);
        continue;
      }
      if (isHidden(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width >= panelWidth - 1) continue; // Dividers run edge to edge on purpose.
      const style = getComputedStyle(node);
      const painted = alpha(style.backgroundColor) > 0.02 ||
        (parseFloat(style.borderLeftWidth) > 0 && alpha(style.borderLeftColor) > 0.02);
      if (painted || node.matches('img, svg, video, iframe, input, textarea, button, [role=tab]')) add(rect, node, `<${node.tagName.toLowerCase()}> ${named(node)}`);
    }
    return boxes;
  };

  return {
    gutters({ panel, parts }) {
      // From inside the panel's border, which is not part of the gutter.
      const outer = panel.getBoundingClientRect();
      const frame = { left: outer.left + panel.clientLeft, width: panel.clientWidth };
      frame.right = frame.left + frame.width;
      const out = {};
      for (const [name, part] of Object.entries(parts)) {
        const boxes = ink(part, frame.width);
        if (!boxes.length) continue;
        const left = boxes.reduce((a, b) => (b.left < a.left ? b : a));
        const right = boxes.reduce((a, b) => (b.right > a.right ? b : a));
        out[name] = {
          left: Math.round((left.left - frame.left) * 10) / 10,
          right: Math.round((frame.right - right.right) * 10) / 10,
          leftmost: left.what,
          rightmost: right.what,
        };
      }
      return out;
    },

    /** How far what is inside a surface stays from each of its edges. */
    insets({ panel }) {
      const frame = panel.getBoundingClientRect();
      const boxes = [...panel.children].flatMap((child) => ink(child, frame.width));
      if (!boxes.length) return null;
      return {
        top: Math.round(Math.min(...boxes.map((box) => box.top)) - frame.top),
        bottom: Math.round(frame.bottom - Math.max(...boxes.map((box) => box.bottom))),
      };
    },

    /** Anything crossing its frame, or text cut off without an ellipsis. */
    spills({ frame }) {
      const edge = frame.getBoundingClientRect();
      const problems = [];
      const note = (kind, el, detail) => problems.push({ kind, what: named(el), detail });
      for (const el of frame.querySelectorAll('*')) {
        if (isHidden(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const style = getComputedStyle(el);
        const seen = clipped(rect, el.parentElement ?? el);
        if ((seen.right > edge.right + 1 || seen.left < edge.left - 1) && seen.right > seen.left) {
          note('crosses the panel edge', el, `${Math.round(seen.left - edge.left)}..${Math.round(seen.right - edge.left)} of ${Math.round(edge.width)}`);
        }
        const text = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (text.length || el.matches('input, button')) {
          const lost = rect.right - seen.right;
          if (lost > 1 && seen.right > seen.left) note('cut off by a box it does not fit', el, `${Math.round(lost)}px lost`);
        }
        if (!text.length) continue;
        const cut = el.scrollWidth > el.clientWidth + 1;
        const clamped = style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '';
        if (cut && style.overflowX !== 'visible' && (style.textOverflow !== 'ellipsis' || clamped)) {
          note('text cut off with no ellipsis', el, `${el.scrollWidth} in ${el.clientWidth}`);
        }
        if (style.overflowX === 'visible' && style.display !== 'inline') {
          for (const node of text) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const right = Math.max(...[...range.getClientRects()].map((r) => r.right));
            if (right > rect.right + 1) note('text spills out of its box', el, `${Math.round(right - rect.right)}px`);
          }
        }
      }
      return problems;
    },

    /** Samples the player on a grid. Every point must hit the player itself. */
    covered({ player }) {
      const rect = player.getBoundingClientRect();
      const hits = new Map();
      for (let x = 0.5; x < 12; x += 1) {
        for (let y = 0.5; y < 8; y += 1) {
          const hit = document.elementFromPoint(rect.left + (rect.width * x) / 12, rect.top + (rect.height * y) / 8);
          if (hit && hit !== player && !player.contains(hit)) hits.set(named(hit), (hits.get(named(hit)) ?? 0) + 1);
        }
      }
      return { width: rect.width, height: rect.height, hits: [...hits] };
    },

    /** Every control you can see must be the thing you'd click. */
    blockedControls() {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], input, [role=switch], [role=tab]')) {
        if (isHidden(el) || el.getAttribute('aria-hidden') === 'true') continue;
        const rect = el.getBoundingClientRect();
        const seen = clipped(rect, el.parentElement);
        if (seen.right - seen.left < rect.width - 1 || seen.bottom - seen.top < rect.height - 1 || rect.width < 1) continue;
        if (rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth) continue;
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (hit && !el.contains(hit) && !hit.contains(el)) out.push(`${named(el)} is under ${named(hit)}`);
      }
      return out;
    },
  };
};

const tool = (page, name, arg) => page.evaluate(([method, input]) => window.__layout[method](input), [name, arg]);

/** The page's policy forbids eval, so the client installs these as an init script. */
export const layoutScript = `window.__layout = (${inPage.toString()})();`;

const handle = (locator) => locator.first().elementHandle({ timeout: 5000 }).catch(() => null);

/** The surfaces of the rail the viewer can see right now, by what they are. */
export const railParts = (page) => ({
  tabs: page.getByRole('tablist', { name: 'Room panels' }),
  chat: ui.chatLog(page),
  'chat box': ui.chatBox(page).locator('xpath=ancestor::form[1]'),
  search: ui.addBox(page).locator('xpath=ancestor::form[1]'),
  'up next': ui.upNext(page),
  popular: ui.rail(page).getByRole('region', { name: 'Popular on YouTube' }),
  results: ui.results(page),
  people: ui.rail(page).getByRole('tabpanel', { name: 'People' }).getByRole('list'),
  'host switch': ui.hostSwitch(page).locator('xpath=..'),
});

export const gutters = async (page) => {
  const panel = await handle(ui.rail(page));
  const parts = {};
  for (const [name, locator] of Object.entries(railParts(page))) {
    const found = await locator.filter({ visible: true }).first().elementHandle({ timeout: 300 }).catch(() => null);
    if (found) parts[name] = found;
  }
  return tool(page, 'gutters', { panel, parts });
};

export const spills = async (page, locator) => tool(page, 'spills', { frame: await handle(locator) });

export const insets = async (page, locator) => tool(page, 'insets', { panel: await handle(locator) });

export const blockedControls = (page) => tool(page, 'blockedControls');

export const playerCover = async (page) => {
  const player = await handle(page.locator('iframe, video').filter({ visible: true }));
  return player ? tool(page, 'covered', { player }) : null;
};

export const sideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
