// A solo shift as one steppable world: the town, its traffic, the van and the rules. The page drives it with the player's
// button; the tests and the expert-time script drive it with a bot. Pure: no page, no platform.

import { DT } from './config.js';
import { buildCity, bridgeState } from './city.js';
import { createVan, stepVan } from './physics.js';
import { createTraffic } from './traffic.js';
import { createShift } from './shift.js';
import { houseTarget, depotTarget, graphFor } from './driver.js';

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
