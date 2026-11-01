// The courier's career: flow (the combo you build by driving well), tips per delivery, ranks, the garage, three daily jobs,
// the daily streak and one challenge per town. Pure rules and data: no page, no platform. The clock and the stars stay
// the measure of a shift; tips are how well you drove it.

import { angleDiff, DRIVE } from './config.js';
import { createRng, hashString } from './rng.js';

// ------------------------------------------------------------------ flow

export const FLOW = {
  levels: [0, 4, 10, 18, 28], // points to reach x1 .. x5
  cap: 34,
  grace: 3, // seconds of nothing before it starts to drain
  drain: 0.6, // points per second after that
  boost: 0.018, // top speed per level above x1
  gain: { turn: 1, perfect: 2, near: 1.5, drop: 1, mat: 2.5, lap: 2, threeRights: 3, express: 3 },
};

/** The flow meter: add(kind) on good driving, crash() on a crash, step(dt) every step. */
export function createFlow() {
  const f = {
    points: 0,
    level: 1,
    best: 1,
    idle: 0,
    add(kind) {
      const before = f.level;
      f.points = Math.min(FLOW.cap, f.points + (FLOW.gain[kind] || 0));
      f.idle = 0;
      f.level = levelOf(f.points);
      f.best = Math.max(f.best, f.level);
      return f.level > before;
    },
    /** A crash empties it; a scrape knocks a little off. Returns true if a level was lost. */
    crash(hard = true) {
      const before = f.level;
      f.points = hard ? 0 : Math.max(0, f.points - 2);
      f.level = levelOf(f.points);
      f.idle = 0;
      return f.level < before;
    },
    step(dt) {
      f.idle += dt;
      if (f.idle > FLOW.grace && f.points > 0) {
        const floor = FLOW.levels[f.level - 1];
        // Draining never drops a level by itself below where it is unless the bar empties: it stops at the level's floor.
        f.points = Math.max(floor, f.points - FLOW.drain * dt);
      }
    },
    /** 0..1 through the current level (1 at x5 when full). */
    fill() {
      if (f.level >= 5) return Math.min(1, (f.points - FLOW.levels[4]) / (FLOW.cap - FLOW.levels[4]));
      const a = FLOW.levels[f.level - 1];
      const b = FLOW.levels[f.level];
      return (f.points - a) / (b - a);
    },
    /** The van's top-speed factor. */
    boost: () => 1 + (f.level - 1) * FLOW.boost,
  };
  return f;
}

function levelOf(points) {
  let l = 1;
  for (let i = 1; i < FLOW.levels.length; i++) if (points >= FLOW.levels[i]) l = i + 1;
  return l;
}

/**
 * Watches the van for the moves flow pays for: clean and perfect turns, close calls with traffic. step(van, cars, events)
 * after each physics step returns [{ type: 'turn' | 'perfect' | 'near', x, y }].
 */
