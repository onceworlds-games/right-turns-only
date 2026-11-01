// The HUD, in screen pixels, in the street's own language: the clock is a speed-limit sign, the parcels are boxes, the
// standings are exit-sign plates, the shifts are traffic cones, and arrows at the edge point at what's off screen.

import { PALETTE } from './config.js';
import { font, symbol } from './render.js';
import { rr, curl, bigParcel } from './sprites.js';

const INK = PALETTE.ink;

export function outlined(g, text, x, y, size, color = '#F4F1E8', align = 'center', weight = 900) {
  g.font = font(weight, size);
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(4, size * 0.16);
  g.strokeStyle = INK;
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

/** The clock: a speed-limit sign. */
export function clockSign(g, x, y, r, text, { red = false, sub = null, subColor = '#F4F1E8' } = {}) {
  g.save();
  g.fillStyle = 'rgba(10,14,22,0.35)';
  g.beginPath();
  g.arc(x + 3, y + 5, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = red ? '#FFE3DC' : '#F4F1E8';
  g.beginPath();
  g.arc(x, y, r - 2.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = PALETTE.red;
  g.lineWidth = r * 0.17;
  g.beginPath();
  g.arc(x, y, r - 2.5 - r * 0.085, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = red ? PALETTE.red : INK;
  let size = r * 0.78;
  g.font = font(800, size);
  while (g.measureText(text).width > r * 1.36 && size > 10) {
    size -= 2;
    g.font = font(800, size);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y + size * 0.05);
  g.restore();
  if (sub) outlined(g, sub, x, y + r + 16, 20, subColor, 'center', 800);
}

export const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '--';
  if (s < 60) return s.toFixed(1);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
};

export const fmtClock = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The manifest: one box per parcel in the shift. states: 'todo' | 'done' | 'mat'. Centred on cx, or from `left` when given. */
export function manifest(g, cx, y, states, maxW, left = null) {
  const n = states.length;
  let size = Math.min(30, (maxW - 16) / n / 1.2);
  size = Math.max(14, size);
  const gap = size * 0.2;
  const w = n * size + (n - 1) * gap;
  if (left !== null) cx = left + 8 + w / 2;
  let x = cx - w / 2;
  g.save();
  g.fillStyle = 'rgba(20,26,34,0.72)';
  rr(g, x - 8, y - 8, w + 16, size + 16, 8);
  g.fill();
  for (const st of states) {
    if (st === 'todo') {
      g.strokeStyle = 'rgba(244,241,232,0.55)';
      g.lineWidth = 2;
      g.setLineDash([4, 3]);
      g.strokeRect(x + 1, y + 1, size - 2, size - 2);
      g.setLineDash([]);
    } else {
      const s = bigParcel(st === 'mat');
      g.drawImage(s.c, x - size * 0.12, y - size * 0.12, size * 1.24, size * 1.24);
      g.strokeStyle = st === 'mat' ? '#FFFFFF' : '#6FAE5B';
      g.lineWidth = 3.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x + size * 0.22, y + size * 0.55);
      g.lineTo(x + size * 0.42, y + size * 0.75);
      g.lineTo(x + size * 0.8, y + size * 0.3);
      g.stroke();
    }
    x += size + gap;
  }
  g.restore();
  return { x: cx - w / 2 - 8, y: y - 8, w: w + 16, h: size + 16 };
}

/**
 * Arrows at the screen's edge for targets off screen. targets: [{ sx, sy, kind: 'house'|'gold'|'depot', color }].
 * from: [x, y] (the van on screen); box: the safe rect { x0, y0, x1, y1 }; avoid: rects to keep clear.
 */
export function edgeArrows(g, targets, from, box, avoid, t) {
  for (const tg of targets) {
    const inside = tg.sx > box.x0 && tg.sx < box.x1 && tg.sy > box.y0 && tg.sy < box.y1;
    if (inside) continue;
    let dx = tg.sx - from[0];
    let dy = tg.sy - from[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Walk out from the van to the safe box's edge.
    let k = Infinity;
    if (dx > 0) k = Math.min(k, (box.x1 - from[0]) / dx);
    if (dx < 0) k = Math.min(k, (box.x0 - from[0]) / dx);
    if (dy > 0) k = Math.min(k, (box.y1 - from[1]) / dy);
    if (dy < 0) k = Math.min(k, (box.y0 - from[1]) / dy);
    let x = from[0] + dx * k;
    let y = from[1] + dy * k;
    for (const a of avoid) {
      if (x > a.x - 30 && x < a.x + a.w + 30 && y > a.y - 30 && y < a.y + a.h + 30) {
        // Slide along the edge out of the reserved area.
        if (Math.abs(dy) > Math.abs(dx)) x = x < a.x + a.w / 2 ? a.x - 32 : a.x + a.w + 32;
        else y = y < a.y + a.h / 2 ? a.y - 32 : a.y + a.h + 32;
      }
    }
    const a = Math.atan2(dy, dx);
    const pulse = 1 + Math.sin(t * 6) * 0.06;
    const col = tg.kind === 'depot' ? '#1E5BC6' : tg.kind === 'gold' ? '#FFD23F' : tg.color || '#FFC22E';
    g.save();
    g.translate(x, y);
    g.scale(pulse, pulse);
    g.save();
    g.rotate(a);
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(34, 0);
    g.lineTo(6, -22);
    g.lineTo(6, 22);
    g.closePath();
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(29, 0);
    g.lineTo(9, -16);
    g.lineTo(9, 16);
    g.closePath();
    g.fill();
    g.restore();
    // The icon disc.
    g.fillStyle = INK;
    g.beginPath();
    g.arc(0, 0, 21, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    g.arc(0, 0, 18, 0, Math.PI * 2);
    g.fill();
    if (tg.kind === 'depot') curl(g, 12, '#F4F1E8');
    else {
      const s = bigParcel(tg.kind === 'gold');
      g.drawImage(s.c, -12, -12, 24, 24);
    }
    if (tg.label) outlined(g, tg.label, 0, 32, 18, '#F4F1E8', 'center', 800);
    g.restore();
  }
}

/** Standings as stacked green exit-sign plates. rows: [{ place, name, pts, color, symbol, me }] */
export function plates(g, x, y, rows, w = 210) {
  const h = 34;
  let yy = y;
  for (const r of rows) {
    g.save();
    g.fillStyle = 'rgba(10,14,22,0.3)';
    rr(g, x + 2, yy + 3, w, h, 6);
    g.fill();
    g.fillStyle = r.me ? '#FFC22E' : '#F4F1E8';
    rr(g, x - 2, yy - 2, w + 4, h + 4, 7);
    g.fill();
    g.fillStyle = '#17734A';
    rr(g, x, yy, w, h, 5);
    g.fill();
    g.font = font(800, 20);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#F4F1E8';
    g.fillText(String(r.place), x + 10, yy + h / 2 + 1);
    symbol(g, r.symbol, x + 38, yy + h / 2, 7, r.color);
    let name = r.name;
    g.font = font(700, 19);
    const maxName = w - 100;
    while (g.measureText(name).width > maxName && name.length > 2) name = name.slice(0, -1);
    if (name !== r.name) name = name.slice(0, -1) + '…';
    g.fillText(name, x + 52, yy + h / 2 + 1);
    g.textAlign = 'right';
    g.font = font(900, 24);
    g.fillText(String(r.pts), x + w - 10, yy + h / 2 + 1);
    g.restore();
    yy += h + 6;
  }
  return yy;
}

/** Three cones for the shifts: past ones knocked flat, the current one lit. */
export function shiftCones(g, cx, y, round, rounds) {
  for (let i = 0; i < rounds; i++) {
    const x = cx + (i - (rounds - 1) / 2) * 34;
    const lit = i + 1 === round;
    const done = i + 1 < round;
    g.save();
    g.translate(x, y);
    g.globalAlpha = done ? 0.55 : 1;
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(0, -17);
    g.lineTo(12, 13);
    g.lineTo(-12, 13);
    g.closePath();
    g.fill();
    g.fillStyle = lit ? '#FF7A1F' : done ? '#9A6A4A' : '#7A7F88';
    g.beginPath();
    g.moveTo(0, -14);
    g.lineTo(9.5, 11);
    g.lineTo(-9.5, 11);
    g.closePath();
    g.fill();
    g.fillStyle = '#F4F1E8';
    g.fillRect(-6, -1, 12, 4);
    g.fillStyle = INK;
    g.fillRect(-15, 11, 30, 5);
    g.restore();
  }
}
