// A stand-in for YouTube's iframe API, served in place of it, with the methods
// the app's adapter calls. Fixture ids aren't real videos, and a run must not
// depend on YouTube's network, so the real player is only tested by sync.mjs and
// the opt-in real flows. A flow plays the viewer through window.__yt.
(() => {
  const videos = /*FIXTURE*/ {};
  const STATES = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3 };

  class Player {
    constructor(target, options) {
      this.id = options.videoId;
      this.events = options.events;
      this.state = STATES.unstarted;
      this.pos = options.playerVars?.start ?? 0;
      this.rate = 1;
      this.since = 0;
      this.isMutedNow = false;
      this.frame = document.createElement('iframe');
      this.frame.title = 'YouTube video player';
      this.frame.allow = 'autoplay; encrypted-media';
      this.frame.width = '100%';
      this.frame.height = '100%';
      this.frame.src = `${options.host}/embed/${this.id}`;
      target.replaceWith(this.frame);
      window.__yt = this;
      this.ticker = setInterval(() => this.tick(), 100);
      setTimeout(() => this.boot(), 30);
    }

    boot() {
      const code = videos[this.id]?.error;
      if (code) {
        this.events.onError?.({ data: code, target: this });
        return;
      }
      this.events.onReady?.({ target: this });
      if (this.frame.isConnected) this.set(STATES.playing);
    }

    duration() {
      return videos[this.id]?.seconds ?? 600;
    }

    set(state) {
      if (this.state === STATES.playing) this.pos = this.getCurrentTime();
      this.state = state;
      this.since = performance.now();
      this.events.onStateChange?.({ data: state, target: this });
    }

    tick() {
      if (this.state === STATES.playing && this.getCurrentTime() >= this.duration()) {
        this.pos = this.duration();
        this.set(STATES.ended);
      }
    }

    getCurrentTime() {
      const moving = this.state === STATES.playing ? ((performance.now() - this.since) / 1000) * this.rate : 0;
      return Math.min(this.pos + moving, this.duration());
    }

    playVideo() {
      if (this.state !== STATES.playing) this.set(STATES.playing);
    }

    pauseVideo() {
      if (this.state === STATES.playing || this.state === STATES.buffering) this.set(STATES.paused);
    }

    seekTo(seconds) {
      const resume = this.state === STATES.playing || this.state === STATES.buffering;
      this.pos = seconds;
      this.since = performance.now();
      if (!resume) return;
      this.set(STATES.buffering);
      this.pos = seconds;
      setTimeout(() => this.state === STATES.buffering && this.set(STATES.playing), 120);
    }

    setPlaybackRate(rate) {
      this.pos = this.getCurrentTime();
      this.since = performance.now();
      this.rate = rate;
    }

    mute() {
      this.isMutedNow = true;
    }

    unMute() {
      this.isMutedNow = false;
    }

    isMuted() {
      return this.isMutedNow;
    }

    destroy() {
      clearInterval(this.ticker);
      this.frame.remove();
      if (window.__yt === this) window.__yt = undefined;
    }
  }

  window.YT = { Player, PlayerState: STATES };
  setTimeout(() => window.onYouTubeIframeAPIReady?.());
})();
