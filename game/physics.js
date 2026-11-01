// The van: always forward, hold to turn right. Heading snap, loop zones, walls, cars, puddles and snow.
// Pure: no page, no platform. One step is DT seconds.

import { T, DT, DX, DY, DIR_HEADING, DRIVE, VAN, clamp, angleDiff, wrapAngle } from './config.js';
import { pushOut, loopAt, isGrass, tileDrivable } from './city.js';

export function createVan(x, y, heading, v = 0) {
  return {
    x,
    y,
    h: heading,
    vh: heading, // direction of travel (differs from the heading only while sliding)
    v,
    yaw: 0,
    hold: false,
    holdFrom: heading, // heading when this hold began
    lastTurn: 0, // how far the last hold turned (rad)
    stall: 0,
    skid: 0,
    scrape: 0,
    crashes: 0,
    turned: 0, // total clockwise rotation, for badges and stats
    zone: null,
    spin: 0, // cosmetic spin after a crash (rad)
    bumpT: 0,
  };
}

/** The nearest cardinal direction to a heading (0..3) and the signed error to it. */
function nearestDir(h) {
  let best = 0;
  let err = Infinity;
  for (let d = 0; d < 4; d++) {
    const e = angleDiff(h, DIR_HEADING[d]);
    if (Math.abs(e) < Math.abs(err)) {
      err = e;
      best = d;
    }
  }
  return { dir: best, err };
}

/** Where the heading should snap to now, or null: the "invisible help" after a turn or a tap. */
export function snapTarget(van, city, env) {
  // Not while on the ring round a loop zone's centre.
  if (van.zone && Math.hypot(van.x - van.zone.x, van.y - van.zone.y) < DRIVE.loopRadius + 25) return null;
  const tx = Math.floor(van.x / T);
  const ty = Math.floor(van.y / T);
  const ch = city.at(tx, ty);
  if (ch === 'p' || ch === 't') return null; // parks are free driving
  // The two cardinals either side of the heading.
  const { dir, err } = nearestDir(van.h);
  // err > 0: the cardinal is clockwise ahead (still to turn into); err < 0: we have turned past it.
  const realTurn = van.lastTurn >= DRIVE.snapHeld;
  const ok = realTurn ? (err >= 0 ? err <= DRIVE.snapForward : -err <= DRIVE.snapBack) : Math.abs(err) <= DRIVE.snapTap;
  if (!ok || Math.abs(err) < 1e-4) return null;
  // Only onto a road that is there: the way ahead along that direction must be drivable.
  const ax = van.x + DX[dir] * 80;
  const ay = van.y + DY[dir] * 80;
  const ntx = Math.floor(ax / T);
  const nty = Math.floor(ay / T);
  if (!tileDrivable(city, ntx, nty)) return null;
  const nch = city.at(ntx, nty);
  if (nch === 'p' || nch === 't' || nch === 'a') {
    // Into a park or an alley only when already lined up with it.
    if (Math.abs(err) > 6 * (Math.PI / 180)) return null;
  }
  if (env && env.closed && env.closed.has(city.idx(ntx, nty))) return null;
  return DIR_HEADING[dir];
}

/**
 * One step. `hold` is the button. `env`: { closed, bridgeUp, cars: [{x,y,h,len,wid,v}], vans: [{x,y}], t }.
 * Pushes events into `events` (an array) when given: { type: 'crash'|'soft'|'scrape'|'car'|'bump'|'puddle'|'stallEnd' }.
 */
