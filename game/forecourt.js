// The depot forecourt at Clockwise Couriers, in 3D: the yard (everyone's van in its bay before a scramble), the garage
// (your van on the turntable) and the podium after a scramble. Views for the renderer plus the name tags over them.

import { T, SEATS } from './config.js';
import { TITLE_TOWN } from './towns.js';
import { cityFor } from './world.js';
import { podiumOrder } from './scramble.js';
import { font, symbol } from './draw2d.js';
import { outlined } from './hud.js';

export const BODY_IDS = ['box', 'bread', 'pickup', 'mail', 'tuk', 'icecream', 'gold'];

const FORE = { x: 3.5 * T, y: 7.5 * T, gap: 64 };
const TURNTABLE = { x: 2.7 * T, y: 7.5 * T };
const DEG = Math.PI / 180;
const PARK_H = Math.PI / 2 + 0.5; // nose toward the camera, turned a little to show a side
const EMPTY = { cars: [], closed: new Set() };

/** a mixed toward b by k (hex colours). */
function mix(a, b, k) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const x = p(a);
  const y = p(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

export function forecourtCity() {
  return cityFor(TITLE_TOWN);
}

/** Where n vans park: one row in landscape, two staggered rows in portrait. */
export function bays(n, portrait) {
  const cols = portrait ? Math.ceil(n / 2) : n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = portrait ? Math.floor(i / cols) : 0;
    const c = i % cols;
    const inRow = Math.min(cols, n - r * cols);
    const stagger = portrait ? (r ? 0.25 : -0.25) * FORE.gap : 0;
    out.push({ x: FORE.x + (c - (inRow - 1) / 2) * FORE.gap + stagger, y: FORE.y + (portrait ? (r ? 38 : -34) : 0) });
  }
  return out;
}

/** Keep the depth of field's sharp band on the vans (between the page's top and bottom furniture). */
function focusOn(scr, ui) {
  return { focusY: 1 - (ui.top + scr.h - ui.bottom) / 2 / scr.h, band: 0.3, tilt: 0.5 };
}

/**
 * A camera that fits world px [w, h] round (x, y) into the screen box left by the page (ui: top, bottom and maybe left,
 * right) at this pitch and turn.
 */
function fit(scr, x, y, w, h, ui, pitch, maxZoom = 4, yaw = 0) {
  const left = ui.left || 0;
  const right = ui.right || 0;
  const band = Math.max(80, scr.h - ui.top - ui.bottom);
  const across = Math.max(120, scr.w - left - right);
  const zoom = Math.max(0.3, Math.min((across * 0.94 * Math.sin(pitch)) / w, band / h, maxZoom));
  // Slide the target along the screen's up and right so (x, y) lands in the middle of the box.
  const up = (scr.h / 2 - (ui.top + scr.h - ui.bottom) / 2) / zoom;
  const side = ((scr.w / 2 - (left + scr.w - right) / 2) * Math.sin(pitch)) / zoom;
  return { x: x + Math.sin(yaw) * up + Math.cos(yaw) * side, y: y + Math.cos(yaw) * up - Math.sin(yaw) * side, zoom, pitch, yaw };
}

