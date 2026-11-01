// A town's map turned into geometry: what is road, what is solid, the houses and their drop points, the depot, the loop zones
// (roundabouts and cul-de-sac bulbs), lights, puddles, trees, closures, tram rails and drawbridges. Pure: no page, no platform.

import { T, DX, DY, DIR_HEADING, LOOP, DELIVERY, TRAFFIC } from './config.js';
import { createRng, hashString } from './rng.js';

const ROADISH = new Set(['.', 'L', 'z', '~', 'k', 'O', 'c', 'D', '=', 'd', 'r', 'R', '1', '2', '3']);
const PARKISH = new Set(['p', 't']);
const LOTS = new Set(['h', 'b', 'g', 'x', 'Q', 'w']);

export const isRoadChar = (ch) => ROADISH.has(ch);
export const isParkChar = (ch) => PARKISH.has(ch);

/** Build the geometry of a town (from towns.js). */
export function buildCity(town) {
  const map = town.map;
  const h = map.length;
  const w = map[0].length;
  const chars = [];
  for (let y = 0; y < h; y++) {
    if (map[y].length !== w) throw new Error(`${town.name}: row ${y} is ${map[y].length} wide, not ${w}`);
    for (let x = 0; x < w; x++) chars.push(map[y][x]);
  }
  const at = (tx, ty) => (tx < 0 || ty < 0 || tx >= w || ty >= h ? 'x' : chars[ty * w + tx]);
  const idx = (tx, ty) => ty * w + tx;
  const rng = createRng(hashString(`town:${town.id}`));

  const city = {
    town,
    id: town.id,
    w,
    h,
    W: w * T,
    H: h * T,
    chars,
    at,
    idx,
    loops: [],
    cut: new Map(), // tile index → loop zone whose circle frees part of this lot
    houses: [],
    lights: [],
    zebras: [],
    puddles: [],
    trees: [],
    closures: { 1: [], 2: [], 3: [] },
    drawbridges: [],
    tram: null,
    depot: null,
    alleys: new Map(), // tile index → 'h' | 'v'
    soft: !!town.soft,
    snow: !!town.snow,
    seed: hashString(`town:${town.id}`),
  };

  // Loop zones: roundabouts (O) and bulbs (c), and the lots their circles cut into.
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const ch = at(tx, ty);
      if (ch !== 'O' && ch !== 'c') continue;
      const zone = { kind: ch === 'O' ? 'plaza' : 'bulb', tx, ty, x: (tx + 0.5) * T, y: (ty + 0.5) * T, r: ch === 'O' ? LOOP.plaza : LOOP.bulb };
      city.loops.push(zone);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!LOTS.has(at(nx, ny))) continue;
          // Does the circle reach into this tile?
          const cx = Math.max(nx * T, Math.min(zone.x, (nx + 1) * T));
          const cy = Math.max(ny * T, Math.min(zone.y, (ny + 1) * T));
          if (Math.hypot(cx - zone.x, cy - zone.y) < zone.r - 1) city.cut.set(idx(nx, ny), zone);
        }
      }
    }
  }

  // Alleys run between two roads.
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (at(tx, ty) !== 'a') continue;
      const horiz = (at(tx - 1, ty) === 'a' || ROADISH.has(at(tx - 1, ty))) && (at(tx + 1, ty) === 'a' || ROADISH.has(at(tx + 1, ty)));
      city.alleys.set(idx(tx, ty), horiz ? 'h' : 'v');
    }
  }

  // Features on road tiles.
  let lightN = 0;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const ch = at(tx, ty);
      const cx = (tx + 0.5) * T;
      const cy = (ty + 0.5) * T;
      if (ch === 'L' || ch === 'R') city.lights.push({ tx, ty, x: cx, y: cy, offset: ((lightN++ * 5.3) % 16) });
      if (ch === 'z') {
        const horizRoad = ROADISH.has(at(tx - 1, ty)) || ROADISH.has(at(tx + 1, ty));
        city.zebras.push({ tx, ty, x: cx, y: cy, across: horizRoad ? 'v' : 'h', offset: rng.float(0, 9) });
      }
      if (ch === '~') city.puddles.push({ x: cx + rng.float(-22, 22), y: cy + rng.float(-22, 22), r: 30 + rng.float(0, 8) });
      if (ch === '1' || ch === '2' || ch === '3') city.closures[ch].push({ tx, ty });
      if (ch === 'd') city.drawbridges.push({ tx, ty, x: cx, y: cy, axis: ROADISH.has(at(tx - 1, ty)) ? 'h' : 'v' });
      if (ch === 't') city.trees.push({ x: cx + rng.float(-14, 14), y: cy + rng.float(-14, 14), r: 24 });
      if (ch === 'D') {
        city.depot = { tx, ty, x: cx, y: cy, dir: town.start ?? 0, heading: DIR_HEADING[town.start ?? 0] };
      }
    }
  }
  if (!city.depot) throw new Error(`${town.name}: no depot`);

  // Tram: the rails form one loop.
  if (town.tram) city.tram = traceRails(city);

  // Houses: a lot with a road beside it faces that road. The drop point is on the road, 24 px out from the kerb.
  const tutorialFace = new Map((town.tutorial || []).map(([tx, ty, face]) => [idx(tx, ty), face]));
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const ch = at(tx, ty);
      if (ch !== 'h' && ch !== 'b') continue;
      if (city.cut.has(idx(tx, ty))) continue;
      const faces = [];
      for (const d of [2, 1, 3, 0]) {
        const n = at(tx + DX[d], ty + DY[d]);
        if (!addressRoad(n)) continue;
        // A drop point inside a loop zone's circle would be crowded: skip.
        const dx = (tx + 0.5 + DX[d] * 0.5) * T + DX[d] * DELIVERY.dropOff;
        const dy = (ty + 0.5 + DY[d] * 0.5) * T + DY[d] * DELIVERY.dropOff;
        if (city.loops.some((z) => Math.hypot(dx - z.x, dy - z.y) < z.r + 30)) continue;
        if (Math.hypot(dx - city.depot.x, dy - city.depot.y) < 150) continue;
        faces.push(d);
      }
      const want = tutorialFace.get(idx(tx, ty));
      let face = want !== undefined && faces.includes(want) ? want : faces.length ? faces[hashString(`${town.id}:${tx}:${ty}`) % faces.length] : -1;
      const house = makeHouse(city, tx, ty, ch, face, rng);
      house.id = city.houses.length;
      city.houses.push(house);
    }
  }
  city.addresses = city.houses.filter((hs) => hs.face >= 0);
  return city;
}