export function createMoves() {
  const near = new Map(); // car id → { min, hit, cross }
  let wasHold = false;
  let holdFrom = 0;
  let turned = 0;
  let scraped = false;
  let pendingTurn = null; // a released turn waiting for its snap to finish
  return {
    step(van, cars, events, dt = 1 / 60) {
      const out = [];
      const hit = events.some((e) => e.type === 'crash' || e.type === 'car' || e.type === 'soft');
      if (events.some((e) => e.type === 'scrape') || hit) scraped = true;
      // Turns: a real turn (a hold the physics counts as one, so the snap finishes it), with no scrape on the way.
      if (van.hold && !wasHold) {
        holdFrom = van.turned;
        scraped = hit;
        pendingTurn = null;
      }
      if (!van.hold && wasHold) {
        turned = van.turned - holdFrom;
        if (turned >= DRIVE.snapHeld && !van.zone && !scraped) {
          // How close to a road's direction the release was: under 5° is perfect.
          const err = Math.min(...[0, 1, 2, 3].map((d) => Math.abs(angleDiff(van.h, (d * Math.PI) / 2))));
          pendingTurn = { err, t: 0 };
        }
      }
      wasHold = van.hold;
      if (pendingTurn) {
        pendingTurn.t += dt;
        if (hit) pendingTurn = null;
        else if (pendingTurn.t > 0.35) {
          out.push({ type: pendingTurn.err < (5 * Math.PI) / 180 ? 'perfect' : 'turn', x: van.x, y: van.y });
          pendingTurn = null;
        }
      }
      // Close calls: a car crossing the van's way (or passing it) closer than a van's width, at speed, never touched.
      const seen = new Set();
      for (const c of cars || []) {
        if (c.walker || c.id === undefined) continue;
        const d = Math.hypot(c.x - van.x, c.y - van.y);
        if (d > 80) continue;
        seen.add(c.id);
        let n = near.get(c.id);
        if (!n) near.set(c.id, (n = { min: d, hit: false, fast: false, cross: false }));
        n.min = Math.min(n.min, d);
        if (van.v > 150) n.fast = true;
        const a = Math.abs(angleDiff(van.h, c.h));
        if (a > 0.5 && a < Math.PI - 0.5) n.cross = true;
      }
      for (const e of events) if (e.type === 'car' && e.car && near.has(e.car.id)) near.get(e.car.id).hit = true;
      if (hit) for (const n of near.values()) n.hit = true;
      for (const [id, n] of near) {
        if (seen.has(id)) continue;
        if (!n.hit && n.fast && n.min < (n.cross ? 52 : 40)) out.push({ type: 'near', x: van.x, y: van.y });
        near.delete(id);
      }
      return out;
    },
  };
}

// ------------------------------------------------------------------ tips

/** Tips for one delivery. o: { mat, quick (seconds since the last drop or load), level, express } */
export function tipFor(o) {
  let t = 10;
  if (o.mat) t += 10;
  if (o.quick !== undefined && o.quick < 12) t += Math.round((12 - Math.max(0, o.quick)) * 0.75);
  if (o.express) t += 40;
  return t * Math.max(1, o.level || 1);
}

/** Tips at the end of a shift: o: { stars, newBest, firstClear, medal } */
export function shiftBonus(o) {
  const parts = [];
  if (o.stars) parts.push(['STARS', o.stars * 25]);
  if (o.firstClear) parts.push(['NEW TOWN', 50]);
  if (o.newBest) parts.push(['NEW BEST', 20]);
  if (o.medal) parts.push(['CHALLENGE', 100]);
  return parts;
}

// ------------------------------------------------------------------ ranks

export const RANK_TITLES = [
  'Trainee',
  'Parcel Pup',
  'Kerb Hopper',
  'Van Hand',
  'Courier',
  'Right-Hander',
  'Doorstep Dasher',
  'Mat Finder',
  'Corner Cutter',
  'Senior Courier',
  'Roundabout Regular',
  'Clockwise Pro',
  'Express Runner',
  'Doormat Ace',
  'Route Boss',
  'Town Favourite',
  'Flow Rider',
  'Lane Weaver',
  'Depot Legend',
  'Gold Courier',
  'Night Runner',
  'Snow Driver',
  'Storm Chaser',
  'Bridge Master',
  'Twelve-Town Hero',
  'Platinum Courier',
  'Head of Fleet',
  'Courier Royalty',
  'The Right Stuff',
  'Clockwise Legend',
];

/** Tips needed to go from rank r to r + 1. */
export const rankStep = (r) => 80 + 45 * r;

/** Rank from lifetime tips: { rank (1..30), title, into, need, max } */
export function rankOf(xp) {
  let r = 1;
  let left = Math.max(0, xp | 0);
  while (r < RANK_TITLES.length && left >= rankStep(r)) {
    left -= rankStep(r);
    r++;
  }
  const max = r >= RANK_TITLES.length;
  return { rank: r, title: RANK_TITLES[r - 1], into: max ? 0 : left, need: max ? 0 : rankStep(r), max };
}

// ------------------------------------------------------------------ the garage

