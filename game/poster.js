// Store art: one staged, frozen frame per poster, drawn with the game's own 3D renderer from real (simulated) play. The
// badges are flat symbols on discs, drawn in 2D.

import { T, SEATS, PALETTE, DELIVERY, angleDiff } from './config.js';
import { TOWNS, TITLE_TOWN } from './towns.js';
import { createRenderer } from './gfx/renderer.js';
import { createMarksLayer } from './gfx/marks-layer.js';
import { createTrafficLayer } from './gfx/traffic-layer.js';
import { createPeopleLayer } from './gfx/people-layer.js';
import { createVansLayer } from './gfx/vans-layer.js';
import { createFxLayer } from './gfx/fx-layer.js';
import { createWeatherLayer } from './gfx/weather-layer.js';
import { loadModels } from './gfx/models.js';
import { createScrambleWorld, cityFor } from './world.js';
import { openList } from './scramble.js';
import { createFx } from './fx.js';
import { createForecourt, forecourtCity } from './forecourt.js';
import { outlined, plates, clockSign } from './hud.js';
import { tileDrivable } from './city.js';
import { vanSprite, vanShadow, curl, bigParcel, rr, shade } from './sprites.js';

const BODIES = ['box', 'bread', 'pickup', 'mail', 'tuk', 'icecream'];
const NAMES = ['Mo', 'Rosa', 'Dex', 'Juno', 'Pip', 'Vik'];
const DEG = Math.PI / 180;
const raf = () => new Promise((r) => requestAnimationFrame(r));

/** The same picture every time: a seeded Math.random for the people, the puffs and the particles. */
function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function renderPoster(name) {
  seedRandom(7);
  const W = innerWidth;
  const H = innerHeight;
  try {
    await Promise.race([Promise.all([document.fonts.load('900 40px "Barlow Condensed"'), document.fonts.load('700 20px "Barlow Condensed"')]), new Promise((r) => setTimeout(r, 2000))]);
    await document.fonts.ready;
  } catch {
    /* draw with what we have */
  }
  const cv = document.getElementById('cv');
  if (name.startsWith('badge-')) {
    cv.width = W;
    cv.height = H;
    drawBadge(cv.getContext('2d'), W, name.slice(6));
    await raf();
    document.body.dataset.ready = '1';
    return;
  }
  const R = createRenderer(cv, { preserve: true });
  R.resize(W, H, 1);
  R.quality = 'high';
  const people = createPeopleLayer(R);
  R.layers.push(createMarksLayer(R), createTrafficLayer(R), people, createVansLayer(R), createFxLayer(R), createWeatherLayer(R));
  R.greet = people.greet;
  R.sound = () => {};
  await loadModels();
  await raf();
  const fx = createFx();
  const shot = { icon: iconShot, action: actionShot, win: winShot, multi: multiShot }[name] || coverShot;
  const p = shot(R, W, H, fx);
  const view = p.view;
  view.fx = fx;
  view.paint = (view.paint || []).concat(fx.paint);
  // Let it come to life (springs, people at their doors, puffs), then freeze.
  if (p.greet) for (const g of p.greet) R.greet(g.id, g.o || {});
  const until = performance.now() + (p.settle ?? 1.4) * 1000;
  while (performance.now() < until) {
    R.frame(view);
    await raf();
  }
  R.frame(view);
  if (p.hud) {
    R.ctx.setTransform(1, 0, 0, 1, 0, 0);
    p.hud(R.ctx, R);
  }
  await raf();
  await raf();
  document.body.dataset.ready = '1';
}

// ---------------------------------------------------------------- simulated play

function drivers(n, skill = 0.85) {
  const styles = ['veteran', 'careful', 'rusher', 'steady', 'shortcut', 'rookie'];
  return Array.from({ length: n }, (_, i) => ({ id: `bot:${i + 1}`, skill: i === 0 ? 1 : skill - i * 0.03, style: styles[i % 6], seed: 7 + i }));
}

