import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWNS } from '../game/towns.js';
import { cityFor, createSoloWorld, estimateFor, parFor } from '../game/world.js';
import { createShift, isMat, starsFor, minPlausible, createPassTracker } from '../game/shift.js';
import { createVan } from '../game/physics.js';
import { DELIVERY, STARS } from '../game/config.js';

/** Move a van in a straight line through points, calling shift.step each 1/60 s. */
function pass(shift, van, x0, y0, x1, y1, speed = 260) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (speed / 60));
  const ev = [];
  for (let i = 0; i <= n; i++) {
    van.x = x0 + ((x1 - x0) * i) / n;
    van.y = y0 + ((y1 - y0) * i) / n;
    van.v = speed;
    for (const e of shift.step(van, 1 / 60)) ev.push(e);
  }
  return ev;
}

test('doormat: closest pass within 28 px at 210 px/s or less', () => {
  assert.equal(isMat(28, 210), true);
  assert.equal(isMat(28.5, 200), false);
  assert.equal(isMat(10, 211), false);
  assert.equal(isMat(0, 0), true);
});

test('a pass through a ring delivers at its closest point; outside it nothing', () => {
  const city = cityFor(TOWNS[0]);
  const shift = createShift(city);
  shift.start();
  const van = createVan(0, 0, 0, 260);
  const h = shift.lit[0];
  // Miss: 80 px off.
  let ev = pass(shift, van, h.dropX - 300, h.dropY - 80, h.dropX + 300, h.dropY - 80);
  assert.equal(ev.filter((e) => e.type === 'drop').length, 0);
  ev = pass(shift, van, h.dropX - 300, h.dropY - 40, h.dropX + 300, h.dropY - 40);
  const drops = ev.filter((e) => e.type === 'drop');
  assert.equal(drops.length, 1);
  assert.equal(drops[0].mat, false);
  assert.ok(Math.abs(drops[0].d - 40) < 3);
  // A slow pass down the middle lands on the mat.
  const h2 = shift.lit[0];
  ev = pass(shift, van, h2.dropX - 300, h2.dropY + 5, h2.dropX + 300, h2.dropY + 5, 190);
  assert.equal(ev.find((e) => e.type === 'drop').mat, true);
  assert.equal(shift.mats, 1);
});

test('loading: three on the van, the depot tops it up, the last drop ends the shift with doormat seconds off', () => {
  const town = TOWNS[0];
  const city = cityFor(town);
  const shift = createShift(city);
  shift.start();
  assert.equal(shift.lit.length, DELIVERY.perLoad);
  assert.equal(shift.queue.length, town.parcels - DELIVERY.perLoad);
  const van = createVan(0, 0, 0, 260);
  let done = null;
  let loads = 0;
  for (let guard = 0; guard < 20 && !done; guard++) {
    if (shift.needsDepot()) {
      const d = city.depot;
      for (const e of pass(shift, van, d.x - 100, d.y, d.x + 100, d.y)) if (e.type === 'load') loads++;
      continue;
    }
    const h = shift.lit[0];
    for (const e of pass(shift, van, h.dropX, h.dropY - 200, h.dropX, h.dropY + 200, 200)) if (e.type === 'done') done = e;
  }
  assert.ok(done, 'the shift ended');
  assert.equal(loads, town.parcels / DELIVERY.perLoad - 1);
  assert.equal(done.mats, town.parcels);
  assert.ok(Math.abs(done.final - (done.time - town.parcels * DELIVERY.matBonus)) < 1e-9 || done.final === 0);
});

test('Coneyard: the cones move every reload', () => {
  const city = cityFor(TOWNS.find((t) => t.cones));
  const shift = createShift(city);
  shift.start();
  const k0 = shift.closureK;
  shift.lit = [];
  const van = createVan(city.depot.x - 100, city.depot.y, 0, 260);
  const ev = pass(shift, van, city.depot.x - 100, city.depot.y, city.depot.x + 100, city.depot.y);
  assert.ok(ev.some((e) => e.type === 'closures'));
  assert.notEqual(shift.closureK, k0);
  assert.ok(shift.closed.size > 0);
});

