import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWNS } from '../game/towns.js';
import { runSolo, parFor } from '../game/world.js';
import { createDriver } from '../game/driver.js';

test('the best bot finishes every town within twice par, with no NaN', () => {
  for (const town of TOWNS) {
    const r = runSolo(town, createDriver({ skill: 1, seed: 1 }));
    assert.ok(r.done, `${town.name}: did not finish`);
    assert.ok(r.final < parFor(town) * 2, `${town.name}: ${r.final.toFixed(1)} s against par ${parFor(town)}`);
    const v = r.world.van;
    assert.ok([v.x, v.y, v.h, v.v].every(Number.isFinite), `${town.name}: NaN`);
  }
});

test('a beginner bot still finishes every town, and is slower over the route', () => {
  let expert = 0;
  let beginner = 0;
  for (const town of TOWNS) {
    expert += runSolo(town, createDriver({ skill: 1, seed: 1 })).final;
    const r = runSolo(town, createDriver({ skill: 0.3, seed: 2 }), { limit: 420 });
    assert.ok(r.done, `${town.name}: the beginner did not finish`);
    beginner += r.final;
  }
  assert.ok(expert < beginner, `expert ${expert.toFixed(0)} s vs beginner ${beginner.toFixed(0)} s`);
});

test('bots are deterministic for a seed (every page agrees)', () => {
  const a = runSolo(TOWNS[3], createDriver({ skill: 0.6, seed: 7 }));
  const b = runSolo(TOWNS[3], createDriver({ skill: 0.6, seed: 7 }));
  assert.equal(a.final, b.final);
  assert.equal(a.crashes, b.crashes);
});
