// Every sound is made here with Web Audio: the engine, the indicator's tick-tock, thuds, the doorbell, crashes, and a small
// step sequencer that plays each town's groove. Started by the first tap; the platform owns volume and mute.

const GROOVES = {
  sunny: { bpm: 104, root: 48, scale: [0, 2, 4, 7, 9], bass: [0, 0, 7, 0, 5, 0, 7, 9], chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]], hook: [12, 14, 16, 19, 16, 14], hat: 'closed', swing: 0.08 },
  disco: { bpm: 112, root: 45, scale: [0, 3, 5, 7, 10], bass: [0, 12, 0, 12, 5, 17, 7, 19], chords: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [7, 10, 14]], hook: [12, 15, 17, 15, 12, 10], hat: 'open', swing: 0 },
  harbour: { bpm: 96, root: 50, scale: [0, 2, 4, 7, 9], bass: [0, 0, 4, 7, 9, 7, 4, 0], chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], hook: [16, 14, 12, 9, 12, 14], hat: 'off', swing: 0.12 },
  snow: { bpm: 100, root: 52, scale: [0, 2, 4, 7, 9], bass: [0, 7, 0, 7, 5, 12, 7, 4], chords: [[0, 4, 7], [5, 9, 12], [9, 12, 16], [7, 11, 14]], hook: [19, 16, 14, 12, 14, 16], hat: 'bells', swing: 0.06 },
  night: { bpm: 118, root: 45, scale: [0, 3, 5, 7, 10], bass: [0, 0, 0, 0, 8, 8, 10, 10], chords: [[0, 3, 7], [8, 12, 15], [10, 14, 17], [7, 10, 14]], hook: [12, 10, 7, 10, 12, 15], hat: 'closed', swing: 0, saw: true },
  desert: { bpm: 92, root: 40, scale: [0, 1, 4, 5, 7, 8, 10], bass: [0, 0, 1, 0, 5, 4, 1, 0], chords: [[0, 4, 7], [1, 5, 8], [0, 4, 7], [10, 13, 17]], hook: [12, 13, 16, 13, 12, 10], hat: 'closed', swing: 0.1 },
  rain: { bpm: 98, root: 47, scale: [0, 2, 3, 7, 10], bass: [0, 0, 3, 3, 5, 5, 7, 10], chords: [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [8, 12, 15, 19]], hook: [15, 14, 10, 7, 10, 12], hat: 'soft', swing: 0.16 },
  works: { bpm: 108, root: 46, scale: [0, 3, 5, 6, 7, 10], bass: [0, 0, 12, 0, 10, 0, 7, 5], chords: [[0, 3, 7], [5, 8, 12], [6, 10, 13], [7, 10, 14]], hook: [12, 15, 12, 10, 7, 10], hat: 'closed', swing: 0.04 },
  swing: { bpm: 110, root: 48, scale: [0, 2, 4, 7, 9], bass: [0, 4, 7, 9, 12, 9, 7, 4], chords: [[0, 4, 7, 11], [9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17]], hook: [16, 19, 21, 19, 16, 14], hat: 'ride', swing: 0.22 },
  finale: { bpm: 120, root: 43, scale: [0, 2, 4, 5, 7, 9, 11], bass: [0, 0, 7, 7, 9, 9, 5, 7], chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], hook: [12, 16, 19, 24, 19, 16], hat: 'open', swing: 0, saw: true },
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createAudio() {
  let ac = null;
  let master = null;
  let sfx = null;
  let mus = null;
  let noiseBuf = null;
  let engine = null;
  let squeal = null;
  const seq = { groove: null, mellow: false, step: 0, next: 0, bar: 0 };
  let lastTick = 0;

  function ensure() {
    if (ac) return ac;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      ac = new AC();
    } catch {
      return null;
    }
    master = ac.createGain();
    master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ac.destination);
    sfx = ac.createGain();
    sfx.gain.value = 0.8;
    sfx.connect(master);
    mus = ac.createGain();
    mus.gain.value = 0.32;
    mus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }

  function noise(dur, t0, { freq = 1000, q = 1, type = 'bandpass', gain = 0.3, attack = 0.005, dest = sfx } = {}) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
    return f;
  }

  function tone(freq, dur, t0, { type = 'sine', gain = 0.3, attack = 0.005, slide = 0, dest = sfx } = {}) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  const sounds = {
    click: (t) => tone(1400, 0.05, t, { type: 'square', gain: 0.08 }),
    tick: (t) => noise(0.03, t, { freq: 3800, q: 6, gain: 0.25 }),
    tock: (t) => noise(0.03, t, { freq: 2600, q: 6, gain: 0.2 }),
    throw: (t) => noise(0.22, t, { freq: 900, q: 0.8, gain: 0.18, attack: 0.08 }),
    thud: (t) => {
      tone(110, 0.16, t, { gain: 0.5, slide: 0.5 });
      noise(0.08, t, { freq: 500, q: 1, gain: 0.25 });
    },
    ding: (t) => {
      tone(988, 0.5, t, { type: 'triangle', gain: 0.35 });
      tone(784, 0.7, t + 0.22, { type: 'triangle', gain: 0.35 });
    },
    load: (t) => {
      for (let i = 0; i < 3; i++) tone(150 + i * 40, 0.1, t + i * 0.09, { gain: 0.4, slide: 0.6 });
      [0, 4, 7].forEach((n, i) => tone(mtof(72 + n), 0.18, t + 0.3 + i * 0.08, { type: 'square', gain: 0.07 }));
    },
    crash: (t) => {
      tone(90, 0.3, t, { type: 'triangle', gain: 0.6, slide: 0.4 });
      noise(0.25, t, { freq: 2200, q: 2, gain: 0.25 });
      noise(0.6, t + 0.15, { freq: 6000, type: 'highpass', gain: 0.08, attack: 0.05 });
    },
    soft: (t) => noise(0.25, t, { freq: 700, q: 0.7, gain: 0.25, attack: 0.02 }),
    scrape: (t) => noise(0.12, t, { freq: 3000, q: 1.5, gain: 0.08 }),
    bump: (t) => {
      tone(140, 0.12, t, { gain: 0.35, slide: 0.6 });
    },
    horn: (t) => {
      tone(392, 0.22, t, { type: 'square', gain: 0.06 });
      tone(494, 0.22, t, { type: 'square', gain: 0.05 });
    },
    whoop: (t) => tone(500, 0.18, t, { type: 'sine', gain: 0.18, slide: 2.2 }),
    lap: (t) => tone(600, 0.5, t, { type: 'sine', gain: 0.18, slide: 2.5 }),
    bell: (t) => {
      tone(1320, 0.5, t, { type: 'triangle', gain: 0.2 });
      tone(1320, 0.5, t + 0.18, { type: 'triangle', gain: 0.2 });
    },
    ping: (t) => tone(1760, 0.25, t, { type: 'sine', gain: 0.15 }),
    boop: (t) => {
      tone(330, 0.1, t, { type: 'square', gain: 0.07 });
      tone(262, 0.14, t + 0.11, { type: 'square', gain: 0.07 });
    },
    taken: (t) => tone(520, 0.45, t, { type: 'triangle', gain: 0.25, slide: 0.45 }),
    lastcall: (t) => {
      sounds.bell(t);
      tone(400, 1.2, t + 0.3, { type: 'sawtooth', gain: 0.05, slide: 2.4, attack: 0.3 });
    },
    whistle: (t) => {
      tone(2100, 0.35, t, { type: 'sine', gain: 0.18 });
      tone(2100, 0.5, t + 0.4, { type: 'sine', gain: 0.18 });
    },
    star: (t, i = 0) => {
      tone(90, 0.15, t, { gain: 0.5, slide: 0.5 });
      tone(mtof(76 + i * 4), 0.4, t + 0.03, { type: 'triangle', gain: 0.2 });
    },
    fanfare: (t) => [0, 4, 7, 12, 7, 12].forEach((n, i) => tone(mtof(60 + n), 0.3, t + i * 0.12, { type: 'sawtooth', gain: 0.07 })),
    go: (t) => {
      tone(392, 0.25, t, { type: 'square', gain: 0.07 });
      tone(494, 0.25, t, { type: 'square', gain: 0.07 });
      tone(587, 0.35, t + 0.26, { type: 'square', gain: 0.08 });
    },
    countdown: (t) => tone(660, 0.12, t, { type: 'square', gain: 0.07 }),
  };

  const audio = {
    get ready() {
      return !!ac;
    },
    unlock() {
      if (!ensure()) return;
      if (ac.state === 'suspended') ac.resume().catch(() => {});
    },
    play(name, arg) {
      if (!ac || ac.state !== 'running' || !sounds[name]) return;
      try {
        sounds[name](ac.currentTime + 0.005, arg);
      } catch {
        /* a sound must never break the game */
      }
    },
    /** The engine: speed 0..1, on/off; holding adds the indicator's tick-tock; squeal 0..1. */
    drive(on, speed, holding, squealAmt) {
      if (!ac || ac.state !== 'running') return;
      const t = ac.currentTime;
      if (on && !engine) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        const f = ac.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 400;
        const g = ac.createGain();
        g.gain.value = 0;
        o.connect(f).connect(g).connect(sfx);
        o.start();
        engine = { o, f, g };
        const s = ac.createBufferSource();
        s.buffer = noiseBuf;
        s.loop = true;
        const sf = ac.createBiquadFilter();
        sf.type = 'bandpass';
        sf.frequency.value = 2400;
        sf.Q.value = 3;
        const sg = ac.createGain();
        sg.gain.value = 0;
        s.connect(sf).connect(sg).connect(sfx);
        s.start();
        squeal = { s, g: sg };
      }
      if (!engine) return;
      const target = on ? 0.05 + speed * 0.05 : 0;
      engine.g.gain.setTargetAtTime(target, t, 0.08);
      engine.o.frequency.setTargetAtTime(48 + speed * 70, t, 0.1);
      engine.f.frequency.setTargetAtTime(300 + speed * 700, t, 0.1);
      squeal.g.gain.setTargetAtTime(on ? squealAmt * 0.06 : 0, t, 0.05);
      // The indicator: tick-tock at 2.5 Hz.
      if (on && holding) {
        const now = performance.now();
        if (now - lastTick > 200) {
          lastTick = now;
          audio.play(Math.floor(now / 200) % 2 ? 'tick' : 'tock');
        }
      }
    },
    /** Music: a groove name (or null for silence); mellow for the yard and menus. */
    music(name, mellow = false) {
      const g = name ? GROOVES[name] || GROOVES.sunny : null;
      if (seq.groove === g && seq.mellow === mellow) return;
      seq.groove = g;
      seq.mellow = mellow;
      if (ac && mus) mus.gain.setTargetAtTime(g ? (mellow ? 0.18 : 0.3) : 0, ac.currentTime, 0.3);
      if (ac) seq.next = Math.max(seq.next, ac.currentTime + 0.05);
    },
    duck(on) {
      if (ac && mus) mus.gain.setTargetAtTime(on ? 0.1 : seq.mellow ? 0.18 : 0.3, ac.currentTime, 0.2);
    },
    /** Schedule music a little ahead; call every frame. */
    update() {
      if (!ac || ac.state !== 'running' || !seq.groove) return;
      const g = seq.groove;
      const stepDur = 60 / g.bpm / 4;
      while (seq.next < ac.currentTime + 0.15) {
        playStep(g, seq.step, seq.next + (seq.step % 2 ? g.swing * stepDur : 0), stepDur);
        seq.next += stepDur;
        seq.step = (seq.step + 1) % 64;
      }
    },
  };

  function playStep(g, step, t, sd) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const mellow = seq.mellow;
    const d = mus;
    // Kick and snare.
    if (!mellow && (s16 === 0 || s16 === 8 || (s16 === 10 && bar % 2 === 1))) tone(120, 0.18, t, { gain: 0.9, slide: 0.35, dest: d });
    if (!mellow && (s16 === 4 || s16 === 12)) noise(0.14, t, { freq: 1800, q: 0.8, gain: 0.45, dest: d });
    // Hats.
    if (s16 % 2 === 0 || g.hat === 'open') {
      const open = g.hat === 'open' && s16 % 4 === 2;
      const freq = g.hat === 'bells' ? 5200 : g.hat === 'ride' ? 6200 : 8000;
      if (g.hat === 'bells' && s16 % 4 === 0) tone(2093, 0.12, t, { type: 'triangle', gain: 0.05, dest: d });
      else if (!(g.hat === 'off' && s16 % 4 === 0)) noise(open ? 0.15 : g.hat === 'soft' ? 0.03 : 0.04, t, { freq, type: 'highpass', gain: mellow ? 0.08 : 0.14, dest: d });
    }
    // Bass on the 8ths.
    if (s16 % 2 === 0) {
      const n = g.bass[(s16 / 2) | 0];
      tone(mtof(g.root + n - 12), sd * 1.7, t, { type: g.saw ? 'sawtooth' : 'triangle', gain: mellow ? 0.32 : 0.42, dest: d });
    }
    // Chord stabs on the off-beats.
    if (s16 === 6 || s16 === 14) {
      const ch = g.chords[bar % g.chords.length];
      for (const n of ch) tone(mtof(g.root + 12 + n), sd * 1.2, t, { type: 'square', gain: mellow ? 0.025 : 0.04, dest: d });
    }
    // The hook every other bar.
    if (!mellow && bar % 2 === 1 && s16 % 3 === 0 && s16 < 16) {
      const n = g.hook[(s16 / 3) | 0];
      if (n !== undefined) tone(mtof(g.root + 12 + n), sd * 2.2, t, { type: g.saw ? 'sawtooth' : 'square', gain: 0.035, dest: d });
    }
  }

  return audio;
}
