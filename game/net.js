// The room: joining, the Shift Scramble match (createMatch), deliveries as host claims, the bots the host drives, and every
// van's presence. Each page simulates its own van against the shared traffic clock (match.elapsed); only deliveries are
// decided by the host.

import { DT, DELIVERY, SCRAMBLE, BOTS, VAN_BODIES, DX, DY, clamp } from './config.js';
import { TOWNS } from './towns.js';
import { bridgeState, closedTiles } from './city.js';
import { createTraffic } from './traffic.js';
import { cityFor } from './world.js';
import { createDriver, houseTarget, depotTarget, graphFor } from './driver.js';
import { trapHouses } from './shift.js';
import { newScramble, fillAddresses, checkClaim, applyDrop, openLastCall, createRunner, stepRunner, openList, scrambleTargets, scrambleClosure, ADDR_ID } from './scramble.js';

export const SETTINGS = [
  { id: 'towns', label: 'Towns', options: [{ value: 'mixed', label: 'Mixed' }, { value: 'easy', label: 'Easy' }, { value: 'hard', label: 'Hard' }], default: 'mixed' },
  // A shift's round includes its 3 s intro (the town from above, the addresses lit), so 2:00 of driving is 123 s.
  { id: 'shift', label: 'Shift', options: [{ value: 120 + SCRAMBLE.intro, label: '2:00' }, { value: 180 + SCRAMBLE.intro, label: '3:00' }], default: 120 + SCRAMBLE.intro },
];

/** Seconds of driving in this shift so far (the round's first seconds are the intro). */
export const shiftTime = (m) => Math.max(0, m.elapsed / 1000 - SCRAMBLE.intro);

/** Join the room as the page loads, then load the helpers. Null when there's no platform. */
export async function connect(ow, onJoin) {
  if (!ow || !ow.rooms) return null;
  let room;
  try {
    room = await ow.rooms.join({ maxPlayers: 6, minPlayers: 1, lobby: 'bar', settings: SETTINGS });
  } catch {
    return null;
  }
  try {
    if (onJoin) onJoin(room);
  } catch {
    /* the page's business */
  }
  let helpers = null;
  const HELPERS = '/__onceworlds/v1/';
  try {
    // The platform serves its helpers next to the SDK; they are never bundled.
    const at = (name) => import(/* @vite-ignore */ `${HELPERS}${name}.js`);
    const [m, h, b] = await Promise.all([at('match'), at('host'), at('bots')]);
    helpers = { createMatch: m.createMatch, createHost: h.createHost, createBots: b.createBots, t: h.t };
  } catch {
    helpers = null;
  }
  return createNet(room, helpers);
}

/** The town pool for a setting. */
export function townPool(setting) {
  if (setting === 'easy') return TOWNS.slice(0, 6);
  if (setting === 'hard') return TOWNS.slice(6);
  return TOWNS;
}

/** Where seat i waits at the start: a 2×3 grid in and behind the depot bay. */
export function startSpot(city, i) {
  const d = city.depot;
  const back = (d.dir + 2) % 4;
  const row = Math.floor(i / 2);
  const side = i % 2 ? 1 : -1;
  const rx = -DY[d.dir];
  const ry = DX[d.dir];
  return { x: d.x + DX[back] * row * 56 + rx * side * 22, y: d.y + DY[back] * row * 56 + ry * side * 22, h: d.heading };
}

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** A van from presence, checked; null when it isn't a sensible one. */
export function cleanVan(p, city) {
  if (!p || typeof p !== 'object' || !city) return null;
  if (!num(p.x, -50, city.W + 50) || !num(p.y, -50, city.H + 50) || !num(p.h, -1e4, 1e4)) return null;
  return {
    x: p.x,
    y: p.y,
    h: p.h,
    v: num(p.v, 0, 400) ? p.v : 0,
    k: p.k === 1 || p.k === true,
    p: Number.isInteger(p.p) && p.p >= 0 && p.p <= 3 ? p.p : 0,
    body: Number.isInteger(p.body) && p.body >= 0 && p.body < VAN_BODIES.length ? p.body : 0,
    s: num(p.s, 0, 2) ? p.s : 0,
  };
}