// Unlock conditions: { rank } | { stars } | { streak } (best streak) | { medals } (town challenges) | { jobs } (jobs done).
export const PAINTS = [
  { id: 'courier', name: 'Courier Yellow', color: '#FFC22E', rank: 1 },
  { id: 'post', name: 'Post Red', color: '#D9412E', rank: 2 },
  { id: 'mint', name: 'Mint', color: '#5BC4A0', rank: 4 },
  { id: 'sky', name: 'Sky Blue', color: '#4FA3E8', rank: 6 },
  { id: 'grape', name: 'Grape', color: '#8C5BD1', rank: 8 },
  { id: 'flamingo', name: 'Flamingo', color: '#F07AA8', rank: 10 },
  { id: 'snow', name: 'Snow White', color: '#F4F1E8', rank: 12 },
  { id: 'ink', name: 'Ink', color: '#2E3440', rank: 15 },
  { id: 'lime', name: 'Lime', color: '#A8D93B', rank: 18 },
  { id: 'tangerine', name: 'Tangerine', color: '#F28C3B', rank: 21 },
  { id: 'teal', name: 'Teal', color: '#1F9AA6', jobs: 10 },
  { id: 'chrome', name: 'Chrome', color: '#C9CED6', streak: 7 },
  { id: 'gold', name: 'Gold', color: '#E8B931', stars: 36 },
];

export const TOPPERS = [
  { id: 'none', name: 'Nothing', rank: 1 },
  { id: 'cone', name: 'Traffic Cone', rank: 3 },
  { id: 'flag', name: 'Pennant', rank: 7 },
  { id: 'duck', name: 'Rubber Duck', streak: 3 },
  { id: 'lightbar', name: 'Light Bar', rank: 11 },
  { id: 'stack', name: 'Parcel Tower', rank: 14 },
  { id: 'dish', name: 'Satellite Dish', rank: 20 },
  { id: 'tree', name: 'Pine Tree', medals: 6 },
  { id: 'crown', name: 'Crown', medals: 12 },
];

export const TRAILS = [
  { id: 'none', name: 'No Trail', rank: 1 },
  { id: 'sparks', name: 'Sparks', rank: 5 },
  { id: 'confetti', name: 'Confetti', rank: 9 },
  { id: 'bubbles', name: 'Bubbles', jobs: 25 },
  { id: 'rainbow', name: 'Rainbow', rank: 16 },
  { id: 'stars', name: 'Stars', streak: 14 },
  { id: 'flames', name: 'Flames', rank: 25 },
];

/** Parcel wraps: what the parcels on your roof (and the ones you throw) are wrapped in. card / tape colours. */
export const WRAPS = [
  { id: 'kraft', name: 'Brown Paper', card: '#C8925A', tape: '#E9D8B4', rank: 1 },
  { id: 'priority', name: 'Priority Blue', card: '#2F6FD6', tape: '#F4F1E8', rank: 4 },
  { id: 'fragile', name: 'Fragile', card: '#F1ECE0', tape: '#D9412E', rank: 8 },
  { id: 'gift', name: 'Gift Wrap', card: '#D9412E', tape: '#FFD23F', rank: 13 },
  { id: 'mint', name: 'Mint Box', card: '#5BC4A0', tape: '#F4F1E8', jobs: 40 },
  { id: 'royal', name: 'Royal Purple', card: '#6A3FB5', tape: '#FFC22E', medals: 3 },
  { id: 'neon', name: 'Neon', card: '#2E3440', tape: '#FF4FD8', rank: 19 },
];

/** What a profile has earned so far: { rank, stars, streak, medals, jobs }. */
export function progressOf(p) {
  return {
    rank: rankOf(p.xp || 0).rank,
    stars: Object.values(p.stars || {}).reduce((a, b) => a + (b | 0), 0),
    streak: (p.streak && p.streak.best) || 0,
    medals: Object.keys(p.medals || {}).length,
    jobs: p.jobsDone || 0,
  };
}

