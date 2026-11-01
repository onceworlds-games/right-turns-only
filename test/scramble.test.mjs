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

test('knock-offs: only the van driven into loses a parcel; head on, both do; a slow nudge, nobody', async () => {
  const { hitSpeed, knockedBy } = await import('../game/scramble.js');
  const { KNOCK } = await import('../game/config.js');
  const runner = (x, y, h, v, p = 3) => ({ van: { x, y, h, v }, p, knockT: 0 });
  // B stopped, A drives into its back at 240.
  const a = runner(0, 0, 0, 240);
  const b = runner(28, 0, 0, 0);
  assert.equal(knockedBy(b, a.van), true);
  assert.equal(knockedBy(a, b.van), false);
  // Head on at speed: both.
  const c = runner(0, 0, 0, 220);
  const d = runner(28, 0, Math.PI, 220);
  assert.equal(knockedBy(c, d.van), true);
  assert.equal(knockedBy(d, c.van), true);
  // T-bone: the van hit side-on loses one, the one that hit it doesn't.
  const e = runner(0, 0, Math.PI / 2, 230); // driving south into f
  const f = runner(0, 28, 0, 200); // crossing east
  assert.equal(knockedBy(f, e.van), true);
  assert.equal(knockedBy(e, f.van), false);
  // Gentle, empty, or still cooling down: nothing.
  assert.equal(knockedBy(runner(28, 0, 0, 0), runner(0, 0, 0, KNOCK.speed - 20).van), false);
  assert.equal(knockedBy(runner(28, 0, 0, 0, 0), a.van), false);
  assert.equal(knockedBy({ ...runner(28, 0, 0, 0), knockT: 0.5 }, a.van), false);
  // At the depot nobody loses one.
  const city = { depot: { x: 30, y: 0 } };
  assert.equal(knockedBy(b, a.van, city), false);
  assert.equal(knockedBy(b, a.van, { depot: { x: 3000, y: 0 } }), true);
  assert.ok(Math.abs(hitSpeed({ x: 10, y: 0 }, { x: 0, y: 0, h: 0, v: 200 }) - 200) < 1e-9);
  assert.equal(hitSpeed({ x: 0, y: 0 }, { x: 0, y: 0, h: 0, v: 200 }), 0);
});

test('loose parcels: ids, the oldest goes past the cap, they lie for a while, and only a van close by with room gets one', async () => {
  const { addLoose, expireLoose, checkGrab, applyGrab, grabsFor, LOOSE_ID } = await import('../game/scramble.js');
  const { KNOCK } = await import('../game/config.js');
  const d = newScramble(1);
  const first = addLoose(d, 100.4, 200.6, 1000);
  assert.ok(LOOSE_ID.test(first.id));
  assert.deepEqual([first.x, first.y], [100, 201]);
  for (let i = 0; i < KNOCK.max; i++) addLoose(d, 300, 300, 2000 + i);
  assert.equal(d.loose.length, KNOCK.max);
  assert.ok(!d.loose.some((l) => l.id === first.id), 'the oldest went');
  const l = d.loose[0];
  const near = { playing: true, x: l.x + 20, y: l.y };
  assert.equal(checkGrab(d, l.id, near, l.at + 100), 'flying');
  const late = l.at + KNOCK.settle * 1000 + 10;
  assert.equal(checkGrab(d, l.id, near, late), null);
  assert.equal(checkGrab(d, l.id, { playing: true, x: l.x + 400, y: l.y }, late), 'far');
  assert.equal(checkGrab(d, 'l99999', near, late), 'gone');
  assert.equal(checkGrab(d, 'a3', near, late), 'bad');
  assert.equal(checkGrab(d, l.id, null, late), 'not-playing');
  assert.equal(applyGrab(d, l.id).id, l.id);
  assert.equal(applyGrab(d, l.id), null);
  // A runner picks up what's under it, once each, and never past three.
  const one = [{ id: 'l1', x: 300, y: 300, at: 0 }];
  const r = { van: { x: 310, y: 300 }, p: 1 };
  assert.deepEqual(grabsFor(r, one, 9000), ['l1']);
  assert.equal(grabsFor(r, one, 9000).length, 0, 'each is tried once');
  assert.equal(grabsFor({ van: { x: 300, y: 300 }, p: 2 }, d.loose, 9000).length, 1, 'never past three');
  assert.equal(grabsFor({ van: { x: 300, y: 300 }, p: 3 }, d.loose, 9000).length, 0, 'a full van leaves them');
  assert.equal(grabsFor({ van: { x: 300 + KNOCK.reach + 5, y: 300 }, p: 0 }, one, 9000).length, 0, 'out of reach');
  assert.equal(grabsFor({ van: { x: 300, y: 300 }, p: 0 }, d.loose, 2100).length, 0, 'not while they are still flying');
  assert.equal(expireLoose(d, 2000 + KNOCK.life * 1000 + 100), true);
  assert.equal(d.loose.length, 0);
  assert.equal(expireLoose(d, 1e9), false);
});

