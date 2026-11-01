// Solo rules: which houses a shift delivers to, loading at the depot, passes through rings (and doormats), the clock, stars,
// and the moments badges care about. The same rules score the scramble's passes. Pure: no page, no platform.

import { DELIVERY, STARS, DEG } from './config.js';
import { createRng, hashString } from './rng.js';
import { inDepot } from './physics.js';
import { closureSet, closedTiles } from './city.js';
import { dijkstra, bestTo, dropTile } from './route.js';
import { graphFor } from './driver.js';

/** A shift's houses, in the order they load. Fixed per town; the daily's come from the date. */
export function shiftHouses(city, opts = {}) {
  const town = city.town;
  const count = opts.parcels || (opts.daily !== undefined ? DAILY_PARCELS : town.parcels);
  const seed = opts.daily !== undefined ? hashString(`daily:${opts.daily}:${town.id}`) : hashString(`shift:${town.id}`);
  const rng = createRng(seed);
  const pool = city.addresses.slice();
  const first = [];
  if (opts.daily === undefined && town.tutorial) {
    for (const [tx, ty] of town.tutorial) {
      const h = pool.find((p) => p.tx === tx && p.ty === ty);
      if (h) first.push(h);
    }
  }
  const rest = rng.shuffle(pool.filter((h) => !first.includes(h)));
  // Roadworks: never a house on a street the cones can turn into a dead end (loads top up, so any set may be out).
  const traps = trapHouses(city);
  const trapped = (h) => traps.has(h.id);
  // Spread them out: never two drops within 200 px in the same load.
  const out = first.slice();
  for (const h of rest) {
    if (out.length >= count) break;
    const load = out.slice(out.length - (out.length % DELIVERY.perLoad));
    if (load.some((o) => Math.hypot(o.dropX - h.dropX, o.dropY - h.dropY) < 200)) continue;
    if (trapped(h)) continue;
    out.push(h);
  }
  for (const h of rest) {
    if (out.length >= count) break;
    if (!out.includes(h) && !trapped(h)) out.push(h);
  }
  return out;
}

const trapSets = new Map();
/**
 * Houses on a street that a closure set turns into a dead end: arriving there, some way in has no way back to the depot in
 * right turns. Without `k`, the houses any set traps. Only Coneyard has closures.
 */
export function trapHouses(city, k = 0) {
  const key = `${city.id}:${k}`;
  let set = trapSets.get(key);
  if (set) return set;
  set = new Set();
  if (!k && city.town.cones) for (const j of [1, 2, 3]) for (const id of trapHouses(city, j)) set.add(id);
  if (k) {
    const graph = graphFor(city, closedTiles(city, k), `k${k}`);
    const depotTile = city.idx(city.depot.tx, city.depot.ty);
    const fromDepot = dijkstra(graph, depotTile * 4 + city.depot.dir);
    for (const h of city.addresses) {
      const tile = dropTile(city, h);
      if (!Number.isFinite(bestTo(fromDepot, tile).time)) {
        set.add(h.id);
        continue;
      }
      for (let d = 0; d < 4; d++) {
        if (!Number.isFinite(fromDepot.dist[tile * 4 + d])) continue;
        if (!Number.isFinite(bestTo(dijkstra(graph, tile * 4 + d), depotTile).time)) {
          set.add(h.id);
          break;
        }
      }
    }
  }
  trapSets.set(key, set);
  return set;
}

export const DAILY_PARCELS = 9;

/** Today's daily shift: a town (any of them) from the day number. */
export function dailyTown(day, towns) {
  return towns[hashString(`daily:${day}`) % towns.length];
}

/** Stars for a final time against the town's expert time. */
export function starsFor(time, expert) {
  if (!Number.isFinite(time)) return 0;
  if (!expert) return 1;
  if (time <= expert * STARS.three) return 3;
  if (time <= expert * STARS.two) return 2;
  return 1;
}

