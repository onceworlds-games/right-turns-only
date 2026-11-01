// Store art: one staged, deterministic frame per poster, drawn with the game's own renderer from real (simulated) play.

import { T, SEATS, PALETTE, DELIVERY, angleDiff } from './config.js';
import { TOWNS, TITLE_TOWN } from './towns.js';
import { createRenderer } from './render.js';
import { createScrambleWorld } from './world.js';
import { openList } from './scramble.js';
import { createFx } from './fx.js';
import { drawPodium } from './yard.js';
import { outlined, plates, clockSign } from './hud.js';
import { tileDrivable } from './city.js';
import { vanSprite, vanShadow, curl, bigParcel, rr, shade } from './sprites.js';

const BODIES = ['box', 'bread', 'pickup', 'mail', 'tuk', 'icecream'];
const NAMES = ['Mo', 'Rosa', 'Dex', 'Juno', 'Pip', 'Vik'];

export async function renderPoster(name) {
  const badge = name.startsWith('badge-');
  const W = innerWidth;
  const H = innerHeight;
  try {
    await Promise.race([Promise.all([document.fonts.load('900 40px "Barlow Condensed"'), document.fonts.load('700 20px "Barlow Condensed"')]), new Promise((r) => setTimeout(r, 2000))]);
    await document.fonts.ready;
  } catch {
    /* draw with what we have */
  }
  const cv = document.getElementById('cv');
  const R = createRenderer(cv);
  R.resize(W, H, 1);
  R.quality = 'high';
  if (badge) drawBadge(R.ctx, W, name.slice(6));
  else if (name === 'icon') drawIcon(R.ctx, W);
  else if (name === 'win') drawWin(R, W, H);
  else if (name === 'action') drawAction(R, W, H);
  else if (name === 'multi') drawMulti(R, W, H);
  else drawCover(R, W, H);
  requestAnimationFrame(() => requestAnimationFrame(() => (document.body.dataset.ready = '1')));
}

// ---------------------------------------------------------------- simulated play

function drivers(n, skill = 0.85) {
  const styles = ['veteran', 'careful', 'rusher', 'steady', 'shortcut', 'rookie'];
  return Array.from({ length: n }, (_, i) => ({ id: `bot:${i + 1}`, skill: i === 0 ? 1 : skill - i * 0.03, style: styles[i % 6], seed: 7 + i }));
}