test('knock-offs in a shift: parcels stay 0-3, every grabbed parcel had been knocked loose, and the road is cleared', () => {
  let knocks = 0;
  let grabs = 0;
  for (const town of TOWNS) {
    const { w } = (() => {
      const world = createScrambleWorld(town, { seed: 5, seconds: 120, drivers: drivers(5, 0.6) });
      const loose = new Set();
      while (!world.done) {
        for (const e of world.step()) {
          if (e.type === 'knock') {
            knocks++;
            loose.add(e.id);
          }
          if (e.type === 'grab') {
            grabs++;
            assert.ok(loose.has(e.id), `${town.name}: grabbed ${e.id}, never knocked loose`);
          }
        }
        for (const r of world.runners) assert.ok(r.p >= 0 && r.p <= 3, `${town.name}: ${r.p} parcels`);
        assert.ok(world.data.loose.length <= 6);
      }
      return { w: world };
    })();
    for (const l of w.data.loose) assert.ok(w.t * 1000 - l.at < 30_000);
  }
  assert.ok(grabs <= knocks);
});

test('bots go for loose parcels on the road near them, worth more with an empty roof, and give up on one they drove past', async () => {
  const { looseTargets } = await import('../game/scramble.js');
  const { KNOCK, T } = await import('../game/config.js');
  const { tileDrivable } = await import('../game/city.js');
  const city = cityFor(TOWNS[0]);
  // A road tile and a lot (not road) in Maple Row.
  let road = null;
  let lot = null;
  for (let ty = 1; ty < city.h - 1 && !(road && lot); ty++) {
    for (let tx = 1; tx < city.w - 1; tx++) {
      if (!road && tileDrivable(city, tx, ty) && tileDrivable(city, tx + 1, ty)) road = { x: (tx + 0.5) * T, y: (ty + 0.5) * T };
      if (!lot && !tileDrivable(city, tx, ty)) lot = { x: (tx + 0.5) * T, y: (ty + 0.5) * T };
    }
  }
  const data = { loose: [{ id: 'l1', x: road.x, y: road.y, at: 0 }, { id: 'l2', x: lot.x, y: lot.y, at: 0 }] };
  const bot = (x, y, p) => ({ van: { x, y }, p });
  const empty = looseTargets(city, data, bot(road.x + 200, road.y, 0));
  assert.deepEqual(empty.map((t) => t.key), ['l1'], 'only the one on the road');
  assert.ok(empty[0].value > 1, 'an empty roof wants it more');
  assert.ok(looseTargets(city, data, bot(road.x + 200, road.y, 1))[0].value < 1);
  assert.equal(looseTargets(city, data, bot(road.x + 200, road.y, 3)).length, 0, 'a full roof leaves it');
  assert.equal(looseTargets(city, data, bot(road.x + KNOCK.chase + 50, road.y, 0)).length, 0, 'too far to chase');
  // Driving past: close, then further away.
  const r = bot(road.x + 40, road.y, 1);
  assert.equal(looseTargets(city, data, r).length, 1);
  r.van.x = road.x - 60;
  assert.equal(looseTargets(city, data, r).length, 0, 'went by without it');
});
