// Juice: particles, flying parcels, rising numbers, sprayed road paint and camera shake. A fixed pool, no per-frame garbage.

import { PALETTE } from './config.js';
import { bigParcel } from './sprites.js';
import { font } from './draw2d.js';

const MAX = 260;

export function createFx() {
  const parts = [];
  for (let i = 0; i < MAX; i++) parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 4, color: '#fff', kind: 0, rot: 0, vr: 0 });
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
      p.kind = opts.kind ?? 0; // 0 dot, 1 square (confetti/parcels), 2 smoke (grows)
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

  /** Draw the world-space effects (called inside the world transform). */
  fx.drawWorld = (g) => {
    for (const r of fx.rings) {
      const k = r.t / r.dur;
      g.save();
      g.globalAlpha = 1 - k;
      g.strokeStyle = r.color;
      g.lineWidth = 10 * (1 - k) + 2;
      g.beginPath();
      g.arc(r.x, r.y, 30 + k * 90, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    for (const p of parts) {
      if (!p.on) continue;
      const k = p.life / p.max;
      g.globalAlpha = 1 - k * k;
      g.fillStyle = p.color;
      if (p.kind === 2) {
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1 + k * 2), 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === 1) {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8);
        g.restore();
      } else {
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    for (const th of fx.throws) {
      const k = Math.min(1, th.t / th.dur);
      const x = th.x0 + (th.x1 - th.x0) * k;
      const y = th.y0 + (th.y1 - th.y0) * k;
      const lift = Math.sin(k * Math.PI) * 26;
      const s = bigParcel(!!th.gold);
      g.fillStyle = 'rgba(10,14,22,0.25)';
      g.beginPath();
      g.ellipse(x + 4, y + 6, 10, 5, 0, 0, Math.PI * 2);
      g.fill();
      const sc = 0.8 + Math.sin(k * Math.PI) * 0.45;
      g.save();
      g.translate(x, y - lift);
      g.rotate(k * 4);
      g.drawImage(s.c, -12 * sc, -12 * sc, 24 * sc, 24 * sc);
      g.restore();
    }
    for (const tx of fx.texts) {
      const k = tx.t / tx.dur;
      const y = tx.y - 30 - k * 50;
      g.save();
      g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.3);
      g.translate(tx.x, y);
      g.scale(pop, pop);
      g.font = font(900, tx.size);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 7;
      g.strokeStyle = PALETTE.ink;
      g.strokeText(tx.text, 0, 0);
      g.fillStyle = tx.color;
      g.fillText(tx.text, 0, 0);
      g.restore();
    }
  };

  return fx;
}
