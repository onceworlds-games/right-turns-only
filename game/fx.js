// Juice: particles, flying parcels, rising numbers, sprayed road paint and camera shake, as state (the gfx layers draw it).
// A fixed pool, no per-frame garbage.

const MAX = 260;

export function createFx() {
  const parts = [];
  for (let i = 0; i < MAX; i++) parts.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0, max: 1, size: 4, color: '#fff', kind: 0, rot: 0, vr: 0 });
  const fx = {
    parts,
    throws: [], // parcels in the air: { x0, y0, x1, y1, t, dur, gold, mat, done }
    texts: [], // rising numbers in the world: { x, y, text, color, t, dur, size }
    paint: [], // sprayed words: { text, x, y, h, size, t, hold, fade, alpha, wipe }
    rings: [], // ring bursts: { x, y, t, dur, color }
    trauma: 0,
    reduced: false,
    lite: false,
    shake: [0, 0],
  };

  fx.spawn = (x, y, n, opts = {}) => {
    if (fx.reduced) n = Math.ceil(n / 3);
    if (fx.lite) n = Math.ceil(n / 2);
    let made = 0;
    for (const p of parts) {
      if (made >= n) break;
      if (p.on) continue;
      const a = opts.dir !== undefined ? opts.dir + (Math.random() - 0.5) * (opts.spread ?? 1.2) : Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 120) * (0.4 + Math.random() * 0.8);
      p.on = true;
      p.x = x + (Math.random() - 0.5) * (opts.jitter ?? 6);
      p.y = y + (Math.random() - 0.5) * (opts.jitter ?? 6);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.life = 0;
      p.max = (opts.life ?? 0.6) * (0.7 + Math.random() * 0.6);
      p.size = (opts.size ?? 4) * (0.7 + Math.random() * 0.6);
      p.color = Array.isArray(opts.color) ? opts.color[(Math.random() * opts.color.length) | 0] : opts.color || '#fff';
      p.kind = opts.kind ?? 0; // 0 dot (a spark), 1 square (confetti, chips), 2 smoke (grows)
      // Height (px above the ground) and how it falls: sparks drop fast, confetti flutters, smoke rises.
      p.z = opts.z ?? 8;
      p.vz = (opts.up ?? (p.kind === 2 ? 20 : sp * 0.9)) * (0.6 + Math.random() * 0.8);
      p.g = opts.gravity ?? (p.kind === 2 ? -12 : p.kind === 1 ? 300 : 520);
      p.rot = Math.random() * 6;
      p.vr = (Math.random() - 0.5) * 10;
      p.drag = opts.drag ?? 2.5;
      made++;
    }
  };

  fx.add = (kind, o) => {
    if (kind === 'throw') fx.throws.push({ t: 0, dur: 0.42, ...o });
    else if (kind === 'text') fx.texts.push({ t: 0, dur: 1.1, size: 30, color: '#F4F1E8', ...o });
    else if (kind === 'ring') fx.rings.push({ t: 0, dur: 0.5, color: '#FFC22E', ...o });
  };

  /** Spray words onto the road (see drawPaint). They wipe on, hold, then wear off. o: { lines, x, y, h, width, hold } */
  fx.spray = (key, o) => {
    const old = fx.paint.find((p) => p.key === key);
    if (old) {
      Object.assign(old, o);
      old.t = Math.min(old.t, 0.35);
      return old;
    }
    const p = { key, hold: 2.5, ...o, t: 0, alpha: 0, wipe: 0 };
    fx.paint.push(p);
    return p;
  };

  fx.unspray = (key) => {
    const p = fx.paint.find((q) => q.key === key);
    if (p && p.t < 0.35 + p.hold) p.hold = Math.max(0, p.t - 0.35);
  };

  fx.kick = (amount) => {
    fx.trauma = Math.min(1, fx.trauma + amount);
  };

  fx.update = (dt) => {
    for (const p of parts) {
      if (!p.on) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.on = false;
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= p.g * dt;
      if (p.kind === 1) p.vz *= Math.exp(-1.6 * dt); // flutter
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz = -p.vz * 0.3;
        p.vx *= 0.5;
        p.vy *= 0.5;
        p.vr *= 0.5;
      }
      p.rot += p.vr * dt;
    }
    for (const list of [fx.throws, fx.texts, fx.rings]) {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].t += dt;
        if (list[i].t >= list[i].dur) {
          if (list[i].onDone) list[i].onDone();
          list.splice(i, 1);
        }
      }
    }
    for (let i = fx.paint.length - 1; i >= 0; i--) {
      const p = fx.paint[i];
      p.t += dt;
      const fadeAt = 0.35 + p.hold;
      p.wipe = Math.min(1, p.t / 0.35);
      p.alpha = p.t < fadeAt ? 1 : Math.max(0, 1 - (p.t - fadeAt) / 0.8);
      if (p.hold === Infinity) p.alpha = 1;
      if (p.alpha <= 0 && p.t > fadeAt) fx.paint.splice(i, 1);
    }
    fx.trauma = Math.max(0, fx.trauma - dt * 1.4);
    if (fx.reduced) fx.shake[0] = fx.shake[1] = 0;
    else {
      const s = fx.trauma * fx.trauma * 12;
      const t = performance.now() / 1000;
      fx.shake[0] = s * Math.sin(t * 37.1) * Math.cos(t * 13.3);
      fx.shake[1] = s * Math.sin(t * 29.7 + 1.3);
    }
  };

  fx.clear = () => {
    for (const p of parts) p.on = false;
    fx.throws.length = 0;
    fx.texts.length = 0;
    fx.rings.length = 0;
    fx.paint.length = 0;
    fx.trauma = 0;
  };

  return fx;
}
