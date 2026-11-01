// The town in 3D, built once from its map: roads with their paint, kerbs and pavements, lots with houses and gardens,
// downtown blocks, parks, water with quays and bridges, the edge of town and the depot. Static geometry is merged per
// 4 × 4-tile chunk (one draw for the town, one for its leaves); things that move (traffic lights, doors, drawbridges,
// lamps at night) are listed for the renderer.
//
// World px map to metres: X = x × 0.1, Z = y × 0.1, Y up. A tile is 12 m.

import * as THREE from 'three';
import { T, DX, DY, DRIVE } from '../config.js';
import { isRoadChar } from '../city.js';
import { createRng, hashString } from '../rng.js';
import { Builder, SURF, shade, mix } from './build.js';
import { S } from './style.js';
import { house, building, garden, tree, bush, fenceRun, hedgeRun, bins, flowers } from './houses.js';
import { SignBuilder, SHOPS } from './signs.js';

export const TS = T * S; // 12 m
export const KERB = 0.2;
export const LAWN = 0.25;
export const WATER_Y = -1.2;
export const PAVE = 1.5;
const CHUNK = 4;
const PAINT = '#ECE8DC';
const PAINT_Y = 0.014;

const ryFor = (face) => [Math.PI, Math.PI / 2, 0, -Math.PI / 2][face];

/** Rotate a local point (lot frame) into the world. */
function toWorld(cx, cy, cz, ry, l) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return [cx + l[0] * c + l[2] * s, cy + l[1], cz - l[0] * s + l[2] * c];
}

// ------------------------------------------------------------------ polygons on the ground

/** A rectangle minus a disc, as a polygon ([x, z] points), or null when the disc covers it. */
export function minusDisc(x0, z0, x1, z1, cx, cz, r) {
  const nx = Math.max(x0, Math.min(cx, x1));
  const nz = Math.max(z0, Math.min(cz, z1));
  const rect = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  if ((nx - cx) ** 2 + (nz - cz) ** 2 >= r * r) return rect;
  const inside = (p) => (p[0] - cx) ** 2 + (p[1] - cz) ** 2 < r * r;
  const N = 24;
  const pts = [];
  for (let e = 0; e < 4; e++) {
    const a = rect[e];
    const b = rect[(e + 1) % 4];
    for (let i = 0; i < N; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / N, a[1] + ((b[1] - a[1]) * i) / N]);
  }
  const M = pts.length;
  let s = -1;
  for (let i = 0; i < M; i++) {
    if (!inside(pts[i])) {
      s = i;
      break;
    }
  }
  if (s < 0) return null;
  const cross = (o, i) => {
    let a = o;
    let b = i;
    for (let k = 0; k < 22; k++) {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (inside(m)) b = m;
      else a = m;
    }
    return a;
  };
  const out = [pts[s]];
  let prevIn = false;
  let entry = null;
  for (let j = 1; j <= M; j++) {
    const p = pts[(s + j) % M];
    const q = pts[(s + j - 1) % M];
    const pin = inside(p);
    if (pin && !prevIn) {
      entry = cross(q, p);
      out.push(entry);
    } else if (!pin && prevIn) {
      const exit = cross(p, q);
      const a0 = Math.atan2(entry[1] - cz, entry[0] - cx);
      const a1 = Math.atan2(exit[1] - cz, exit[0] - cx);
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const steps = Math.max(2, Math.ceil(Math.abs(d) / (Math.PI / 40)));
      for (let k = 1; k < steps; k++) {
        const a = a0 + (d * k) / steps;
        out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
      out.push(exit);
    }
    if (!pin && j < M) out.push(p);
    prevIn = pin;
  }
  return out;
}

/** Fill a polygon on the ground at height y, facing up. */
export function fillPoly(b, poly, y, color, surf) {
  if (poly.length === 4 && poly[0][1] === poly[1][1] && poly[1][0] === poly[2][0] && poly[2][1] === poly[3][1]) {
    b.ground(Math.min(poly[0][0], poly[1][0]), Math.min(poly[0][1], poly[2][1]), Math.max(poly[0][0], poly[1][0]), Math.max(poly[0][1], poly[2][1]), y, color, surf);
    return;
  }
  const tris = THREE.ShapeUtils.triangulateShape(
    poly.map(([x, z]) => new THREE.Vector2(x, z)),
    [],
  );
  for (const [i, j, k] of tris) {
    const A = poly[i];
    let B = poly[j];
    let C = poly[k];
    const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
    if (ny < 0) [B, C] = [C, B];
    b.tri([A[0], y, A[1]], [B[0], y, B[1]], [C[0], y, C[1]], color, surf, [A[0], A[1]], [B[0], B[1]], [C[0], C[1]]);
  }
}

/** A vertical face along p→q from yBot to yTop, facing n. */
function wallSeg(b, p, q, yTop, yBot, n, color, surf = 0) {
  let a = p;
  let c = q;
  if (-(c[1] - a[1]) * n[0] + (c[0] - a[0]) * n[1] < 0) [a, c] = [q, p];
  b.quad([a[0], yBot, a[1]], [c[0], yBot, c[1]], [c[0], yTop, c[1]], [a[0], yTop, a[1]], color, surf);
}

/** Faces down from a polygon's edges wherever the ground outside is lower (lowerAt returns that height, or null). */
function polyWalls(b, poly, yTop, lowerAt, color, surf = 0) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const sg = area > 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const n = [(sg * dz) / len, (-sg * dx) / len];
    const lo = lowerAt((p[0] + q[0]) / 2 + n[0] * 0.12, (p[1] + q[1]) / 2 + n[1] * 0.12);
    if (lo === null || lo >= yTop - 0.005) continue;
    wallSeg(b, p, q, yTop, lo, n, color, surf);
  }
}

/** A flat quad on the ground from four [x, z] corners (any winding), at height y. */
function flat(b, pts, y, color, surf = 0) {
  fillPoly(b, pts, y, color, surf);
}

/** A flat bar on the ground centred at (x, z) along angle a: len × wid. */
function bar(b, x, z, a, len, wid, y, color, surf = 0) {
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  const px = -uz;
  const pz = ux;
  const l = len / 2;
  const w = wid / 2;
  const pts = [
    [x - ux * l - px * w, z - uz * l - pz * w],
    [x + ux * l - px * w, z + uz * l - pz * w],
    [x + ux * l + px * w, z + uz * l + pz * w],
    [x - ux * l + px * w, z - uz * l + pz * w],
  ];
  const tris = [
    [0, 1, 2],
    [0, 2, 3],
  ];
  for (const [i, j, k] of tris) {
    const A = pts[i];
    let B = pts[j];
    let C = pts[k];
    const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
    if (ny < 0) [B, C] = [C, B];
    b.tri([A[0], y, A[1]], [B[0], y, B[1]], [C[0], y, C[1]], color, surf, [A[0], A[1]], [B[0], B[1]], [C[0], C[1]]);
  }
}

/** A flat arc band (radius r, width w) from a0 to a1 on the ground. */
function arcBand(b, x, z, r, w, a0, a1, y, color, n = 16) {
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const p = [
      [x + Math.cos(t0) * (r - w / 2), z + Math.sin(t0) * (r - w / 2)],
      [x + Math.cos(t1) * (r - w / 2), z + Math.sin(t1) * (r - w / 2)],
      [x + Math.cos(t1) * (r + w / 2), z + Math.sin(t1) * (r + w / 2)],
      [x + Math.cos(t0) * (r + w / 2), z + Math.sin(t0) * (r + w / 2)],
    ];
    flat(b, p, y, color);
  }
}

function tri2(b, A, B, C, y, color) {
  const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
  if (ny < 0) [B, C] = [C, B];
  b.tri([A[0], y, A[1]], [B[0], y, B[1]], [C[0], y, C[1]], color, 0);
}

// ------------------------------------------------------------------ the town

/**
 * Build a town. Returns { chunks: [{ main, leaves, x0, z0, x1, z1 }] (Builders), signs (SignBuilder), doors, lamps,
 * porch, smoke, fountains, parked, heads, beacons, bridges, water, bounds }.
 */