export function stepVan(van, hold, city, env, events = null) {
  const dt = (env && env.dt) || DT;
  const was = van.hold;
  van.hold = !!hold;
  if (van.hold && !was) van.holdFrom = van.h;
  if (!van.hold && was) van.lastTurn = angleSpan(van.holdFrom, van.h, van.turnedThisHold || 0);
  if (van.hold && !was) van.turnedThisHold = 0;

  if (van.spin > 0) van.spin = Math.max(0, van.spin - dt * 2);
  if (van.bumpT > 0) van.bumpT -= dt;

  if (van.stall > 0) {
    van.stall -= dt;
    van.v = 0;
    van.yaw = 0;
    if (van.stall <= 0) {
      van.stall = 0;
      if (events) events.push({ type: 'stallEnd' });
    }
    collideCars(van, env, events);
    return;
  }

  const zone = loopAt(city, van.x, van.y);
  van.zone = zone;
  const grass = isGrass(city, van.x, van.y);
  if (van.skid > 0) van.skid -= dt;

  // Puddles: a skid with no turning.
  if (city.puddles.length && van.skid <= 0) {
    for (const p of city.puddles) {
      if ((van.x - p.x) ** 2 + (van.y - p.y) ** 2 < p.r * p.r && van.v > 120) {
        van.skid = DRIVE.puddleSkid;
        if (events) events.push({ type: 'puddle', x: van.x, y: van.y });
        break;
      }
    }
  }

  // Yaw.
  // In a loop zone the van orbits the centre once the centre is on its right; until then it turns as usual.
  const orbit = zone && van.hold && centreOnRight(van, zone);
  let targetYaw = 0;
  if (van.hold && van.skid <= 0) targetYaw = orbit ? orbitYaw(van, zone, city.snow) : DRIVE.yaw;
  // Pressing ramps the turn in over yawRamp; letting go ends it twice as fast (so a release lands where it was meant to).
  const ramp = (DRIVE.yaw / (targetYaw > van.yaw ? DRIVE.yawRamp : DRIVE.yawRamp * 0.5)) * dt;
  if (orbit && van.skid <= 0) van.yaw = targetYaw;
  else van.yaw += clamp(targetYaw - van.yaw, -ramp, ramp);
  if (van.skid > 0) van.yaw = 0;

  // Speed.
  let target = van.hold ? (zone ? DRIVE.loopSpeed * (city.snow ? 0.8 : 1) : DRIVE.turning) : city.snow ? DRIVE.iceStraight : DRIVE.straight;
  if (grass) target *= DRIVE.grass;
  if (van.boost) target *= van.boost; // flow: a little more top speed for driving well (1 when not set)
  // Traffic ahead going the same way: the van tucks in behind it (it never rear-ends a car).
  const lead = carAhead(van, env);
  if (lead) target = Math.min(target, Math.max(0, lead.v * 0.96 - lead.close));
  if (van.v < target) van.v = Math.min(target, van.v + (van.v < DRIVE.turning ? DRIVE.accLow : DRIVE.accHigh) * dt);
  else if (van.v > target) van.v = Math.max(target, van.v - (lead ? DRIVE.decFollow : van.hold ? DRIVE.decTurn : DRIVE.decOver) * dt);

  // Heading.
  const dh = van.yaw * dt;
  van.h = wrapAngle(van.h + dh);
  if (dh > 0) {
    van.turned += dh;
    van.turnedThisHold = (van.turnedThisHold || 0) + dh;
  }

  // Snap when released.
  if (!van.hold && van.skid <= 0 && Math.abs(van.yaw) < 0.05) {
    const target = snapTarget(van, city, env);
    if (target !== null) {
      const e = angleDiff(van.h, target);
      const rate = Math.min(DRIVE.snapRate, Math.abs(e) * DRIVE.snapEase + 0.4);
      const step = Math.sign(e) * Math.min(Math.abs(e), rate * dt);
      van.h = wrapAngle(van.h + step);
    }
  }

  // Direction of travel: in snow it lags the heading.
  if (city.snow) {
    const e = angleDiff(van.vh, van.h);
    van.vh = wrapAngle(van.vh + clamp(e, -DRIVE.iceGrip * dt, DRIVE.iceGrip * dt));
  } else van.vh = van.h;

  van.x += Math.cos(van.vh) * van.v * dt;
  van.y += Math.sin(van.vh) * van.v * dt;

  collideWalls(van, city, env, events, dt);
  collideCars(van, env, events);
  collideVans(van, env, events);
}

/** How far a hold turned: the accumulated clockwise rotation (wrapping past 180° is fine). */
function angleSpan(from, to, turned) {
  return turned || Math.max(0, angleDiff(from, to));
}

/** The nearest car straight ahead going the same way, close enough to follow: { v, close } (close: how much too near). */
function carAhead(van, env) {
  if (!env) return null;
  const c = Math.cos(van.h);
  const s = Math.sin(van.h);
  let best = null;
  let bestD = Infinity;
  const look = (car) => {
    if (car.walker || !Number.isFinite(car.h)) return;
    const dx = car.x - van.x;
    const dy = car.y - van.y;
    const along = dx * c + dy * s;
    if (along <= 0) return;
    const across = Math.abs(-dx * s + dy * c);
    if (across > (car.wid || VAN.wid) / 2 + VAN.wid / 2 - 2) return;
    const gap = along - (car.len || VAN.len) / 2 - VAN.len / 2;
    if (gap > DRIVE.followGap || gap >= bestD) return;
    if (Math.abs(angleDiff(van.h, car.h)) > 0.6) return;
    bestD = gap;
    best = { v: car.v || 0, close: Math.max(0, (DRIVE.followGap * 0.5 - gap) * 3) };
  };
  // Cars, and other vans going the same way (a van tucks in behind instead of shunting).
  if (env.cars) for (const car of env.cars) look(car);
  if (env.vans) for (const o of env.vans) look(o);
  return best;
}