/** Run a scramble, leaving tyre marks on the renderer, calling pick(world, step) each step; returns the world. */
function run(R, town, opts, steps, pick) {
  const w = createScrambleWorld(town, opts);
  if (R) {
    R.setCity(w.city);
    R.clearMarks();
  }
  for (let i = 0; i < steps; i++) {
    w.step();
    if (R)
      for (const r of w.runners) {
        const v = r.van;
        if (v.hold && v.v > 150 && i % 2 === 0) R.mark(v.x - Math.cos(v.h) * 14, v.y - Math.sin(v.h) * 14, v.h, w.city.snow ? 'snow' : 'tyre');
      }
    if (pick) pick(w, i);
  }
  return w;
}

function vansOf(w) {
  return w.runners.map((r, i) => ({
    x: r.van.x,
    y: r.van.y,
    h: r.van.h,
    v: r.van.v,
    hold: r.van.hold,
    stall: r.van.stall,
    braking: r.van.v < DELIVERY.matSpeed,
    body: BODIES[i % BODIES.length],
    color: SEATS[i % SEATS.length].color,
    symbol: SEATS[i % SEATS.length].symbol,
    parcels: r.p,
  }));
}

function addrView(R, w) {
  const open = openList(w.city, w.data);
  return {
    open,
    rings: open.map((o) => ({ x: o.house.dropX, y: o.house.dropY, gold: o.gold })),
    beacons: open.map((o) => ({ ...R.matAt(o.house), gold: o.gold, scale: o.gold ? 1.3 : 1 })),
  };
}

function weather(view, town, t) {
  if (town.rain) view.rain = true;
  if (town.snow) view.snow = true;
  view.t = t;
  view.bakeAll = true;
}

function chevrons(open, vans) {
  const out = [];
  for (const o of open) {
    let n = 0;
    for (const v of vans) {
      if (n >= 2) continue;
      const dx = o.house.dropX - v.x;
      const dy = o.house.dropY - v.y;
      const d = Math.hypot(dx, dy);
      if (d > 520 || d < 80 || Math.abs(angleDiff(v.h, Math.atan2(dy, dx))) > 0.6) continue;
      const a = Math.atan2(-dy, -dx);
      out.push({ x: o.house.dropX + Math.cos(a) * (DELIVERY.ring + 14), y: o.house.dropY + Math.sin(a) * (DELIVERY.ring + 14), h: a + Math.PI, color: v.color });
      n++;
    }
  }
  return out;
}

/** A parcel in flight from a van to a house, `k` of the way there. */
function inFlight(fx, v, house, k, gold = false) {
  fx.add('throw', { x0: v.x, y0: v.y, x1: house.doorX, y1: house.doorY, house: house.id, gold, dur: 0.5 });
  fx.throws[fx.throws.length - 1].t = 0.5 * k;
}

// ---------------------------------------------------------------- the posters

/** The title street: the name painted on the avenue, the yellow van throwing a parcel to a door, rivals on the way. */
function coverShot(R, W, H, fx) {
  const w = run(R, TITLE_TOWN, { seed: 11, seconds: 1e9, drivers: drivers(3, 0.95) }, 900);
  const city = w.city;
  const house = (id) => city.houses.find((h) => h.id === id);
  const hero = { x: 5.5 * T - 22, y: 5.5 * T, h: -Math.PI / 2 + 0.06, v: 210, hold: false, braking: false, color: PALETTE.yellow, body: 'box', parcels: 2 };
  const vans = [
    hero,
    { x: 5.5 * T + 22, y: 2.55 * T, h: Math.PI / 2, v: 230, color: SEATS[1].color, body: 'bread', parcels: 3 },
    { x: 7.4 * T, y: 1.5 * T - 26, h: 0.02, v: 220, color: SEATS[2].color, body: 'mail', parcels: 1 },
  ];
  const to = house(17);
  inFlight(fx, hero, to, 0.42);
  // Traffic, but none on the words.
  const cars = w.env.cars.filter((c) => !(Math.abs(c.x - 5.5 * T) < 80 && c.y > 2.8 * T && c.y < 5.6 * T));
  const beacons = [house(4), house(13), house(8)].map((h, k) => ({ ...R.matAt(h), gold: k === 0, scale: k === 0 ? 1.3 : 1 }));
  const zoom = Math.min(H / 520, W / 640) * 1.18;
  const view = {
    cam: { x: 5.5 * T, y: 4.45 * T, zoom, pitch: 48 * DEG, shake: [0, 0] },
    env: { ...w.env, cars },
    vans,
    beacons,
    tilt: 0.55,
    band: 0.26,
    focusY: 0.5,
    paint: [
      { lines: ['RIGHT', 'TURNS', 'ONLY'], x: 5.5 * T, y: 4.15 * T, upright: true, width: 112, max: 80, stretch: 1.3, alpha: 1 },
      { arrow: true, x: 5.5 * T, y: 2.4 * T, size: 40, alpha: 1 },
    ],
  };
  weather(view, TITLE_TOWN, w.t);
  return { view, greet: [{ id: to.id }], settle: 1.6 };
}