function addressRoad(ch) {
  return ch === '.' || ch === 'L' || ch === 'z' || ch === '~' || ch === 'r' || ch === 'R';
}

function makeHouse(city, tx, ty, kind, face, rng) {
  const x0 = tx * T;
  const y0 = ty * T;
  const house = { tx, ty, kind, face, x: x0 + T / 2, y: y0 + T / 2, roof: rng.int(5), seed: rng.int(1e9) };
  if (face >= 0) {
    // The drop point on the road, and the doormat on the lot just inside the kerb.
    const ex = x0 + T / 2 + DX[face] * (T / 2);
    const ey = y0 + T / 2 + DY[face] * (T / 2);
    house.dropX = ex + DX[face] * DELIVERY.dropOff;
    house.dropY = ey + DY[face] * DELIVERY.dropOff;
    house.matX = ex - DX[face] * 30;
    house.matY = ey - DY[face] * 30;
    house.doorX = ex - DX[face] * 40;
    house.doorY = ey - DY[face] * 40;
  }
  return house;
}

function traceRails(city) {
  const rail = (tx, ty) => {
    const ch = city.at(tx, ty);
    return ch === 'r' || ch === 'R';
  };
  let start = null;
  for (let ty = 0; ty < city.h && !start; ty++) for (let tx = 0; tx < city.w && !start; tx++) if (rail(tx, ty)) start = [tx, ty];
  if (!start) return null;
  const pts = [];
  let [cx, cy] = start;
  let prev = null;
  for (let guard = 0; guard < 500; guard++) {
    pts.push([(cx + 0.5) * T, (cy + 0.5) * T]);
    let moved = false;
    // Clockwise preference keeps the walk deterministic.
    for (const d of [1, 2, 3, 0]) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (!rail(nx, ny)) continue;
      if (prev && prev[0] === nx && prev[1] === ny) continue;
      prev = [cx, cy];
      cx = nx;
      cy = ny;
      moved = true;
      break;
    }
    if (!moved || (cx === start[0] && cy === start[1])) break;
  }
  return { points: pts };
}

