import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOW, createFlow, createMoves, tipFor, shiftBonus, rankOf, rankStep, RANK_TITLES, PAINTS, TOPPERS, TRAILS, progressOf, isUnlocked, newlyUnlocked, jobsFor, JOBS, addStats, jobProgress, streakAfter, streakNow, CHALLENGES } from '../game/career.js';
import { TOWNS } from '../game/towns.js';
import { VAN_BODIES } from '../game/config.js';
import { createVan } from '../game/physics.js';

test('flow climbs x1 to x5 on good driving and a crash empties it', () => {
  const f = createFlow();
  assert.equal(f.level, 1);
  assert.equal(f.boost(), 1);
  f.add('mat');
  f.add('perfect');
  assert.equal(f.level, 2); // 4.5 points
  for (let i = 0; i < 14; i++) f.add('mat');
  assert.equal(f.level, 5);
  assert.equal(f.points, FLOW.cap);
  assert.ok(f.boost() > 1.05 && f.boost() < 1.1);
  assert.equal(f.crash(), true);
  assert.equal(f.level, 1);
  assert.equal(f.points, 0);
  assert.equal(f.best, 5);
});

test('flow drains after a quiet spell but never below the level it reached', () => {
  const f = createFlow();
  for (let i = 0; i < 4; i++) f.add('mat'); // 10 points: x3
  assert.equal(f.level, 3);
  f.add('turn'); // 11
  for (let i = 0; i < 60 * 2; i++) f.step(1 / 60);
  assert.equal(f.points, 11); // within the grace
  for (let i = 0; i < 60 * 20; i++) f.step(1 / 60);
  assert.equal(f.level, 3);
  assert.equal(f.points, FLOW.levels[2]);
  assert.ok(f.fill() === 0);
});

test('a scrape knocks a little off; fill runs 0..1 within a level', () => {
  const f = createFlow();
  f.add('mat');
  f.add('drop'); // 3.5
  assert.ok(Math.abs(f.fill() - 3.5 / 4) < 1e-9);
  f.crash(false);
  assert.equal(f.points, 1.5);
});

test('moves: a held turn released square onto the road is perfect, a sloppy one is a turn, a scraped one nothing', () => {
  const moves = createMoves();
  const van = createVan(0, 0, 0, 200);
  const run = (fromH, toH, scrape = false) => {
    const out = [];
    van.h = fromH;
    van.hold = true;
    van.turned = 0;
    out.push(...moves.step(van, [], []));
    van.turned = toH - fromH;
    van.h = toH;
    out.push(...moves.step(van, [], scrape ? [{ type: 'scrape' }] : []));
    van.hold = false;
    for (let i = 0; i < 30; i++) out.push(...moves.step(van, [], []));
    return out.map((e) => e.type);
  };
  assert.deepEqual(run(0, Math.PI / 2 + 0.02), ['perfect']);
  assert.deepEqual(run(0, Math.PI / 2 + 0.2), ['turn']);
  assert.deepEqual(run(0, Math.PI / 2, true), []);
  assert.deepEqual(run(0, 0.5), []); // too small to count
});

test('moves: a car crossing close in front at speed is a close call; touching it is not', () => {
  const pass = (minGap, touch) => {
    const moves = createMoves();
    const van = createVan(0, 0, 0, 220);
    const out = [];
    for (let i = -30; i <= 30; i++) {
      const car = { id: 7, x: 30 + minGap, y: i * 4, h: Math.PI / 2, v: 200, len: 46, wid: 26 };
      const ev = touch && i === 0 ? [{ type: 'car', car }] : [];
      out.push(...moves.step(van, [car], ev));
    }
    out.push(...moves.step(van, [], []));
    return out.filter((e) => e.type === 'near').length;
  };
  assert.equal(pass(10, false), 1);
  assert.equal(pass(40, false), 0);
  assert.equal(pass(10, true), 0);
});

