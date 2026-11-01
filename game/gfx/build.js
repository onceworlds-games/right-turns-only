// A geometry builder: boxes, quads, prisms and cylinders emitted into one flat-shaded buffer with vertex colours, a
// surface pattern id and pattern coordinates in metres. Thousands of pieces become one draw call.

import * as THREE from 'three';

/** Surface patterns (drawn by the shader in material.js). */
export const SURF = {
  plain: 0,
  asphalt: 1,
  grass: 2,
  tiles: 3,
  brick: 4,
  planks: 5,
  paving: 6,
  glass: 7,
  metal: 8,
  lamp: 9, // always lit (lamps, signs)
  soil: 10,
  shingle: 11,
  snow: 12,
  stucco: 13,
  litWindow: 14, // a window that glows at night (and reflects by day)
  facade: 15, // a wall with a grid of windows drawn on it (far buildings)
  puddle: 16,
};

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const colorCache = new Map();

/** A hex colour (sRGB) as linear [r, g, b], cached. */
export function lin(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    const col = new THREE.Color(hex);
    c = [col.r, col.g, col.b];
    colorCache.set(hex, c);
  }
  return c;
}

/** Mix two hex colours (sRGB space) by k, or lighten/darken one: shade('#808080', 0.2). */
export function shade(hex, k) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + k * (k > 0 ? 1 - hsl.l : hsl.l))));
  return `#${c.getHexString()}`;
}
export function mix(a, b, k) {
  const ca = new THREE.Color(a);
  ca.lerp(new THREE.Color(b), k);
  return `#${ca.getHexString()}`;
}

