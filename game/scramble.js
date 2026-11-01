// Shift Scramble rules: which addresses are open, where a new one lights up, the golden last call, checking and scoring a
// delivery claim, and one van's step (passes and reloads). The host's page and the tests use the same functions.
// Pure: no page, no platform.

import { T, DELIVERY, SCRAMBLE, KNOCK, openAddresses } from './config.js';
import { dijkstra, stateOf, bestTo, dropTile } from './route.js';
import { stepVan, inDepot, createVan } from './physics.js';
import { createPassTracker } from './shift.js';
import { closureSet, tileDrivable } from './city.js';

export const ADDR_ID = /^a\d{1,6}$/;
export const LOOSE_ID = /^l\d{1,6}$/;
export const MAX_LOG = 12;

/** A shift's shared state (what the host keeps in match.data). */
export function newScramble(townId) {
  return { town: townId, addrs: [], seq: 0, pts: {}, mats: {}, log: [], lastCall: false, loose: [] };
}

/** Coneyard's roadworks in a scramble move every 40 s of the shift. */
export const scrambleClosure = (seconds) => closureSet(Math.floor(seconds / 40));

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** A house for a new address: never on one that's open, at least 480 px from every van when the town allows it. */
export function pickHouse(city, data, vans, rand, clearOf = SCRAMBLE.spawnClear, avoid = null) {
  const open = new Set(data.addrs.map((a) => a.house));
  const recent = new Set(data.log.slice(-3).map((l) => l[1]));
  const cands = city.addresses.filter((h) => !open.has(h.id) && !recent.has(h.id) && !(avoid && avoid.has(h.id)));
  if (!cands.length) return null;
  const spaced = (h) =>
    data.addrs.every((a) => {
      const o = city.houses[a.house];
      return !o || dist(o.dropX, o.dropY, h.dropX, h.dropY) >= 240;
    });
  for (let r = clearOf; r >= 0; r -= 120) {
    const ok = cands.filter((h) => spaced(h) && vans.every((v) => dist(v.x, v.y, h.dropX, h.dropY) >= r));
    if (ok.length) return ok[Math.floor(rand() * ok.length) % ok.length];
  }
  return cands[Math.floor(rand() * cands.length) % cands.length];
}

/** Top the open addresses up to the count for this many seats (the golden one doesn't count). */
export function fillAddresses(city, data, vans, rand, seats, avoid = null) {
  const want = openAddresses(seats);
  let guard = 0;
  while (data.addrs.filter((a) => !a.gold).length < want && guard++ < 10) {
    const h = pickHouse(city, data, vans, rand, SCRAMBLE.spawnClear, avoid);
    if (!h) break;
    data.seq++;
    data.addrs.push({ id: `a${data.seq}`, house: h.id, gold: false });
  }
  return data;
}

/**
 * The last call's house: the one whose right-turn travel times from every van are closest together, reachable in time.
 * vans: [{ x, y, h }].
 */