// ---------------------------------------------------------------- queries

/** Is a tile something a van can drive on (closures and drawbridges aside)? */
export function tileDrivable(city, tx, ty) {
  const ch = city.at(tx, ty);
  return ROADISH.has(ch) || PARKISH.has(ch) || ch === 'a';
}

/** The loop zone a point is in, or null. */
export function loopAt(city, x, y) {
  for (const z of city.loops) if ((x - z.x) * (x - z.x) + (y - z.y) * (y - z.y) < z.r * z.r) return z;
  return null;
}

/** Is a world point inside something solid (for spawns, bots and tests)? `closed` is the set of closed tiles. */
export function solidAt(city, x, y, env = null) {
  const tx = Math.floor(x / T);
  const ty = Math.floor(y / T);
  if (tx < 0 || ty < 0 || tx >= city.w || ty >= city.h) return true;
  const ch = city.at(tx, ty);
  const i = city.idx(tx, ty);
  if (LOTS.has(ch)) {
    const zone = city.cut.get(i);
    return !(zone && Math.hypot(x - zone.x, y - zone.y) < zone.r);
  }
  if (ch === 't') return city.trees.some((tr) => Math.hypot(x - tr.x, y - tr.y) < tr.r);
  if (ch === 'a') {
    const o = city.alleys.get(i);
    const lx = x - (tx + 0.5) * T;
    const ly = y - (ty + 0.5) * T;
    return o === 'h' ? Math.abs(ly) > 30 : Math.abs(lx) > 30;
  }
  if (env && env.closed && env.closed.has(i)) return true;
  if (env && env.bridgeUp && ch === 'd') return true;
  return false;
}

export const isGrass = (city, x, y) => PARKISH.has(city.at(Math.floor(x / T), Math.floor(y / T)));

/**
 * Push a circle out of everything solid near it. Returns { x, y, soft } (the push, summed) or null.
 * env: { closed: Set of closed tile indices, bridgeUp: bool }.
 */
export function pushOut(city, px, py, r, env) {
  let ox = 0;
  let oy = 0;
  let hit = false;
  let soft = false;
  const tx0 = Math.floor((px - r) / T);
  const tx1 = Math.floor((px + r) / T);
  const ty0 = Math.floor((py - r) / T);
  const ty1 = Math.floor((py + r) / T);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const out = tx < 0 || ty < 0 || tx >= city.w || ty >= city.h;
      const ch = out ? 'x' : city.at(tx, ty);
      const i = out ? -1 : city.idx(tx, ty);
      let solidBox = false;
      let cones = false;
      if (LOTS.has(ch)) solidBox = true;
      else if (env && env.closed && i >= 0 && env.closed.has(i)) solidBox = cones = true;
      else if (env && env.bridgeUp && ch === 'd') solidBox = true;
      if (solidBox) {
        const zone = i >= 0 ? city.cut.get(i) : null;
        const p = zone ? pushCutBox(px, py, r, tx, ty, zone) : pushBox(px, py, r, tx * T, ty * T, (tx + 1) * T, (ty + 1) * T);
        if (p) {
          ox += p[0];
          oy += p[1];
          hit = true;
          if (cones || (city.soft && ch !== 'w' && ch !== 'Q')) soft = true;
        }
        continue;
      }
      if (ch === 'a') {
        const o = city.alleys.get(i);
        const x0 = tx * T;
        const y0 = ty * T;
        const boxes = o === 'h' ? [[x0, y0, x0 + T, y0 + 30], [x0, y0 + 90, x0 + T, y0 + T]] : [[x0, y0, x0 + 30, y0 + T], [x0 + 90, y0, x0 + T, y0 + T]];
        for (const b of boxes) {
          const p = pushBox(px, py, r, b[0], b[1], b[2], b[3]);
          if (p) {
            ox += p[0];
            oy += p[1];
            hit = true;
          }
        }
      }
    }
  }
  for (const tr of city.trees) {
    const dx = px - tr.x;
    const dy = py - tr.y;
    const d = Math.hypot(dx, dy);
    if (d < tr.r + r && d > 1e-6) {
      const k = (tr.r + r - d) / d;
      ox += dx * k;
      oy += dy * k;
      hit = true;
      soft = soft || city.soft;
    }
  }
  return hit ? { x: ox, y: oy, soft } : null;
}

