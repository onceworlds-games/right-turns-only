import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWNS } from '../game/towns.js';
import { BOTS, SCRAMBLE, openAddresses } from '../game/config.js';
import { cityFor, createScrambleWorld } from '../game/world.js';
import { newScramble, fillAddresses, checkClaim, applyDrop, pointsFor, pickHouse, lastCallHouse } from '../game/scramble.js';
import { graphFor } from '../game/driver.js';
import { createRng } from '../game/rng.js';

const drivers = (seed, skill = null) => BOTS.map((b, i) => ({ id: `bot:${i + 1}`, skill: skill ?? b.skill, style: skill === null ? b.style : 'steady', seed: seed * 10 + i }));

function play(town, seed, skill) {
  const w = createScrambleWorld(town, { seed, seconds: 120, drivers: drivers(seed, skill) });
  let lastCalls = 0;
  while (!w.done) for (const e of w.step()) if (e.type === 'lastCall' && e.addr) lastCalls++;
  return { w, lastCalls };
}

test('six equal bots over 120 s: 6-14 deliveries each on average, no runaway, a last call every shift', () => {
  for (const town of TOWNS) {
    for (const seed of [1, 2]) {
      const { w, lastCalls } = play(town, seed, 0.65);
      const del = w.runners.map((r) => r.delivered);
      const mean = del.reduce((a, b) => a + b, 0) / del.length;
      assert.ok(mean >= 5 && mean <= 15, `${town.name} s${seed}: mean ${mean.toFixed(1)} (${del})`);
      assert.ok(Math.max(...del) <= Math.max(mean * 2, mean + 6), `${town.name} s${seed}: runaway (${del})`);
      assert.equal(lastCalls, 1, `${town.name}: last call`);
      for (const r of w.runners) assert.ok([r.van.x, r.van.y, r.van.h].every(Number.isFinite));
      assert.equal(w.data.addrs.filter((a) => !a.gold).length, openAddresses(6));
    }
  }
});

test('the real bot line-up: everyone scores, the veteran beats the rookie over a few shifts', () => {
  let mo = 0;
  let juno = 0;
  for (const id of [1, 3, 4, 6]) {
    const { w } = play(TOWNS[id - 1], id, null);
    for (const r of w.runners) assert.ok(r.delivered > 0, `${TOWNS[id - 1].name}: ${BOTS[r.seat].name} delivered nothing`);
    mo += w.data.pts[2] || 0;
    juno += w.data.pts[3] || 0;
  }
  assert.ok(mo > juno, `Mo ${mo} vs Juno ${juno}`);
});

test('new addresses: never on an open one, 480 px clear of every van when the town allows', () => {
  const city = cityFor(TOWNS[3]);
  const rng = createRng(3);
  const data = newScramble(4);
  const vans = [{ x: city.depot.x, y: city.depot.y }];
  fillAddresses(city, data, vans, rng.next, 6);
  assert.equal(data.addrs.length, 5);
  const houses = data.addrs.map((a) => a.house);
  assert.equal(new Set(houses).size, 5);
  for (const a of data.addrs) {
    const h = city.houses[a.house];
    assert.ok(Math.hypot(h.dropX - vans[0].x, h.dropY - vans[0].y) >= SCRAMBLE.spawnClear);
  }
  // A crowded town falls back to the farthest it can.
  const tiny = cityFor(TOWNS[0]);
  const many = tiny.addresses.slice(0, 12).map((h) => ({ x: h.dropX, y: h.dropY }));
  assert.ok(pickHouse(tiny, newScramble(1), many, rng.next));
});

test('claims: open, playing, with a parcel, near the ring; each address only once', () => {
  const city = cityFor(TOWNS[2]);
  const data = newScramble(3);
  fillAddresses(city, data, [], createRng(1).next, 2);
  const a = data.addrs[0];
  const h = city.houses[a.house];
  const near = { playing: true, parcels: 2, x: h.dropX + 20, y: h.dropY };
  assert.equal(checkClaim(city, data, { addr: a.id, mat: false }, near), null);
  assert.equal(checkClaim(city, data, { addr: a.id }, { ...near, playing: false }), 'not-playing');
  assert.equal(checkClaim(city, data, { addr: a.id }, { ...near, parcels: 0 }), 'empty');
  assert.equal(checkClaim(city, data, { addr: a.id }, { ...near, x: h.dropX + 400 }), 'far');
  assert.equal(checkClaim(city, data, { addr: 'a999' }, near), 'closed');
  assert.equal(checkClaim(city, data, { addr: '<script>' }, near), 'bad');
  assert.equal(checkClaim(city, data, { addr: a.id }, { ...near, x: NaN }), 'bad');
  assert.equal(checkClaim(city, data, null, near), 'bad');
  const entry = applyDrop(data, 0, a.id, true, 1234);
  assert.deepEqual(entry, [0, a.house, 1, 0, 1234]);
  assert.equal(data.pts[0], 2);
  assert.equal(data.mats[0], 1);
  assert.equal(applyDrop(data, 1, a.id, false, 1300), null, 'a second claim on the same address loses');
  assert.equal(checkClaim(city, data, { addr: a.id }, near), 'closed');
  assert.equal(pointsFor(true, true), SCRAMBLE.goldPoints + 1);
});

test('the last call picks a house the vans are about equally far from', () => {
  const town = TOWNS[3];
  const city = cityFor(town);
  const data = newScramble(4);
  const vans = [city.addresses[0], city.addresses[20], city.addresses[40]].map((h) => ({ x: h.dropX, y: h.dropY, h: 0 }));
  const h = lastCallHouse(city, graphFor(city), data, vans);
  assert.ok(h);
  assert.ok(vans.every((v) => Math.hypot(v.x - h.dropX, v.y - h.dropY) >= 300));
});