/** Is a garage item (or van body, which needs stars) unlocked for this progress? */
export function isUnlocked(item, pr) {
  if (item.rank !== undefined && pr.rank < item.rank) return false;
  if (item.stars !== undefined && pr.stars < item.stars) return false;
  if (item.streak !== undefined && pr.streak < item.streak) return false;
  if (item.medals !== undefined && pr.medals < item.medals) return false;
  if (item.jobs !== undefined && pr.jobs < item.jobs) return false;
  return true;
}

/** The unlock condition in a few words. */
export function unlockText(item) {
  if (item.rank !== undefined && item.rank > 1) return `RANK ${item.rank}`;
  if (item.stars) return `${item.stars} STARS`;
  if (item.streak) return `${item.streak}-DAY STREAK`;
  if (item.medals) return `${item.medals} MEDALS`;
  if (item.jobs) return `${item.jobs} JOBS`;
  return '';
}

/** Items newly unlocked between two progress snapshots, across every list given. */
export function newlyUnlocked(before, after, lists) {
  const out = [];
  for (const list of lists) for (const item of list) if (!isUnlocked(item, before) && isUnlocked(item, after)) out.push(item);
  return out;
}

// ------------------------------------------------------------------ daily jobs and the streak

export const JOBS = [
  { id: 'mats', text: 'Land {n} parcels on the mat', stat: 'mats', n: [4, 6, 8], tips: 60 },
  { id: 'parcels', text: 'Deliver {n} parcels', stat: 'parcels', n: [10, 15, 20], tips: 50 },
  { id: 'flow', text: 'Reach flow x{n}', stat: 'maxFlow', n: [3, 4, 5], max: true, tips: 70 },
  { id: 'perfect', text: 'Make {n} perfect turns', stat: 'perfect', n: [5, 8, 12], tips: 60 },
  { id: 'near', text: '{n} close calls with traffic', stat: 'near', n: [3, 5, 8], tips: 60 },
  { id: 'laps', text: 'Lap a roundabout {n} times', stat: 'laps', n: [1, 2, 3], tips: 60 },
  { id: 'clean', text: 'Finish {n} shifts with no crash', stat: 'clean', n: [1, 2, 3], tips: 70 },
  { id: 'stars', text: 'Win {n} stars', stat: 'stars', n: [3, 5, 7], tips: 70 },
  { id: 'express', text: 'Deliver {n} express parcels', stat: 'express', n: [1, 2, 3], tips: 80 },
  { id: 'tips', text: 'Earn {n} tips', stat: 'tips', n: [300, 500, 800], tips: 60 },
  { id: 'shifts', text: 'Finish {n} shifts', stat: 'shifts', n: [2, 3, 4], tips: 50 },
];

/** Today's three jobs: [{ id, text, stat, n, max, tips }], the same for everyone on a given day. */
export function jobsFor(day) {
  const rng = createRng(hashString(`jobs:${day}`));
  const pool = rng.shuffle(JOBS.slice());
  return pool.slice(0, 3).map((j) => {
    const n = j.n[rng.int(j.n.length)];
    return { id: j.id, text: j.text.replace('{n}', String(n)), stat: j.stat, n, max: !!j.max, tips: j.tips };
  });
}

/** Add one shift's stats into the day's running totals (max for the `max` stats). */
export function addStats(day, shift) {
  const out = { ...day };
  for (const [k, v] of Object.entries(shift)) {
    if (typeof v !== 'number') continue;
    out[k] = k === 'maxFlow' ? Math.max(out[k] || 0, v) : (out[k] || 0) + v;
  }
  return out;
}

/** How far along a job is: 0..1. */
export const jobProgress = (job, stats) => Math.min(1, (stats[job.stat] || 0) / job.n);

/** The streak after playing on `day`: { last, n, best }. Missing a day starts it again at 1. */
export function streakAfter(s, day) {
  const cur = s || { last: -1, n: 0, best: 0 };
  if (cur.last === day) return cur;
  const n = cur.last === day - 1 ? cur.n + 1 : 1;
  return { last: day, n, best: Math.max(cur.best || 0, n) };
}

/** The streak as it stands today (it is broken if yesterday was missed). */
export const streakNow = (s, day) => (s && (s.last === day || s.last === day - 1) ? s.n : 0);

