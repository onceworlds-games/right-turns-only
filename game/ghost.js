// Ghosts: a run recorded at 5 Hz, quantised and delta-coded into a short string for ow.save, and played back smoothly.
// Pure: no page, no platform.

export const GHOST_HZ = 5;
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ESC = '.';
const TURN = 256; // heading steps per turn
const POS = 2; // px per step

/** A recorder: call `add(t, x, y, h)` every frame (it keeps 5 Hz), `drop(t)` at each delivery, then `encode()`. */
export function createRecorder() {
  const xs = [];
  const ys = [];
  const hs = [];
  const drops = [];
  let next = 0;
  return {
    add(t, x, y, h) {
      if (t + 1e-6 < next) return;
      next = (xs.length + 1) / GHOST_HZ;
      xs.push(Math.round(x / POS));
      ys.push(Math.round(y / POS));
      hs.push(((Math.round((h / (Math.PI * 2)) * TURN) % TURN) + TURN) % TURN);
    },
    drop(t) {
      drops.push(Math.round(t * 100));
    },
    get length() {
      return xs.length;
    },
    encode() {
      let out = '';
      let px = 0;
      let py = 0;
      let ph = 0;
      for (let i = 0; i < xs.length; i++) {
        let dh = hs[i] - ph;
        if (dh > TURN / 2) dh -= TURN;
        if (dh < -TURN / 2) dh += TURN;
        out += num(xs[i] - px) + num(ys[i] - py) + num(dh);
        px = xs[i];
        py = ys[i];
        ph = hs[i];
      }
      return { v: 1, s: out, d: drops };
    },
  };
}

function num(n) {
  if (n >= -31 && n <= 32) return A[n + 31];
  // Escaped: three characters, 18 bits, offset.
  const u = Math.max(0, Math.min(262143, n + 131072));
  return ESC + A[(u >> 12) & 63] + A[(u >> 6) & 63] + A[u & 63];
}

/** Decode a saved ghost into { t: [], x: [], y: [], h: [], drops: [s] }, or null when it isn't one. */
export function decodeGhost(g) {
  if (!g || g.v !== 1 || typeof g.s !== 'string' || g.s.length > 60000) return null;
  const x = [];
  const y = [];
  const h = [];
  const vals = [];
  const s = g.s;
  for (let i = 0; i < s.length; ) {
    if (s[i] === ESC) {
      const a = A.indexOf(s[i + 1]);
      const b = A.indexOf(s[i + 2]);
      const c = A.indexOf(s[i + 3]);
      if (a < 0 || b < 0 || c < 0) return null;
      vals.push(((a << 12) | (b << 6) | c) - 131072);
      i += 4;
    } else {
      const a = A.indexOf(s[i]);
      if (a < 0) return null;
      vals.push(a - 31);
      i++;
    }
  }
  let px = 0;
  let py = 0;
  let ph = 0;
  for (let i = 0; i + 2 < vals.length; i += 3) {
    px += vals[i];
    py += vals[i + 1];
    ph += vals[i + 2];
    x.push(px * POS);
    y.push(py * POS);
    h.push((ph / TURN) * Math.PI * 2);
  }
  const drops = Array.isArray(g.d) ? g.d.filter((n) => Number.isFinite(n)).map((n) => n / 100) : [];
  return { x, y, h, drops, duration: x.length / GHOST_HZ };
}

/** Where the ghost is at time t (seconds since GO): { x, y, h } or null past its end. */
export function ghostAt(g, t, out = {}) {
  if (!g || !g.x.length) return null;
  const f = t * GHOST_HZ;
  const i = Math.floor(f);
  if (i >= g.x.length - 1) return null;
  if (i < 0) {
    out.x = g.x[0];
    out.y = g.y[0];
    out.h = g.h[0];
    return out;
  }
  const k = f - i;
  out.x = g.x[i] + (g.x[i + 1] - g.x[i]) * k;
  out.y = g.y[i] + (g.y[i + 1] - g.y[i]) * k;
  out.h = g.h[i] + (g.h[i + 1] - g.h[i]) * k;
  return out;
}