/** Star thresholds in seconds (for the town card). */
export function starTimes(expert) {
  return { two: expert * STARS.two, three: expert * STARS.three };
}

/**
 * Track one van's passes through a set of rings. `step(van, lit)` returns the houses it delivered to this step:
 * [{ house, mat, x, y, d, v }]. A pass counts at its closest point to the drop.
 */
export function createPassTracker() {
  const passes = new Map(); // house id → { minD, v, x, y }
  return {
    step(van, lit) {
      const out = [];
      for (const house of lit) {
        const d = Math.hypot(van.x - house.dropX, van.y - house.dropY);
        const p = passes.get(house.id);
        if (d < DELIVERY.ring) {
          if (!p) passes.set(house.id, { minD: d, v: van.v, x: van.x, y: van.y });
          else if (d < p.minD) {
            p.minD = d;
            p.v = van.v;
            p.x = van.x;
            p.y = van.y;
          } else if (d > p.minD + 3 && van.v > 20) {
            out.push(done(house, p));
          }
        } else if (p) out.push(done(house, p));
      }
      for (const o of out) passes.delete(o.house.id);
      // Forget passes for houses no longer lit.
      for (const id of passes.keys()) if (!lit.some((h) => h.id === id)) passes.delete(id);
      return out;
    },
    reset() {
      passes.clear();
    },
  };
}

function done(house, p) {
  return { house, mat: isMat(p.minD, p.v), x: p.x, y: p.y, d: p.minD, v: p.v };
}

export const isMat = (d, v) => d <= DELIVERY.mat && v <= DELIVERY.matSpeed;

/**
 * A solo shift. opts: { daily }. Call `start()` at GO, then `step(van, dt)` every simulation step; it returns events:
 * { type: 'drop', house, mat, x, y } | { type: 'load', houses } | { type: 'done', time, final, mats } |
 * { type: 'closures', k } | { type: 'feat', id } (badge moments: three-rights, roundabout-regular).
 */
export function createShift(city, opts = {}) {
  const houses = opts.houses || shiftHouses(city, opts);
  const tracker = createPassTracker();
  const s = {
    city,
    houses,
    queue: houses.slice(),
    lit: [],
    delivered: [],
    mats: 0,
    crashes: 0,
    clock: 0,
    running: false,
    finished: false,
    reloads: 0,
    closureK: city.town.cones ? closureSet(0) : 0,
    closed: new Set(),
    trail: [],
    turns: [], // recent held turns: [time, radians]
    lapTurn: 0,
    lapZone: null,
    lastHold: false,
    holdStart: 0,
  };
  s.closed = closedTiles(city, s.closureK);

  // The first load is on the van at the start.
  s.lit = s.queue.splice(0, DELIVERY.perLoad);

  s.start = () => {
    s.running = true;
    s.clock = 0;
  };

  s.step = (van, dt, crashed = false) => {
    const events = [];
    if (!s.running || s.finished) return events;
    s.clock += dt;
    if (crashed) {
      s.crashes++;
      s.turns.length = 0;
    }
    // Deliveries.
    for (const p of tracker.step(van, s.lit)) {
      s.lit = s.lit.filter((h) => h !== p.house);
      s.delivered.push({ house: p.house, mat: p.mat, t: s.clock });
      if (p.mat) s.mats++;
      events.push({ type: 'drop', house: p.house, mat: p.mat, x: p.x, y: p.y, d: p.d, v: p.v });
    }
    // Loading: passing through the depot tops the van up.
    if (s.queue.length && s.lit.length < DELIVERY.perLoad && inDepot(van, city.depot, DELIVERY.depotZone)) {
      const add = s.queue.splice(0, DELIVERY.perLoad - s.lit.length);
      s.lit = s.lit.concat(add);
      s.reloads++;
      events.push({ type: 'load', houses: add });
      if (city.town.cones) {
        s.closureK = closureSet(s.reloads);
        s.closed = closedTiles(city, s.closureK);
        events.push({ type: 'closures', k: s.closureK });
      }
    }
    // Feats.
    if (van.hold && !s.lastHold) s.holdStart = van.turned;
    if (!van.hold && s.lastHold) {
      const amount = van.turned - s.holdStart;
      if (amount >= 60 * DEG && !van.zone) {
        s.turns.push([s.clock, amount]);
        while (s.turns.length > 3) s.turns.shift();
        if (s.turns.length === 3 && s.clock - s.turns[0][0] <= 6 && s.turns.reduce((a, b) => a + b[1], 0) >= 260 * DEG) {
          events.push({ type: 'feat', id: 'three-rights' });
          s.turns.length = 0;
        }
      }
    }
    s.lastHold = van.hold;
    if (van.zone && van.zone.kind === 'plaza') {
      if (s.lapZone !== van.zone) {
        s.lapZone = van.zone;
        s.lapTurn = van.turned;
      } else if (van.turned - s.lapTurn >= Math.PI * 2) {
        events.push({ type: 'feat', id: 'roundabout-regular' });
        s.lapTurn = Infinity;
      }
    } else s.lapZone = null;
    // Trail for the results map (2 Hz is plenty).
    if (!s.trail.length || s.clock - s.trail[s.trail.length - 1][2] >= 0.5) s.trail.push([Math.round(van.x), Math.round(van.y), s.clock, van.zone ? 1 : 0]);
    // Done when the last parcel lands.
    if (!s.lit.length && !s.queue.length) {
      s.finished = true;
      s.running = false;
      const final = Math.max(0, s.clock - s.mats * DELIVERY.matBonus);
      events.push({ type: 'done', time: s.clock, final, mats: s.mats });
    }
    return events;
  };

  /** Final time so far (the clock less the doormat seconds). */
  s.final = () => Math.max(0, s.clock - s.mats * DELIVERY.matBonus);
  /** What the van should head for: the lit houses, or the depot when empty. */
  s.needsDepot = () => !s.lit.length && s.queue.length > 0;
  return s;
}