export function createForecourt() {
  const st = { ready: new Map(), kick: new Map(), paint: new Map(), spin: 0, hop: 0, conf: 0 };

  function nameDecal(key, text, x, y, color) {
    let p = st.paint.get(key);
    if (!p || p.lines[0] !== text || p.color !== color) {
      p = { lines: [text], x, y, upright: true, width: 54, max: 22, stretch: 1.3, alpha: 0.95, color };
      st.paint.set(key, p);
    }
    p.x = x;
    p.y = y;
    return p;
  }

  function tag(g, R, x, y, hgt, s, sub, subColor) {
    const [sx, sy, sz] = R.toScreen(x, y, hgt);
    if (sz > 1) return;
    g.save();
    g.font = font(900, 18);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let name = s.name.toUpperCase();
    while (g.measureText(name).width > 150 && name.length > 3) name = name.slice(0, -1);
    const w = g.measureText(name).width + 34;
    g.globalAlpha = s.empty ? 0.6 : 1;
    g.fillStyle = s.me ? 'rgba(46,34,6,0.9)' : 'rgba(20,26,34,0.86)';
    g.strokeStyle = s.me ? '#FFC22E' : 'rgba(244,241,232,0.35)';
    g.lineWidth = s.me ? 3 : 2;
    g.beginPath();
    g.roundRect(sx - w / 2, sy - 15, w, 30, 8);
    g.fill();
    g.stroke();
    symbol(g, s.symbol, sx - w / 2 + 13, sy, 6, s.color);
    g.fillStyle = s.me ? '#FFC22E' : '#F4F1E8';
    g.fillText(name, sx + 7, sy + 1);
    if (s.host && !s.empty) {
      // A courier cap: the host.
      const cx = sx + w / 2 - 2;
      const cy = sy - 16;
      g.fillStyle = '#141A22';
      g.beginPath();
      g.arc(cx, cy, 11, Math.PI, 0);
      g.fill();
      g.fillRect(cx - 11, cy - 1, 24, 5);
      g.fillStyle = '#1E5BC6';
      g.beginPath();
      g.arc(cx, cy, 8.5, Math.PI, 0);
      g.fill();
      g.fillRect(cx - 9, cy, 20, 2.5);
    }
    if (sub) {
      g.font = font(900, 14);
      const sw = g.measureText(sub).width + 16;
      g.fillStyle = subColor;
      g.beginPath();
      g.roundRect(sx - sw / 2, sy + 17, sw, 20, 6);
      g.fill();
      g.fillStyle = '#141A22';
      g.fillText(sub, sx, sy + 28);
    }
    g.restore();
  }

  /** The yard: seats [{ name, me, body, ready, host, empty, color, symbol, topper }] in their bays. */
  function yard(scr, seats, t, ui) {
    const portrait = scr.w < scr.h * 0.9;
    const spots = bays(seats.length, portrait);
    const pitch = (portrait ? 54 : 46) * DEG;
    const cols = portrait ? Math.ceil(seats.length / 2) : seats.length;
    const cam = fit(scr, FORE.x, FORE.y + (portrait ? 2 : 0), cols * FORE.gap + (portrait ? 30 : 40), portrait ? 190 : 130, ui, pitch, 3.4);
    const vans = [];
    const paint = [];
    seats.forEach((s, i) => {
      const p = spots[i];
      const was = st.ready.get(s.name);
      st.ready.set(s.name, !!s.ready);
      let kick = 0;
      if (s.ready && was === false) kick = 0.9;
      // An open bay keeps a stock van in a dull coat: a bot takes it if nobody does.
      const color = s.empty ? mix(s.color, '#9EA3AA', 0.6) : s.color;
      vans.push({ x: p.x, y: p.y, h: PARK_H, v: 0, color, body: BODY_IDS[s.body] || 'box', topper: s.topper || 'none', wrap: s.wrap, parcels: s.empty ? 0 : 3, me: s.me, kick, braking: !s.ready });
      paint.push(nameDecal(`n${i}`, String(i + 1), p.x - 4, p.y + 40, '#F4F1E8'));
    });
    return {
      t,
      env: EMPTY,
      vans,
      paint,
      cam,
      ...focusOn(scr, ui),
      hud(g, R) {
        seats.forEach((s, i) => {
          const p = spots[i];
          tag(g, R, p.x, p.y, 3.6, s);
        });
      },
    };
  }

  /** The garage: your van alone on the turntable, slowly turning; picks make it hop. */
  function garage(scr, look, t, dt, ui) {
    st.spin += dt * (0.55 + st.hop * 3);
    st.hop = Math.max(0, st.hop - dt * 1.6);
    // Down the street from the east: nothing between the camera and the turntable.
    const pitch = 24 * DEG;
    const yaw = Math.PI / 2;
    const x = TURNTABLE.x;
    const y = TURNTABLE.y;
    const wide = scr.w > scr.h;
    const cam = fit(scr, x, y, wide ? 104 : 70, wide ? 120 : 84, ui, pitch, 9, yaw);
    const kick = st.pendingKick || 0;
    st.pendingKick = 0;
    return {
      t,
      env: EMPTY,
      vans: [{ x, y, h: Math.PI + 0.6 + st.spin, v: 0, color: look.color, body: look.body, topper: look.topper, wrap: look.wrap, parcels: 3, me: true, kick }],
      rings: [{ x, y, color: '#F4F1E8', alpha: 0.55 }],
      cam,
      ...focusOn(scr, ui),
    };
  }

  /** A garage pick: the van hops and turns faster for a moment. */
  function hop() {
    st.hop = 1;
    st.pendingKick = 0.8;
  }

  /** The podium: rows [{ place, name, pts, color, symbol, me, body, topper }]; the top three on plinths, the rest behind. */
  function podium(scr, rows, t, dt, ui, fx) {
    const portrait = scr.w < scr.h * 0.9;
    const pitch = (portrait ? 52 : 44) * DEG;
    const cam = fit(scr, FORE.x, FORE.y - 22, portrait ? 205 : 320, portrait ? 210 : 190, ui, pitch, 3.2);
    const dx = portrait ? 66 : 78;
    const pw = portrait ? 58 : 64;
    // Plinths by order (centre, left, right), each as tall and coloured as the place of the van on it: a tie for first
    // puts two winners up, spinning.
    const PL = { 1: { hgt: 1.7, color: '#FFC22E' }, 2: { hgt: 1.1, color: '#DCE2EA' }, 3: { hgt: 0.65, color: '#D99A5B' } };
    const SLOT = [0, -dx, dx];
    const vans = [];
    const plinths = [];
    const tags = [];
    const order = podiumOrder(rows);
    const rest = order.rest;
    order.plinths.forEach((r, i) => {
      const p = r ? Math.max(1, Math.min(3, r.place | 0 || i + 1)) : i + 1;
      const d = PL[p];
      const x = FORE.x + SLOT[i];
      const y = FORE.y + 6;
      plinths.push({ x, y, w: pw, d: 58, hgt: d.hgt, color: d.color, place: r ? r.place || p : p });
      if (!r) return;
      const win = p === 1;
      const h = win ? PARK_H + t * 1.6 * (i === 0 ? 1 : -1) : PARK_H + (i === 1 ? 0.3 : -0.3);
      vans.push({ x, y, z: d.hgt, h, v: win ? 160 : 0, hold: win, color: r.color, body: BODY_IDS[r.body] || 'box', topper: r.topper || 'none', wrap: r.wrap, parcels: 3, me: r.me });
      tags.push({ r, x, y, hgt: d.hgt + 3.8 });
    });
    rest.forEach((r, i) => {
      const x = FORE.x + (i - (rest.length - 1) / 2) * (portrait ? 58 : 70);
      const y = FORE.y - 62;
      vans.push({ x, y, h: PARK_H, v: 0, color: r.color, body: BODY_IDS[r.body] || 'box', topper: r.topper || 'none', parcels: 0, me: r.me });
      tags.push({ r, x, y, hgt: 3.6 });
    });
    // Confetti over the winner every so often.
    st.conf -= dt;
    if (st.conf <= 0 && fx) {
      st.conf = 1.1 + Math.random() * 0.6;
      fx.spawn(FORE.x + (Math.random() - 0.5) * 60, FORE.y, 26, { color: ['#FFC22E', '#F4F1E8', '#E2574C', '#5BC4A0', '#4FA3E8'], kind: 1, speed: 120, up: 360, life: 1.6, size: 5, z: 40 });
    }
    return {
      t,
      env: EMPTY,
      vans,
      plinths,
      cam,
      ...focusOn(scr, ui),
      hud(g, R) {
        for (const pl of plinths) {
          const [sx, sy, sz] = R.toScreen(pl.x, pl.y + pl.d / 2, pl.hgt * 0.5);
          if (sz <= 1) outlined(g, String(pl.place), sx, sy + 4, Math.max(22, Math.min(46, scr.w / 22)), '#F4F1E8');
        }
        for (const tg of tags) tag(g, R, tg.x, tg.y, tg.hgt, { ...tg.r, symbol: tg.r.symbol || SEATS[0].symbol }, `${tg.r.pts} PTS`, tg.r.place === 1 ? '#FFC22E' : '#DCE2EA');
      },
    };
  }

  return { yard, garage, hop, podium };
}