/** Run a scramble, leaving tyre marks on the renderer, calling pick(world, step) each step; returns the world. */
function run(R, town, opts, steps, pick) {
  const w = createScrambleWorld(town, opts);
  R.setCity(w.city);
  R.clearMarks();
  for (let i = 0; i < steps; i++) {
    w.step();
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

function addrView(w) {
  const open = openList(w.city, w.data);
  return {
    open,
    rings: open.map((o) => ({ x: o.house.dropX, y: o.house.dropY, gold: o.gold })),
    beacons: open.map((o) => ({ x: o.house.doorX, y: o.house.doorY - 10, gold: o.gold, scale: o.gold ? 1.3 : 1 })),
  };
}

function weather(view, town, t) {
  if (town.night) Object.assign(view, { dark: 0.8, darkColor: '#0B1030', neon: true });
  else if (town.dusk) Object.assign(view, { dark: 0.42, darkColor: '#3A1F3A' });
  else if (town.rain) view.rain = true;
  if (town.snow) view.snow = true;
  view.t = t;
  view.reduced = true;
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

// ---------------------------------------------------------------- the posters

/** The title street, mid-scramble: the name painted on the avenue, a van delivering past it. */
function drawCover(R, W, H) {
  // Find the moment a van is in a ring in the shot and the most vans are in it, none of them on the words.
  const target = { x: 5.5 * T, y: 4 * T };
  let best = -Infinity;
  let at = 600;
  const opts = { seed: 11, seconds: 1e9, drivers: drivers(4, 0.95) };
  const inFrame = (x, y) => Math.abs(x - target.x) < 360 && Math.abs(y - target.y) < 200;
  run(R, TITLE_TOWN, opts, 2400, (w, i) => {
    if (i < 600) return;
    const open = openList(w.city, w.data);
    let s = 0;
    for (const r of w.runners) {
      if (inFrame(r.van.x, r.van.y)) s += 1;
      if (Math.abs(r.van.x - target.x) < 110 && Math.abs(r.van.y - 4.15 * T) < 170) s -= 3;
      for (const o of open) {
        const d = Math.hypot(o.house.dropX - r.van.x, o.house.dropY - r.van.y);
        if (d < 50 && inFrame(r.van.x, r.van.y)) s += 3 - d / 50;
      }
    }
    // A ring painted over the words muddles them.
    for (const o of open) if (Math.abs(o.house.dropX - target.x) < 150 && Math.abs(o.house.dropY - 4.15 * T) < 200) s -= 2;
    if (s > best) {
      best = s;
      at = i;
    }
  });
  const w = run(R, TITLE_TOWN, opts, at + 1);
  const a = addrView(w);
  const vans = vansOf(w);
  // The van delivering is the courier-yellow one (seat colours are only paint).
  let hero = -1;
  let heroHouse = null;
  let near = 50;
  vans.forEach((v, i) => {
    for (const o of a.open) {
      const d = Math.hypot(o.house.dropX - v.x, o.house.dropY - v.y);
      if (d < near && inFrame(v.x, v.y)) {
        near = d;
        hero = i;
        heroHouse = o.house;
      }
    }
  });
  if (hero > 0) {
    const tmp = { color: vans[0].color, body: vans[0].body, symbol: vans[0].symbol };
    Object.assign(vans[0], { color: vans[hero].color, body: vans[hero].body, symbol: vans[hero].symbol });
    Object.assign(vans[hero], tmp);
  }
  const fx = createFx();
  if (heroHouse) {
    const v = vans[Math.max(0, hero)];
    fx.add('throw', { x0: v.x, y0: v.y, x1: heroHouse.doorX, y1: heroHouse.doorY, gold: false, dur: 0.42 });
    fx.throws[0].t = 0.18;
  }
  const zoom = Math.min(H / 560, W / 700) * 1.15;
  const view = {
    cam: { x: 5.5 * T, y: 3.95 * T, zoom, shake: [0, 0] },
    env: w.env,
    vans,
    rings: a.rings,
    beacons: a.beacons,
    paint: [
      { lines: ['RIGHT', 'TURNS', 'ONLY'], x: 5.5 * T, y: 4.15 * T, upright: true, width: 112, max: 80, stretch: 1.3, alpha: 1 },
      { arrow: true, x: 5.5 * T, y: 2.4 * T, size: 40, alpha: 1 },
    ],
  };
  view.drawWorldFx = (g) => fx.drawWorld(g);
  weather(view, TITLE_TOWN, w.t);
  R.frame(view);
}

/** A close-up at night: a van swinging right past a lit address, the parcel in the air. */
function drawAction(R, W, H) {
  const town = TOWNS.find((t) => t.night) || TOWNS[6];
  const opts = { seed: 4, seconds: 1e9, drivers: drivers(5, 0.9) };
  let best = -1;
  let at = 900;
  let pickData = null;
  run(R, town, opts, 3600, (w, i) => {
    if (i < 600) return;
    const r = w.runners[0];
    if (!r.van.hold || r.van.v < 120) return;
    const open = openList(w.city, w.data);
    for (const o of open) {
      const d = Math.hypot(o.house.dropX - r.van.x, o.house.dropY - r.van.y);
      if (d > 60) continue;
      const others = w.runners.slice(1).filter((q) => Math.hypot(q.van.x - r.van.x, q.van.y - r.van.y) < 260).length;
      const s = 2 - d / 60 + others * 0.7;
      if (s > best) {
        best = s;
        at = i;
        pickData = o.house.id;
      }
    }
  });
  const w = run(R, town, opts, at + 1);
  const a = addrView(w);
  const van = w.runners[0].van;
  const view = {
    cam: { x: van.x + Math.cos(van.h) * 40, y: van.y + Math.sin(van.h) * 40, zoom: Math.min(W, H) / 330, shake: [0, 0] },
    env: w.env,
    vans: vansOf(w),
    rings: a.rings,
    beacons: a.beacons,
  };
  // The parcel already on its way to the porch.
  const house = w.city.houses.find((h) => h.id === pickData) || null;
  const fx = createFx();
  if (house) {
    fx.add('throw', { x0: van.x, y0: van.y, x1: house.doorX, y1: house.doorY, gold: false, dur: 0.42 });
    fx.throws[0].t = 0.2;
    fx.spawn(van.x - Math.cos(van.h) * 20, van.y - Math.sin(van.h) * 20, 14, { color: ['#FFD27A', '#FFFFFF'], speed: 120, life: 0.6, size: 3 });
    fx.update(0.1);
  }
  view.drawWorldFx = (g) => fx.drawWorld(g);
  weather(view, town, w.t);
  R.frame(view);
}

/** The podium after a scramble: the winner's van spinning donuts, confetti. */
function drawWin(R, W, H) {
  const g = R.ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const rows = [
    { place: 1, name: 'Mo', pts: 31, color: SEATS[0].color, body: 0 },
    { place: 2, name: 'Rosa', pts: 27, color: SEATS[1].color, body: 1 },
    { place: 3, name: 'Dex', pts: 22, color: SEATS[2].color, body: 3 },
  ];
  drawPodium(g, W, H, rows, 0.43, 70, 40);
  // Tyre donuts under the winner.
  g.save();
  g.strokeStyle = 'rgba(18,20,26,0.35)';
  g.lineWidth = 6;
  const unit = Math.min(W / 3.6, (H - 110) / 2.6, 220);
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    g.arc(W / 2, 70 + (H - 110) * 0.78 - unit * 0.85 - unit * 0.32, unit * (0.38 + k * 0.08), 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
  const fx = createFx();
  for (let i = 0; i < 6; i++) fx.spawn(W / 2 + (i - 2.5) * 180, -30, 30, { dir: Math.PI / 2, spread: 2.4, speed: 520, life: 4, size: 11, kind: 1, color: ['#FFC22E', '#F0573C', '#3EA6F0', '#37C98A', '#F4F1E8', '#A174F2'], drag: 1.2, jitter: 120 });
  fx.update(0.32);
  fx.update(0.32);
  fx.drawWorld(g);
  outlined(g, 'SHIFT SCRAMBLE', W / 2, 52, 64, '#F4F1E8');
  // The rest of the field on exit-sign plates along the bottom.
  const rest = [
    { place: 4, name: 'Juno', pts: 18, color: SEATS[3].color, symbol: SEATS[3].symbol },
    { place: 5, name: 'Pip', pts: 15, color: SEATS[4].color, symbol: SEATS[4].symbol },
    { place: 6, name: 'Vik', pts: 11, color: SEATS[5].color, symbol: SEATS[5].symbol },
  ];
  rest.forEach((r, k) => plates(g, W / 2 + (k - 1) * 240 - 105, H - 78, [r], 210));
}

/** Six vans converging on the golden last call, with the standings and the clock. */
function drawMulti(R, W, H) {
  const town = TOWNS.find((t) => t.name === 'Fiveways') || TOWNS[2];
  const opts = { seed: 3, seconds: 70, drivers: drivers(6, 0.85) };
  let best = -1;
  let at = 3000;
  run(R, town, opts, 70 * 60 - 2, (w, i) => {
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
  const a = addrView(w);
  const gold = a.open.find((o) => o.gold);
  const vans = vansOf(w).map((v, i) => ({ ...v, tag: NAMES[i] }));
  const c = gold ? { x: gold.house.dropX, y: gold.house.dropY } : { x: w.city.W / 2, y: w.city.H / 2 };
  const zoom = Math.min(W / 1000, H / 560);
  const side = 250; // px of plates on the right
  const cam = { x: c.x + side / 2 / zoom, y: c.y + 20, zoom, shake: [0, 0] };
  stage(w.city, vans, c, { x0: cam.x - W / 2 / zoom, x1: cam.x + (W / 2 - side) / zoom, y0: cam.y - H / 2 / zoom, y1: cam.y + H / 2 / zoom });
  const view = {
    cam,
    env: w.env,
    vans,
    rings: a.rings,
    beacons: a.beacons,
    chevrons: chevrons(a.open, vans),
  };
  weather(view, town, w.t);
  R.frame(view);
  // The scramble HUD, as in the game.
  const g = R.ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const rows = w.runners
    .map((r, i) => ({ name: NAMES[i], pts: (w.data.pts && w.data.pts[r.seat]) || 0, color: SEATS[i].color, symbol: SEATS[i].symbol, me: i === 0 }))
    .sort((p, q) => q.pts - p.pts);
  rows.forEach((r, k) => (r.place = k > 0 && rows[k - 1].pts === r.pts ? rows[k - 1].place : k + 1));
  clockSign(g, W - 72, 66, 46, '0:14', { red: true });
  plates(g, W - 224, 132, rows, 210);
  outlined(g, 'LAST CALL', W - 119, 132 + rows.length * 40 + 34, 44, '#FFD23F');
  outlined(g, '×3', W - 119, 132 + rows.length * 40 + 82, 44, '#FFD23F');
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

/** The icon: the yellow van riding the brand's right-turn curl on a blue road sign. */
function drawIcon(g, S) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = PALETTE.blue;
  g.fillRect(0, 0, S, S);
  // A plate's white border, inside the safe area.
  g.strokeStyle = '#F4F1E8';
  g.lineWidth = S * 0.03;
  rr(g, S * 0.1, S * 0.1, S * 0.8, S * 0.8, S * 0.09);
  g.stroke();
  g.save();
  g.translate(S / 2, S * 0.53);
  curl(g, S * 0.42, '#F4F1E8', S * 0.11);
  g.restore();
  // The van at the top of the curl, heading right.
  const r = S * 0.42 * 0.62;
  g.save();
  g.translate(S / 2 - S * 0.02, S * 0.53 + S * 0.42 * 0.12 - r);
  const k = S / 150;
  g.scale(k, k);
  g.drawImage(vanShadow().c, -32 + 4, -21 + 6, 64, 42);
  g.drawImage(vanSprite('box', PALETTE.yellow).c, -28, -17, 56, 34);
  g.restore();
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
    default:
      disc(g, S, PALETTE.blue);
      g.save();
      g.translate(c, c + 8);
      curl(g, 70, paint, 24);
      g.restore();
  }
}