// ------------------------------------------------------------------ town challenges

/** One per town; `test(stats)` on a finished shift's stats. */
export const CHALLENGES = {
  1: { text: 'Every parcel on the mat', test: (s) => s.parcels > 0 && s.mats >= s.parcels },
  2: { text: 'A shift with no crash', test: (s) => s.crashes === 0 },
  3: { text: 'Lap the roundabout 3 times', test: (s) => s.laps >= 3 },
  4: { text: '6 close calls in traffic', test: (s) => s.near >= 6 },
  5: { text: 'Reach flow x5', test: (s) => s.maxFlow >= 5 },
  6: { text: 'No crash on the ice', test: (s) => s.crashes === 0 },
  7: { text: 'Three rights, twice', test: (s) => s.threeRights >= 2 },
  8: { text: 'Beat the three-star time', test: (s) => s.stars >= 3 },
  9: { text: '12 perfect turns', test: (s) => s.perfect >= 12 },
  10: { text: 'Deliver the express parcel', test: (s) => s.express >= 1 },
  11: { text: '8 perfect turns, no crash', test: (s) => s.perfect >= 8 && s.crashes === 0 },
  12: { text: 'Every parcel on the mat', test: (s) => s.parcels > 0 && s.mats >= s.parcels },
};

// ------------------------------------------------------------------ settling a shift

/**
 * Pay a finished shift into the profile. o: { town (id), day, tips (earned driving), stats: { parcels, mats, crashes,
 * laps, near, perfect, threeRights, express, maxFlow }, stars, newBest, firstClear, lists (garage lists for unlocks) }.
 * Returns { profile (a new object), report: { driven, bonus: [[label, tips]], jobBonus, total, before, after, jobs: [{ text,
 * progress, done, fresh, tips }], medal (text or null), streak, unlocks: [item] } }.
 */
export function settleShift(profile, o) {
  const p = { ...profile, jobs: profile.jobs ? { ...profile.jobs } : null, medals: { ...(profile.medals || {}) } };
  const beforeProgress = progressOf(profile);
  const before = rankOf(profile.xp || 0);
  const stats = { ...o.stats, stars: o.stars || 0, tips: o.tips || 0, shifts: 1, clean: o.stats.crashes === 0 ? 1 : 0 };
  // The town's challenge.
  const ch = CHALLENGES[o.town];
  const medal = ch && !p.medals[o.town] && ch.test(stats) ? ch.text : null;
  if (medal) p.medals[o.town] = 1;
  const bonus = shiftBonus({ stars: o.stars, newBest: o.newBest, firstClear: o.firstClear, medal: !!medal });
  // Today's jobs.
  const jobs = jobsFor(o.day);
  if (!p.jobs || p.jobs.day !== o.day) p.jobs = { day: o.day, stats: {}, paid: [] };
  const was = p.jobs.stats;
  p.jobs.stats = addStats(was, stats);
  p.jobs.paid = (p.jobs.paid || []).slice();
  let jobBonus = 0;
  const jobList = jobs.map((j) => {
    const progress = jobProgress(j, p.jobs.stats);
    const fresh = progress >= 1 && !p.jobs.paid.includes(j.id);
    if (fresh) {
      p.jobs.paid.push(j.id);
      jobBonus += j.tips;
      p.jobsDone = (p.jobsDone || 0) + 1;
    }
    return { text: j.text, progress, done: progress >= 1, fresh, tips: j.tips };
  });
  // The streak counts any finished shift.
  p.streak = streakAfter(profile.streak, o.day);
  const total = (o.tips || 0) + bonus.reduce((a, b) => a + b[1], 0) + jobBonus;
  p.xp = (profile.xp || 0) + total;
  const after = rankOf(p.xp);
  const unlocks = newlyUnlocked(beforeProgress, progressOf(p), o.lists || [PAINTS, TOPPERS, TRAILS, WRAPS]);
  return { profile: p, report: { driven: o.tips || 0, bonus, jobBonus, total, before, after, jobs: jobList, medal, streak: p.streak.n, unlocks } };
}
