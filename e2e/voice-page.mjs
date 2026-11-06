// Runs in the page, before the app: counts mic requests, and reads what's actually
// being played and received, so a test can tell real sound from a working button.
export const instrument = () => {
  const Native = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = class extends Native {
    constructor(...args) {
      super(...args);
      window.__pcs.push(this);
    }
  };
  window.__micAsks = 0;
  const devices = navigator.mediaDevices;
  const ask = devices.getUserMedia.bind(devices);
  devices.getUserMedia = (constraints) => {
    if (constraints?.audio) window.__micAsks += 1;
    return ask(constraints);
  };

  // Reads what the page is actually playing, not what the network delivered.
  const taps = new Map();
  const context = () => (window.__audio ??= new AudioContext());
  const tap = (element) => {
    if (!taps.has(element) && element.srcObject) {
      const analyser = context().createAnalyser();
      analyser.fftSize = 8192;
      context().createMediaStreamSource(element.srcObject).connect(analyser);
      taps.set(element, analyser);
    }
    return taps.get(element);
  };
  window.__peak = () => {
    void context().resume();
    let loudest = 0;
    for (const element of document.querySelectorAll('audio')) {
      const analyser = tap(element);
      if (!analyser) continue;
      const samples = new Float32Array(2048);
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
    }
    return loudest;
  };
  window.__pitch = async (ms) => {
    void context().resume();
    const totals = new Map();
    const started = performance.now();
    while (performance.now() - started < ms) {
      for (const element of document.querySelectorAll('audio')) {
        const analyser = tap(element);
        if (!analyser) continue;
        const bins = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(bins);
        let best = 0;
        for (let i = 2; i < bins.length; i += 1) if (bins[i] > bins[best]) best = i;
        if (bins[best] > -70) {
          const hz = Math.round((best * context().sampleRate) / analyser.fftSize / 10) * 10;
          totals.set(hz, (totals.get(hz) ?? 0) + 1);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return [...totals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  };
  /** Resolves with when sound arrived, watching faster than a round trip to the test can. */
  window.__audibleAfter = (limit) =>
    new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.__peak() > 0.02 || Date.now() - started > limit) {
          clearInterval(timer);
          resolve(Date.now());
        }
      }, 5);
    });
  window.__stats = async () => {
    const out = { bytes: 0, packets: 0, energy: 0, pair: null };
    for (const pc of window.__pcs) {
      const stats = await pc.getStats();
      for (const entry of stats.values()) {
        if (entry.type === 'inbound-rtp' && entry.kind === 'audio') {
          out.bytes += entry.bytesReceived ?? 0;
          out.packets += entry.packetsReceived ?? 0;
          out.energy += entry.totalAudioEnergy ?? 0;
        }
        if (entry.type === 'candidate-pair' && entry.nominated && entry.bytesReceived > 0) {
          const remote = stats.get(entry.remoteCandidateId);
          out.pair = `${remote?.protocol} ${remote?.port}`;
        }
      }
    }
    return out;
  };
};
