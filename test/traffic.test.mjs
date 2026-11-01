import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWNS } from '../game/towns.js';
import { cityFor } from '../game/world.js';
import { createTraffic } from '../game/traffic.js';

test('traffic never jams for good: over ten minutes no car in any town stays stopped for 30 s', () => {
  for (const town of TOWNS) {
    const traffic = createTraffic(cityFor(town));
    const still = new Map();
    let worst = 0;
    for (let t = 0; t <= 600; t += 0.5) {
      traffic.advanceTo(t);
      for (const car of traffic.cars) {
        const s = car.v < 5 ? (still.get(car.id) || 0) + 0.5 : 0;
        still.set(car.id, s);
        worst = Math.max(worst, s);
      }
    }
    assert.ok(worst < 30, `${town.name}: a car stood still for ${worst} s`);
  }
});

test('traffic is the same for everyone: a pure function of the shift clock', () => {
  const city = cityFor(TOWNS[3]);
  const a = createTraffic(city);
  const b = createTraffic(city);
  a.advanceTo(90);
  for (let t = 0; t <= 90; t += 7.3) b.advanceTo(t);
  b.advanceTo(90);
  assert.deepEqual(a.cars.map((c) => [c.id, Math.round(c.x), Math.round(c.y)]), b.cars.map((c) => [c.id, Math.round(c.x), Math.round(c.y)]));
});
