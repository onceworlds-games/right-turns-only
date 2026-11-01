// The bot brain, also used for autoplay: pick where to go, plan it in right turns, then drive the line with one button.
// Driving: every few frames, roll the van forward for a few input plans (release, tap, holds of several lengths) and keep the
// one that stays nearest the line while getting furthest along it. Skill sets reaction time, mistakes and choices.
// Pure: no page, no platform.

import { T, DX, DY, DIR_HEADING, DRIVE, DELIVERY, clamp, angleDiff, dirOf } from './config.js';
import { buildGraph, dijkstra, stateOf, bestTo, pathTo, dropTile } from './route.js';
import { stepVan } from './physics.js';
import { loopAt } from './city.js';
import { createRng } from './rng.js';

const LANE = 20; // bots keep a little left of the road's centre (traffic keeps left)
const ROLL_DT = 1 / 20;

const left = (d) => [DY[d], -DX[d]];

/**
 * A driving line through the planned states, as points. `lat` is how far left of the road's centre the van is now; the line
 * keeps that offset on straights (a van can't drift left), takes rights round the inner corner and comes out at LANE, and
 * rounds loop zones on the orbit. `goal` ({ x, y, drift }) is where it should end: with `drift` it drifts right onto the goal
 * (a doormat attempt), otherwise it only needs to pass it.
 */
export function lineFor(city, nodes, from, goal = null, lat = LANE, prefix = []) {
  const pts = [[from.x, from.y], ...prefix];
  const add = (x, y) => pts.push([x, y]);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const ti = node >> 2;
    const d = node & 3;
    const cx = ((ti % city.w) + 0.5) * T;
    const cy = (Math.floor(ti / city.w) + 0.5) * T;
    const next = nodes[i + 1];
    const nd = next === undefined ? d : next & 3;
    const ch = city.at(ti % city.w, Math.floor(ti / city.w));
    const L = left(d);
    if (ch === 'O' || ch === 'c') {
      const k = (nd - d + 4) % 4;
      if (k === 0) {
        add(cx + L[0] * lat, cy + L[1] * lat);
        continue;
      }
      // Round the loop zone: clockwise on the orbit from the way in to the way out.
      const r = DRIVE.loopRadius;
      const a0 = Math.atan2(L[1], L[0]);
      const steps = k * 4;
      for (let s = 0; s <= steps; s++) {
        const a = a0 + (s / steps) * k * (Math.PI / 2);
        add(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      lat = r;
      continue;
    }
    if (nd === (d + 1) % 4 && next !== undefined) {
      // A right turn: a quarter circle that starts at the van's offset and comes out at LANE in the new road.
      // In (forward, right) terms round the junction: radius R, centre (LANE - R, R - lat). From the right-hand side
      // of the road the turn starts a little later and stays wide enough for the van (R >= 68).
      const R = Math.max(68, 60 + lat);
      const f = [DX[d], DY[d]];
      const rt = [DX[nd], DY[nd]];
      const ox = cx + f[0] * (LANE - R) + rt[0] * (R - lat);
      const oy = cy + f[1] * (LANE - R) + rt[1] * (R - lat);
      const a0 = Math.atan2(-rt[1], -rt[0]);
      for (let s = 0; s <= 5; s++) {
        const a = a0 + (s / 5) * (Math.PI / 2);
        add(ox + Math.cos(a) * R, oy + Math.sin(a) * R);
      }
      lat = LANE;
      continue;
    }
    add(cx + L[0] * lat, cy + L[1] * lat);
  }
  if (goal && nodes.length) {
    // The last stretch: straight on past the goal. A doormat attempt drifts right onto it first, gently (the van drifts
    // right with taps and the heading snap; under ~12° the snap can always pull it straight again).
    const last = nodes[nodes.length - 1];
    const d = last & 3;
    const lt = last >> 2;
    const lch = city.at(lt % city.w, Math.floor(lt / city.w));
    if (nodes.length > 1 && lch !== 'O' && lch !== 'c') pts.pop();
    const along = (q) => (q[0] - goal.x) * DX[d] + (q[1] - goal.y) * DY[d];
    const side = (q) => (q[0] - goal.x) * -DY[d] + (q[1] - goal.y) * DX[d]; // how far q is to the goal's right, moving along d
    // The start of the final straight: walk back over points on one line along d.
    let si = pts.length - 1;
    while (si > 0 && Math.abs(side(pts[si - 1]) - side(pts[si])) < 3 && along(pts[si - 1]) < along(pts[si])) si--;
    const S = pts[si];
    const run = Math.max(0, -along(S));
    let shift = goal.drift ? Math.max(0, -side(S)) : 0; // how far right to drift (never left)
    const room = Math.max(20, Math.min(clamp(shift * 7.5, 50, 360), run - 10));
    // Drifting right leaves the van on the wrong side for the next turn (a van can't drift back): only a little.
    if (shift > Math.min(room * 0.14, 22)) shift = 0;
    const gx = S[0] + DX[d] * run - DY[d] * shift;
    const gy = S[1] + DY[d] * run + DX[d] * shift;
    while (pts.length - 1 > si && along(pts[pts.length - 1]) > -room) pts.pop();
    if (run - room > 5) add(S[0] + DX[d] * (run - room), S[1] + DY[d] * (run - room));
    add(gx, gy);
    add(gx + DX[d] * 90, gy + DY[d] * 90);
    goal.x = gx;
    goal.y = gy;
  }
  // Points too close together confuse the follower.
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    if (Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]) > 6) out.push(pts[i]);
  }
  return out;
}

