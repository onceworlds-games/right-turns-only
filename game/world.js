// A solo shift as one steppable world: the town, its traffic, the van and the rules. The page drives it with the player's
// button; the tests and the expert-time script drive it with a bot. Pure: no page, no platform.

import { DT, SCRAMBLE, STARS, KNOCK, DELIVERY } from './config.js';
import { buildCity, bridgeState, closedTiles } from './city.js';
import { createRng } from './rng.js';
import { createVan, stepVan } from './physics.js';
import { createTraffic } from './traffic.js';
import { createShift, shiftHouses, routeEstimate, dailyTown, trapHouses, DAILY_PARCELS } from './shift.js';
import { closureSet } from './city.js';
import { TOWNS } from './towns.js';
import { createDriver, houseTarget, depotTarget, graphFor } from './driver.js';
import { newScramble, fillAddresses, openList, stepRunner, applyDrop, openLastCall, createRunner, scrambleTargets, scrambleClosure, knockedBy, addLoose, expireLoose, grabsFor, applyGrab } from './scramble.js';

const cities = new Map();
/** One city per town (they never change). */
export function cityFor(town) {
  let c = cities.get(town.id);
  if (!c) {
    c = buildCity(town);
    cities.set(town.id, c);
  }
  return c;
}

/** Today's daily shift: { day, town, parcels }. */
export function dailyShift(day) {
  return { day, town: dailyTown(day, TOWNS), parcels: DAILY_PARCELS };
}

const estimates = new Map();
/** The route time of a shift's best orders (seconds); opts: { daily } as for createShift. */
export function estimateFor(town, opts = {}) {
  const key = `${town.id}:${opts.daily ?? ''}`;
  let e = estimates.get(key);
  if (e === undefined) {
    const city = cityFor(town);
    const houses = shiftHouses(city, opts.daily !== undefined ? { daily: opts.daily } : {});
    e = routeEstimate(city, houses, (li) => {
      if (!town.cones) return graphFor(city);
      const k = closureSet(li);
      return graphFor(city, closedTiles(city, k), `k${k}`);
    });
    estimates.set(key, e);
  }
  return e;
}

/** Par: the expert time the stars are measured against. */
export const parFor = (town, opts = {}) => Math.round(estimateFor(town, opts) * STARS.par * 10) / 10;

/**
 * opts: { daily, houses }. world.step(hold) advances one fixed step (DT) and returns the shift's events plus the van's
 * physics events ({ type: 'crash' | 'car' | 'scrape' | ... }).
 */
export function createSoloWorld(town, opts = {}) {
  const city = cityFor(town);
  const traffic = createTraffic(city);
  const shift = createShift(city, opts);
  const d = city.depot;
  const van = createVan(d.x, d.y, d.heading, 0);
  const w = {
    town,
    city,
    traffic,
    shift,
    van,
    t: 0, // seconds since GO
    env: { closed: shift.closed, bridgeUp: false, cars: [], t: 0 },
  };

  w.envAt = (t) => {
    traffic.advanceTo(t);
    w.env.closed = shift.closed;
    w.env.bridgeUp = city.drawbridges.length > 0 && bridgeState(t).up;
    w.env.cars = traffic.bodies(t);
    w.env.t = t;
    return w.env;
  };

  /** One step. `started` false keeps the van parked under the canopy (the intro). */
  w.step = (hold, started = true) => {
    const events = [];
    if (!started) {
      w.envAt(w.t);
      return events;
    }
    const env = w.envAt(w.t + DT);
    stepVan(van, hold, city, env, events);
    const crashed = events.some((e) => e.type === 'crash' || e.type === 'car');
    for (const e of shift.step(van, DT, crashed)) events.push(e);
    w.t += DT;
    return events;
  };

  /** Where a bot would go next. */
  w.targets = () => (shift.needsDepot() ? [depotTarget(city)] : shift.lit.map((h) => houseTarget(city, h, `h${h.id}`)));
  w.graph = () => graphFor(city, shift.closed, `k${shift.closureK}`);
  w.botCtx = () => ({ city, graph: w.graph(), targets: w.targets(), env: w.env });
  return w;
}

/** Run a whole solo shift with a driver (tests, expert times). Returns { time, final, mats, crashes, done }. */
export function runSolo(town, driver, opts = {}) {
  const w = createSoloWorld(town, opts);
  w.shift.start();
  const limit = opts.limit || 400;
  let done = null;
  while (!done && w.t < limit) {
    const hold = driver.drive(w.van, w.botCtx(), DT);
    for (const e of w.step(hold)) if (e.type === 'done') done = e;
  }
  return { time: done ? done.time : Infinity, final: done ? done.final : Infinity, mats: w.shift.mats, crashes: w.shift.crashes, done: !!done, world: w };
}