/** A close-up: the van swinging right past an address, tyres smoking, the parcel in the air. */
function actionShot(R, W, H, fx) {
  const town = TOWNS[0];
  const opts = { seed: 4, seconds: 1e9, drivers: drivers(5, 0.9) };
  let best = -1;
  let at = 900;
  let pick = null;
  run(null, town, opts, 3600, (w, i) => {
    if (i < 600) return;
    const r = w.runners[0];
    if (!r.van.hold || r.van.v < 120) return;
    for (const o of openList(w.city, w.data)) {
      const d = Math.hypot(o.house.dropX - r.van.x, o.house.dropY - r.van.y);
      if (d > 60) continue;
      const others = w.runners.slice(1).filter((q) => Math.hypot(q.van.x - r.van.x, q.van.y - r.van.y) < 260).length;
      const s = 2 - d / 60 + others * 0.7;
      if (s > best) {
        best = s;
        at = i;
        pick = o.house.id;
      }
    }
  });
  const w = run(R, town, opts, at + 1);
  const a = addrView(R, w);
  const van = w.runners[0].van;
  const vans = vansOf(w);
  Object.assign(vans[0], { color: PALETTE.yellow, body: 'box' });
  // Behind and beside the van, looking where it is going.
  const yaw = Math.atan2(-Math.cos(van.h), -Math.sin(van.h)) + 0.75;
  const view = {
    cam: { x: van.x + Math.cos(van.h) * 30, y: van.y + Math.sin(van.h) * 30, zoom: Math.min(W, H) / 240, pitch: 34 * DEG, yaw, shake: [0, 0] },
    env: w.env,
    vans,
    rings: a.rings,
    beacons: a.beacons,
    tilt: 0.8,
    band: 0.2,
    focusY: 0.45,
  };
  const house = w.city.houses.find((h) => h.id === pick) || null;
  const greet = [];
  if (house) {
    inFlight(fx, van, house, 0.4);
    greet.push({ id: house.id });
  }
  // Tyre smoke off the rear wheels and a spray of sparks.
  const bx = van.x - Math.cos(van.h) * 20;
  const by = van.y - Math.sin(van.h) * 20;
  for (const side of [-1, 1]) fx.spawn(bx - Math.sin(van.h) * 9 * side, by + Math.cos(van.h) * 9 * side, 10, { color: '#D9D7E4', kind: 2, speed: 30, up: 14, life: 1.2, size: 6, z: 2, dir: van.h + Math.PI, spread: 1.4 });
  for (let i = 0; i < 6; i++) fx.update(0.05);
  weather(view, town, w.t);
  return { view, greet, settle: 1.3 };
}

/** The podium at the depot after a scramble: the winner spinning on top, confetti in the air. */
function winShot(R, W, H, fx) {
  const court = createForecourt();
  R.setCity(forecourtCity());
  const rows = NAMES.slice(0, 5).map((n, i) => ({ place: i + 1, name: n, pts: [31, 27, 22, 18, 11][i], color: SEATS[i].color, symbol: SEATS[i].symbol, body: [0, 1, 3, 2, 5][i], topper: ['crown', 'cone', 'none', 'duck', 'none'][i] }));
  const view = court.podium({ w: W, h: H }, rows, 0.6, 0.016, { top: 40, bottom: 30 }, null);
  Object.assign(view.cam, { shake: [0, 0] });
  // Confetti thrown high over the plinths, caught on its way down.
  for (let i = 0; i < 7; i++) fx.spawn(3.5 * T + (i - 3) * 50, 7.5 * T + ((i * 37) % 60) - 30, 34, { color: ['#FFC22E', '#F0573C', '#3EA6F0', '#37C98A', '#F4F1E8', '#A174F2'], kind: 1, speed: 160, up: 520, life: 4, size: 6, z: 30, jitter: 60 });
  for (let i = 0; i < 14; i++) fx.update(0.05);
  const hud = view.hud;
  return { view, settle: 1.2, hud: (g, R2) => hud(g, R2) };
}