export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.puv = [];
    this.surf = [];
    this.seed = [];
    this.m = new THREE.Matrix4();
    this.nm = new THREE.Matrix3();
    this.stack = [];
    this.curSeed = 0;
  }

  get count() {
    return this.pos.length / 3;
  }

  /** Push a transform (translate x, y, z, then rotate ry about Y, then scale). */
  push(x = 0, y = 0, z = 0, ry = 0, s = 1) {
    this.stack.push(this.m.clone());
    const t = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
    this.m.multiply(t);
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  /** Push an arbitrary matrix. */
  pushMatrix(mat) {
    this.stack.push(this.m.clone());
    this.m.multiply(mat);
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  pop() {
    this.m = this.stack.pop() || new THREE.Matrix4();
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  setSeed(s) {
    this.curSeed = s;
    return this;
  }

  /** A triangle (local points), with pattern coords per corner. */
  tri(a, b, c, color, surf = 0, ua = [0, 0], ub = [1, 0], uc = [0, 1], shadeK = 1) {
    tmpA.set(a[0], a[1], a[2]).applyMatrix4(this.m);
    tmpB.set(b[0], b[1], b[2]).applyMatrix4(this.m);
    tmpC.set(c[0], c[1], c[2]).applyMatrix4(this.m);
    e1.subVectors(tmpB, tmpA);
    e2.subVectors(tmpC, tmpA);
    tmpN.crossVectors(e1, e2).normalize();
    const col = typeof color === 'string' ? lin(color) : color;
    const r = col[0] * shadeK;
    const g = col[1] * shadeK;
    const bl = col[2] * shadeK;
    for (const [p, u] of [
      [tmpA, ua],
      [tmpB, ub],
      [tmpC, uc],
    ]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      this.col.push(r, g, bl);
      this.puv.push(u[0], u[1]);
      this.surf.push(surf);
      this.seed.push(this.curSeed);
    }
  }

  /** A quad a-b-c-d (counter-clockwise seen from the front). Pattern u runs a→b, v runs a→d, in metres. */
  quad(a, b, c, d, color, surf = 0, opts = {}) {
    const lu = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const lv = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    const u0 = opts.u0 || 0;
    const v0 = opts.v0 || 0;
    const ua = [u0, v0];
    const ub = [u0 + lu, v0];
    const uc = [u0 + lu, v0 + lv];
    const ud = [u0, v0 + lv];
    const k = opts.shade || 1;
    // Optional darker bottom edge (contact shading): colours per corner.
    if (opts.bottomDark) {
      const col = typeof color === 'string' ? lin(color) : color;
      const dk = 1 - opts.bottomDark;
      const cb = [col[0] * dk, col[1] * dk, col[2] * dk];
      this.triCols(a, b, c, [cb, cb, col], surf, ua, ub, uc, k);
      this.triCols(a, c, d, [cb, col, col], surf, ua, uc, ud, k);
      return;
    }
    this.tri(a, b, c, color, surf, ua, ub, uc, k);
    this.tri(a, c, d, color, surf, ua, uc, ud, k);
  }

  /** A triangle with a colour per corner. */
  triCols(a, b, c, cols, surf, ua, ub, uc, k = 1) {
    tmpA.set(a[0], a[1], a[2]).applyMatrix4(this.m);
    tmpB.set(b[0], b[1], b[2]).applyMatrix4(this.m);
    tmpC.set(c[0], c[1], c[2]).applyMatrix4(this.m);
    e1.subVectors(tmpB, tmpA);
    e2.subVectors(tmpC, tmpA);
    tmpN.crossVectors(e1, e2).normalize();
    const pts = [tmpA, tmpB, tmpC];
    const uvs = [ua, ub, uc];
    for (let i = 0; i < 3; i++) {
      const p = pts[i];
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      this.col.push(cols[i][0] * k, cols[i][1] * k, cols[i][2] * k);
      this.puv.push(uvs[i][0], uvs[i][1]);
      this.surf.push(surf);
      this.seed.push(this.curSeed);
    }
  }

  /**
   * An axis-aligned box centred at (x, z) with its base at y. opts: { top, sides, surf, topSurf, bottom: false,
   * bottomDark, faces: { n, s, e, w } colour overrides, skip: Set of 'top'|'n'|'s'|'e'|'w'|'bottom' }.
   */
  box(x, y, z, sx, sy, sz, color, opts = {}) {
    const x0 = x - sx / 2;
    const x1 = x + sx / 2;
    const z0 = z - sz / 2;
    const z1 = z + sz / 2;
    const y0 = y;
    const y1 = y + sy;
    const surf = opts.surf ?? 0;
    const topSurf = opts.topSurf ?? surf;
    const top = opts.top || color;
    const skip = opts.skip || null;
    const f = opts.faces || {};
    const bd = opts.bottomDark || 0;
    const sideOpts = bd ? { bottomDark: bd } : {};
    if (!skip || !skip.has('top')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, topSurf);
    // South (+z), north (-z), east (+x), west (-x). Pattern v runs up the wall.
    if (!skip || !skip.has('s')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], f.s || color, surf, sideOpts);
    if (!skip || !skip.has('n')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], f.n || color, surf, sideOpts);
    if (!skip || !skip.has('e')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], f.e || color, surf, sideOpts);
    if (!skip || !skip.has('w')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], f.w || color, surf, sideOpts);
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, surf);
  }

  /**
   * A gable roof over a w (x) × d (z) footprint at height y, ridge along x, rising h, with eaves overhang `o`.
   * Gable ends filled with `wall`. Roof slopes use the tiles pattern (v runs down the slope).
   */
  gable(x, y, z, w, d, h, roof, wall, o = 0.35, opts = {}) {
    const x0 = x - w / 2 - o;
    const x1 = x + w / 2 + o;
    const z0 = z - d / 2 - o;
    const z1 = z + d / 2 + o;
    const ridgeY = y + h;
    const eaveY = y - o * (h / (d / 2));
    const surf = opts.surf ?? SURF.tiles;
    const thick = 0.12;
    // Slopes (front +z, back -z): v runs from the ridge down.
    this.quad([x1, ridgeY, z], [x0, ridgeY, z], [x0, eaveY, z1], [x1, eaveY, z1], roof, surf, { shade: 1 });
    this.quad([x0, ridgeY, z], [x1, ridgeY, z], [x1, eaveY, z0], [x0, eaveY, z0], roof, surf, { shade: 1 });
    // Fascia (the roof's thickness at the eaves).
    const fas = opts.fascia || shade(typeof roof === 'string' ? roof : '#888888', -0.35);
    this.quad([x0, eaveY - thick, z1], [x1, eaveY - thick, z1], [x1, eaveY, z1], [x0, eaveY, z1], fas, 0);
    this.quad([x1, eaveY - thick, z0], [x0, eaveY - thick, z0], [x0, eaveY, z0], [x1, eaveY, z0], fas, 0);
    // Barge boards along the gable edges.
    for (const xe of [x0, x1]) {
      const s = xe === x0 ? -1 : 1;
      const a = [xe, eaveY, z1];
      const b = [xe, ridgeY, z];
      const c = [xe, eaveY, z0];
      if (s > 0) {
        this.quad([xe, eaveY - thick, z1], [xe, ridgeY - thick, z], [xe, ridgeY, z], [xe, eaveY, z1], fas, 0);
        this.quad([xe, ridgeY - thick, z], [xe, eaveY - thick, z0], [xe, eaveY, z0], [xe, ridgeY, z], fas, 0);
      } else {
        this.quad([xe, ridgeY - thick, z], [xe, eaveY - thick, z1], [xe, eaveY, z1], [xe, ridgeY, z], fas, 0);
        this.quad([xe, eaveY - thick, z0], [xe, ridgeY - thick, z], [xe, ridgeY, z], [xe, eaveY, z0], fas, 0);
      }
      void a;
      void b;
      void c;
    }
    // Gable end walls (inside the eaves).
    const gx0 = x - w / 2;
    const gx1 = x + w / 2;
    const gz0 = z - d / 2;
    const gz1 = z + d / 2;
    this.tri([gx1, y, gz1], [gx1, y, gz0], [gx1, ridgeY - 0.05, z], wall, opts.wallSurf ?? 0, [0, 0], [d, 0], [d / 2, h]);
    this.tri([gx0, y, gz0], [gx0, y, gz1], [gx0, ridgeY - 0.05, z], wall, opts.wallSurf ?? 0, [0, 0], [d, 0], [d / 2, h]);
    // Ridge cap.
    if (opts.ridge !== false) this.box(x, ridgeY - 0.06, z, w + o * 2 + 0.05, 0.14, 0.22, fas);
  }

  /** A hip roof: four slopes up to a short ridge along x. */
  hip(x, y, z, w, d, h, roof, o = 0.35, opts = {}) {
    const x0 = x - w / 2 - o;
    const x1 = x + w / 2 + o;
    const z0 = z - d / 2 - o;
    const z1 = z + d / 2 + o;
    const ry = y + h;
    const half = (d + 2 * o) / 2;
    const rx0 = Math.min(x, x0 + half);
    const rx1 = Math.max(x, x1 - half);
    const ey = y - o * (h / (d / 2));
    const surf = opts.surf ?? SURF.tiles;
    this.quad([rx1, ry, z], [rx0, ry, z], [x0, ey, z1], [x1, ey, z1], roof, surf);
    this.quad([rx0, ry, z], [rx1, ry, z], [x1, ey, z0], [x0, ey, z0], roof, surf);
    this.tri([x1, ey, z1], [x1, ey, z0], [rx1, ry, z], roof, surf, [0, 0], [d, 0], [d / 2, h]);
    this.tri([x0, ey, z0], [x0, ey, z1], [rx0, ry, z], roof, surf, [0, 0], [d, 0], [d / 2, h]);
    const fas = opts.fascia || shade(typeof roof === 'string' ? roof : '#888888', -0.35);
    this.box(x, ey - 0.12, z1 - 0.02, w + 2 * o, 0.12, 0.04, fas);
    this.box(x, ey - 0.12, z0 + 0.02, w + 2 * o, 0.12, 0.04, fas);
    this.box(x1 - 0.02, ey - 0.12, z, 0.04, 0.12, d + 2 * o, fas);
    this.box(x0 + 0.02, ey - 0.12, z, 0.04, 0.12, d + 2 * o, fas);
    if (rx1 > rx0 + 0.05) this.box(x, ry - 0.06, z, rx1 - rx0 + 0.1, 0.12, 0.18, fas);
  }

  /** A flat slab roof with a parapet. */
  parapet(x, y, z, w, d, wall, roofCol, rim = 0.35, height = 0.5) {
    this.box(x, y, z, w, 0.06, d, roofCol, { skip: new Set(['n', 's', 'e', 'w']), topSurf: SURF.paving });
    this.box(x, y, z - d / 2 + rim / 2, w, height, rim, wall);
    this.box(x, y, z + d / 2 - rim / 2, w, height, rim, wall);
    this.box(x - w / 2 + rim / 2, y, z, rim, height, d - rim * 2, wall);
    this.box(x + w / 2 - rim / 2, y, z, rim, height, d - rim * 2, wall);
  }

  /** A vertical cylinder (n sides) with its base at y. */
  cyl(x, y, z, r, h, color, n = 8, opts = {}) {
    const surf = opts.surf ?? 0;
    const r1 = opts.r1 ?? r; // top radius
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r];
      const p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
      const q0 = [x + Math.cos(a0) * r1, y + h, z + Math.sin(a0) * r1];
      const q1 = [x + Math.cos(a1) * r1, y + h, z + Math.sin(a1) * r1];
      const arc = ((Math.PI * 2 * r) / n) * i;
      this.quad(p1, p0, q0, q1, color, surf, { u0: arc, bottomDark: opts.bottomDark });
      if (opts.cap !== false && r1 > 0.001) this.tri([x, y + h, z], q1, q0, opts.top || color, opts.topSurf ?? surf);
    }
  }

  /** A low-poly blob (an icosahedron squashed by sy), for bushes and tree crowns. */
  blob(x, y, z, r, color, sy = 1, detail = 0, jitter = 0.18, seed = 1, colorTop = null) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const p = g.attributes.position;
    // Deterministic jitter per vertex position.
    const key = new Map();
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i);
      const vy = p.getY(i);
      const vz = p.getZ(i);
      const k = `${vx.toFixed(3)},${vy.toFixed(3)},${vz.toFixed(3)}`;
      let j = key.get(k);
      if (j === undefined) {
        const h = Math.sin((vx * 12.9898 + vy * 78.233 + vz * 37.719 + seed) * 43758.5453);
        j = 1 + (h - Math.floor(h) - 0.5) * 2 * jitter;
        key.set(k, j);
      }
      p.setXYZ(i, vx * j, vy * j * sy, vz * j);
    }
    const idx = g.index ? g.index.array : null;
    const get = (i) => [p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z];
    const n = idx ? idx.length : p.count;
    const ct = colorTop ? lin(colorTop) : null;
    const cb = lin(color);
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx[i] : i;
      const ib = idx ? idx[i + 1] : i + 1;
      const ic = idx ? idx[i + 2] : i + 2;
      const a = get(ia);
      const b = get(ib);
      const c = get(ic);
      if (ct) {
        const up = (a[1] + b[1] + c[1]) / 3 - y;
        const k = Math.max(0, Math.min(1, 0.5 + up / (r * sy * 1.6)));
        const col = [cb[0] + (ct[0] - cb[0]) * k, cb[1] + (ct[1] - cb[1]) * k, cb[2] + (ct[2] - cb[2]) * k];
        this.tri(a, b, c, col, SURF.plain);
      } else this.tri(a, b, c, color, SURF.plain);
    }
    g.dispose();
  }

  /** A flat disc on the ground (y), n segments; for loop zones, puddles, rugs. */
  disc(x, y, z, r, color, n = 24, surf = 0, r0 = 0) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      if (r0 > 0) {
        this.quad([x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0], [x + Math.cos(a1) * r0, y, z + Math.sin(a1) * r0], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], color, surf, { u0: x, v0: z });
      } else
        this.tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], color, surf, [x, z], [x + Math.cos(a1) * r, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, z + Math.sin(a0) * r]);
    }
  }

  /** A flat rectangle on the ground at height y (x0..x1, z0..z1), pattern coords in world metres. */
  ground(x0, z0, x1, z1, y, color, surf = 0) {
    this.tri([x0, y, z0], [x0, y, z1], [x1, y, z1], color, surf, [x0, z0], [x0, z1], [x1, z1]);
    this.tri([x0, y, z0], [x1, y, z1], [x1, y, z0], color, surf, [x0, z0], [x1, z1], [x1, z0]);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('puv', new THREE.Float32BufferAttribute(this.puv, 2));
    g.setAttribute('surf', new THREE.Float32BufferAttribute(this.surf, 1));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(this.seed, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
