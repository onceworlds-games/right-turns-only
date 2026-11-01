// Town traffic: cars, buses, the tram, people on zebra crossings. A pure function of the town and the shift clock, stepped at a
// fixed 30 Hz, so every page sees the same streets. Cars keep left, turn any way, stop for lights, people, raised bridges and
// whatever is in front of them, and never react to vans. Pure: no page, no platform.

import { T, DX, DY, TRAFFIC, clamp, wrapAngle } from './config.js';
import { lightState, bridgeState } from './city.js';
import { createRng } from './rng.js';

const STEP = TRAFFIC.step;
const LANE = TRAFFIC.lane;
const CAR_ROAD = new Set(['.', 'L', 'z', '~', 'k', 'O', 'c', '=', 'd', 'R']); // not 'r': the rails are the tram's (cars cross them at R)
const COLORS = ['#E8E4DA', '#3F7FD1', '#D9573B', '#2E3440', '#F0B43C', '#5BB06A', '#B7BCC6', '#8C5BD1', '#F28C3B'];
const left = (d) => [DY[d], -DX[d]];

/** Which tiles cars may use: roads, but never roadworks streets, the depot, alleys or parks. */
function carRoad(city) {
  const ok = new Uint8Array(city.w * city.h);
  const closed = new Set();
  for (const k of [1, 2, 3]) for (const c of city.closures[k] || []) closed.add(city.idx(c.tx, c.ty));
  for (let ty = 0; ty < city.h; ty++) {
    for (let tx = 0; tx < city.w; tx++) {
      const i = city.idx(tx, ty);
      ok[i] = CAR_ROAD.has(city.at(tx, ty)) && !closed.has(i) ? 1 : 0;
    }
  }
  return (tx, ty) => tx >= 0 && ty >= 0 && tx < city.w && ty < city.h && ok[city.idx(tx, ty)] === 1;
}

/** A car's path through one tile, entering moving `d` and leaving moving `e`: a sampler s → {x, y, h} and its length. */
function tilePath(city, tx, ty, d, e) {
  const cx = (tx + 0.5) * T;
  const cy = (ty + 0.5) * T;
  const L = left(d);
  const Le = left(e);
  const sx = cx - DX[d] * 60 + L[0] * LANE;
  const sy = cy - DY[d] * 60 + L[1] * LANE;
  const ex = cx + DX[e] * 60 + Le[0] * LANE;
  const ey = cy + DY[e] * 60 + Le[1] * LANE;
  const k = (e - d + 4) % 4;
  if (k === 0) return line(sx, sy, ex, ey);
  if (k === 2) {
    // Turning round (a dead end's turning circle): in, a clockwise arc at the lane radius, out.
    const r = LANE;
    const ax = cx + L[0] * r;
    const ay = cy + L[1] * r;
    const a0 = Math.atan2(L[1], L[0]);
    const turn = Math.PI;
    const bx = cx + Le[0] * r;
    const by = cy + Le[1] * r;
    return chain([line(sx, sy, ax, ay), arc(cx, cy, r, a0, turn), line(bx, by, ex, ey)]);
  }
  if (k === 1) {
    // Right: the wide one, round the far corner.
    const ox = cx - DX[d] * 60 + DX[e] * 60;
    const oy = cy - DY[d] * 60 + DY[e] * 60;
    return arc(ox, oy, 60 + LANE, Math.atan2(-DY[e], -DX[e]), Math.PI / 2);
  }
  // Left: the tight one, round the near corner.
  const ox = cx - DX[d] * 60 + DX[e] * 60;
  const oy = cy - DY[d] * 60 + DY[e] * 60;
  return arc(ox, oy, 60 - LANE, Math.atan2(-DY[e], -DX[e]), -Math.PI / 2);
}

function line(x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const h = Math.atan2(y1 - y0, x1 - x0);
  return { len, at: (s) => ({ x: x0 + ((x1 - x0) * s) / len, y: y0 + ((y1 - y0) * s) / len, h }), curve: 0 };
}

/** An arc round (ox, oy) of radius r from angle a0, turning `turn` radians (positive: clockwise on screen). */
function arc(ox, oy, r, a0, turn) {
  const len = Math.abs(turn) * r;
  const sgn = Math.sign(turn);
  return {
    len,
    curve: 1 / r,
    at: (s) => {
      const a = a0 + (s / r) * sgn;
      return { x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r, h: a + (sgn * Math.PI) / 2 };
    },
  };
}

function chain(parts) {
  const len = parts.reduce((a, p) => a + p.len, 0);
  return {
    len,
    curve: Math.max(...parts.map((p) => p.curve)),
    at: (s) => {
      for (const p of parts) {
        if (s <= p.len) return p.at(s);
        s -= p.len;
      }
      const p = parts[parts.length - 1];
      return p.at(p.len);
    },
  };
}