/** Distance from a point to a polyline segment range; returns [distance, arc length at the nearest point, segment]. */
function nearest(poly, cum, x, y, from, to) {
  let best = Infinity;
  let arc = 0;
  let seg = from;
  for (let i = Math.max(0, from); i < Math.min(poly.length - 1, to); i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < best) {
      best = d;
      arc = cum[i] + Math.sqrt(l2) * t;
      seg = i;
    }
  }
  return [Math.sqrt(best), arc, seg];
}

/** The point at arc length `s` along a polyline (clamped to its ends). */
function pointAt(poly, cum, s) {
  if (s <= 0) return poly[0];
  for (let i = 1; i < poly.length; i++) {
    if (cum[i] >= s) {
      const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return [poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * t, poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * t];
    }
  }
  return poly[poly.length - 1];
}

const loopWhy = (a) => `a${Math.round(a * 57)}`;

function cumulative(poly) {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  return cum;
}

/**
 * A driver. opts: { skill 0..1, style, seed }. Call `drive(van, ctx)` every frame; it returns whether to hold.
 * ctx: { city, graph, targets: [{ key, x, y, tile, value }], env, now }. Targets are where it may go next; the driver picks.
 */
export function createDriver(opts = {}) {
  const skill = clamp(opts.skill ?? 1, 0, 1);
  const style = opts.style || 'steady';
  const rng = createRng(opts.seed ?? 1);
  const reaction = 0.06 + (1 - skill) * 0.18; // s
  const noise = (1 - skill) * 0.9;
  const missChance = (1 - skill) * 0.12;
  const st = {
    plan: null, // { key, poly, cum, seg, endArc, made }
    hold: false,
    queue: [], // [time, hold]
    t: 0,
    nextThink: 0,
    nextChoose: 0,
    straight: false,
    lastKey: '',
    missUntil: -1,
    nextNoise: 0,
    lookNoise: 0,
    tapUntil: -1,
    tapNext: 0,
    flipUntil: -1,
    flipTo: false,
    stuck: 0,
    lastProgress: 0,
    lastProgressT: 0,
    chosen: null,
  };

  function choose(van, ctx) {
    const targets = ctx.targets.filter((t) => t && Number.isFinite(t.x));
    if (!targets.length) return null;
    if (targets.length === 1) return targets[0];
    // Keep the current pick unless it's gone; look again now and then.
    const cur = st.chosen && targets.find((t) => t.key === st.chosen.key);
    if (cur && st.t < st.nextChoose) return cur;
    st.nextChoose = st.t + 0.5;
    if (skill < 0.5 || style === 'rookie') {
      // As the crow flies: the rookie's mistake.
      let best = targets[0];
      let bd = Infinity;
      for (const t of targets) {
        let d = Math.hypot(t.x - van.x, t.y - van.y) / (t.value || 1);
        if (cur && t.key === cur.key) d *= 0.8;
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      return best;
    }
    const route = routeFrom(van, ctx);
    let best = cur || targets[0];
    let bt = Infinity;
    for (const t of targets) {
      let time = timeTo(route, t);
      if (!Number.isFinite(time)) continue;
      if (t.contest && skill >= 0.8) time += t.contest; // someone else will get there first: worth less
      time /= t.value || 1;
      time += rng.float(0, noise * 2.5);
      if (cur && t.key === cur.key) time = time * 0.85 - 0.3; // don't dither between two
      if (time < bt) {
        bt = time;
        best = t;
      }
    }
    return best;
  }

  /**
   * Where the van can start a route from: normally its tile (or the next one once past the middle); near a loop zone's
   * centre, each way out of the zone, after orbiting round to it.
   */
  function routeFrom(van, ctx) {
    const city = ctx.city;
    const graph = ctx.graph;
    const zone = loopAt(city, van.x, van.y);
    const options = [];
    if (zone && Math.hypot(van.x - zone.x, van.y - zone.y) < DRIVE.loopRadius + 45) {
      const R = DRIVE.loopRadius;
      const phi = Math.atan2(van.y - zone.y, van.x - zone.x);
      for (let e = 0; e < 4; e++) {
        if (!graph.drivable(zone.tx + DX[e], zone.ty + DY[e])) continue;
        const L = left(e);
        let turn = Math.atan2(L[1], L[0]) - phi;
        turn = ((turn % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (turn < 0.3) turn += Math.PI * 2;
        const prefix = [];
        const steps = Math.max(2, Math.ceil(turn / 0.4));
        for (let k = 1; k <= steps; k++) {
          const a = phi + (turn * k) / steps;
          prefix.push([zone.x + Math.cos(a) * R, zone.y + Math.sin(a) * R]);
        }
        const start = city.idx(zone.tx + DX[e], zone.ty + DY[e]) * 4 + e;
        options.push({ start, cost: (turn * R) / DRIVE.loopSpeed, prefix, lat: R, res: dijkstra(graph, start), here: false, zone });
      }
      if (options.length) return { van, options };
    }
    let from = stateOf(city, van.x, van.y, van.h);
    const d = from & 3;
    const ti = from >> 2;
    const tx = ti % city.w;
    const ty = Math.floor(ti / city.w);
    const along = (van.x - (tx + 0.5) * T) * DX[d] + (van.y - (ty + 0.5) * T) * DY[d];
    const L0 = left(d);
    const lat = clamp((van.x - (tx + 0.5) * T) * L0[0] + (van.y - (ty + 0.5) * T) * L0[1], -46, 46);
    if (!zone && along > -10 && graph.drivable(tx + DX[d], ty + DY[d])) from = city.idx(tx + DX[d], ty + DY[d]) * 4 + d;
    options.push({ start: from, cost: 0, prefix: [], lat, res: dijkstra(graph, from), here: { tile: ti, d } });
    return { van, options };
  }

  /** The best route time to a target, and the option and nodes for it. */
  function bestRoute(route, target) {
    let best = null;
    for (const o of route.options) {
      // Already on the target's tile with the goal ahead: no route needed.
      if (o.here && o.here.tile === target.tile) {
        const d = o.here.d;
        const ahead = (target.x - route.van.x) * DX[d] + (target.y - route.van.y) * DY[d];
        if (ahead > 10) {
          const time = ahead / DRIVE.straight;
          if (!best || time < best.time) best = { time, option: o, nodes: [target.tile * 4 + d] };
          continue;
        }
      }
      const b = bestTo(o.res, target.tile);
      const time = o.cost + b.time;
      if (Number.isFinite(time) && (!best || time < best.time)) best = { time, option: o, node: b.node };
    }
    if (best && !best.nodes) best.nodes = pathTo(best.option.res, best.node);
    return best;
  }

  function timeTo(route, target) {
    const b = bestRoute(route, target);
    return b ? b.time : Infinity;
  }

  function makePlan(van, ctx, target) {
    const best = bestRoute(routeFrom(van, ctx), target);
    if (!best) return null;
    // Careful drivers and experts drift onto the bullseye (the doormat); the rest only pass through the ring.
    const mat = !!target.house && (skill >= 0.7 || style === 'careful');
    const aim = { x: target.x, y: target.y, drift: mat };
    const poly = lineFor(ctx.city, best.nodes, van, aim, best.option.lat, best.option.prefix);
    const cum = cumulative(poly);
    // The loop zones on the way, and which way out of each.
    const loops = [];
    if (best.option.zone) loops.push({ tile: best.option.zone.ty * ctx.city.w + best.option.zone.tx, e: best.option.start & 3 });
    for (let i = 0; i < best.nodes.length - 1; i++) {
      const ti = best.nodes[i] >> 2;
      const ch = ctx.city.chars[ti];
      if (ch === 'O' || ch === 'c') loops.push({ tile: ti, e: best.nodes[i + 1] & 3 });
    }
    return { key: target.key, target, aim, mat, loops, aimArc: cum[cum.length - 1] - 90, poly, cum, seg: 0, endArc: cum[cum.length - 1], made: st.t };
  }

  /** Run the van forward, holding for `holdFor` seconds and then letting go, for `total` seconds: how badly does it hit something? */
  function rollout(van, ctx, holdFor, total) {
    const sim = { ...van };
    const cars0 = (ctx.env && ctx.env.cars) || [];
    const near = cars0.filter((c) => Math.abs(c.x - van.x) < 400 && Math.abs(c.y - van.y) < 400);
    const moved = near.map((c) => ({ ...c }));
    const env = { closed: ctx.env?.closed, bridgeUp: ctx.env?.bridgeUp, cars: moved, dt: ROLL_DT };
    let bad = 0;
    const ev = [];
    for (let t = 0; t < total - 1e-6; t += ROLL_DT) {
      // Cars carry on the way they're going.
      for (let i = 0; i < near.length; i++) {
        const c = near[i];
        moved[i].x = c.x + Math.cos(c.h) * (c.v || 0) * (t + ROLL_DT);
        moved[i].y = c.y + Math.sin(c.h) * (c.v || 0) * (t + ROLL_DT);
      }
      ev.length = 0;
      stepVan(sim, t < holdFor, ctx.city, env, ev);
      for (const e of ev) {
        if (e.type === 'crash' || e.type === 'car') bad += 10 * (1 - t / total) + 5;
        else if (e.type === 'soft') bad += 6 * (1 - t / total) + 3;
        else if (e.type === 'scrape') bad += 0.2;
      }
      if (sim.stall > 0) break;
    }
    return bad;
  }

  /** One frame: returns whether to hold the button. */
  function drive(van, ctx, dt = 1 / 60) {
    st.t += dt;
    if (van.stall > 0) {
      st.queue.length = 0;
      st.hold = false;
      st.plan = null; // replan after the crash
      return false;
    }
    // What to go for.
    const want = choose(van, ctx);
    if (!want) {
      st.plan = null;
      return applyQueue(false);
    }
    st.chosen = want;
    const p = st.plan;
    const needPlan = !p || p.key !== want.key || st.t - p.made > 3.5;
    if (needPlan) {
      st.plan = makePlan(van, ctx, want);
      st.lastKey = want.key;
      if (!st.plan) return applyQueue(false);
    }
    const plan = st.plan;
    const [dist, arc, seg] = nearest(plan.poly, plan.cum, van.x, van.y, plan.seg, plan.seg + 18);
    plan.seg = seg;
    if (dist > 95 || arc > plan.endArc - 30) {
      st.plan = makePlan(van, ctx, want);
      if (!st.plan) return applyQueue(false);
    }
    // Stuck against something: replan.
    if (arc > st.lastProgress + 20) {
      st.lastProgress = arc;
      st.lastProgressT = st.t;
    } else if (st.t - st.lastProgressT > 2.5) {
      st.plan = makePlan(van, ctx, want);
      st.lastProgress = 0;
      st.lastProgressT = st.t;
    }
    // Pure pursuit with one button: hold while a point a little way along the line is to the right.
    const lead = reaction * (0.4 + skill * 0.6);
    const px = van.x + Math.cos(van.vh) * van.v * lead;
    const py = van.y + Math.sin(van.vh) * van.v * lead;
    if (st.t >= st.nextNoise) {
      st.nextNoise = st.t + 0.6;
      st.lookNoise = noise > 0 ? rng.gauss() * noise * 60 : 0;
    }
    const look = clamp(30 + van.v * 0.2 + st.lookNoise, 22, 150);
    const [qx, qy] = pointAt(plan.poly, plan.cum, arc + look + van.v * lead);
    const alpha = angleDiff(van.h, Math.atan2(qy - py, qx - px));
    let want2 = alpha > 0.05;
    st.why = loopWhy(alpha);
    // On a straight, drift across with taps only: past ~7° the snap could no longer pull the van straight again.
    const card = DIR_HEADING[dirOf(van.h)];
    const [ax, ay] = pointAt(plan.poly, plan.cum, arc + look * 0.6);
    const [bx, by] = pointAt(plan.poly, plan.cum, arc + look * 0.6 + 30);
    const lineH = Math.atan2(by - ay, bx - ax);
    const hNext = van.h + van.yaw * (reaction + 0.03);
    // In a loop zone on the route: hold round until facing the way out, then let go.
    st.straight = false;
    const loop = van.zone && plan.loops.find((l) => l.tile === van.zone.ty * ctx.city.w + van.zone.tx && !l.done);
    if (loop) {
      let rem = (DIR_HEADING[loop.e] - van.h) % (Math.PI * 2);
      if (rem < 0) rem += Math.PI * 2;
      if (rem > Math.PI * 2 - 0.5) rem = 0; // just past it
      const lag = (van.hold ? Math.max(van.yaw, 1) : 1.2) * (reaction + 0.05);
      const z = van.zone;
      const toZ = angleDiff(van.h, Math.atan2(z.y - van.y, z.x - van.x));
      const onRight = toZ > 0.5 && toZ < Math.PI - 0.6;
      // With the centre on the right the van orbits it; otherwise it turns as usual, so start that turn where it comes out
      // on the far lane of the way out (like a junction).
      const fwd = (z.x - van.x) * Math.cos(van.h) + (z.y - van.y) * Math.sin(van.h);
      const ready = van.hold || onRight || fwd < Math.min(van.v, 170) / DRIVE.yaw - DRIVE.loopRadius + 8;
      want2 = rem > lag && ready;
      if (rem <= lag && (van.hold || rem < 0.05)) loop.done = true;
    } else if (van.zone && Math.hypot(van.x - van.zone.x, van.y - van.zone.y) < DRIVE.loopRadius + 40) {
      want2 = false; // just let go of a loop: leave it alone until it's out
    } else if (Math.abs(angleDiff(card, lineH)) < 0.4) {
      // On a straight: drift right with short pulses only, each one small enough for the snap to pull straight again.
      if (want2 && Math.abs(angleDiff(card, hNext)) < 0.025 && st.t >= st.tapNext) {
        st.tapUntil = st.t + 0.11;
        st.tapNext = st.t + 0.2;
      }
      want2 = false;
      st.straight = true;
    }
    // Doormat: once lined up, feather down under the doormat speed with quick taps just before the bullseye.
    const toAim = plan.aimArc - arc;
    if (plan.mat && toAim > 0 && toAim < 40 + (van.v - 195) * 5 && van.v > DELIVERY.matSpeed - 6 && Math.abs(angleDiff(card, van.h)) < 0.05 && !van.zone) {
      if (st.t >= st.tapNext) {
        st.tapUntil = st.t + 0.09;
        st.tapNext = st.t + 0.2;
      }
    }
    if (st.t < st.tapUntil) {
      want2 = true;
      st.why = 'tap';
    }
    // A lapse: now and then a lesser driver misses the moment to turn.
    if (want2 && !van.hold && alpha > 0.5 && missChance > 0 && st.t > st.missUntil + 1 && rng.chance(missChance * 0.05)) {
      st.missUntil = st.t + 0.35 + rng.float(0, 0.45);
    }
    if (st.t < st.missUntil) want2 = false;
    // Look before leaping: if what it's about to do runs into something, take whichever of letting go, a tap or a hold
    // doesn't (or hurts least).
    if (st.t >= st.nextThink && !loop) {
      st.nextThink = st.t + 0.1;
      if (rng.chance(0.3 + skill * 0.7)) {
        const tapping = st.t < st.tapUntil;
        const mine = !want2 ? 0 : tapping ? 1 : 2;
        const futures = [0, 0.1, 0.5];
        const bad = [rollout(van, ctx, futures[mine], 0.55), -1, -1];
        if (bad[0] > 0) {
          let best = mine;
          let low = bad[0];
          for (let k = 0; k < 3; k++) {
            if (k === mine) continue;
            const b = rollout(van, ctx, futures[k], 0.55);
            if (b < low - 0.5) {
              low = b;
              best = k;
            }
          }
          if (best !== mine) {
            st.why = `avoid${best}`;
            want2 = best > 0;
            st.tapUntil = best === 1 ? st.t + 0.1 : -1;
            st.flipUntil = best === 2 ? st.t + 0.12 : st.t + 0.05;
            st.flipTo = want2;
          }
        }
      }
    }
    if (st.t < st.flipUntil) want2 = st.flipTo;
    st.queue.push([st.t + reaction, want2]);
    return applyQueue(st.hold);
  }

  function applyQueue(fallback) {
    while (st.queue.length && st.queue[0][0] <= st.t) st.hold = st.queue.shift()[1];
    return st.queue.length || fallback !== undefined ? st.hold : fallback;
  }

  return {
    drive,
    get target() {
      return st.chosen;
    },
    get why() {
      return st.why;
    },
    get line() {
      return st.plan ? st.plan.poly : null;
    },
    reset() {
      st.plan = null;
      st.queue.length = 0;
      st.hold = false;
    },
    skill,
    style,
  };
}

/** A house as a target for a driver. */
export function houseTarget(city, house, key, value = 1) {
  return { key, x: house.dropX, y: house.dropY, tile: dropTile(city, house), value, house };
}

export function depotTarget(city) {
  const d = city.depot;
  return { key: 'depot', x: d.x, y: d.y, tile: city.idx(d.tx, d.ty), value: 1 };
}

/** One graph per town and closure set, kept. */
const graphs = new Map();
export function graphFor(city, closed = null, key = '0') {
  const k = `${city.id}:${key}`;
  let g = graphs.get(k);
  if (!g) {
    g = buildGraph(city, closed);
    graphs.set(k, g);
  }
  return g;
}

export { DELIVERY };