function pushBox(px, py, r, x0, y0, x1, y1) {
  const cx = Math.max(x0, Math.min(px, x1));
  const cy = Math.max(y0, Math.min(py, y1));
  let dx = px - cx;
  let dy = py - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    return [dx * k, dy * k];
  }
  // Centre inside the box: out the nearest side.
  const l = px - x0;
  const rr = x1 - px;
  const t = py - y0;
  const b = y1 - py;
  const m = Math.min(l, rr, t, b);
  if (m === l) return [-(l + r), 0];
  if (m === rr) return [rr + r, 0];
  if (m === t) return [0, -(t + r)];
  return [0, b + r];
}

/** A lot cut by a loop zone's circle: solid only outside the circle. */
function pushCutBox(px, py, r, tx, ty, zone) {
  const dx = px - zone.x;
  const dy = py - zone.y;
  const d = Math.hypot(dx, dy);
  if (d < zone.r) {
    // Inside the free circle: only the arc can touch, where it runs through this tile.
    if (d + r <= zone.r) return null;
    const ax = zone.x + (dx / (d || 1)) * zone.r;
    const ay = zone.y + (dy / (d || 1)) * zone.r;
    if (ax < tx * T - 2 || ax > (tx + 1) * T + 2 || ay < ty * T - 2 || ay > (ty + 1) * T + 2) return null;
    const k = (d + r - zone.r) / (d || 1);
    return [-dx * k, -dy * k];
  }
  const p = pushBox(px, py, r, tx * T, ty * T, (tx + 1) * T, (ty + 1) * T);
  if (!p) return null;
  // Only the part of the box outside the circle is solid: ignore a push from a box point that is inside it.
  const bx = Math.max(tx * T, Math.min(px, (tx + 1) * T));
  const by = Math.max(ty * T, Math.min(py, (ty + 1) * T));
  if (Math.hypot(bx - zone.x, by - zone.y) < zone.r - 1) return null;
  return p;
}

// ---------------------------------------------------------------- traffic lanes and lights

/** Light phase at time t for a light: which axis has green ('v' north-south, 'h' east-west), and amber. */
export function lightState(light, t) {
  const L = TRAFFIC.light;
  const half = L.green + L.amber + L.allRed;
  const cyc = (t + light.offset) % (half * 2);
  const axis = cyc < half ? 'v' : 'h';
  const local = cyc < half ? cyc : cyc - half;
  if (local < L.green) return { axis, color: 'green' };
  if (local < L.green + L.amber) return { axis, color: 'amber' };
  return { axis, color: 'red' };
}

/** Is a drawbridge raised at time t (and are its bells ringing)? */
export function bridgeState(t) {
  const c = t % 30;
  return { up: c >= 24, warn: c >= 22.5 && c < 24, lift: c >= 24 ? Math.min(1, (c - 24) / 1, (30 - c) / 1) : 0 };
}

/** Which closure set is out: solo by load (0, 1, 2…), multiplayer by time. */
export const closureSet = (n) => (n % 3) + 1;

/** The set of closed tile indices for closure set k. */
export function closedTiles(city, k) {
  const s = new Set();
  if (!k) return s;
  for (const c of city.closures[k] || []) s.add(city.idx(c.tx, c.ty));
  return s;
}

/** Map validation: problems a right-turn-only van would hit (dead ends without a loop, L corners). Used by tests. */
export function mapProblems(city) {
  const out = [];
  for (let ty = 0; ty < city.h; ty++) {
    for (let tx = 0; tx < city.w; tx++) {
      const ch = city.at(tx, ty);
      if (!ROADISH.has(ch) || ch === 'O' || ch === 'c') continue;
      const n = [0, 1, 2, 3].filter((d) => tileDrivable(city, tx + DX[d], ty + DY[d]));
      if (n.length <= 1) out.push(`${tx},${ty} '${ch}' is a dead end`);
      else if (n.length === 2 && (n[1] - n[0]) % 2 === 1) out.push(`${tx},${ty} '${ch}' is an L corner`);
    }
  }
  return out;
}