/** Six vans converging on the golden last call, with the standings and the clock. */
function multiShot(R, W, H) {
  const town = TOWNS.find((t) => t.name === 'Fiveways') || TOWNS[2];
  const opts = { seed: 3, seconds: 70, drivers: drivers(6, 0.85) };
  let best = -1;
  let at = 3000;
  run(null, town, opts, 70 * 60 - 2, (w, i) => {
    if (!w.data.lastCall) return;
    const gold = openList(w.city, w.data).find((o) => o.gold);
    if (!gold) return;
    let s = 0;
    for (const r of w.runners) {
      const d = Math.hypot(r.van.x - gold.house.dropX, r.van.y - gold.house.dropY);
      if (d < 420) s += 1 - d / 900;
    }
    if (s > best) {
      best = s;
      at = i;
    }
  });
  const w = run(R, town, opts, at + 1);
  const a = addrView(R, w);
  const gold = a.open.find((o) => o.gold);
  const vans = vansOf(w).map((v, i) => ({ ...v, tag: NAMES[i] }));
  const c = gold ? { x: gold.house.dropX, y: gold.house.dropY } : { x: w.city.W / 2, y: w.city.H / 2 };
  const zoom = Math.min(W / 900, H / 520);
  const side = 250; // px of plates on the right
  const cam = { x: c.x + (side / 2 / zoom) * Math.sin(55 * DEG), y: c.y + 30, zoom, pitch: 55 * DEG, shake: [0, 0] };
  stage(w.city, vans, c, { x0: cam.x - W / 2 / zoom, x1: cam.x + (W / 2 - side) / zoom, y0: cam.y - H / 2 / zoom, y1: cam.y + H / 2 / zoom });
  const view = { cam, env: w.env, vans, rings: a.rings, beacons: a.beacons, chevrons: chevrons(a.open, vans), tilt: 0.5, band: 0.3 };
  weather(view, town, w.t);
  const rows = w.runners
    .map((r, i) => ({ name: NAMES[i], pts: (w.data.pts && w.data.pts[r.seat]) || 0, color: SEATS[i].color, symbol: SEATS[i].symbol, me: i === 0 }))
    .sort((p, q) => q.pts - p.pts);
  rows.forEach((r, k) => (r.place = k > 0 && rows[k - 1].pts === r.pts ? rows[k - 1].place : k + 1));
  const hud = (g) => {
    clockSign(g, W - 72, 66, 46, '0:14', { red: true });
    plates(g, W - 224, 132, rows, 210);
    outlined(g, 'LAST CALL', W - 119, 132 + rows.length * 40 + 34, 44, '#FFD23F');
    outlined(g, '×3', W - 119, 132 + rows.length * 40 + 82, 44, '#FFD23F');
  };
  return { view, hud, settle: 1.2 };
}