test('tips: a base, the mat, a quick bonus, the express, times the flow', () => {
  assert.equal(tipFor({ mat: false, level: 1 }), 10);
  assert.equal(tipFor({ mat: true, level: 1 }), 20);
  assert.equal(tipFor({ mat: true, level: 3 }), 60);
  assert.equal(tipFor({ mat: false, quick: 0, level: 1 }), 19);
  assert.equal(tipFor({ mat: false, quick: 20, level: 1 }), 10);
  assert.equal(tipFor({ mat: true, express: true, level: 2 }), 120);
  const b = shiftBonus({ stars: 3, newBest: true, firstClear: true, medal: true });
  assert.deepEqual(
    b.map((x) => x[0]),
    ['STARS', 'NEW TOWN', 'NEW BEST', 'CHALLENGE'],
  );
  assert.equal(
    b.reduce((a, x) => a + x[1], 0),
    75 + 50 + 20 + 100,
  );
});

test('ranks: thirty of them, each a little further than the last', () => {
  assert.equal(RANK_TITLES.length, 30);
  assert.deepEqual(rankOf(0), { rank: 1, title: 'Trainee', into: 0, need: rankStep(1), max: false });
  assert.equal(rankOf(rankStep(1) - 1).rank, 1);
  assert.equal(rankOf(rankStep(1)).rank, 2);
  let total = 0;
  for (let r = 1; r < 30; r++) total += rankStep(r);
  assert.equal(rankOf(total - 1).rank, 29);
  const top = rankOf(total + 99999);
  assert.equal(top.rank, 30);
  assert.equal(top.max, true);
  assert.ok(total > 15000 && total < 30000, `${total} tips to the top`);
});

test('garage: every item has a unique id and a way to unlock it; rank, stars, streak, medals and jobs all count', () => {
  for (const list of [PAINTS, TOPPERS, TRAILS]) {
    const ids = new Set(list.map((i) => i.id));
    assert.equal(ids.size, list.length);
    assert.ok(isUnlocked(list[0], { rank: 1, stars: 0, streak: 0, medals: 0, jobs: 0 }), 'the first is free');
  }
  const p = progressOf({ xp: 0, stars: { 1: 3, 2: 2 }, streak: { best: 3 }, medals: { 1: 1 }, jobsDone: 4 });
  assert.deepEqual(p, { rank: 1, stars: 5, streak: 3, medals: 1, jobs: 4 });
  assert.equal(isUnlocked(TOPPERS.find((t) => t.id === 'duck'), p), true);
  assert.equal(isUnlocked(PAINTS.find((t) => t.id === 'chrome'), p), false);
  assert.equal(isUnlocked(VAN_BODIES[1], p), false); // 6 stars
  const after = { ...p, rank: 5 };
  const fresh = newlyUnlocked(p, after, [PAINTS, TOPPERS, TRAILS]).map((i) => i.id);
  assert.deepEqual(fresh.sort(), ['cone', 'mint', 'post', 'sparks'].sort());
});

test('daily jobs: three different jobs, the same all day, different on other days', () => {
  const a = jobsFor(20400);
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((j) => j.id)).size, 3);
  assert.deepEqual(jobsFor(20400), a);
  let differ = false;
  for (let d = 20401; d < 20410; d++) if (JSON.stringify(jobsFor(d)) !== JSON.stringify(a)) differ = true;
  assert.ok(differ);
  for (const j of a) {
    assert.ok(!j.text.includes('{n}'));
    assert.ok(j.tips > 0);
  }
});

test('daily stats add up across shifts; the best flow is a max; progress caps at 1', () => {
  let day = {};
  day = addStats(day, { mats: 3, parcels: 6, maxFlow: 3, near: 1 });
  day = addStats(day, { mats: 2, parcels: 6, maxFlow: 2, near: 4 });
  assert.deepEqual(day, { mats: 5, parcels: 12, maxFlow: 3, near: 5 });
  assert.equal(jobProgress({ stat: 'mats', n: 4 }, day), 1);
  assert.equal(jobProgress({ stat: 'near', n: 10 }, day), 0.5);
  assert.equal(jobProgress({ stat: 'laps', n: 1 }, day), 0);
});