/** Is the zone's centre on the van's right (or close to it)? */
function centreOnRight(van, zone) {
  const dx = zone.x - van.x;
  const dy = zone.y - van.y;
  if (dx * dx + dy * dy < 16 * 16) return true;
  const a = angleDiff(van.h, Math.atan2(dy, dx));
  return a > 0.5 && a < Math.PI - 0.6;
}

/** Holding in a loop zone: keep the centre on the right and glide round it at the loop radius. */
function orbitYaw(van, zone, snow) {
  const dx = zone.x - van.x;
  const dy = zone.y - van.y;
  const d = Math.hypot(dx, dy) || 1;
  const toCentre = Math.atan2(dy, dx);
  const want = toCentre - Math.PI / 2 + Math.atan2(d - DRIVE.loopRadius, 34);
  const err = angleDiff(van.h, want);
  const ff = van.v / Math.max(DRIVE.loopRadius, d);
  return clamp(ff + err * 7, 0, snow ? DRIVE.iceGrip : DRIVE.loopYawMax);
}

function collideWalls(van, city, env, events, dt) {
  const c = Math.cos(van.h);
  const s = Math.sin(van.h);
  let px = 0;
  let py = 0;
  let soft = false;
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    let any = false;
    for (const o of VAN.offs) {
      const p = pushOut(city, van.x + c * o, van.y + s * o, VAN.r, env);
      if (!p) continue;
      van.x += p.x;
      van.y += p.y;
      px += p.x;
      py += p.y;
      soft = soft || p.soft;
      any = true;
      hit = true;
    }
    if (!any) break;
  }
  if (!hit) {
    van.scrape = Math.max(0, van.scrape - dt * 4);
    return;
  }
  const len = Math.hypot(px, py);
  if (len < 1e-6) return;
  const nx = px / len;
  const ny = py / len;
  const ux = Math.cos(van.vh);
  const uy = Math.sin(van.vh);
  const into = -(ux * nx + uy * ny); // 1 = head on
  const impact = into * van.v;
  if (impact > DRIVE.crashSpeed && into > Math.sin(DRIVE.crashAngle)) {
    if (soft) {
      van.v *= DRIVE.softKeep;
      van.x += nx * 8;
      van.y += ny * 8;
      if (events) events.push({ type: 'soft', x: van.x - nx * 20, y: van.y - ny * 20, power: impact });
      slideAlong(van, nx, ny, city, env, 0.4);
    } else {
      van.stall = DRIVE.stallWall;
      van.crashes++;
      van.x += nx * DRIVE.bounceWall;
      van.y += ny * DRIVE.bounceWall;
      van.v = 0;
      van.yaw = 0;
      van.spin = 0.35;
      if (events) events.push({ type: 'crash', x: van.x - nx * 24, y: van.y - ny * 24, power: impact });
      slideAlong(van, nx, ny, city, env, 0.5);
    }
    return;
  }
  // A scrape: slide along the wall, losing a little speed.
  van.v *= Math.pow(DRIVE.scrapeDecay, dt);
  slideAlong(van, nx, ny, city, env, DRIVE.scrapeTurn * dt);
  van.scrape = Math.min(1, van.scrape + dt * 6);
  if (events && van.v > 60) events.push({ type: 'scrape', x: van.x - nx * 16, y: van.y - ny * 16, power: impact });
}