export function buildTown(city, style) {
  const town = city.town;
  const p = town.palette;
  const W = city.w;
  const H = city.h;
  let waterEdge = 0;
  for (let x = 0; x < W; x++) waterEdge += (city.at(x, 0) === 'w') + (city.at(x, H - 1) === 'w');
  const outside = waterEdge > W ? 'w' : 'x';
  const edgeKind = town.night || town.id === 4 || town.id === 11 ? 'city' : town.snow ? 'snow' : town.dust ? 'desert' : 'hedge';
  const OUT = { n: 4, s: 2, e: 3, w: 3 };
  const charAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H ? outside : city.at(tx, ty));
  const inMap = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H;
  const isRoad = (tx, ty) => isRoadChar(charAt(tx, ty));
  const roadish = (tx, ty) => isRoad(tx, ty) || charAt(tx, ty) === 'a';
  const zones = city.loops.map((z) => ({ src: z, x: z.x * S, z: z.y * S, r: z.r * S, kind: z.kind, tx: z.tx, ty: z.ty }));
  const level = (x, z) => {
    for (const zn of zones) if ((x - zn.x) ** 2 + (z - zn.z) ** 2 < zn.r * zn.r) return 0;
    const tx = Math.floor(x / TS);
    const ty = Math.floor(z / TS);
    const ch = charAt(tx, ty);
    if (ch === 'w') return WATER_Y;
    if (isRoadChar(ch)) return 0;
    if (ch === 'p' || ch === 't') return 0.03;
    if (ch === 'a') {
      const o = city.alleys.get(city.idx(tx, ty));
      const lx = x - (tx + 0.5) * TS;
      const lz = z - (ty + 0.5) * TS;
      return (o === 'h' ? Math.abs(lz) : Math.abs(lx)) < 3 ? 0 : KERB;
    }
    return KERB;
  };

  const out = {
    chunks: new Map(),
    signs: new SignBuilder(),
    doors: [],
    lamps: [],
    porch: [],
    smoke: [],
    fountains: [],
    parked: [],
    heads: [],
    beacons: [],
    bridges: [],
    houseAt: new Map(), // house id → { door: [x, z], mat: [x, z], ry, kind }
    water: { x0: -OUT.w * TS - 200, z0: -OUT.n * TS - 200, x1: (W + OUT.e) * TS + 200, z1: (H + OUT.s) * TS + 200 },
    bounds: { x0: 0, z0: 0, x1: W * TS, z1: H * TS },
    outside,
    edgeKind,
  };
  const chunk = (tx, ty) => {
    const key = `${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`;
    let c = out.chunks.get(key);
    if (!c) {
      const cx = Math.floor(tx / CHUNK);
      const cy = Math.floor(ty / CHUNK);
      c = { main: new Builder(), leaves: new Builder(), x0: cx * CHUNK * TS, z0: cy * CHUNK * TS, x1: (cx + 1) * CHUNK * TS, z1: (cy + 1) * CHUNK * TS };
      out.chunks.set(key, c);
    }
    return c;
  };
  const houseByTile = new Map(city.houses.map((h) => [city.idx(h.tx, h.ty), h]));
  const asphalt = p.asphalt;
  const kerbC = shade(p.pave, -0.22);
  const quay = town.id === 12 ? '#9C8F7E' : '#8E8A84';
  const lawn = p.lawn;
  const night = !!town.night;
  const downtown = edgeKind === 'city';

  // ---------------------------------------------------------------- roads

  function roadTile(tx, ty, ch, b, rng) {
    const X0 = tx * TS;
    const Z0 = ty * TS;
    const cx = X0 + TS / 2;
    const cz = Z0 + TS / 2;
    if (ch !== 'd') b.ground(X0, Z0, X0 + TS, Z0 + TS, 0, asphalt, SURF.asphalt);
    for (let d = 0; d < 4; d++) {
      const ex = cx + DX[d] * TS * 0.5;
      const ez = cz + DY[d] * TS * 0.5;
      const lv = level(ex + DX[d] * 0.1, ez + DY[d] * 0.1);
      const half = [-DY[d] * TS * 0.5, DX[d] * TS * 0.5];
      const pa = [ex - half[0], ez - half[1]];
      const pb = [ex + half[0], ez + half[1]];
      if (lv < -0.01 && ch !== 'd') {
        wallSeg(b, pa, pb, 0, ch === '=' ? -0.75 : lv, [DX[d], DY[d]], ch === '=' ? shade(quay, 0.1) : quay, SURF.paving);
        if (ch === '=') wallSeg(b, pa, pb, 0.05, -0.02, [DX[d], DY[d]], '#C9A13A');
      }
      if (lv > 0.1) {
        // The gutter along the kerb.
        const w = 0.35;
        const ix = DX[d] * (TS / 2 - w / 2);
        const iz = DY[d] * (TS / 2 - w / 2);
        bar(b, cx + ix, cz + iz, d % 2 ? Math.PI / 2 : 0, TS, w, 0.005, shade(asphalt, -0.3), SURF.asphalt);
      }
    }
    if (ch === '=' || ch === 'd') bridgeBits(tx, ty, ch, b);
    markings(tx, ty, ch, b, rng);
    // Now and then a manhole cover.
    if (ch !== 'O' && ch !== 'c' && ch !== 'D' && ch !== 'z' && ch !== 'd' && rng.chance(0.35)) {
      const a = rng.int(4);
      const off = rng.float(-3.5, 3.5);
      const side = rng.chance(0.5) ? 2.9 : -2.9;
      const mx = cx + (a % 2 ? side : off);
      const mz = cz + (a % 2 ? off : side);
      b.disc(mx, 0.008, mz, 0.42, shade(asphalt, -0.35), 10);
      b.disc(mx, 0.01, mz, 0.3, shade(asphalt, -0.2), 10);
    }
    if (ch === 'L' || ch === 'R') lightPoles(tx, ty, b);
    if (ch === 'z') zebraBeacons(tx, ty, b);
    if (isStraight(tx, ty) && ch !== '=' && ch !== 'd' && (tx * 7 + ty * 3) % 2 === 0) streetLamp(tx, ty, b, rng);
  }

  function isStraight(tx, ty) {
    const n = [0, 1, 2, 3].map((d) => roadish(tx + DX[d], ty + DY[d]));
    const count = n.filter(Boolean).length;
    return count === 2 && ((n[0] && n[2]) || (n[1] && n[3]));
  }

  function oneWayOf(tx, ty, axis) {
    const ow = town.oneWay;
    if (!ow) return undefined;
    return axis === 'h' ? ow.rows && ow.rows[ty] : ow.cols && ow.cols[tx];
  }

  function markings(tx, ty, ch, b, rng) {
    const X0 = tx * TS;
    const Z0 = ty * TS;
    const cx = X0 + TS / 2;
    const cz = Z0 + TS / 2;
    const n = [0, 1, 2, 3].map((d) => roadish(tx + DX[d], ty + DY[d]));
    const count = n.filter(Boolean).length;
    if (ch === 'O' || ch === 'c') return;
    if (ch === 'D') return loadingBay(tx, ty, b);
    if (ch === 'z') {
      const zb = city.zebras.find((q) => q.tx === tx && q.ty === ty);
      for (let i = 0; i < 7; i++) {
        if (zb && zb.across === 'v') b.ground(X0 + 0.6 + i * 1.6, Z0 + 1.8, X0 + 1.6 + i * 1.6, Z0 + TS - 1.8, PAINT_Y, PAINT);
        else b.ground(X0 + 1.8, Z0 + 0.6 + i * 1.6, X0 + TS - 1.8, Z0 + 1.6 + i * 1.6, PAINT_Y, PAINT);
      }
      // Zig-zags aside: the give-way lines either side.
      return;
    }
    if (ch === 'r' || ch === 'R') rails(tx, ty, b);
    const straightV = count === 2 && n[0] && n[2];
    const straightH = count === 2 && n[1] && n[3];
    if (straightV || straightH) {
      const ow = oneWayOf(tx, ty, straightH ? 'h' : 'v');
      if (ow !== undefined) {
        if ((tx + ty) % 2 === 0) paintArrow(b, cx, cz, [-Math.PI / 2, 0, Math.PI / 2, Math.PI][ow]);
        return;
      }
      if (ch === 'r' || ch === 'd' || ch === '=') {
        if (ch === '=') for (let i = 0; i < 3; i++) bar(b, straightV ? cx : X0 + 1.9 + i * 4, straightV ? Z0 + 1.9 + i * 4 : cz, straightV ? Math.PI / 2 : 0, 2.2, 0.3, PAINT_Y, PAINT);
        return;
      }
      for (let i = 0; i < 3; i++) bar(b, straightV ? cx : X0 + 1.9 + i * 4, straightV ? Z0 + 1.9 + i * 4 : cz, straightV ? Math.PI / 2 : 0, 2.2, 0.3, PAINT_Y, PAINT);
      return;
    }
    if (count >= 3) {
      // A junction: give-way dashes (or a stop line at lights) across the lane coming in on each arm. Traffic keeps left.
      const lit = ch === 'L' || ch === 'R';
      for (let d = 0; d < 4; d++) {
        if (!n[d]) continue;
        const m = (d + 2) % 4;
        const lx = DY[m];
        const lz = -DX[m];
        const ex = cx + DX[d] * (TS / 2 - 0.4);
        const ez = cz + DY[d] * (TS / 2 - 0.4);
        const along = d % 2 ? Math.PI / 2 : 0; // the line runs across the arm
        if (lit) {
          const a = 0.4;
          const bb = 5.6;
          bar(b, ex + lx * ((a + bb) / 2), ez + lz * ((a + bb) / 2), along, bb - a, 0.45, PAINT_Y, PAINT);
        } else {
          for (let k = 0; k < 4; k++) {
            const o = 0.6 + k * 1.4 + 0.4;
            bar(b, ex + lx * o, ez + lz * o, along, 0.8, 0.4, PAINT_Y, PAINT);
          }
          // A painted give-way triangle in the lane, set back.
          const tx2 = ex + lx * 3 + DX[d] * 1.6;
          const tz2 = ez + lz * 3 + DY[d] * 1.6;
          const ax = -DX[d];
          const az = -DY[d];
          tri2(b, [tx2 + ax * 0.9, tz2 + az * 0.9], [tx2 - ax * 0.9 + lx * 0.6, tz2 - az * 0.9 + lz * 0.6], [tx2 - ax * 0.9 - lx * 0.6, tz2 - az * 0.9 - lz * 0.6], PAINT_Y, PAINT);
          tri2(b, [tx2 + ax * 0.55, tz2 + az * 0.55], [tx2 - ax * 0.6 + lx * 0.38, tz2 - az * 0.6 + lz * 0.38], [tx2 - ax * 0.6 - lx * 0.38, tz2 - az * 0.6 - lz * 0.38], PAINT_Y + 0.002, asphalt);
        }
      }
    }
    void rng;
  }

  function paintArrow(b, x, z, h) {
    bar(b, x - Math.cos(h) * 1.3, z - Math.sin(h) * 1.3, h, 3.4, 0.8, PAINT_Y, PAINT);
    const ux = Math.cos(h);
    const uz = Math.sin(h);
    tri2(b, [x + ux * 2.8, z + uz * 2.8], [x + ux * 0.4 - uz * 1.3, z + uz * 0.4 + ux * 1.3], [x + ux * 0.4 + uz * 1.3, z + uz * 0.4 - ux * 1.3], PAINT_Y, PAINT);
  }

  function loadingBay(tx, ty, b) {
    const X0 = tx * TS;
    const Z0 = ty * TS;
    const y = '#FFC22E';
    const m = 1.0;
    const w = 0.5;
    b.ground(X0 + m, Z0 + m, X0 + TS - m, Z0 + m + w, PAINT_Y, y);
    b.ground(X0 + m, Z0 + TS - m - w, X0 + TS - m, Z0 + TS - m, PAINT_Y, y);
    b.ground(X0 + m, Z0 + m + w, X0 + m + w, Z0 + TS - m - w, PAINT_Y, y);
    b.ground(X0 + TS - m - w, Z0 + m + w, X0 + TS - m, Z0 + TS - m - w, PAINT_Y, y);
    // Hatching: diagonal stripes clipped to the box.
    const ix0 = X0 + m + w + 0.2;
    const iz0 = Z0 + m + w + 0.2;
    const ix1 = X0 + TS - m - w - 0.2;
    const iz1 = Z0 + TS - m - w - 0.2;
    for (let k = -12; k < 12; k += 2.2) {
      const poly = clipConvex(
        [
          [ix0 + k, iz0],
          [ix0 + k + 0.55, iz0],
          [ix0 + k + 0.55 + (iz1 - iz0), iz1],
          [ix0 + k + (iz1 - iz0), iz1],
        ],
        ix0,
        iz0,
        ix1,
        iz1,
      );
      if (poly.length >= 3) fillPoly(b, poly, PAINT_Y, mix(y, asphalt, 0.35));
    }
  }

  function rails(tx, ty, b) {
    const X0 = tx * TS;
    const Z0 = ty * TS;
    const cx = X0 + TS / 2;
    const cz = Z0 + TS / 2;
    const rail = (x, y) => {
      const c = charAt(x, y);
      return c === 'r' || c === 'R';
    };
    const ns = [0, 1, 2, 3].filter((d) => rail(tx + DX[d], ty + DY[d]));
    const steel = '#B9BEC6';
    const bed = shade(asphalt, 0.12);
    const gauge = 0.75;
    if (ns.length === 2 && (ns[1] - ns[0]) % 2 === 1) {
      // A curve: quarter circles round the inside corner.
      const [d1, d2] = ns;
      const kx = cx + (DX[d1] + DX[d2]) * TS * 0.5;
      const kz = cz + (DY[d1] + DY[d2]) * TS * 0.5;
      const a0 = Math.atan2(cz - kz + DY[d1] * 0, cx - kx);
      const start = Math.atan2(cz + DY[d1] * TS * 0.5 - kz, cx + DX[d1] * TS * 0.5 - kx);
      const end = Math.atan2(cz + DY[d2] * TS * 0.5 - kz, cx + DX[d2] * TS * 0.5 - kx);
      let d = end - start;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      void a0;
      arcBand(b, kx, kz, TS / 2, 2.6, start, start + d, 0.006, bed, 12);
      for (const o of [-gauge, gauge]) arcBand(b, kx, kz, TS / 2 + o, 0.14, start, start + d, 0.016, steel, 12);
      return;
    }
    for (const d of ns) {
      const ex = cx + DX[d] * TS * 0.25;
      const ez = cz + DY[d] * TS * 0.25;
      const a = d % 2 ? 0 : Math.PI / 2;
      bar(b, ex, ez, a, TS / 2 + 1.3, 2.6, 0.006, bed);
      for (const o of [-gauge, gauge]) bar(b, ex + DY[d] * o, ez - DX[d] * o, a, TS / 2 + 0.05, 0.14, 0.016, steel);
    }
  }

  function bridgeBits(tx, ty, ch, b) {
    const X0 = tx * TS;
    const Z0 = ty * TS;
    const cx = X0 + TS / 2;
    const cz = Z0 + TS / 2;
    const horiz = roadish(tx - 1, ty) || roadish(tx + 1, ty);
    const rail = town.id === 12 ? '#3E4A56' : '#E9E4D6';
    if (ch === '=') {
      // Railings along both water sides, posts and a top rail; a pier underneath.
      for (const s of [-1, 1]) {
        for (let i = 0; i <= 12; i++) {
          const along = -TS / 2 + i * (TS / 12);
          const x = horiz ? cx + along : cx + s * (TS / 2 - 0.15);
          const z = horiz ? cz + s * (TS / 2 - 0.15) : cz + along;
          b.box(x, 0, z, 0.12, 1.05, 0.12, rail);
        }
        if (horiz) b.box(cx, 1.0, cz + s * (TS / 2 - 0.15), TS, 0.12, 0.16, rail);
        else b.box(cx + s * (TS / 2 - 0.15), 1.0, cz, 0.16, 0.12, TS, rail);
        // A kerb strip inside the railing.
        if (horiz) b.box(cx, 0, cz + s * (TS / 2 - 0.45), TS, 0.16, 0.5, shade(quay, 0.15));
        else b.box(cx + s * (TS / 2 - 0.45), 0, cz, 0.5, 0.16, TS, shade(quay, 0.15));
      }
      b.box(cx, WATER_Y - 0.2, cz, horiz ? 1.4 : 5, -WATER_Y - 0.55, horiz ? 5 : 1.4, quay, { surf: SURF.paving });
      return;
    }
    // A drawbridge: stone posts at the corners with lamps; the leaves move (the renderer's).
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = cx + sx * (TS / 2 - 0.5);
        const z = cz + sz * (TS / 2 - 0.5);
        b.box(x, WATER_Y, z, 1.0, -WATER_Y + 2.6, 1.0, '#A89C8A', { surf: SURF.paving, top: '#8E8474' });
        b.box(x, 2.6, z, 1.2, 0.2, 1.2, '#8E8474');
        b.box(x, 2.8, z, 0.3, 0.5, 0.3, '#2A2E36');
        b.box(x, 3.3, z, 0.4, 0.35, 0.4, '#FFE7B0', { surf: SURF.lamp });
        out.lamps.push({ x, y: 3.5, z, r: 9 });
      }
    }
    out.bridges.push({ tx, ty, x: cx, z: cz, horiz });
  }

  function lightPoles(tx, ty, b) {
    const cx = (tx + 0.5) * TS;
    const cz = (ty + 0.5) * TS;
    const light = city.lights.find((l) => l.tx === tx && l.ty === ty);
    const spots = [
      [-1, -1, 'h', -Math.PI / 2],
      [1, 1, 'h', Math.PI / 2],
      [1, -1, 'v', Math.PI],
      [-1, 1, 'v', 0],
    ];
    for (const [sx, sz, axis, ry] of spots) {
      const x = cx + sx * 6.7;
      const z = cz + sz * 6.7;
      const base = level(x, z);
      b.cyl(x, base, z, 0.09, 3.6 - base, '#2A2E36', 6);
      b.push(x, 3.0, z, ry);
      b.box(0, 0, 0.12, 0.42, 1.2, 0.34, '#1C1F26');
      b.box(0, -0.05, 0.08, 0.6, 1.3, 0.06, '#F2B544');
      // Visors over the three lamps.
      for (let k = 0; k < 3; k++) b.box(0, 0.98 - k * 0.38 + 0.11, 0.36, 0.3, 0.04, 0.16, '#1C1F26');
      b.pop();
      out.heads.push({ light, axis, x, z, ry });
    }
  }

  function zebraBeacons(tx, ty, b) {
    const cx = (tx + 0.5) * TS;
    const cz = (ty + 0.5) * TS;
    const zb = city.zebras.find((q) => q.tx === tx && q.ty === ty);
    const across = zb ? zb.across : 'h';
    for (const s of [-1, 1]) {
      // A beacon on the pavement at each end of the stripes.
      const X = across === 'v' ? cx + s * 5.0 : cx + s * 6.8;
      const Z = across === 'v' ? cz + s * 6.8 : cz + s * 5.0;
      const base = level(X, Z);
      if (base < 0.1) continue;
      for (let k = 0; k < 5; k++) b.cyl(X, base + k * 0.55, Z, 0.07, 0.55, k % 2 ? '#F4F1E8' : '#1C1F26', 6);
      out.beacons.push({ x: X, y: base + 3.0, z: Z });
    }
  }

  function streetLamp(tx, ty, b, rng) {
    const cx = (tx + 0.5) * TS;
    const cz = (ty + 0.5) * TS;
    const horiz = roadish(tx - 1, ty);
    const sides = horiz ? [0, 2] : [1, 3];
    const options = sides.filter((d) => level(cx + DX[d] * 6.6, cz + DY[d] * 6.6) >= KERB - 0.01);
    if (!options.length) return;
    const d = options[(tx + ty) % options.length];
    const x = cx + DX[d] * 6.6;
    const z = cz + DY[d] * 6.6;
    const post = downtown ? '#3A3F48' : '#2F4A3E';
    b.cyl(x, KERB, z, 0.1, 5.4, post, 6, { r1: 0.07 });
    b.box(x, KERB, z, 0.34, 0.5, 0.34, post);
    // The arm out over the road and the lamp.
    const ax = -DX[d];
    const az = -DY[d];
    b.box(x + ax * 0.7, KERB + 5.3, z + az * 0.7, Math.abs(ax) * 1.4 + 0.08, 0.08, Math.abs(az) * 1.4 + 0.08, post);
    const hx = x + ax * 1.35;
    const hz = z + az * 1.35;
    b.box(hx, KERB + 5.05, hz, 0.7, 0.24, 0.5, post);
    b.box(hx, KERB + 4.98, hz, 0.56, 0.08, 0.38, '#FFE7B0', { surf: SURF.lamp });
    out.lamps.push({ x: hx, y: KERB + 4.9, z: hz, r: 11 });
    void rng;
  }

  // ---------------------------------------------------------------- lots

  function lotTile(tx, ty, ch, c, rng) {
    const b = c.main;
    const leaves = c.leaves;
    const X0 = tx * TS;
    const Z0 = ty * TS;
    const X1 = X0 + TS;
    const Z1 = Z0 + TS;
    const cx = X0 + TS / 2;
    const cz = Z0 + TS / 2;
    const zone = inMap(tx, ty) ? city.cut.get(city.idx(tx, ty)) : null;
    const zn = zone ? zones.find((q) => q.src === zone) : null;
    const slab = zn ? minusDisc(X0, Z0, X1, Z1, zn.x, zn.z, zn.r) : minusDisc(X0, Z0, X1, Z1, 1e6, 1e6, 0);
    if (!slab) return;
    const far = !inMap(tx, ty);
    const edgeLawn = ch === 'x' && (edgeKind === 'hedge' || edgeKind === 'snow');
    const desert = ch === 'x' && edgeKind === 'desert';
    const slabC = desert ? p.lawn : edgeLawn && far ? lawn : p.pave;
    fillPoly(b, slab, KERB, slabC, desert ? SURF.soil : edgeLawn && far ? SURF.grass : SURF.paving);
    polyWalls(b, slab, KERB, (x, z) => level(x, z), kerbC);
    if (far) return farTile(tx, ty, c, rng);
    const roadSide = [0, 1, 2, 3].map((d) => isRoad(tx + DX[d], ty + DY[d]));
    const lawnLot = ch === 'h' || ch === 'g' || edgeLawn;
    if (lawnLot) {
      const ix0 = X0 + (roadSide[3] ? PAVE : 0);
      const ix1 = X1 - (roadSide[1] ? PAVE : 0);
      const iz0 = Z0 + (roadSide[0] ? PAVE : 0);
      const iz1 = Z1 - (roadSide[2] ? PAVE : 0);
      const lp = zn ? minusDisc(ix0, iz0, ix1, iz1, zn.x, zn.z, zn.r + PAVE) : minusDisc(ix0, iz0, ix1, iz1, 1e6, 1e6, 0);
      if (lp) {
        fillPoly(b, lp, LAWN, lawn, SURF.grass);
        polyWalls(b, lp, LAWN, (x, z) => (x > X0 && x < X1 && z > Z0 && z < Z1 ? KERB : null), shade(lawn, -0.35));
      }
    }
    if (zn) return cutLot(tx, ty, ch, c, rng, zn);
    if (ch === 'h') {
      const hs = houseByTile.get(city.idx(tx, ty));
      let face = hs && hs.face >= 0 ? hs.face : -1;
      if (face < 0) face = roadSide[2] ? 2 : roadSide[1] ? 1 : roadSide[3] ? 3 : roadSide[0] ? 0 : 2;
      const ry = ryFor(face);
      const ctx = { b, leaves, doors: [], lamps: [], smoke: [], parked: [], style, rng, roof: p.roofs[(hs ? hs.roof : rng.int(5)) % p.roofs.length], lot: hs ? hs.id : -1 };
      b.push(cx, LAWN, cz, ry);
      leaves.push(cx, LAWN, cz, ry);
      b.setSeed(rng.float(0, 100));
      const res = house(ctx);
      b.pop();
      leaves.pop();
      collect(ctx, cx, LAWN, cz, ry, hs, res, 'house');
      return;
    }
    if (ch === 'b') {
      const hs = houseByTile.get(city.idx(tx, ty));
      let face = hs && hs.face >= 0 ? hs.face : -1;
      if (face < 0) face = roadSide[2] ? 2 : roadSide[1] ? 1 : roadSide[3] ? 3 : roadSide[0] ? 0 : 2;
      const ry = ryFor(face);
      const roads = [roadSide[(face + 2) % 4], roadSide[(face + 3) % 4], roadSide[face], roadSide[(face + 1) % 4]];
      const awnings = [
        ['#B8442F', '#F4F1E8'],
        ['#2F6E4F', '#F4F1E8'],
        ['#2F5D8C', '#F4F1E8'],
        ['#F2B544', '#24323F'],
        ['#5B3F73', '#E9DCC6'],
        ['#E98FA4', '#F4F1E8'],
      ];
      const ctx = { b, leaves, doors: [], lamps: [], smoke: [], parked: [], signs: [], style, rng, face: roads[2] ? 1 : -1, roads, awning: awnings[rng.int(awnings.length)], tall: downtown, lot: hs ? hs.id : -1 };
      b.push(cx, KERB, cz, ry);
      leaves.push(cx, KERB, cz, ry);
      b.setSeed(rng.float(0, 100));
      const res = building(ctx);
      b.pop();
      leaves.pop();
      collect(ctx, cx, KERB, cz, ry, hs, res, 'shop');
      out.signs.push(cx, KERB, cz, ry);
      for (const sg of ctx.signs) {
        const name = SHOPS[rng.int(SHOPS.length)];
        out.signs.sign(night ? `neon:${name}` : name, sg.x, sg.y, sg.z + 0.02, sg.w, sg.h);
      }
      out.signs.pop();
      return;
    }
    if (ch === 'g') {
      const ctx = { b, leaves, style, rng, fountains: [] };
      b.push(cx, LAWN, cz, 0);
      leaves.push(cx, LAWN, cz, 0);
      garden(ctx);
      b.pop();
      leaves.pop();
      for (const f of ctx.fountains) out.fountains.push([cx + f[0], LAWN + f[1], cz + f[2]]);
      return;
    }
    if (ch === 'x') edgeTile(tx, ty, c, rng, roadSide);
  }

  function collect(ctx, cx, cy, cz, ry, hs, res, kind) {
    for (const d of ctx.doors) {
      const [x, y, z] = toWorld(cx, cy, cz, ry, [d.x, 0, d.z]);
      out.doors.push({ x, y, z, ry, w: d.w, h: d.h, color: d.color, house: hs ? hs.id : -1, hidden: !!d.hidden });
    }
    for (const l of ctx.lamps) {
      const [x, y, z] = toWorld(cx, cy, cz, ry, l);
      out.porch.push({ x, y, z, r: 4.5 });
    }
    for (const s of ctx.smoke) out.smoke.push(toWorld(cx, cy, cz, ry, s));
    for (const pk of ctx.parked) {
      const [x, , z] = toWorld(cx, cy, cz, ry, [pk.x, 0, pk.z]);
      out.parked.push({ x, y: cy, z, ry: ry + (pk.ry || 0) });
    }
    if (hs && res) {
      const door = toWorld(cx, cy, cz, ry, [res.doorX, 0, res.doorZ]);
      const mat = toWorld(cx, cy, cz, ry, [res.matX, 0, res.matZ]);
      const inside = toWorld(cx, cy, cz, ry, [res.doorX, 0, res.doorZ - 2.2]);
      out.houseAt.set(hs.id, { door: [door[0], door[2]], mat: [mat[0], mat[2]], inside: [inside[0], inside[2]], y: cy, ry, kind, ridge: res.ridge });
    }
  }

  /** A lot the loop zone's circle bites into: no house; a garden or a little plaza round the curve. */
  function cutLot(tx, ty, ch, c, rng, zn) {
    const cx = (tx + 0.5) * TS;
    const cz = (ty + 0.5) * TS;
    const away = (x, z, m) => Math.hypot(x - zn.x, z - zn.z) > zn.r + PAVE + m;
    if (ch === 'b' || ch === 'Q') {
      for (let i = 0; i < 4; i++) {
        const x = cx + rng.float(-4.5, 4.5);
        const z = cz + rng.float(-4.5, 4.5);
        if (!away(x, z, 1.2)) continue;
        c.main.cyl(x, KERB, z, 0.9, 0.6, '#B9B2A6', 10, { top: '#5C4433', topSurf: SURF.soil });
        bush(c.leaves, x, z, 0.75, p.hedge, rng, KERB + 0.6);
      }
      return;
    }
    let trees = 0;
    for (let i = 0; i < 6; i++) {
      const x = cx + rng.float(-4.4, 4.4);
      const z = cz + rng.float(-4.4, 4.4);
      if (!away(x, z, 1.6)) continue;
      if (trees < 2 && rng.chance(0.6)) {
        tree(c.main, c.leaves, x, z, rng.float(1.4, 2.0), style, rng, { y: LAWN });
        trees++;
      } else bush(c.leaves, x, z, rng.float(0.6, 0.9), p.hedge, rng, LAWN);
    }
  }

  // ---------------------------------------------------------------- the edge of town

  function edgeTile(tx, ty, c, rng, roadSide) {
    const X0 = tx * TS;
    const Z0 = ty * TS;
    const cx = X0 + TS / 2;
    const cz = Z0 + TS / 2;
    const ix0 = X0 + (roadSide[3] ? PAVE + 0.3 : 0.2);
    const ix1 = X0 + TS - (roadSide[1] ? PAVE + 0.3 : 0.2);
    const iz0 = Z0 + (roadSide[0] ? PAVE + 0.3 : 0.2);
    const iz1 = Z0 + TS - (roadSide[2] ? PAVE + 0.3 : 0.2);
    const south = ty >= H - 1;
    if (edgeKind === 'city') {
      cityBlock(c, (ix0 + ix1) / 2, (iz0 + iz1) / 2, ix1 - ix0, iz1 - iz0, south ? rng.float(4, 7) : rng.float(10, 20), rng, KERB);
      return;
    }
    if (edgeKind === 'desert') {
      for (let i = 0; i < 3; i++) c.leaves.blob(cx + rng.float(-4, 4), KERB + 0.3, cz + rng.float(-4, 4), rng.float(0.6, 1.4), rng.pick(['#B98A5E', '#A47650', '#C49A6C']), 0.6, 0, 0.3, i + tx);
      for (let i = 0; i < 2; i++) tree(c.main, c.leaves, cx + rng.float(-4, 4), cz + rng.float(-4, 4), rng.float(0.9, 1.4), style, rng, { kind: 'cactus', y: KERB });
      if (rng.chance(0.4)) tree(c.main, c.leaves, cx + rng.float(-3, 3), cz + rng.float(-3, 3), rng.float(1.6, 2.2), style, rng, { y: KERB });
      return;
    }
    if (edgeKind === 'snow') {
      hedgeRun(c.leaves, ix0, (iz0 + iz1) / 2, ix1, (iz0 + iz1) / 2, '#EEF3F7', 1.0, iz1 - iz0);
      for (let i = 0; i < 2 + rng.int(2); i++) tree(c.main, c.leaves, cx + rng.float(-3.5, 3.5), cz + rng.float(-3.5, 3.5), rng.float(1.6, 2.3), style, rng, { y: LAWN + 0.8 });
      return;
    }
    // A thick hedge with trees growing out of it.
    const hc = p.hedge;
    c.leaves.box((ix0 + ix1) / 2, LAWN, (iz0 + iz1) / 2, ix1 - ix0, south ? 1.4 : 2.2, iz1 - iz0, hc, { top: shade(hc, 0.14), bottomDark: 0.3 });
    for (let i = 0; i < 2 + rng.int(2); i++) {
      if (south && rng.chance(0.6)) continue;
      tree(c.main, c.leaves, cx + rng.float(-3.5, 3.5), cz + rng.float(-3.5, 3.5), rng.float(1.8, 2.6), style, rng, { y: LAWN + (south ? 1.4 : 2.2) - 1.2 });
    }
  }

  /** A plain block with windows drawn on (edges and the far town). */
  function cityBlock(c, x, z, w, d, h, rng, y0) {
    const b = c.main;
    const walls = style.walls;
    const col = walls[rng.int(walls.length)];
    b.setSeed(rng.float(0, 100));
    b.box(x, y0, z, w, h, d, col, { surf: SURF.facade, skip: new Set(['top']), bottomDark: 0.12 });
    b.box(x, y0 + h, z, w + 0.3, 0.3, d + 0.3, shade(col, 0.25));
    b.parapet(x, y0 + h + 0.3, z, w + 0.2, d + 0.2, shade(col, 0.2), '#8E8A84', 0.25, 0.5);
    if (rng.chance(0.5)) b.box(x + rng.float(-w / 4, w / 4), y0 + h + 0.3, z + rng.float(-d / 4, d / 4), 1.6, 1.0, 1.4, '#C9CED6', { surf: SURF.metal });
  }

  function farTile(tx, ty, c, rng) {
    const cx = (tx + 0.5) * TS;
    const cz = (ty + 0.5) * TS;
    if (edgeKind === 'city') {
      const north = ty < 0;
      cityBlock(c, cx, cz, TS - 0.6, TS - 0.6, north ? rng.float(12, 30) : rng.float(4, 9), rng, KERB);
      return;
    }
    if (edgeKind === 'desert') {
      if (rng.chance(0.5)) c.leaves.blob(cx + rng.float(-4, 4), KERB, cz + rng.float(-4, 4), rng.float(1.5, 3.5), rng.pick(['#C49A6C', '#B98A5E', '#D4AE7E']), 0.5, 0, 0.35, tx * 3 + ty);
      if (rng.chance(0.5)) tree(c.main, c.leaves, cx + rng.float(-4, 4), cz + rng.float(-4, 4), rng.float(1.0, 1.4), style, rng, { kind: 'cactus', y: KERB });
      return;
    }
    const n = 2 + rng.int(3);
    for (let i = 0; i < n; i++) tree(c.main, c.leaves, cx + rng.float(-4.5, 4.5), cz + rng.float(-4.5, 4.5), rng.float(2.0, 3.0), style, rng, { y: KERB });
    if (edgeKind === 'hedge' && rng.chance(0.5)) bush(c.leaves, cx + rng.float(-4, 4), cz + rng.float(-4, 4), rng.float(1.0, 1.6), p.hedge, rng, KERB);
  }

  // ---------------------------------------------------------------- parks and alleys

  function parkTile(tx, ty, ch, c, rng) {
    const b = c.main;
    const X0 = tx * TS;
    const Z0 = ty * TS;
    const y = 0.03;
    const horiz = tx % 2 === 0;
    for (let i = 0; i < 4; i++) {
      const col = i % 2 ? p.lawn : p.lawn2;
      if (horiz) b.ground(X0, Z0 + i * 3, X0 + TS, Z0 + (i + 1) * 3, y, col, SURF.grass);
      else b.ground(X0 + i * 3, Z0, X0 + (i + 1) * 3, Z0 + TS, y, col, SURF.grass);
    }
    for (let d = 0; d < 4; d++) {
      if (!isRoad(tx + DX[d], ty + DY[d])) continue;
      const w = 0.25;
      bar(b, X0 + TS / 2 + DX[d] * (TS / 2 - w / 2), Z0 + TS / 2 + DY[d] * (TS / 2 - w / 2), d % 2 ? Math.PI / 2 : 0, TS, w, y + 0.012, shade(p.pave, -0.1));
    }
    // Daisies and clover, flat on the grass (vans drive over them).
    for (let i = 0; i < 10; i++) {
      const x = X0 + rng.float(0.5, TS - 0.5);
      const z = Z0 + rng.float(0.5, TS - 0.5);
      const col = style.flowers[rng.int(style.flowers.length)];
      for (let k = 0; k < 4; k++) b.disc(x + rng.float(-0.4, 0.4), y + 0.01, z + rng.float(-0.4, 0.4), 0.09, col, 5);
    }
    if (ch === 't') {
      for (const tr of city.trees) {
        if (Math.floor(tr.x / T) !== tx || Math.floor(tr.y / T) !== ty) continue;
        tree(b, c.leaves, tr.x * S, tr.y * S, 2.4, style, rng, { y });
        b.disc(tr.x * S, y + 0.008, tr.y * S, 1.0, shade(p.lawn2, -0.25), 12, SURF.soil);
      }
    }
  }

  function alleyTile(tx, ty, c, rng) {
    const b = c.main;
    const X0 = tx * TS;
    const Z0 = ty * TS;
    const o = city.alleys.get(city.idx(tx, ty));
    const lane = o === 'h' ? [X0, Z0 + 3, X0 + TS, Z0 + 9] : [X0 + 3, Z0, X0 + 9, Z0 + TS];
    b.ground(lane[0], lane[1], lane[2], lane[3], 0, shade(asphalt, 0.05), SURF.asphalt);
    const sides = o === 'h' ? [[X0, Z0, X0 + TS, Z0 + 3], [X0, Z0 + 9, X0 + TS, Z0 + TS]] : [[X0, Z0, X0 + 3, Z0 + TS], [X0 + 9, Z0, X0 + TS, Z0 + TS]];
    for (const [x0, z0, x1, z1] of sides) {
      const poly = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ];
      fillPoly(b, poly, KERB, shade(p.pave, -0.08), SURF.paving);
      polyWalls(b, poly, KERB, (x, z) => level(x, z), kerbC);
    }
    // A brick wall along each side, bins and crates, a drain down the middle.
    for (const s of [0, 1]) {
      const [x0, z0, x1, z1] = sides[s];
      const wx = o === 'h' ? (x0 + x1) / 2 : s ? x1 - 0.3 : x0 + 0.3;
      const wz = o === 'h' ? (s ? z1 - 0.3 : z0 + 0.3) : (z0 + z1) / 2;
      b.box(wx, KERB, wz, o === 'h' ? TS : 0.4, 2.2, o === 'h' ? 0.4 : TS, '#9C5A44', { surf: SURF.brick, top: '#8A8580' });
      const bx = o === 'h' ? X0 + rng.float(2, 9) : (x0 + x1) / 2;
      const bz = o === 'h' ? (z0 + z1) / 2 : Z0 + rng.float(2, 9);
      if (rng.chance(0.7)) {
        b.push(bx, KERB, bz, o === 'h' ? 0 : Math.PI / 2);
        bins(b, -0.4, 0, rng);
        b.pop();
      } else b.box(bx, KERB, bz, 1.0, 0.8, 1.0, '#A57A4E', { surf: SURF.planks });
    }
    if (o === 'h') b.ground(X0, Z0 + 5.9, X0 + TS, Z0 + 6.1, 0.005, shade(asphalt, -0.3), SURF.asphalt);
    else b.ground(X0 + 5.9, Z0, X0 + 6.1, Z0 + TS, 0.005, shade(asphalt, -0.3), SURF.asphalt);
  }

  // ---------------------------------------------------------------- the loop zones and the depot

  function zoneBits(zn) {
    const c = chunk(zn.tx, zn.ty);
    const b = c.main;
    b.disc(zn.x, 0, zn.z, zn.r, asphalt, 48, SURF.asphalt);
    // A skirt down to the water where the circle stands over it.
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const lv = level(zn.x + Math.cos(am) * (zn.r + 0.15), zn.z + Math.sin(am) * (zn.r + 0.15));
      if (lv > -0.1) continue;
      wallSeg(b, [zn.x + Math.cos(a0) * zn.r, zn.z + Math.sin(a0) * zn.r], [zn.x + Math.cos(a1) * zn.r, zn.z + Math.sin(a1) * zn.r], 0, WATER_Y, [Math.cos(am), Math.sin(am)], quay, SURF.paving);
      // A railing round the pier.
      if (i % 2 === 0) b.box(zn.x + Math.cos(am) * (zn.r - 0.2), 0, zn.z + Math.sin(am) * (zn.r - 0.2), 0.12, 1.05, 0.12, '#E9E4D6');
      b.push(zn.x + Math.cos(am) * (zn.r - 0.2), 1.0, zn.z + Math.sin(am) * (zn.r - 0.2), -am);
      b.box(0, 0, 0, 0.14, 0.1, ((Math.PI * 2 * zn.r) / n) * 1.02, '#E9E4D6');
      b.pop();
    }
    if (zn.kind === 'plaza') {
      // A mini-roundabout: a low white dome, clockwise arrows.
      b.cyl(zn.x, 0, zn.z, 2.0, 0.16, '#E9E4D6', 20, { r1: 1.5, top: '#F4F1E8' });
      b.cyl(zn.x, 0.16, zn.z, 1.5, 0.08, '#F4F1E8', 20, { r1: 0.9 });
      for (let k = 0; k < 3; k++) {
        const a0 = (k / 3) * Math.PI * 2 + 0.3;
        const a1 = a0 + 1.1;
        arcBand(b, zn.x, zn.z, 5.2, 0.45, a0, a1, PAINT_Y, PAINT, 10);
        const hx = zn.x + Math.cos(a1) * 5.2;
        const hz = zn.z + Math.sin(a1) * 5.2;
        const tx = -Math.sin(a1);
        const tz = Math.cos(a1);
        const rx = Math.cos(a1);
        const rz = Math.sin(a1);
        tri2(b, [hx + tx * 0.9, hz + tz * 0.9], [hx - tx * 0.5 + rx * 0.8, hz - tz * 0.5 + rz * 0.8], [hx - tx * 0.5 - rx * 0.8, hz - tz * 0.5 - rz * 0.8], PAINT_Y, PAINT);
      }
    } else {
      // A turning circle: the orbit, dashed.
      const r = (DRIVE.loopRadius + 6) * S;
      for (let k = 0; k < 14; k++) {
        const a0 = (k / 14) * Math.PI * 2;
        arcBand(b, zn.x, zn.z, r, 0.32, a0, a0 + (Math.PI * 2) / 28, PAINT_Y, PAINT, 3);
      }
      b.disc(zn.x, PAINT_Y, zn.z, 0.45, PAINT, 12);
    }
  }

  function depot() {
    const qs = [];
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) if (city.at(tx, ty) === 'Q') qs.push([tx, ty]);
    const d = city.depot;
    const dx = d.tx;
    const dy = d.ty;
    if (qs.length) {
      const minX = Math.min(...qs.map((q) => q[0]));
      const maxX = Math.max(...qs.map((q) => q[0]));
      const minY = Math.min(...qs.map((q) => q[1]));
      const maxY = Math.max(...qs.map((q) => q[1]));
      const c = chunk(minX, minY);
      const b = c.main;
      const x0 = minX * TS + 0.6;
      const x1 = (maxX + 1) * TS - 0.6;
      const z0 = minY * TS + 0.6;
      const z1 = (maxY + 1) * TS - 0.6;
      const x = (x0 + x1) / 2;
      const z = (z0 + z1) / 2;
      const w = x1 - x0;
      const dd = z1 - z0;
      const h = 6.4;
      const cream = '#EDE7D8';
      b.setSeed(7);
      b.box(x, KERB, z, w, h, dd, cream, { surf: SURF.metal, skip: new Set(['top']), bottomDark: 0.1 });
      b.box(x, KERB, z, w + 0.08, 1.0, dd + 0.08, '#9C5A44', { surf: SURF.brick, skip: new Set(['top']) });
      // The brand stripe.
      b.box(x, KERB + h - 1.5, z, w + 0.12, 0.9, dd + 0.12, '#FFC22E', { skip: new Set(['top']) });
      b.box(x, KERB + h - 1.6, z, w + 0.14, 0.1, dd + 0.14, '#141A22', { skip: new Set(['top']) });
      b.box(x, KERB + h, z, w + 0.3, 0.25, dd + 0.3, '#3A3F48');
      b.parapet(x, KERB + h + 0.25, z, w + 0.2, dd + 0.2, '#3A3F48', '#9AA0A8', 0.25, 0.45);
      // The logo on the roof: a blue disc with the curl.
      const R = Math.min(w, dd) / 2 - 1.2;
      const ry = KERB + h + 0.33;
      b.disc(x, ry, z, R, '#1E5BC6', 32);
      curl(b, x, ry + 0.01, z, R * 0.78, '#F4F1E8');
      // Roller doors facing the bay.
      const side = dx < minX ? 3 : dx > maxX ? 1 : dy < minY ? 0 : 2;
      const facing = [
        [x, z0, w, 0],
        [x1, z, dd, Math.PI / 2],
        [x, z1, w, 0],
        [x0, z, dd, -Math.PI / 2],
      ][side];
      const doorRy = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][side];
      b.push(side === 0 || side === 2 ? x : side === 1 ? x1 : x0, KERB, side === 0 ? z0 : side === 2 ? z1 : z, doorRy);
      const n = Math.max(1, Math.floor(facing[2] / 5));
      for (let i = 0; i < n; i++) {
        const ox = -facing[2] / 2 + (facing[2] / n) * (i + 0.5);
        b.box(ox, 0, 0.06, 3.6, 4.1, 0.12, '#3A3F48');
        b.quad([ox - 1.6, 0.05, 0.13], [ox + 1.6, 0.05, 0.13], [ox + 1.6, 3.9, 0.13], [ox - 1.6, 3.9, 0.13], '#C9CED6', SURF.metal);
        b.box(ox, 4.2, 0.35, 0.8, 0.12, 0.5, '#FFE7B0', { surf: SURF.lamp });
      }
      b.pop();
      // The sign on the face the camera sees (south), else the bay's face.
      const sx = x;
      const sz = z1 + 0.05;
      const sw = Math.min(w - 1.0, 15);
      out.signs.push(sx, KERB, sz, 0);
      out.signs.sign('CLOCKWISE COURIERS', 0, h - 2.5, 0.02, sw, sw / 16);
      out.signs.pop();
      if (side !== 2) {
        // A smaller sign over the doors too.
        const p0 = [
          [x, z0 - 0.05, Math.PI],
          [x1 + 0.05, z, Math.PI / 2],
          [x, z1 + 0.05, 0],
          [x0 - 0.05, z, -Math.PI / 2],
        ][side];
        out.signs.push(p0[0], KERB, p0[1], p0[2]);
        out.signs.sign('CLOCKWISE COURIERS', 0, h - 0.9, 0.08, Math.min(facing[2] - 1, 12), Math.min(facing[2] - 1, 12) / 16);
        out.signs.pop();
      }
    }
    // The gantry over the bay with the LOAD sign.
    const c = chunk(dx, dy);
    const b = c.main;
    const cx = (dx + 0.5) * TS;
    const cz = (dy + 0.5) * TS;
    const across = d.dir === 0 || d.dir === 2 ? 0 : Math.PI / 2; // the beam runs across the way in
    b.push(cx, 0, cz, across);
    for (const s of [-1, 1]) {
      b.box(s * 6.3, 0, 0, 0.45, 5.6, 0.45, '#FFC22E');
      b.box(s * 6.3, 0, 0, 0.7, 0.3, 0.7, '#3A3F48');
    }
    b.box(0, 5.2, 0, 13.0, 0.5, 0.5, '#FFC22E');
    b.box(0, 5.15, 0, 13.0, 0.08, 0.56, '#141A22');
    b.box(0, 4.2, 0, 3.6, 0.95, 0.14, '#1E5BC6');
    b.box(-0.9, 4.7, 0, 0.06, 0.5, 0.06, '#3A3F48');
    b.box(0.9, 4.7, 0, 0.06, 0.5, 0.06, '#3A3F48');
    b.pop();
    out.signs.push(cx, 0, cz, across);
    out.signs.sign('LOAD', 0, 4.67, 0.08, 3.4, 0.85);
    out.signs.pop();
    out.signs.push(cx, 0, cz, across + Math.PI);
    out.signs.sign('LOAD', 0, 4.67, 0.08, 3.4, 0.85);
    out.signs.pop();
    out.gantry = { x: cx, z: cz, ry: across };
  }

  /** The Clockwise Couriers curl: three-quarters of a ring and an arrowhead, flat. */
  function curl(b, x, y, z, r, color) {
    const a0 = -Math.PI * 0.95;
    const a1 = Math.PI * 0.55;
    arcBand(b, x, z, r * 0.7, r * 0.26, a0, a1, y, color, 24);
    const hx = x + Math.cos(a1) * r * 0.7;
    const hz = z + Math.sin(a1) * r * 0.7;
    const tx = -Math.sin(a1);
    const tz = Math.cos(a1);
    const rx = Math.cos(a1);
    const rz = Math.sin(a1);
    tri2(b, [hx + tx * r * 0.42, hz + tz * r * 0.42], [hx + rx * r * 0.36, hz + rz * r * 0.36], [hx - rx * r * 0.36, hz - rz * r * 0.36], y, color);
  }

  // ---------------------------------------------------------------- lot boundaries

  function boundaries() {
    const pair = (a, b2) => (a === 'h' && (b2 === 'h' || b2 === 'g')) || (a === 'g' && b2 === 'h');
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const a = city.at(tx, ty);
        if (a !== 'h' && a !== 'g') continue;
        if (city.cut.has(city.idx(tx, ty))) continue;
        for (const [ox, oy] of [
          [1, 0],
          [0, 1],
        ]) {
          const nb = charAt(tx + ox, ty + oy);
          if (!pair(a, nb) || (inMap(tx + ox, ty + oy) && city.cut.has(city.idx(tx + ox, ty + oy)))) continue;
          const rng = createRng(hashString(`edge${town.id}:${tx},${ty},${ox}`));
          const c = chunk(tx, ty);
          if (ox) {
            const x = (tx + 1) * TS;
            let z0 = ty * TS;
            let z1 = z0 + TS;
            if (isRoad(tx, ty - 1) || isRoad(tx + 1, ty - 1)) z0 += PAVE + 0.15;
            if (isRoad(tx, ty + 1) || isRoad(tx + 1, ty + 1)) z1 -= PAVE + 0.15;
            if (isRoad(tx, ty - 1) || isRoad(tx, ty + 1)) {
              /* the front: keep the run off the front garden */
            }
            run(c, rng, x, z0 + 0.1, x, z1 - 0.1);
          } else {
            const z = (ty + 1) * TS;
            let x0 = tx * TS;
            let x1 = x0 + TS;
            if (isRoad(tx - 1, ty) || isRoad(tx - 1, ty + 1)) x0 += PAVE + 0.15;
            if (isRoad(tx + 1, ty) || isRoad(tx + 1, ty + 1)) x1 -= PAVE + 0.15;
            run(c, rng, x0 + 0.1, z, x1 - 0.1, z);
          }
        }
      }
    }
  }

  function run(c, rng, x0, z0, x1, z1) {
    const k = rng.float(0, 1);
    c.main.push(0, LAWN, 0, 0);
    c.leaves.push(0, LAWN, 0, 0);
    if (k < 0.45) hedgeRun(c.leaves, x0, z0, x1, z1, p.hedge, rng.float(1.0, 1.5), 0.8);
    else if (k < 0.75) fenceRun(c.main, x0, z0, x1, z1, '#8A6A4E', 1.3);
    else if (k < 0.9) fenceRun(c.main, x0, z0, x1, z1, '#F4F1E8', 0.9);
    else {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      c.main.box((x0 + x1) / 2, 0, (z0 + z1) / 2, alongX ? len : 0.35, 0.9, alongX ? 0.35 : len, '#B9AE9C', { surf: SURF.paving, top: '#A39886' });
    }
    c.main.pop();
    c.leaves.pop();
  }

  // ---------------------------------------------------------------- go

  for (let ty = -OUT.n; ty < H + OUT.s; ty++) {
    for (let tx = -OUT.w; tx < W + OUT.e; tx++) {
      const ch = charAt(tx, ty);
      const c = chunk(tx, ty);
      const rng = createRng(hashString(`${town.id}:${tx},${ty}`));
      c.main.setSeed(rng.float(0, 100));
      if (ch === 'w') {
        if (!inMap(tx, ty) || !city.cut.has(city.idx(tx, ty))) waterTile(tx, ty, c, rng);
        continue;
      }
      if (isRoadChar(ch)) roadTile(tx, ty, ch, c.main, rng);
      else if (ch === 'p' || ch === 't') parkTile(tx, ty, ch, c, rng);
      else if (ch === 'a') alleyTile(tx, ty, c, rng);
      else lotTile(tx, ty, ch, c, rng);
    }
  }
  for (const zn of zones) zoneBits(zn);
  for (const pd of city.puddles) {
    const c = chunk(Math.floor(pd.x / T), Math.floor(pd.y / T));
    const x = pd.x * S;
    const z = pd.y * S;
    const r = pd.r * S;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const e = (a) => [x + Math.cos(a) * r * 1.3 * Math.cos(0.3) - Math.sin(a) * r * 0.85 * Math.sin(0.3), z + Math.cos(a) * r * 1.3 * Math.sin(0.3) + Math.sin(a) * r * 0.85 * Math.cos(0.3)];
      const A = e(a0);
      const B = e(a1);
      const ny = (A[1] - z) * (B[0] - x) - (A[0] - x) * (B[1] - z);
      if (ny >= 0) c.main.tri([x, 0.009, z], [A[0], 0.009, A[1]], [B[0], 0.009, B[1]], mix(asphalt, '#2C3E52', 0.5), SURF.puddle, [x, z], A, B);
      else c.main.tri([x, 0.009, z], [B[0], 0.009, B[1]], [A[0], 0.009, A[1]], mix(asphalt, '#2C3E52', 0.5), SURF.puddle, [x, z], B, A);
    }
  }
  boundaries();
  depot();
  return out;

  function waterTile(tx, ty, c, rng) {
    // Harbour clutter on open water: a buoy now and then; boats tied up along quays.
    if (rng.chance(0.06)) {
      const x = (tx + 0.5) * TS + rng.float(-3, 3);
      const z = (ty + 0.5) * TS + rng.float(-3, 3);
      c.main.cyl(x, WATER_Y - 0.3, z, 0.45, 1.1, rng.chance(0.5) ? '#D9573B' : '#F2B544', 8, { r1: 0.25 });
    }
    if (!inMap(tx, ty)) return;
    for (let d = 0; d < 4; d++) {
      const nb = charAt(tx + DX[d], ty + DY[d]);
      if (nb === 'w' || !rng.chance(0.18)) continue;
      // A little boat moored against the quay.
      const x = (tx + 0.5) * TS + DX[d] * 3.6;
      const z = (ty + 0.5) * TS + DY[d] * 3.6;
      boat(c, x, z, d % 2 ? 0 : Math.PI / 2, rng);
      break;
    }
  }

  function boat(c, x, z, ry, rng) {
    const b = c.main;
    const hull = rng.pick(['#F4F1E8', '#2F5D8C', '#B8442F', '#2F6E4F']);
    b.push(x, WATER_Y - 0.25, z, ry);
    b.box(0, 0, 0, 5.0, 0.8, 1.9, hull, { top: '#A57A4E', topSurf: SURF.planks });
    b.box(2.5, 0, 0, 0.8, 0.8, 1.2, hull);
    b.box(-0.6, 0.8, 0, 1.8, 1.0, 1.4, '#F4F1E8');
    b.box(-0.6, 1.8, 0, 2.0, 0.1, 1.6, shade(hull, -0.2));
    b.pop();
  }
}

/** Sutherland–Hodgman: a convex polygon clipped to a rectangle. */
function clipConvex(poly, x0, z0, x1, z1) {
  const edges = [
    (p) => p[0] >= x0,
    (p) => p[0] <= x1,
    (p) => p[1] >= z0,
    (p) => p[1] <= z1,
  ];
  const isect = [
    (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (z0 - a[1])) / (b[1] - a[1]), z0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (z1 - a[1])) / (b[1] - a[1]), z1],
  ];
  let outp = poly;
  for (let e = 0; e < 4; e++) {
    const inp = outp;
    outp = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i];
      const prev = inp[(i + inp.length - 1) % inp.length];
      const cin = edges[e](cur);
      const pin = edges[e](prev);
      if (cin) {
        if (!pin) outp.push(isect[e](prev, cur));
        outp.push(cur);
      } else if (pin) outp.push(isect[e](prev, cur));
    }
    if (!outp.length) break;
  }
  return outp;
}