/**
 * Create the traffic for a town. `seed` varies the cars (solo shifts use the town's seed so every run matches).
 * Returns { t, cars, tram, walkers, advanceTo(t), bodies(), lights(t) }.
 */
export function createTraffic(city, seed = city.seed) {
  const town = city.town;
  const rng = createRng(seed ^ 0x5eed);
  const road = carRoad(city);
  const lightAt = new Map(city.lights.map((l) => [city.idx(l.tx, l.ty), l]));
  const zebraAt = new Map(city.zebras.map((z) => [city.idx(z.tx, z.ty), z]));
  const oneWay = town.oneWay || null;
  const sim = { t: 0, cars: [], tram: null, walkers: [] };

  const allowed = (tx, ty, e) => {
    if (!road(tx, ty)) return false;
    if (oneWay) {
      const rw = oneWay.rows && oneWay.rows[ty];
      if (rw !== undefined && (e === 1 || e === 3) && e !== rw) return false;
      const cl = oneWay.cols && oneWay.cols[tx];
      if (cl !== undefined && (e === 0 || e === 2) && e !== cl) return false;
    }
    return true;
  };

  function chooseExit(car, tx, ty, d) {
    const opts = [];
    const ch = city.at(tx, ty);
    const loop = ch === 'O' || ch === 'c';
    for (const [k, w] of [[0, 5], [1, 2.5], [3, 2.5]]) {
      const e = (d + k) % 4;
      if (allowed(tx + DX[e], ty + DY[e], e)) opts.push([e, loop && k === 0 ? 3 : w]);
    }
    if (!opts.length) {
      const back = (d + 2) % 4;
      return allowed(tx + DX[back], ty + DY[back], back) || road(tx + DX[back], ty + DY[back]) ? back : d;
    }
    let total = 0;
    for (const o of opts) total += o[1];
    let r = car.rng.float(0, total);
    for (const o of opts) {
      r -= o[1];
      if (r <= 0) return o[0];
    }
    return opts[opts.length - 1][0];
  }

  function enter(car, tx, ty, d) {
    car.tx = tx;
    car.ty = ty;
    car.d = d;
    car.e = chooseExit(car, tx, ty, d);
    car.path = tilePath(city, tx, ty, d, car.e);
    car.s = 0;
  }

  // Spawn cars spread over the streets, away from the depot.
  const spots = [];
  for (let ty = 0; ty < city.h; ty++) {
    for (let tx = 0; tx < city.w; tx++) {
      if (!road(tx, ty)) continue;
      const ch = city.at(tx, ty);
      if (ch === 'O' || ch === 'c' || ch === 'L' || ch === 'R' || ch === 'z' || ch === 'd') continue;
      if (Math.abs(tx - city.depot.tx) + Math.abs(ty - city.depot.ty) < 3) continue;
      const dirs = [0, 1, 2, 3].filter((d) => allowed(tx + DX[d], ty + DY[d], d) && road(tx - DX[d], ty - DY[d]));
      if (dirs.length) spots.push([tx, ty, dirs]);
    }
  }
  rng.shuffle(spots);
  const count = Math.min(town.cars || 0, spots.length);
  for (let i = 0; i < count; i++) {
    const [tx, ty, dirs] = spots[i];
    const bus = !!town.buses && i % 4 === 3;
    const car = {
      id: i,
      kind: bus ? 'bus' : 'car',
      len: bus ? 92 : 46,
      wid: bus ? 34 : 26,
      top: bus ? 110 : 120 + rng.int(31),
      color: bus ? '#F0B43C' : COLORS[rng.int(COLORS.length)],
      rng: createRng(seed + i * 7919),
      v: 0,
      x: 0,
      y: 0,
      h: 0,
      px: 0,
      py: 0,
      ph: 0,
      wait: 0,
      creep: 0,
      jams: 0,
      ghost: 0,
      tx: 0,
      ty: 0,
      d: 0,
      e: 0,
      s: 0,
      path: null,
    };
    enter(car, tx, ty, dirs[rng.int(dirs.length)]);
    car.s = rng.float(0, car.path.len * 0.8);
    place(car);
    car.px = car.x;
    car.py = car.y;
    car.ph = car.h;
    car.v = car.top * 0.6;
    sim.cars.push(car);
  }

  // The tram: round the rails, slow and long.
  if (city.tram && city.tram.points.length > 2) {
    const pts = city.tram.points;
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push({ a, b, len, s0: total });
      total += len;
    }
    sim.tram = { kind: 'tram', len: 150, wid: 40, top: 85, v: 85, s: 0, total, segs, x: 0, y: 0, h: 0, px: 0, py: 0, ph: 0, color: '#2FA36B', bell: 0, wait: 0, creep: 0 };
    placeTram(sim.tram);
    sim.tram.px = sim.tram.x;
    sim.tram.py = sim.tram.y;
    sim.tram.ph = sim.tram.h;
  }

  function place(car) {
    const p = car.path.at(clamp(car.s, 0, car.path.len));
    car.x = p.x;
    car.y = p.y;
    car.h = wrapAngle(p.h);
  }

  function placeTram(tr) {
    const s = ((tr.s % tr.total) + tr.total) % tr.total;
    for (const g of tr.segs) {
      if (s <= g.s0 + g.len) {
        const k = (s - g.s0) / (g.len || 1);
        tr.x = g.a[0] + (g.b[0] - g.a[0]) * k;
        tr.y = g.a[1] + (g.b[1] - g.a[1]) * k;
        // Ease the heading round corners: look a little ahead.
        const s2 = s + 30;
        const ahead = pointOnTram(tr, s2);
        const back = pointOnTram(tr, s - 30);
        tr.h = Math.atan2(ahead[1] - back[1], ahead[0] - back[0]);
        return;
      }
    }
  }

  function pointOnTram(tr, s) {
    s = ((s % tr.total) + tr.total) % tr.total;
    for (const g of tr.segs) {
      if (s <= g.s0 + g.len) {
        const k = (s - g.s0) / (g.len || 1);
        return [g.a[0] + (g.b[0] - g.a[0]) * k, g.a[1] + (g.b[1] - g.a[1]) * k];
      }
    }
    return tr.segs[0].a;
  }

  /** People on zebra crossings at time t: each crossing has a group every 10 s, crossing for 3.4 s. */
  function walkersAt(t) {
    const out = [];
    for (const z of city.zebras) {
      const c = (t + z.offset) % 10;
      if (c > 3.4) continue;
      const k = c / 3.4;
      const n = town.rain ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const lag = i * 0.12;
        const kk = clamp((k - lag) / (1 - 0.24), 0, 1);
        const dir = (z.tx + z.ty + i) % 2 ? 1 : -1;
        const off = (kk - 0.5) * 128 * dir;
        const side = (i - (n - 1) / 2) * 16;
        const x = z.across === 'v' ? z.x + side : z.x + off;
        const y = z.across === 'v' ? z.y + off : z.y + side;
        out.push({ kind: 'walker', x, y, h: z.across === 'v' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI, len: 14, wid: 14, v: 0, walker: true, zebra: z, k: kk, i });
      }
    }
    return out;
  }

  function zebraBusy(z, t) {
    return (t + z.offset) % 10 < 3.6;
  }

  /** Is the way into the next tile shut for this car right now? */
  function stopAhead(car, t) {
    const remaining = car.path.len - car.s;
    if (remaining > 40) return false;
    const nx = car.tx + DX[car.e];
    const ny = car.ty + DY[car.e];
    const i = city.idx(nx, ny);
    const light = lightAt.get(i);
    if (light) {
      const ls = lightState(light, t);
      const axis = car.e === 0 || car.e === 2 ? 'v' : 'h';
      if (ls.axis !== axis || ls.color === 'red' || (ls.color === 'amber' && remaining > 10)) return true;
    }
    const z = zebraAt.get(i);
    if (z && zebraBusy(z, t)) return true;
    if (city.at(nx, ny) === 'd') {
      const b = bridgeState(t);
      if (b.up || b.warn) return true;
    }
    return false;
  }

  /** Something in front: the nearest gap to a vehicle in this one's cone (with a tie-break so two never wait for each other). */
  function blocked(me, others) {
    const gap = TRAFFIC.gap;
    const c = Math.cos(me.h);
    const s = Math.sin(me.h);
    for (const o of others) {
      if (o === me) continue;
      const dx = o.x - me.x;
      const dy = o.y - me.y;
      const reach = gap + (o.len + me.len) / 2 - 10;
      const d2 = dx * dx + dy * dy;
      if (d2 > reach * reach || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const cos = (dx * c + dy * s) / d;
      if (cos < TRAFFIC.cone) continue;
      // Do they see me too? Then the lower id (the tram first) goes.
      if (o.kind !== 'walker') {
        const oc = (-dx * Math.cos(o.h) - dy * Math.sin(o.h)) / d;
        if (oc >= TRAFFIC.cone && rank(me) < rank(o)) continue;
      }
      return true;
    }
    return false;
  }
  const rank = (v) => (v.kind === 'tram' ? -1 : v.id);

  /** Is something right against this one's nose? (What a creeping car still stops for.) */
  function touching(me, others) {
    const c = Math.cos(me.h);
    const s = Math.sin(me.h);
    for (const o of others) {
      if (o === me) continue;
      const dx = o.x - me.x;
      const dy = o.y - me.y;
      if (Math.abs(dx) > 200 || Math.abs(dy) > 200) continue;
      const along = dx * c + dy * s;
      if (along <= 0) continue;
      const across = Math.abs(-dx * s + dy * c);
      const dh = o.h - me.h;
      const ca = Math.abs(Math.cos(dh));
      const sa = Math.abs(Math.sin(dh));
      const extAlong = (ca * o.len + sa * o.wid) / 2;
      const extAcross = (sa * o.len + ca * o.wid) / 2;
      if (along < me.len / 2 + extAlong + 6 && across < me.wid / 2 + extAcross - 2) return true;
    }
    return false;
  }

  function stepOnce() {
    const t = sim.t;
    sim.walkers = walkersAt(t);
    const all = sim.tram ? [...sim.cars, sim.tram, ...sim.walkers] : [...sim.cars, ...sim.walkers];
    for (const car of sim.cars) {
      car.px = car.x;
      car.py = car.y;
      car.ph = car.h;
      let target = Math.min(car.top, car.path.curve > 0 ? (car.path.curve > 0.02 ? 70 : 100) : car.top);
      // Stuck too long behind other cars (a jam): creep on for a moment regardless of them. A creep that fails too (cars
      // nose to nose round a junction) becomes a ghost: it slips through them for a moment, so a jam never lasts.
      if (car.creep > 0) car.creep -= STEP;
      if (car.ghost > 0) car.ghost -= STEP;
      const held = stopAhead(car, t);
      if (held || (car.ghost > 0 ? false : car.creep <= 0 ? blocked(car, all) : touching(car, all))) target = 0;
      if (car.v < target) car.v = Math.min(target, car.v + 220 * STEP);
      else car.v = Math.max(target, car.v - 700 * STEP);
      car.wait = car.v < 5 && !held ? car.wait + STEP : 0;
      if (car.v > 40) car.jams = 0;
      if (car.wait > 4 + (car.id % 5) * 0.3) {
        car.wait = 0;
        car.jams = (car.jams || 0) + 1;
        if (car.jams >= 2) car.ghost = 1.2;
        else car.creep = 1.2;
      }
      car.s += car.v * STEP;
      while (car.s >= car.path.len) {
        const over = car.s - car.path.len;
        enter(car, car.tx + DX[car.e], car.ty + DY[car.e], car.e);
        car.s = over;
      }
      place(car);
    }
    if (sim.tram) {
      const tr = sim.tram;
      tr.px = tr.x;
      tr.py = tr.y;
      tr.ph = tr.h;
      if (tr.creep > 0) tr.creep -= STEP;
      const target = (tr.creep <= 0 ? blocked(tr, all) : touching(tr, all)) ? 0 : tr.top;
      tr.wait = tr.v < 5 ? tr.wait + STEP : 0;
      if (tr.wait > 3) {
        tr.wait = 0;
        tr.creep = 1.5;
      }
      tr.v = target > tr.v ? Math.min(target, tr.v + 120 * STEP) : Math.max(target, tr.v - 500 * STEP);
      tr.s += tr.v * STEP;
      tr.bell = tr.v < 20 ? tr.bell + STEP : 0;
      placeTram(tr);
    }
    sim.t = Math.round((t + STEP) * 1e6) / 1e6;
  }

  /** Step until the traffic clock reaches t (seconds since the shift started); bodies(t) then lerps between the last two steps. */
  sim.advanceTo = (t) => {
    let guard = 0;
    while (sim.t < t - 1e-9 && guard++ < 20000) stepOnce();
  };

  /** Everything a van can hit, interpolated to time t (between the last two steps). */
  sim.bodies = (t = sim.t) => {
    const k = clamp(1 - (sim.t - t) / STEP, 0, 1);
    const out = [];
    for (const c of sim.cars) out.push(lerpBody(c, k));
    if (sim.tram) out.push(lerpBody(sim.tram, k));
    for (const w of sim.walkers) out.push(w);
    return out;
  };

  function lerpBody(c, k) {
    const dh = wrapAngle(c.h - c.ph);
    return { kind: c.kind, x: c.px + (c.x - c.px) * k, y: c.py + (c.y - c.py) * k, h: c.ph + dh * k, len: c.len, wid: c.wid, v: c.v, color: c.color, id: c.id, bell: c.bell };
  }

  sim.walkersAt = walkersAt;
  return sim;
}