export function lastCallHouse(city, graph, data, vans, avoid = null) {
  if (!vans.length) return null;
  const open = new Set(data.addrs.map((a) => a.house));
  if (avoid) for (const id of avoid) open.add(id);
  const results = vans.map((v) => dijkstra(graph, stateOf(city, v.x, v.y, v.h)));
  let best = null;
  let bestScore = Infinity;
  for (const h of city.addresses) {
    if (open.has(h.id)) continue;
    if (vans.some((v) => dist(v.x, v.y, h.dropX, h.dropY) < 300)) continue;
    const tile = dropTile(city, h);
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    for (const r of results) {
      const t = bestTo(r, tile).time;
      if (!Number.isFinite(t)) {
        hi = Infinity;
        break;
      }
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
      sum += t;
    }
    if (!Number.isFinite(hi)) continue;
    const mean = sum / results.length;
    const score = hi - lo + Math.max(0, 5 - mean) * 2 + Math.max(0, hi - 15) * 3;
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

/** Light the golden address. */
export function openLastCall(city, graph, data, vans, rand, avoid = null) {
  if (data.lastCall) return null;
  const h = lastCallHouse(city, graph, data, vans, avoid) || pickHouse(city, data, vans, rand, 300, avoid);
  data.lastCall = true;
  if (!h) return null;
  data.seq++;
  const a = { id: `a${data.seq}`, house: h.id, gold: true };
  data.addrs.push(a);
  return a;
}

/**
 * Is a delivery claim good? claim: { addr, mat }. who: { playing, parcels, x, y } (the sender's latest known van).
 * Returns null when it is, or why not.
 */
export function checkClaim(city, data, claim, who) {
  if (!who || !who.playing) return 'not-playing';
  if (!claim || typeof claim.addr !== 'string' || !ADDR_ID.test(claim.addr)) return 'bad';
  const a = data.addrs.find((x) => x.id === claim.addr);
  if (!a) return 'closed';
  if (!(who.parcels > 0)) return 'empty';
  const h = city.houses[a.house];
  if (!h || !Number.isFinite(who.x) || !Number.isFinite(who.y)) return 'bad';
  if (dist(who.x, who.y, h.dropX, h.dropY) > SCRAMBLE.claimReach) return 'far';
  return null;
}

/** Points for a delivery. */
export const pointsFor = (gold, mat) => (gold ? SCRAMBLE.goldPoints : 1) + (mat ? 1 : 0);

/**
 * Score a delivery and close the address (the caller tops the addresses back up). Returns the log entry.
 * log entries: [seat, house, mat 0|1, gold 0|1, ms].
 */
export function applyDrop(data, seat, addrId, mat, ms) {
  const i = data.addrs.findIndex((a) => a.id === addrId);
  if (i < 0) return null;
  const a = data.addrs[i];
  data.addrs.splice(i, 1);
  data.pts[seat] = (data.pts[seat] || 0) + pointsFor(a.gold, mat);
  if (mat) data.mats[seat] = (data.mats[seat] || 0) + 1;
  const entry = [seat, a.house, mat ? 1 : 0, a.gold ? 1 : 0, Math.max(0, Math.round(ms) || 0)];
  data.log.push(entry);
  while (data.log.length > MAX_LOG) data.log.shift();
  return entry;
}

// ------------------------------------------------------------------ knock-offs

/**
 * How hard `other` drove into `me`: its speed straight at me (px/s, along the line between the two). A knock-off at
 * KNOCK.speed or more. Only the van that was hit loses a parcel: ram a van from behind or the side and you keep yours; meet
 * head on and you both lose one.
 */
export function hitSpeed(me, other) {
  const dx = me.x - other.x;
  const dy = me.y - other.y;
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-6) || !Number.isFinite(other.v) || !Number.isFinite(other.h)) return 0;
  return (other.v * (Math.cos(other.h) * dx + Math.sin(other.h) * dy)) / d;
}

/**
 * After a bump with `other`: does this runner lose a parcel? (It has one, it isn't cooling down, the hit was hard, and it
 * isn't at the depot, where everyone crowds in to load.)
 */
export function knockedBy(r, other, city = null) {
  if (city && dist(r.van.x, r.van.y, city.depot.x, city.depot.y) < KNOCK.depotSafe) return false;
  return r.p > 0 && !(r.knockT > 0) && hitSpeed(r.van, other) >= KNOCK.speed;
}

/** A parcel knocked into the road at x, y (match time ms). The oldest goes when there are too many. Returns it. */
export function addLoose(data, x, y, ms) {
  if (!Array.isArray(data.loose)) data.loose = [];
  data.seq++;
  const l = { id: `l${data.seq}`, x: Math.round(x), y: Math.round(y), at: Math.max(0, Math.round(ms) || 0) };
  data.loose.push(l);
  while (data.loose.length > KNOCK.max) data.loose.shift();
  return l;
}

/** Drop loose parcels that have lain too long. True when any went. */
export function expireLoose(data, ms) {
  if (!Array.isArray(data.loose) || !data.loose.length) return false;
  const keep = data.loose.filter((l) => ms - l.at < KNOCK.life * 1000);
  if (keep.length === data.loose.length) return false;
  data.loose = keep;
  return true;
}

/** Can this van grab that loose parcel? who: { playing, x, y }. Null when it can, or why not. */
export function checkGrab(data, id, who, ms) {
  if (!who || !who.playing) return 'not-playing';
  if (typeof id !== 'string' || !LOOSE_ID.test(id)) return 'bad';
  const l = (data.loose || []).find((x) => x.id === id);
  if (!l) return 'gone';
  if (ms - l.at < KNOCK.settle * 1000 - 250) return 'flying';
  if (!Number.isFinite(who.x) || !Number.isFinite(who.y)) return 'bad';
  if (dist(who.x, who.y, l.x, l.y) > KNOCK.claimReach) return 'far';
  return null;
}

/** Take a loose parcel out of the road. Returns it (null when it had gone). */
export function applyGrab(data, id) {
  const i = (data.loose || []).findIndex((l) => l.id === id);
  if (i < 0) return null;
  return data.loose.splice(i, 1)[0];
}

