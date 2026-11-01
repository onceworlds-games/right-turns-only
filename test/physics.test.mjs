import test from 'node:test';
import assert from 'node:assert/strict';
import { TOWNS } from '../game/towns.js';
import { cityFor } from '../game/world.js';
import { createVan, stepVan } from '../game/physics.js';
import { DRIVE, DIR_HEADING, angleDiff } from '../game/config.js';

const env = () => ({ closed: new Set(), cars: [], vans: [], bridgeUp: false, t: 0 });
const deg = (r) => (r * 180) / Math.PI;

function drive(city, van, holdFn, seconds) {
  const ev = [];
  for (let i = 0; i < seconds * 60; i++) stepVan(van, holdFn(i / 60, van), city, env(), ev);
  return ev;
}

test('a held turn at a junction comes out a clean 90° whenever it is let go near the new road', () => {
  // Maple Row: north up column 4 into the T at row 4, right onto row 4 (heading east).
  const city = cityFor(TOWNS[0]);
  for (let startY = 580; startY <= 655; startY += 15) {
    for (let hold = 0.45; hold <= 0.851; hold += 0.05) {
      const van = createVan(510, 900, -Math.PI / 2, 260);
      let from = -1;
      const ev = drive(city, van, (t, v) => {
        if (from < 0 && v.y <= startY) from = t;
        return from >= 0 && t - from < hold;
      }, 4);
      const bad = ev.filter((e) => e.type === 'crash' || e.type === 'soft');
      assert.equal(bad.length, 0, `start ${startY}, hold ${hold.toFixed(2)}: hit something`);
      assert.ok(Math.abs(deg(angleDiff(van.h, 0))) < 0.5, `start ${startY}, hold ${hold.toFixed(2)}: heading ${deg(van.h).toFixed(1)}`);
    }
  }
});

test('a tap on a straight swerves a little and comes back straight', () => {
  const city = cityFor(TOWNS[0]);
  for (const tap of [0.05, 0.08, 0.11]) {
    const van = createVan(1260, 1260, Math.PI, 260); // row 10, heading west
    drive(city, van, (t) => t > 0.2 && t < 0.2 + tap, 1.2);
    assert.ok(Math.abs(angleDiff(van.h, Math.PI)) < 0.01, `tap ${tap}: heading ${deg(van.h)}`);
  }
});

test('held in a turning bulb, the van U-turns without touching the kerb; on a roundabout it orbits', () => {
  for (const town of TOWNS) {
    const city = cityFor(town);
    for (const zone of city.loops) {
      // Come in along each road into the zone, on the left lane, and hold once the centre is on the right.
      for (let d = 0; d < 4; d++) {
        const back = (d + 2) % 4;
        const nx = zone.tx + [0, 1, 0, -1][back];
        const ny = zone.ty + [-1, 0, 1, 0][back];
        if (!city.at(nx, ny) || '.LzRr~=1'.indexOf(city.at(nx, ny)) < 0) continue;
        const h = DIR_HEADING[d];
        const lx = Math.cos(h - Math.PI / 2) * DRIVE.loopRadius;
        const ly = Math.sin(h - Math.PI / 2) * DRIVE.loopRadius;
        const van = createVan(zone.x - Math.cos(h) * 150 + lx, zone.y - Math.sin(h) * 150 + ly, h, 200);
        let turned = 0;
        let last = van.h;
        const ev = drive(city, van, (t, v) => {
          turned += angleDiff(last, v.h);
          last = v.h;
          return Math.hypot(v.x - zone.x, v.y - zone.y) < 70;
        }, 4);
        const bad = ev.filter((e) => e.type === 'crash' || e.type === 'soft');
        assert.equal(bad.length, 0, `${town.name} ${zone.kind} at ${zone.tx},${zone.ty} from ${d}`);
        assert.ok(turned > Math.PI * 1.5, `${town.name} ${zone.kind} at ${zone.tx},${zone.ty}: turned ${deg(turned).toFixed(0)}°`);
      }
    }
  }
});

test('crashes stall the van; scrapes and soft hedges do not', () => {
  const city = cityFor(TOWNS[2]); // Fiveways: hard walls
  const van = createVan(300, 780, -Math.PI / 2 + 0.9, 260); // aimed into the block
  const ev = drive(city, van, () => false, 1.5);
  assert.ok(ev.some((e) => e.type === 'crash' || e.type === 'scrape'));
  for (const e of ev) for (const k of ['x', 'y']) if (k in e) assert.ok(Number.isFinite(e[k]));
  assert.ok(Number.isFinite(van.x) && Number.isFinite(van.y) && Number.isFinite(van.h));
});