export function createNet(room, helpers, opts = {}) {
  const t = helpers && helpers.t;
  const net = {
    room,
    helpers,
    match: null,
    host: null,
    bots: null,
    // The scramble as this page simulates it.
    world: null, // { key, city, traffic, env, me: runner, bots: Map, t, closureK }
    events: [],
    myBody: 0,
    lastData: null, // the last round's data, for the between-shift map
    trails: new Map(), // seat id → [[x, y], ...] this shift
    onDrop: null, // (result, pass) for my own claims
    profileWins: 0,
  };
  if (!helpers) return net;

  const host = helpers.createHost(room);
  net.host = host;

  const seatIndex = (id) => {
    const seats = net.match ? net.match.seats : [];
    const i = seats.findIndex((s) => s.id === id);
    return i < 0 ? 0 : i;
  };
  net.seatIndex = seatIndex;
  const botInfo = (seat) => BOTS.find((b) => b.name === seat.name) || BOTS[(parseInt(String(seat.id).split(':')[1], 10) || 1) % BOTS.length];
  net.botInfo = botInfo;

  const match = helpers.createMatch(room, {
    rounds: SCRAMBLE.shifts,
    roundSeconds: 'shift',
    roundEndSeconds: SCRAMBLE.roundEnd,
    resultsSeconds: SCRAMBLE.results,
    admit: 'round',
    data: {
      town: t.int(0, 99),
      addrs: t.array(t.object({ id: t.string(12), house: t.int(0, 999), gold: t.boolean() }), 8),
      seq: t.int(0, 1e6),
      pts: t.record(t.int(0, 999), 32),
      mats: t.record(t.int(0, 999), 32),
      log: t.array(t.array(t.any(), 5), 12),
      bots: t.record(t.any(), 8),
      lastCall: t.boolean(),
    },
    startRound(m) {
      const pool = townPool(room.settings && room.settings.towns);
      const order = m.random('towns').shuffle(pool.map((tw) => tw.id));
      const town = TOWNS.find((tw) => tw.id === order[(m.round - 1) % order.length]) || TOWNS[0];
      const city = cityFor(town);
      const data = newScramble(town.id);
      const spots = m.seats.map((_, i) => startSpot(city, i));
      const rng = m.random(`addr:${m.roundId}:0`);
      fillAddresses(city, data, spots, rng.next, m.seats.length, town.cones ? trapHouses(city) : null);
      data.bots = {};
      return data;
    },
    onTick(m) {
      const data = m.data;
      if (!data || m.phase !== 'round') return;
      const w = net.world;
      if (!w || w.key !== m.roundId) return;
      // Last call.
      if (!data.lastCall && m.secondsLeft <= SCRAMBLE.lastCall) {
        const d = copyData(data);
        const vans = allVans().map((v) => ({ x: v.x, y: v.y, h: v.h }));
        const rng = m.random(`addr:${m.roundId}:${d.seq}:gold`);
        openLastCall(w.city, graphFor(w.city, w.env.closed, `k${w.closureK}`), d, vans, rng.next, w.town.cones ? trapHouses(w.city) : null);
        m.setData(d);
      }
      // Bots checkpoint every 2 s, so a new host can take them over.
      const now = Date.now();
      if (now - (net.lastCheckpoint || 0) > 2000 && w.bots.size) {
        net.lastCheckpoint = now;
        const bots = {};
        for (const [id, b] of w.bots) bots[id] = { x: Math.round(b.van.x), y: Math.round(b.van.y), h: round2(b.van.h), p: b.p };
        m.setData({ ...copyData(m.data), bots });
      }
    },
    score: (m) => (m.data && m.data.pts) || {},
  });
  net.match = match;

  net.bots = helpers.createBots(match, { host, fill: SCRAMBLE.seats, every: 1000, names: BOTS.map((b) => b.name), skill: [0.3, 0.8], think: () => null });

  // Deliveries: the earliest valid claim on an address wins it.
  const drop = host.claim('drop', {
    args: { a: t.string(12), m: t.boolean() },
    key: (a) => a.a,
    rate: 4,
    validate(c) {
      const m = match;
      const w = net.world;
      if (!w || m.phase !== 'round' || m.paused || !m.data || w.key !== m.roundId || shiftTime(m) <= 0) return 'not now';
      if (!ADDR_ID.test(c.args.a)) return 'bad';
      const seat = m.seats.find((s) => s.id === c.from.id && !s.left);
      if (!seat) return 'not seated';
      let who;
      if (seat.bot) {
        const b = w.bots.get(seat.id);
        who = b ? { playing: true, parcels: b.p + 1, x: b.van.x, y: b.van.y } : null;
      } else {
        const p = room.players.get(seat.id);
        const v = p && p.presence && p.presence.r === m.roundId ? cleanVan(p.presence, w.city) : null;
        // The claim leaves as the parcel does: the presence may already show one fewer.
        who = v ? { playing: true, parcels: v.p + 1, x: v.x, y: v.y } : null;
      }
      const why = checkClaim(w.city, m.data, { addr: c.args.a, mat: c.args.m }, who);
      if (why && seat.bot) giveBack(seat.id);
      return why ? why : true;
    },
    apply(winner, rivals) {
      const m = match;
      const w = net.world;
      for (const r of rivals || []) if (String(r.from.id).startsWith('bot:')) giveBack(r.from.id);
      if (!m.data || !w) return;
      const d = copyData(m.data);
      const entry = applyDrop(d, winner.from.id, winner.args.a, winner.args.m, m.elapsed);
      if (!entry) return;
      const rng = m.random(`addr:${m.roundId}:${d.seq}`);
      fillAddresses(w.city, d, allVans(), rng.next, m.seats.length, w.town.cones ? trapHouses(w.city) : null);
      m.setData(d);
    },
  });
  net.drop = drop;

  /** A bot's claim lost or was refused: the parcel goes back on its roof. */
  function giveBack(id) {
    const b = net.world && net.world.bots.get(id);
    if (b) b.p = Math.min(DELIVERY.perLoad, b.p + 1);
  }

  // ------------------------------------------------------------ the page's own simulation

  /** Am I driving in this shift (not watching)? */
  net.playing = () => {
    const m = match;
    return !!m.me && !m.spectating && !m.me.left;
  };

  /** Every van (mine, players' drawn, bots) as { id, x, y, h, v }. */
  function allVans() {
    const out = [];
    const w = net.world;
    if (!w) return out;
    if (net.playing()) out.push({ id: room.me.id, x: w.me.van.x, y: w.me.van.y, h: w.me.van.h, v: w.me.van.v });
    for (const o of net.others()) out.push(o);
    return out;
  }
  net.allVans = allVans;

  /** Set up (or keep) this shift's world. */
  net.ensureWorld = () => {
    const m = match;
    const data = m.data;
    if (!data || m.phase !== 'round') return net.world;
    const key = m.roundId;
    if (net.world && net.world.key === key) return net.world;
    const town = TOWNS.find((tw) => tw.id === data.town) || TOWNS[0];
    const city = cityFor(town);
    const traffic = createTraffic(city);
    const mySeat = seatIndex(room.me.id);
    const spot = startSpot(city, mySeat);
    const me = createRunner(city, room.me.id);
    Object.assign(me.van, { x: spot.x, y: spot.y, h: spot.h, vh: spot.h, v: 0 });
    // A reload mid-shift: carry on from where my presence says I was.
    const mine = room.me.presence && room.me.presence.r === key ? cleanVan(room.me.presence, city) : null;
    if (mine && shiftTime(m) > 1.5) {
      Object.assign(me.van, { x: mine.x, y: mine.y, h: mine.h, vh: mine.h, v: mine.v });
      me.p = mine.p;
    }
    net.world = { key, town, city, traffic, env: { closed: new Set(), bridgeUp: false, cars: [], vans: [], t: 0 }, me, bots: new Map(), t: 0, closureK: 0 };
    net.trails = new Map();
    net.drawnBots = new Map(); // last shift's are in another town
    return net.world;
  };

  /** Take over the bots (host): from the checkpoint or where they were last drawn, else the start grid. */
  function adoptBots() {
    const w = net.world;
    const m = match;
    if (!w || !m.isHost) return;
    m.seats.forEach((seat, i) => {
      if (!seat.bot || w.bots.has(seat.id)) return;
      const info = botInfo(seat);
      const r = createRunner(w.city, seat.id);
      r.driver = createDriver({ skill: info.skill, style: info.style, seed: i + 1 });
      const cp = m.data && m.data.bots && m.data.bots[seat.id];
      const drawn = net.drawnBots && net.drawnBots.get(seat.id);
      const from = drawn || (cp && num(cp.x, 0, w.city.W) && num(cp.y, 0, w.city.H) ? cp : null);
      if (from && shiftTime(m) > 1.5) {
        Object.assign(r.van, { x: from.x, y: from.y, h: from.h || 0, vh: from.h || 0, v: from.v || 0 });
        r.p = Number.isInteger(from.p) ? clamp(from.p, 0, 3) : 3;
      } else {
        const spot = startSpot(w.city, i);
        Object.assign(r.van, { x: spot.x, y: spot.y, h: spot.h, vh: spot.h, v: 0 });
      }
      r.delay = shiftTime(m) > 1.5 ? 0 : i * 0.25;
      w.bots.set(seat.id, r);
    });
    for (const id of [...w.bots.keys()]) if (!m.seats.some((s) => s.id === id && s.bot)) w.bots.delete(id);
  }

  /**
   * Advance my van (and, on the host, the bots) to the shared clock. Returns events for the page:
   * { type: 'pass', pass } (my throws) and the physics events of my van.
   */
  net.step = (hold) => {
    const m = match;
    const w = net.world;
    const out = [];
    if (!w || m.phase !== 'round' || m.paused || !m.data) return out;
    if (m.isHost) adoptBots();
    else if (w.bots.size) w.bots.clear();
    const playing = net.playing();
    const target = shiftTime(m);
    // Catch up at most a second at a time (a hidden tab comes back quickly).
    if (target - w.t > 1) w.t = target - 1;
    const open = openList(w.city, m.data);
    const others = net.others();
    let steps = 0;
    while (w.t + DT <= target && steps < 90) {
      steps++;
      const tt = w.t + DT;
      envAt(w, tt);
      // My van.
      if (playing) {
        w.env.vans = others;
        const ev = [];
        const passes = stepRunner(w.me, hold, w.city, w.env, open, ev);
        for (const e of ev) out.push(e);
        for (const p of passes) {
          out.push({ type: 'pass', pass: p });
          Promise.resolve(drop({ a: p.addr, m: !!p.mat }))
            .then((res) => net.onDrop && net.onDrop(res, p))
            .catch(() => {}); // the room went away: nothing to give back to
        }
      }
      // The bots (host).
      if (m.isHost && w.bots.size) {
        const graph = graphFor(w.city, w.env.closed, `k${w.closureK}`);
        for (const [id, b] of w.bots) {
          if (tt < b.delay) continue;
          w.env.vans = vansExcept(id, w, others);
          const ctx = { city: w.city, graph, targets: scrambleTargets(w.city, m.data, b, houseTarget, depotTarget), env: w.env };
          const bh = b.driver.drive(b.van, ctx, DT);
          b.hold = bh;
          for (const p of stepRunner(b, bh, w.city, w.env, open)) {
            // callAs is false when the claim never went in (no longer host): the parcel stays on the roof.
            if (!host.callAs({ id, name: (m.seats.find((s) => s.id === id) || {}).name || id }, 'drop', { a: p.addr, m: !!p.mat })) giveBack(id);
          }
        }
      }
      w.t = tt;
    }
    // Trails for the between-shift map (2 Hz).
    if (Math.floor(w.t * 2) !== w.trailTick) {
      w.trailTick = Math.floor(w.t * 2);
      // allVans() has the bots too (from the host's own simulation, or its presence).
      for (const v of allVans()) {
        let tr = net.trails.get(v.id);
        if (!tr) net.trails.set(v.id, (tr = []));
        if (tr.length < 800) tr.push([Math.round(v.x), Math.round(v.y)]);
      }
    }
    return out;
  };

  /** Traffic and the town's moving parts at shift time tt. */
  function envAt(w, tt) {
    w.traffic.advanceTo(tt);
    if (w.town.cones) {
      const k = scrambleClosure(tt);
      if (k !== w.closureK) {
        w.closureK = k;
        w.env.closed = closedTiles(w.city, k);
      }
    }
    w.env.bridgeUp = w.city.drawbridges.length > 0 && bridgeState(tt).up;
    w.env.cars = w.traffic.bodies(tt);
    w.env.t = tt;
  }
  net.envAt = envAt;

  function vansExcept(id, w, others) {
    const out = net.playing() ? [{ id: room.me.id, x: w.me.van.x, y: w.me.van.y, h: w.me.van.h, v: w.me.van.v }] : [];
    for (const o of others) if (o.id !== id) out.push(o);
    for (const [bid, b] of w.bots) if (bid !== id) out.push({ id: bid, x: b.van.x, y: b.van.y, h: b.van.h, v: b.van.v });
    return out;
  }

  /** Other vans as drawn now: players from their presence, bots from the host's (or my own, on the host). */
  net.others = () => {
    const w = net.world;
    const out = [];
    if (!w) return out;
    const m = match;
    net.drawnBots = net.drawnBots || new Map();
    for (const seat of m.seats) {
      if (seat.me) continue;
      if (seat.bot) {
        if (m.isHost) {
          const b = w.bots.get(seat.id);
          if (b) out.push({ id: seat.id, x: b.van.x, y: b.van.y, h: b.van.h, v: b.van.v, k: b.hold, p: b.p, bot: true, stall: b.van.stall });
          continue;
        }
        const hp = room.presenceAt(room.host, { angles: ['h'], snap: 200 });
        const raw = hp && hp.r === m.roundId && hp.b ? hp.b[seat.id] : null;
        const v = cleanVan(raw, w.city);
        if (v) {
          out.push({ id: seat.id, ...v, bot: true });
          net.drawnBots.set(seat.id, v);
        }
        continue;
      }
      if (seat.left) continue;
      const pr = room.presenceAt(seat.id, { angles: ['h'], snap: 200 });
      if (!pr || pr.r !== m.roundId || pr.st !== 'play') continue;
      const v = cleanVan(pr, w.city);
      if (v) out.push({ id: seat.id, ...v, away: !!seat.away });
    }
    return out;
  };

  /** Presence: my van (and the host's bots). */
  net.publish = (state) => {
    const w = net.world;
    const m = match;
    const p = { st: state, body: net.myBody };
    if (w && (state === 'play' || state === 'watch')) {
      const v = w.me.van;
      p.r = m.roundId;
      if (state === 'play') Object.assign(p, { x: Math.round(v.x), y: Math.round(v.y), h: round2(v.h), v: Math.round(v.v), k: v.hold ? 1 : 0, p: w.me.p, s: v.stall > 0 ? 1 : 0 });
      if (m.isHost && w.bots.size) {
        p.b = {};
        for (const [id, b] of w.bots) p.b[id] = { x: Math.round(b.van.x), y: Math.round(b.van.y), h: round2(b.van.h), v: Math.round(b.van.v), k: b.hold ? 1 : 0, p: b.p, s: b.van.stall > 0 ? 1 : 0 };
      }
    }
    try {
      room.setPresence(p);
    } catch {
      /* the room may be closing */
    }
  };

  return net;
}

const round2 = (v) => Math.round(v * 100) / 100;
const copyData = (d) => JSON.parse(JSON.stringify(d));