/**
 * A whole scramble shift with bots only (tests, the title scene, posters). opts: { drivers: [{ id, skill, style, seed }],
 * seconds, seed }. Claims apply at once, first come first served, the way the host applies them.
 */
export function createScrambleWorld(town, opts = {}) {
  const city = cityFor(town);
  const traffic = createTraffic(city);
  const seconds = opts.seconds || 120;
  const rng = createRng(`scramble:${opts.seed ?? 1}:${town.id}`);
  const rand = rng.next;
  const data = newScramble(town.id);
  const runners = (opts.drivers || []).map((d, i) => {
    const r = createRunner(city, d.id || `bot:${i + 1}`);
    r.seat = i;
    r.driver = createDriver({ skill: d.skill, style: d.style, seed: d.seed ?? i + 1 });
    // Spread out of the depot one after another.
    r.delay = i * 0.45;
    return r;
  });
  const w = { town, city, traffic, data, runners, t: 0, seconds, env: { closed: new Set(), bridgeUp: false, cars: [], vans: [], t: 0 }, done: false };
  let closureK = town.cones ? scrambleClosure(0) : 0;
  if (closureK) w.env.closed = closedTiles(city, closureK);
  const avoid = () => {
    if (!closureK) return opts.avoid || null;
    if (!opts.avoid) return trapHouses(city);
    return new Set([...trapHouses(city), ...opts.avoid]);
  };
  fillAddresses(city, data, runners.map((r) => r.van), rand, runners.length, avoid());

  w.graph = () => graphFor(city, w.env.closed, `k${closureK}`);
  w.envAt = (t) => {
    traffic.advanceTo(t);
    if (town.cones) {
      const k = scrambleClosure(t);
      if (k !== closureK) {
        closureK = k;
        w.env.closed = closedTiles(city, k);
      }
    }
    w.env.bridgeUp = city.drawbridges.length > 0 && bridgeState(t).up;
    w.env.cars = traffic.bodies(t);
    w.env.t = t;
    return w.env;
  };

  /** One step; returns events: { type: 'drop', seat, house, mat, gold, x, y } | 'knock' | 'grab' | 'lastCall' | 'end'. */
  w.step = () => {
    const events = [];
    if (w.done) return events;
    const env = w.envAt(w.t + DT);
    const open = openList(city, data);
    const graph = w.graph();
    for (const r of runners) {
      if (w.t < r.delay) continue;
      env.vans = runners.filter((o) => o !== r).map((o) => ({ id: o.id, x: o.van.x, y: o.van.y, h: o.van.h, v: o.van.v }));
      const ctx = { city, graph, targets: scrambleTargets(city, data, r, houseTarget, depotTarget), env };
      const hold = r.driver.drive(r.van, ctx, DT);
      const ev = [];
      for (const p of stepRunner(r, hold, city, env, open, ev)) {
        const entry = applyDrop(data, r.seat, p.addr, p.mat, w.t * 1000);
        if (!entry) {
          r.p++; // taken a moment ago: the parcel comes back
          continue;
        }
        r.delivered++;
        if (p.mat) r.mats++;
        events.push({ type: 'drop', seat: r.seat, house: p.house, mat: p.mat, gold: p.gold, x: p.x, y: p.y });
        fillAddresses(city, data, runners.map((o) => o.van), rand, runners.length, avoid());
      }
      // Knock-offs, as the pages and the host settle them: a hard hit drops a parcel into the road; a van with room picks
      // up what it drives over.
      if (r.knockT > 0) r.knockT -= DT;
      for (const e of ev) {
        if (e.type !== 'bump') continue;
        const other = env.vans.find((v) => v.id === e.other);
        if (!other || !knockedBy(r, other, city)) continue;
        r.p--;
        r.knockT = KNOCK.cooldown;
        const l = addLoose(data, r.van.x, r.van.y, w.t * 1000);
        events.push({ type: 'knock', seat: r.seat, id: l.id, x: l.x, y: l.y });
        break;
      }
      for (const id of grabsFor(r, data.loose, w.t * 1000)) {
        if (!applyGrab(data, id)) continue;
        r.p = Math.min(DELIVERY.perLoad, r.p + 1);
        events.push({ type: 'grab', seat: r.seat, id });
      }
    }
    expireLoose(data, w.t * 1000);
    w.t += DT;
    if (!data.lastCall && w.t >= seconds - SCRAMBLE.lastCall) {
      const a = openLastCall(city, graph, data, runners.map((r) => r.van), rand, avoid());
      events.push({ type: 'lastCall', addr: a });
    }
    if (w.t >= seconds) {
      w.done = true;
      events.push({ type: 'end' });
    }
    return events;
  };
  return w;
}