/** Loose parcels a runner drives over (when it has room): their ids. Each is tried once. */
export function grabsFor(r, loose, ms) {
  const out = [];
  if (!loose || !loose.length) return out;
  r.tried = r.tried || new Set();
  for (const l of loose) {
    if (r.p + out.length >= DELIVERY.perLoad) break;
    if (r.tried.has(l.id) || ms - l.at < KNOCK.settle * 1000) continue;
    if (dist(r.van.x, r.van.y, l.x, l.y) > KNOCK.reach) continue;
    r.tried.add(l.id);
    out.push(l.id);
  }
  return out;
}

/** One van in a scramble: its van, its parcels, its passes. */
export function createRunner(city, id) {
  const d = city.depot;
  return { id, van: createVan(d.x, d.y, d.heading, 0), p: DELIVERY.perLoad, tracker: createPassTracker(), delivered: 0, mats: 0 };
}

/**
 * Step one van: physics, passes through open rings (only with a parcel on board) and reloading. Returns the passes:
 * [{ addr, gold, mat, x, y }]. `houses` maps the open addresses: [{ addr, house }] built once per step by the caller.
 */
export function stepRunner(r, hold, city, env, open, events = null) {
  stepVan(r.van, hold, city, env, events);
  const out = [];
  if (r.p > 0) {
    const lit = open.map((o) => o.house);
    for (const p of r.tracker.step(r.van, lit)) {
      const o = open.find((x) => x.house === p.house);
      if (!o) continue;
      r.p--;
      out.push({ addr: o.addr, gold: o.gold, house: p.house, mat: p.mat, x: p.x, y: p.y });
      if (r.p <= 0) break;
    }
  } else r.tracker.reset();
  if (r.p < DELIVERY.perLoad && inDepot(r.van, city.depot, DELIVERY.depotZone)) {
    const n = DELIVERY.perLoad - r.p;
    r.p = DELIVERY.perLoad;
    if (events) events.push({ type: 'load', n });
  }
  return out;
}

/** The open addresses as the runners see them. */
export function openList(city, data) {
  const out = [];
  for (const a of data.addrs) {
    const house = city.houses[a.house];
    if (house) out.push({ addr: a.id, gold: a.gold, house });
  }
  return out;
}

/**
 * Loose parcels a bot with room on its roof goes for: close by, not yet tried, not one it has driven past (it would only
 * loop round and miss again).
 */
export function looseTargets(city, data, r) {
  if (r.p >= DELIVERY.perLoad || !data.loose || !data.loose.length) return [];
  r.passed = r.passed || new Map(); // id → closest it has been
  const out = [];
  for (const l of data.loose) {
    if ((r.tried && r.tried.has(l.id)) || r.passed.get(l.id) === -1) continue;
    const d = dist(r.van.x, r.van.y, l.x, l.y);
    const was = r.passed.get(l.id);
    if (d < 130 && was !== undefined && d > was + 6) {
      r.passed.set(l.id, -1); // went by without it
      continue;
    }
    if (d < 130) r.passed.set(l.id, Math.min(was ?? d, d));
    if (d > KNOCK.chase) continue;
    const tx = Math.floor(l.x / T);
    const ty = Math.floor(l.y / T);
    if (!tileDrivable(city, tx, ty)) continue;
    out.push({ key: l.id, x: l.x, y: l.y, tile: city.idx(tx, ty), value: r.p <= 0 ? 1.5 : 0.8 });
  }
  return out;
}

/** Targets for a bot driver: the open addresses (gold worth more), or the depot when empty; loose parcels close by. */
export function scrambleTargets(city, data, r, houseTarget, depotTarget) {
  const loose = looseTargets(city, data, r);
  if (r.p <= 0) return [depotTarget(city), ...loose];
  return openList(city, data)
    .map((o) => houseTarget(city, o.house, o.addr, o.gold ? SCRAMBLE.goldPoints : 1))
    .concat(loose);
}

/**
 * Who stands where on the podium: the standings in place order, the first three on the plinths (centre, left, right) and
 * the rest behind. A tie keeps its shared place, so two vans tied for first both stand on the podium (the plinth shows
 * the place it was given); no plinth is left empty while someone is behind it.
 */
export function podiumOrder(rows) {
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.place || 99) - (b.r.place || 99) || a.i - b.i)
    .map((x) => x.r);
  return { plinths: [0, 1, 2].map((i) => sorted[i] || null), rest: sorted.slice(3) };
}