test('stars against par; the daily list floor is well under par', () => {
  assert.equal(starsFor(50, 50), 3);
  assert.equal(starsFor(50 * STARS.three + 0.01, 50), 2);
  assert.equal(starsFor(50 * STARS.two + 0.01, 50), 1);
  assert.equal(starsFor(Infinity, 50), 0);
  for (const town of TOWNS) {
    const floor = minPlausible(estimateFor(town), town.parcels);
    assert.ok(floor > 5 && floor < parFor(town) * 0.6, `${town.name}: floor ${floor}`);
  }
});

test('a solo world: crashes are counted, the clock only runs after GO', () => {
  const w = createSoloWorld(TOWNS[1]);
  for (let i = 0; i < 60; i++) w.step(false, false);
  assert.equal(w.t, 0);
  w.shift.start();
  for (let i = 0; i < 600; i++) w.step(false);
  assert.ok(Math.abs(w.t - 10) < 1e-6);
  assert.ok(w.shift.clock > 9.9);
  assert.ok(Number.isFinite(w.van.x));
});

test('the pass tracker forgets houses that go dark', () => {
  const t = createPassTracker();
  const h = { id: 1, dropX: 0, dropY: 0 };
  t.step({ x: 0, y: 10, v: 200 }, [h]);
  assert.deepEqual(t.step({ x: 0, y: 200, v: 200 }, []), []);
});

test('express parcel: from the third town a gold call comes in with the second load, on a timer, off the shift list', async () => {
  const { createDriver } = await import('../game/driver.js');
  const { DT } = await import('../game/config.js');
  const { EXPRESS } = await import('../game/shift.js');
  for (const id of [1, 3]) {
    const town = TOWNS.find((t) => t.id === id);
    const w = createSoloWorld(town);
    const bot = createDriver({ skill: 1, seed: 3 });
    w.shift.start();
    const seen = [];
    let done = null;
    while (!done && w.t < 400) {
      for (const e of w.step(bot.drive(w.van, w.botCtx(), DT))) {
        if (e.type.startsWith('express')) seen.push(e);
        if (e.type === 'done') done = e;
      }
    }
    assert.ok(done, `town ${id} finishes`);
    if (id < 3) assert.equal(seen.length, 0);
    else {
      const call = seen.find((e) => e.type === 'expressCall');
      assert.ok(call, 'the call comes');
      assert.ok(!w.shift.houses.includes(call.house), 'not one of the shift houses');
      assert.ok(call.until > EXPRESS.time - 1);
      // The bot ignores it, so it runs out (unless it happened to drive through it).
      assert.ok(seen.some((e) => e.type === 'expressGone' || e.type === 'express'));
    }
  }
});

test('express parcel: driving through it delivers it (and can land on the mat)', () => {
  const town = TOWNS.find((t) => t.id === 3);
  const city = cityFor(town);
  const shift = createShift(city);
  shift.start();
  const van = createVan(city.depot.x, city.depot.y, 0, 0);
  // Empty the first load, then load at the depot.
  shift.lit = [];
  const ev = shift.step(van, 1 / 60);
  const call = ev.find((e) => e.type === 'expressCall');
  assert.ok(call);
  const h = call.house;
  const got = pass(shift, van, h.dropX - 120, h.dropY, h.dropX + 120, h.dropY, 150);
  const ex = got.find((e) => e.type === 'express');
  assert.ok(ex, 'delivered');
  assert.equal(ex.mat, true);
  assert.equal(shift.express, null);
  assert.equal(shift.expressDone, 1);
});

test('laps: every full lap of a roundabout counts', () => {
  const town = TOWNS.find((t) => t.id === 3);
  const city = cityFor(town);
  const shift = createShift(city);
  shift.start();
  const zone = city.loops.find((z) => z.kind === 'plaza');
  assert.ok(zone);
  const van = createVan(zone.x, zone.y - 40, 0, 120);
  van.zone = zone;
  let laps = 0;
  for (let i = 0; i < 60 * 12; i++) {
    van.turned += (Math.PI * 2 * 3.2) / (60 * 12);
    for (const e of shift.step(van, 1 / 60)) if (e.type === 'feat' && e.id === 'roundabout-regular') laps++;
  }
  assert.equal(laps, 3);
  assert.equal(shift.laps, 3);
});
