import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWNS } from '../game/towns.js';
import { cityFor, parFor, estimateFor, dailyShift } from '../game/world.js';
import { mapProblems, solidAt, closedTiles } from '../game/city.js';
import { graphFor } from '../game/driver.js';
import { dijkstra, bestTo, dropTile } from '../game/route.js';
import { shiftHouses, trapHouses, DAILY_PARCELS } from '../game/shift.js';

test('every town builds, with no dead ends or L corners and enough addresses', () => {
  for (const town of TOWNS) {
    const city = cityFor(town);
    assert.deepEqual(mapProblems(city), [], town.name);
    assert.ok(city.addresses.length >= town.parcels * 2, `${town.name}: ${city.addresses.length} addresses`);
    assert.ok(!solidAt(city, city.depot.x, city.depot.y), `${town.name}: depot is clear`);
  }
});

test('every address is reachable in right turns from the depot, and the depot from it', () => {
  for (const town of TOWNS) {
    const city = cityFor(town);
    // Coneyard: the cones make some streets dead ends while they're out; those houses never get a parcel then.
    const sets = town.cones ? [1, 2, 3].map((k) => Object.assign(Object.create(graphFor(city, closedTiles(city, k), `k${k}`)), { trap: trapHouses(city, k) })) : [graphFor(city)];
    for (const graph of sets) {
      const depotTile = city.idx(city.depot.tx, city.depot.ty);
      const fromDepot = dijkstra(graph, depotTile * 4 + city.depot.dir);
      for (const h of city.addresses) {
        if (graph.trap && graph.trap.has(h.id)) continue;
        const b = bestTo(fromDepot, dropTile(city, h));
        assert.ok(Number.isFinite(b.time), `${town.name}: house ${h.id} unreachable`);
        const back = bestTo(dijkstra(graph, b.node), depotTile);
        assert.ok(Number.isFinite(back.time), `${town.name}: no way back from house ${h.id}`);
      }
    }
  }
});

test('shifts: fixed houses per town, a different set each day, pars that grow along the route', () => {
  for (const town of TOWNS) {
    const city = cityFor(town);
    const a = shiftHouses(city).map((h) => h.id);
    assert.deepEqual(shiftHouses(city).map((h) => h.id), a);
    assert.equal(a.length, town.parcels);
    assert.equal(new Set(a).size, a.length, `${town.name}: no house twice`);
    assert.ok(parFor(town) > 20 && parFor(town) < 240, `${town.name}: par ${parFor(town)}`);
    if (town.cones) a.forEach((id) => assert.ok(!trapHouses(city).has(id), `${town.name}: house ${id} can be in a dead end`));
  }
  assert.ok(parFor(TOWNS[0]) < parFor(TOWNS[11]));
  const d1 = dailyShift(20000);
  const d2 = dailyShift(20001);
  const h1 = shiftHouses(cityFor(d1.town), { daily: 20000 }).map((h) => h.id);
  assert.equal(h1.length, DAILY_PARCELS);
  assert.deepEqual(shiftHouses(cityFor(d1.town), { daily: 20000 }).map((h) => h.id), h1);
  assert.ok(d1.town.id !== d2.town.id || shiftHouses(cityFor(d2.town), { daily: 20001 }).some((h, i) => h.id !== h1[i]));
  assert.ok(estimateFor(d1.town, { daily: 20000 }) > 10);
});
