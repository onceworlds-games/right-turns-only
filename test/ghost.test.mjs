import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, decodeGhost, ghostAt } from '../game/ghost.js';

test('a ghost survives encoding: positions within a few px, headings unwrapped, drops kept', () => {
  const rec = createRecorder();
  const path = [];
  let x = 500;
  let y = 500;
  let h = 0;
  for (let i = 0; i < 60 * 90; i++) {
    const t = i / 60;
    h += (i % 400 < 120 ? 2.6 : 0) / 60; // curls
    x += Math.cos(h) * 4.3;
    y += Math.sin(h) * 4.3;
    if (i % 1500 === 0) x += 900; // a jump (escaped deltas)
    rec.add(t, x, y, h);
    path.push([t, x, y]);
    if (i % 900 === 0) rec.drop(t);
  }
  const saved = JSON.parse(JSON.stringify(rec.encode()));
  assert.ok(saved.s.length < 6000, `size ${saved.s.length}`);
  const g = decodeGhost(saved);
  assert.ok(g);
  assert.equal(g.drops.length, 6);
  const p = ghostAt(g, 10 + 0.2 * 3);
  const want = path.find((q) => q[0] >= 10.6);
  assert.ok(Math.hypot(p.x - want[1], p.y - want[2]) < 6);
  assert.equal(ghostAt(g, 1000), null);
});

test('junk is not a ghost', () => {
  assert.equal(decodeGhost(null), null);
  assert.equal(decodeGhost({ v: 1, s: '!!!' }), null);
  assert.equal(decodeGhost({ v: 2, s: 'AAA' }), null);
  assert.equal(decodeGhost({ v: 1, s: 'x'.repeat(70000) }), null);
});
