// Shift Scramble rules: which addresses are open, where a new one lights up, the golden last call, checking and scoring a
// delivery claim, and one van's step (passes and reloads). The host's page and the tests use the same functions.
// Pure: no page, no platform.

import { DELIVERY, SCRAMBLE, openAddresses } from './config.js';
import { dijkstra, stateOf, bestTo, dropTile } from './route.js';
import { stepVan, inDepot, createVan } from './physics.js';
import { createPassTracker } from './shift.js';
import { closureSet } from './city.js';

export const ADDR_ID = /^a\d{1,6}$/;
export const MAX_LOG = 12;

/** A shift's shared state (what the host keeps in match.data). */
export function newScramble(townId) {
  return { town: townId, addrs: [], seq: 0, pts: {}, mats: {}, log: [], lastCall: false };
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

/** Targets for a bot driver: the open addresses (gold worth more), or the depot when empty. */
export function scrambleTargets(city, data, r, houseTarget, depotTarget) {
  if (r.p <= 0) return [depotTarget(city)];
  return openList(city, data).map((o) => houseTarget(city, o.house, o.addr, o.gold ? SCRAMBLE.goldPoints : 1));
}