/** Ease the heading toward the wall's line, picking the side that leads somewhere open (clockwise when both do). */
function slideAlong(van, nx, ny, city, env, maxTurn) {
  const a = Math.atan2(nx, -ny); // tangent one way (n rotated -90°)
  const b = wrapAngle(a + Math.PI);
  const open = (h) => {
    let free = 0;
    for (let k = 1; k <= 3; k++) {
      const x = van.x + Math.cos(h) * 40 * k + nx * 20;
      const y = van.y + Math.sin(h) * 40 * k + ny * 20;
      const tx = Math.floor(x / T);
      const ty = Math.floor(y / T);
      if (tileDrivable(city, tx, ty) && !(env && env.closed && env.closed.has(city.idx(tx, ty)))) free++;
    }
    return free;
  };
  const da = angleDiff(van.h, a);
  const db = angleDiff(van.h, b);
  const fa = open(a);
  const fb = open(b);
  let pick;
  if (fa !== fb) pick = fa > fb ? a : b;
  else if (Math.abs(Math.abs(da) - Math.abs(db)) < 0.35) pick = da > 0 ? a : b; // head on: the clockwise side
  else pick = Math.abs(da) < Math.abs(db) ? a : b;
  const e = angleDiff(van.h, pick);
  van.h = wrapAngle(van.h + clamp(e, -maxTurn, maxTurn));
  if (!city.snow) van.vh = van.h;
}

function collideCars(van, env, events) {
  if (!env || !env.cars || !env.cars.length) return;
  const c = Math.cos(van.h);
  const s = Math.sin(van.h);
  for (const car of env.cars) {
    if (car.walker) continue; // people always leap clear (drawn by the renderer); they never stop a van
    const dx0 = car.x - van.x;
    const dy0 = car.y - van.y;
    const reach = car.len / 2 + VAN.len / 2 + 8;
    if (dx0 * dx0 + dy0 * dy0 > reach * reach) continue;
    const cc = Math.cos(car.h);
    const cs = Math.sin(car.h);
    const cr = car.wid / 2;
    const segs = Math.max(2, Math.round(car.len / car.wid));
    let px = 0;
    let py = 0;
    for (const o of VAN.offs) {
      const vx = van.x + c * o;
      const vy = van.y + s * o;
      for (let k = 0; k < segs; k++) {
        const t = segs === 1 ? 0 : -car.len / 2 + cr + ((car.len - 2 * cr) * k) / (segs - 1);
        const cx = car.x + cc * t;
        const cy = car.y + cs * t;
        const dx = vx - cx;
        const dy = vy - cy;
        const d = Math.hypot(dx, dy);
        const min = VAN.r + cr;
        if (d < min && d > 1e-6) {
          px += (dx / d) * (min - d);
          py += (dy / d) * (min - d);
        }
      }
    }
    const len = Math.hypot(px, py);
    if (len < 1e-6) continue;
    van.x += px;
    van.y += py;
    const nx = px / len;
    const ny = py / len;
    const rvx = Math.cos(van.vh) * van.v - Math.cos(car.h) * (car.v || 0);
    const rvy = Math.sin(van.vh) * van.v - Math.sin(car.h) * (car.v || 0);
    const rel = Math.hypot(rvx, rvy) || 1;
    const impact = -(rvx * nx + rvy * ny);
    if (van.stall <= 0 && impact > DRIVE.carCrash && impact / rel > Math.sin(DRIVE.crashAngle)) {
      van.stall = DRIVE.stallCar;
      van.crashes++;
      van.x += nx * DRIVE.bounceCar;
      van.y += ny * DRIVE.bounceCar;
      van.v = 0;
      van.yaw = 0;
      van.spin = 0.3;
      if (events) events.push({ type: 'car', x: van.x - nx * 22, y: van.y - ny * 22, power: impact, car });
    } else if (van.bumpT <= 0) {
      van.v *= 0.9;
      van.bumpT = 0.4;
      if (events && impact > 30) events.push({ type: 'nudge', x: van.x - nx * 20, y: van.y - ny * 20, car });
    }
  }
}

/** Other vans: a harmless nudge apart (each page moves only its own van). */
function collideVans(van, env, events) {
  if (!env || !env.vans || !env.vans.length) return;
  for (const o of env.vans) {
    const dx = van.x - o.x;
    const dy = van.y - o.y;
    const d = Math.hypot(dx, dy);
    const min = 30;
    if (d < min && d > 1e-6) {
      van.x += (dx / d) * (min - d) * 0.6;
      van.y += (dy / d) * (min - d) * 0.6;
      if (van.bumpT <= 0) {
        van.bumpT = 0.6;
        van.v *= 0.92;
        if (events) events.push({ type: 'bump', x: (van.x + o.x) / 2, y: (van.y + o.y) / 2, other: o.id });
      }
    }
  }
}

/** Is the van in the depot's load box? */
export function inDepot(van, depot, half) {
  return Math.abs(van.x - depot.x) < half && Math.abs(van.y - depot.y) < half;
}