/** The icon: the yellow van close up, mid right turn, parcels on the roof, a right-turn arrow on the road. */
function iconShot(R, W, H, fx) {
  R.setCity(cityFor(TITLE_TOWN));
  const x = 5.5 * T;
  const y = 3.3 * T;
  const h = -Math.PI / 2 + 0.3;
  const vans = [{ x, y, h, v: 210, hold: true, color: PALETTE.yellow, body: 'box', parcels: 3, topper: 'none' }];
  for (const side of [-1, 1]) fx.spawn(x - Math.cos(h) * 20 - Math.sin(h) * 9 * side, y - Math.sin(h) * 20 + Math.cos(h) * 9 * side, 8, { color: '#ECEAE4', kind: 2, speed: 26, up: 10, life: 1.4, size: 6, z: 2, dir: h + Math.PI, spread: 1.2 });
  for (let i = 0; i < 8; i++) fx.update(0.05);
  // In front of the van and to its left: the nose, the cab and the curl on the roof.
  const yaw = Math.atan2(Math.cos(h), Math.sin(h)) - 0.75;
  const view = {
    t: 0,
    env: { cars: [], closed: new Set() },
    vans,
    cam: { x: x - Math.sin(yaw) * 9, y: y - Math.cos(yaw) * 9, zoom: W / 165, pitch: 36 * DEG, yaw, shake: [0, 0] },
    tilt: 0.7,
    band: 0.24,
    focusY: 0.5,
  };
  return { view, settle: 1.6 };
}

/**
 * Staging: vans outside the frame are put on the roads leading in to `c`, in the left lane and facing it, spread apart. The
 * picture is the scramble's last call; the sim alone rarely brings all six into one shot.
 */
function stage(city, vans, c, box) {
  const inBox = (x, y, pad) => x > box.x0 + pad && x < box.x1 - pad && y > box.y0 + pad && y < box.y1 - pad;
  const taken = [[c.x, c.y]];
  const away = [];
  for (const v of vans) {
    if (inBox(v.x, v.y, 50)) taken.push([v.x, v.y]);
    else away.push(v);
  }
  const spots = [];
  for (let ty = 0; ty < city.h; ty++) {
    for (let tx = 0; tx < city.w; tx++) {
      const ch = city.at(tx, ty);
      if (ch !== '.' && ch !== 'L' && ch !== 'z') continue;
      const horiz = tileDrivable(city, tx - 1, ty) && tileDrivable(city, tx + 1, ty);
      const vert = tileDrivable(city, tx, ty - 1) && tileDrivable(city, tx, ty + 1);
      if (horiz === vert) continue; // junctions and dead ends
      const x = (tx + 0.5) * T;
      const y = (ty + 0.5) * T;
      const h = horiz ? (c.x > x ? 0 : Math.PI) : c.y > y ? Math.PI / 2 : -Math.PI / 2;
      const sx = x + Math.sin(h) * 30; // keep left
      const sy = y - Math.cos(h) * 30;
      const d = Math.hypot(sx - c.x, sy - c.y);
      if (d < 170 || !inBox(sx, sy, 60)) continue;
      spots.push({ x: sx, y: sy, h, d });
    }
  }
  spots.sort((p, q) => p.d - q.d);
  for (const v of away) {
    const s = spots.find((p) => taken.every(([x, y]) => Math.hypot(p.x - x, p.y - y) > 190));
    if (!s) continue;
    Object.assign(v, { x: s.x, y: s.y, h: s.h, v: 240, hold: false, stall: 0, braking: false, parcels: 2 });
    taken.push([s.x, s.y]);
  }
}

// ---------------------------------------------------------------- icon and badges