/**
 * The shortest the shift could take in right turns: each load in its best order, from the depot and back, at the van's
 * speeds along the right-turn graph (rings are passed at their middle). A lower bound in spirit: real driving adds corners.
 */
export function routeEstimate(city, houses, graphAt) {
  const loads = [];
  for (let i = 0; i < houses.length; i += DELIVERY.perLoad) loads.push(houses.slice(i, i + DELIVERY.perLoad));
  const depotTile = city.idx(city.depot.tx, city.depot.ty);
  let node = depotTile * 4 + city.depot.dir;
  let total = 0;
  const caches = new Map();
  const from = (graph, n) => {
    let cache = caches.get(graph);
    if (!cache) caches.set(graph, (cache = new Map()));
    let r = cache.get(n);
    if (!r) {
      r = dijkstra(graph, n);
      cache.set(n, r);
    }
    return r;
  };
  loads.forEach((load, li) => {
    const graph = graphAt(li);
    const last = li === loads.length - 1;
    let best = Infinity;
    let bestEnd = node;
    for (const order of permutations(load)) {
      let t = 0;
      let n = node;
      for (const h of order) {
        const b = bestTo(from(graph, n), dropTile(city, h));
        t += b.time;
        n = b.node;
      }
      if (!last) {
        const b = bestTo(from(graph, n), depotTile);
        t += b.time;
        n = b.node;
      }
      if (t < best) {
        best = t;
        bestEnd = n;
      }
    }
    total += best;
    node = bestEnd;
  });
  return total;
}

function permutations(list) {
  if (list.length <= 1) return [list];
  const out = [];
  list.forEach((x, i) => {
    for (const rest of permutations(list.filter((_, j) => j !== i))) out.push([x, ...rest]);
  });
  return out;
}

/** The least final time a shift could honestly post (the daily list ignores anything quicker). */
export function minPlausible(estimate, parcels) {
  return Math.max(5, estimate * 0.6 - parcels * DELIVERY.matBonus);
}
