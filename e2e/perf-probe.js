// Runs inside the page before anything else. Everything perf.mjs reads comes from
// window.__perf, so it works on the production bundle with no app changes.
(() => {
  const empty = () => ({ commits: 0, renders: 0, names: {}, events: [], tasks: [], frames: [], wsIn: 0, wsOut: 0, wsTypes: {} });
  let win = empty();
  let last = 0;
  let running = false;
  let armed = null;

  // React tells the DevTools hook about every commit, even in production. A fiber
  // whose child pointer did not change was skipped, so walking stops there.
  const COMPONENT = new Set([0, 1, 11, 14, 15]);
  const visit = (fiber) => {
    const before = fiber.alternate;
    if (COMPONENT.has(fiber.tag) && (before === null || fiber.flags & 1)) {
      win.renders += 1;
      const name = fiber.type?.name || fiber.type?.render?.name || fiber.type?.type?.name || 'anonymous';
      win.names[name] = (win.names[name] ?? 0) + 1;
    }
    if (before === null || fiber.child !== before.child) {
      for (let child = fiber.child; child; child = child.sibling) visit(child);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    checkDCE: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    onCommitFiberRoot: (_id, root) => {
      // A state set to what it already was can still commit, with nothing rendered and
      // nothing on the page changed. That costs nothing, so only real work counts.
      const before = win.renders;
      visit(root.current);
      if (win.renders > before) win.commits += 1;
    },
  };

  const watch = (type, options, take) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(take)).observe({ type, ...options });
    } catch {
      // Not every Chrome has every entry type.
    }
  };
  watch('event', { durationThreshold: 16, buffered: true }, (entry) => {
    if (entry.interactionId) win.events.push({ name: entry.name, duration: entry.duration });
  });
  watch('longtask', { buffered: true }, (entry) => win.tasks.push(entry.duration));

  // Browser throttling doesn't reach sockets, so a real round trip goes here.
  const delay = window.__perfSocketDelay ?? 0;
  const Native = window.WebSocket;
  window.__sockets = [];
  window.WebSocket = class extends Native {
    #onmessage = null;
    constructor(...args) {
      super(...args);
      window.__sockets.push(this);
      super.addEventListener('message', (event) => {
        win.wsIn += 1;
        const type = /^\{"t":"([^"]+)"/.exec(event.data)?.[1] ?? 'other';
        win.wsTypes[type] = (win.wsTypes[type] ?? 0) + 1;
        setTimeout(() => this.#onmessage?.(event), delay);
      });
    }
    get onmessage() {
      return this.#onmessage;
    }
    set onmessage(handler) {
      this.#onmessage = handler;
    }
    send(data) {
      win.wsOut += 1;
      setTimeout(() => this.readyState === Native.OPEN && super.send(data), delay);
    }
  };

  const tick = (now) => {
    if (!running) return;
    if (last) win.frames.push(now - last);
    last = now;
    if (armed?.started != null) {
      for (const mark of armed.marks) mark.at ??= mark.check() ? performance.now() : undefined;
    }
    requestAnimationFrame(tick);
  };
  const noteInput = (event) => {
    if (armed && armed.started === null) armed.started = event.timeStamp;
  };
  addEventListener('pointerdown', noteInput, true);
  addEventListener('keydown', noteInput, true);

  const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? 0;

  window.__perf = {
    begin() {
      win = empty();
      win.start = performance.now();
      last = 0;
      if (!running) {
        running = true;
        requestAnimationFrame(tick);
      }
    },
    /**
     * The next input, or this moment if now is set, starts a clock. Each check
     * stops its own mark on the first frame where it holds.
     */
    arm(checks, now) {
      const marks = checks.map((check) => ({ check }));
      armed = { marks, started: now ? performance.now() : null };
    },
    /** Milliseconds from the input to each frame, or null until all have landed. */
    elapsed: () => (armed?.marks.every((mark) => mark.at) ? armed.marks.map((mark) => mark.at - armed.started) : null),
    end() {
      running = false;
      const seconds = (performance.now() - win.start) / 1000;
      const durations = win.events.map((event) => event.duration);
      const budget = 1000 / 60;
      return {
        seconds,
        commits: win.commits,
        renders: win.renders,
        inp: Math.max(0, ...durations),
        interactions: durations.length,
        longTasks: win.tasks.length,
        blockingMs: win.tasks.reduce((sum, duration) => sum + Math.max(duration - 50, 0), 0),
        longestTask: Math.max(0, ...win.tasks),
        frames: win.frames.length,
        dropped: win.frames.reduce((sum, delta) => sum + Math.max(Math.round(delta / budget) - 1, 0), 0),
        frameP95: quantile(win.frames, 0.95),
        wsIn: win.wsIn,
        wsOut: win.wsOut,
        wsTypes: win.wsTypes,
        names: Object.fromEntries(Object.entries(win.names).sort((a, b) => b[1] - a[1]).slice(0, 12)),
      };
    },
  };
})();