test('streak: playing on consecutive days builds it, a missed day starts again, the best is kept', () => {
  let s = streakAfter(null, 100);
  assert.deepEqual(s, { last: 100, n: 1, best: 1 });
  s = streakAfter(s, 100);
  assert.equal(s.n, 1);
  s = streakAfter(s, 101);
  s = streakAfter(s, 102);
  assert.deepEqual(s, { last: 102, n: 3, best: 3 });
  assert.equal(streakNow(s, 103), 3); // still alive today
  assert.equal(streakNow(s, 104), 0); // missed a day
  s = streakAfter(s, 105);
  assert.deepEqual(s, { last: 105, n: 1, best: 3 });
});

test('town challenges: one for every town, each a fair test of a finished shift', () => {
  for (const t of TOWNS) assert.ok(CHALLENGES[t.id], `town ${t.id}`);
  const base = { parcels: 6, mats: 6, crashes: 0, laps: 3, near: 6, maxFlow: 5, threeRights: 2, stars: 3, perfect: 12, express: 1 };
  for (const t of TOWNS) assert.equal(CHALLENGES[t.id].test(base), true, `town ${t.id} passes a perfect shift`);
  const poor = { parcels: 6, mats: 2, crashes: 3, laps: 0, near: 0, maxFlow: 1, threeRights: 0, stars: 1, perfect: 0, express: 0 };
  for (const t of TOWNS) assert.equal(CHALLENGES[t.id].test(poor), false, `town ${t.id} fails a poor shift`);
});

test('settling a shift pays tips, bonuses and fresh jobs once, ranks up, keeps the streak and awards the medal once', async () => {
  const { settleShift, jobsFor: jf } = await import('../game/career.js');
  const day = 20400;
  const jobs = jf(day);
  // Stats that finish every job there is.
  const stats = { parcels: 30, mats: 30, crashes: 0, laps: 5, near: 10, perfect: 20, threeRights: 2, express: 3, maxFlow: 5 };
  const p0 = { xp: 0, stars: {}, streak: null };
  const a = settleShift(p0, { town: 1, day, tips: 900, stats, stars: 3, newBest: false, firstClear: true });
  assert.equal(a.report.medal, 'Every parcel on the mat');
  assert.equal(a.profile.medals[1], 1);
  const doneJobs = a.report.jobs.filter((j) => j.done);
  assert.ok(doneJobs.length >= 1);
  assert.equal(a.report.jobs.filter((j) => j.fresh).length, doneJobs.length);
  assert.equal(a.report.jobBonus, doneJobs.reduce((s, j) => s + j.tips, 0));
  assert.equal(jobs.length, 3);
  assert.equal(a.report.total, 900 + 75 + 50 + 100 + a.report.jobBonus);
  assert.equal(a.profile.xp, a.report.total);
  assert.ok(a.report.after.rank > a.report.before.rank);
  assert.equal(a.profile.streak.n, 1);
  assert.equal(a.profile.jobsDone, doneJobs.length);
  // The same day again: no job paid twice, no second medal, streak unchanged.
  const b = settleShift(a.profile, { town: 1, day, tips: 100, stats, stars: 3, newBest: false, firstClear: false });
  assert.ok(b.report.jobs.filter((j) => j.fresh).every((j) => !doneJobs.some((d) => d.text === j.text)));
  const paidAgain = b.report.jobBonus;
  assert.equal(b.report.medal, null);
  assert.equal(b.report.total, 100 + 75 + paidAgain);
  assert.equal(b.profile.streak.n, 1);
  // Tomorrow: new jobs, the streak grows.
  const c = settleShift(b.profile, { town: 2, day: day + 1, tips: 10, stats: { ...stats, crashes: 1 }, stars: 1 });
  assert.equal(c.profile.streak.n, 2);
  assert.equal(c.profile.jobs.day, day + 1);
  // The input profile is never changed.
  assert.equal(p0.xp, 0);
  assert.equal(a.profile.medals[2], undefined);
});