function disc(g, S, color) {
  const c = S / 2;
  g.fillStyle = PALETTE.ink;
  g.beginPath();
  g.arc(c, c, S * 0.48, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(c, c, S * 0.44, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#F4F1E8';
  g.lineWidth = S * 0.025;
  g.beginPath();
  g.arc(c, c, S * 0.395, 0, Math.PI * 2);
  g.stroke();
}

function drawBadge(g, S, id) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, S, S);
  const c = S / 2;
  const ink = PALETTE.ink;
  const paint = '#F4F1E8';
  switch (id) {
    case 'first-drop': {
      disc(g, S, PALETTE.blue);
      g.save();
      g.translate(c, c + 6);
      g.rotate(-0.2);
      g.drawImage(bigParcel(false).c, -60, -60, 120, 120);
      g.restore();
      break;
    }
    case 'three-rights': {
      disc(g, S, '#17734A');
      // Right, right, right: a left.
      g.save();
      g.translate(c, c);
      g.strokeStyle = paint;
      g.lineWidth = 18;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(-40, 62);
      g.lineTo(-40, -40);
      g.lineTo(40, -40);
      g.lineTo(40, 30);
      g.lineTo(-10, 30);
      g.stroke();
      g.fillStyle = paint;
      g.beginPath();
      g.moveTo(-46, 30);
      g.lineTo(-10, 6);
      g.lineTo(-10, 54);
      g.closePath();
      g.fill();
      g.restore();
      break;
    }
    case 'doormat': {
      disc(g, S, PALETTE.red);
      g.save();
      g.translate(c, c);
      g.rotate(-0.12);
      g.fillStyle = ink;
      rr(g, -66, -44, 132, 88, 10);
      g.fill();
      g.fillStyle = '#B07A45';
      rr(g, -60, -38, 120, 76, 8);
      g.fill();
      g.strokeStyle = '#7A5230';
      g.lineWidth = 3;
      for (let x = -50; x <= 50; x += 10) {
        g.beginPath();
        g.moveTo(x, -32);
        g.lineTo(x, 32);
        g.stroke();
      }
      g.drawImage(bigParcel(false).c, -28, -34, 56, 56);
      g.restore();
      break;
    }
    case 'roundabout-regular': {
      disc(g, S, PALETTE.blue);
      g.save();
      g.translate(c, c);
      for (let i = 0; i < 3; i++) {
        g.save();
        g.rotate((i * Math.PI * 2) / 3);
        g.strokeStyle = paint;
        g.lineWidth = 16;
        g.beginPath();
        g.arc(0, 0, 52, -0.2, 1.35);
        g.stroke();
        const a = 1.35;
        g.translate(Math.cos(a) * 52, Math.sin(a) * 52);
        g.rotate(a + Math.PI / 2);
        g.fillStyle = paint;
        g.beginPath();
        g.moveTo(-17, -6);
        g.lineTo(17, -6);
        g.lineTo(0, 0);
        g.moveTo(0, 22);
        g.lineTo(-20, -4);
        g.lineTo(20, -4);
        g.closePath();
        g.fill();
        g.restore();
      }
      g.restore();
      break;
    }
    case 'rush-hour': {
      disc(g, S, PALETTE.yellow);
      g.save();
      g.translate(c, c);
      g.fillStyle = ink;
      g.beginPath();
      g.arc(0, 0, 66, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = paint;
      g.beginPath();
      g.arc(0, 0, 57, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = ink;
      for (let i = 0; i < 12; i++) {
        g.save();
        g.rotate((i * Math.PI) / 6);
        g.fillRect(-3, -52, 6, i % 3 ? 8 : 14);
        g.restore();
      }
      g.lineCap = 'round';
      g.strokeStyle = ink;
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -40);
      g.moveTo(0, 0);
      g.lineTo(26, 14);
      g.stroke();
      g.fillStyle = PALETTE.red;
      g.beginPath();
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fill();
      g.restore();
      break;
    }
    case 'twelve-towns': {
      disc(g, S, '#17734A');
      g.save();
      g.translate(c, c - 8);
      g.fillStyle = ink;
      g.beginPath();
      g.arc(0, -10, 50, Math.PI * 0.85, Math.PI * 2.15);
      g.lineTo(0, 74);
      g.closePath();
      g.fill();
      g.fillStyle = PALETTE.red;
      g.beginPath();
      g.arc(0, -10, 42, Math.PI * 0.85, Math.PI * 2.15);
      g.lineTo(0, 62);
      g.closePath();
      g.fill();
      g.fillStyle = paint;
      g.beginPath();
      g.arc(0, -10, 18, 0, Math.PI * 2);
      g.fill();
      g.restore();
      break;
    }
    case 'no-scratches': {
      disc(g, S, '#17734A');
      g.save();
      g.translate(c, c + 4);
      g.rotate(-Math.PI / 2 + 0.35);
      g.scale(2.6, 2.6);
      g.drawImage(vanShadow().c, -32 + 3, -21 + 4, 64, 42);
      g.drawImage(vanSprite('box', PALETTE.yellow).c, -28, -17, 56, 34);
      g.restore();
      // Shine.
      for (const [x, y, r] of [
        [c + 52, c - 52, 16],
        [c - 58, c + 40, 10],
      ]) {
        g.fillStyle = paint;
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const rr2 = i % 2 ? r * 0.3 : r;
          g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
        }
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'daily-driver': {
      disc(g, S, PALETTE.red);
      g.save();
      g.translate(c, c + 4);
      g.fillStyle = ink;
      rr(g, -58, -56, 116, 116, 12);
      g.fill();
      g.fillStyle = paint;
      rr(g, -52, -50, 104, 104, 9);
      g.fill();
      g.fillStyle = PALETTE.blue;
      g.fillRect(-52, -50, 104, 28);
      g.fillStyle = ink;
      g.fillRect(-32, -66, 10, 26);
      g.fillRect(22, -66, 10, 26);
      g.translate(0, 18);
      curl(g, 48, PALETTE.blue, 16);
      g.restore();
      break;
    }
    case 'all-stars': {
      disc(g, S, ink);
      g.save();
      g.translate(c, c);
      for (const [x, y, r] of [
        [-48, 16, 30],
        [0, -14, 40],
        [48, 16, 30],
      ]) {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr2 = i % 2 ? r * 0.45 : r;
          g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
        }
        g.closePath();
        g.fillStyle = PALETTE.yellow;
        g.strokeStyle = shade(PALETTE.yellow, -0.4);
        g.lineWidth = 4;
        g.lineJoin = 'round';
        g.fill();
        g.stroke();
      }
      g.restore();
      break;
    }
    case 'full-flow': {
      // Five bars, rising and full.
      disc(g, S, '#1B2A55');
      g.save();
      g.translate(c, c + 6);
      const cols = ['#5BC4A0', '#9BD35A', '#FFC22E', '#FF8A3C', '#F0573C'];
      for (let i = 0; i < 5; i++) {
        const bh = 26 + i * 16;
        const x = -66 + i * 28;
        g.fillStyle = ink;
        rr(g, x - 3, 44 - bh - 3, 26, bh + 6, 6);
        g.fill();
        g.fillStyle = cols[i];
        rr(g, x, 44 - bh, 20, bh, 4);
        g.fill();
      }
      g.restore();
      break;
    }
    case 'express': {
      // A parcel with a lightning bolt, rushing.
      disc(g, S, '#E2412E');
      g.save();
      g.translate(c + 8, c + 4);
      g.strokeStyle = paint;
      g.lineCap = 'round';
      g.lineWidth = 9;
      for (const [y, l] of [
        [-26, 40],
        [0, 56],
        [26, 40],
      ]) {
        g.beginPath();
        g.moveTo(-58 - l, y);
        g.lineTo(-62, y);
        g.stroke();
      }
      g.rotate(-0.12);
      g.drawImage(bigParcel(false).c, -56, -56, 112, 112);
      g.fillStyle = '#FFD23F';
      g.strokeStyle = ink;
      g.lineWidth = 5;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(8, -40);
      g.lineTo(-18, 6);
      g.lineTo(0, 6);
      g.lineTo(-8, 40);
      g.lineTo(22, -8);
      g.lineTo(4, -8);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
      break;
    }
    case 'senior-courier': {
      // The courier's cap, with a star.
      disc(g, S, PALETTE.yellow);
      g.save();
      g.translate(c, c + 18);
      g.fillStyle = ink;
      g.beginPath();
      g.arc(0, 0, 66, Math.PI, 0);
      g.closePath();
      g.fill();
      rr(g, -70, -6, 150, 22, 10);
      g.fill();
      g.fillStyle = '#1E5BC6';
      g.beginPath();
      g.arc(0, 0, 58, Math.PI, 0);
      g.closePath();
      g.fill();
      rr(g, -62, -2, 136, 12, 6);
      g.fill();
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r2 = i % 2 ? 9 : 21;
        g.lineTo(Math.cos(a) * r2, -30 + Math.sin(a) * r2);
      }
      g.closePath();
      g.fillStyle = PALETTE.yellow;
      g.fill();
      g.restore();
      break;
    }
    default:
      disc(g, S, PALETTE.blue);
      g.save();
      g.translate(c, c + 8);
      curl(g, 70, paint, 24);
      g.restore();
  }
}

