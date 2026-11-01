// 2D drawing shared by the HUD and the painted words on the road: the font, seat symbols and road paint.

import { PALETTE } from './config.js';
import { hashString, createRng } from './rng.js';
import { curl } from './sprites.js';

const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

export const font = (weight, px) => `${weight} ${px}px ${FONT}`;

/** Seat symbols: a colour always comes with a shape. */
export function symbol(g, kind, x, y, r, color) {
  g.save();
  g.translate(x, y);
  g.fillStyle = color;
  g.strokeStyle = PALETTE.ink;
  g.lineWidth = 2;
  g.beginPath();
  if (kind === 'triangle') {
    g.moveTo(0, -r * 1.1);
    g.lineTo(r, r * 0.8);
    g.lineTo(-r, r * 0.8);
    g.closePath();
  } else if (kind === 'square') g.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
  else if (kind === 'diamond') {
    g.moveTo(0, -r * 1.15);
    g.lineTo(r, 0);
    g.lineTo(0, r * 1.15);
    g.lineTo(-r, 0);
    g.closePath();
  } else if (kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr2 = i % 2 ? r * 0.5 : r * 1.15;
      g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
    }
    g.closePath();
  } else if (kind === 'hexagon') {
    for (let i = 0; i < 6; i++) g.lineTo(Math.cos((i * Math.PI) / 3) * r, Math.sin((i * Math.PI) / 3) * r);
    g.closePath();
  } else g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
}

/**
 * Road paint: words sprayed on the asphalt, the way lane markings read: each line runs across the road (fitted to `width`),
 * the letters tall along it, lines stacked along the road. p: { lines, x, y, h (the way the road runs), width, alpha, wipe,
 * color, upright (screen-upright, for titles) }. Never drawn upside down on screen.
 */
export function drawPaint(g, p) {
  if (!(p.alpha > 0)) return;
  if (p.arrow) return drawPaintArrow(g, p);
  const lines = p.lines || [p.text];
  const width = p.width || 104;
  g.save();
  g.translate(p.x, p.y);
  let a = p.upright ? 0 : (p.h || 0) + Math.PI / 2;
  if (Math.cos(a) < -0.2) a += Math.PI;
  g.rotate(a);
  // One size for every line: the widest line fills the width.
  g.font = font(900, 100);
  let widest = 1;
  for (const l of lines) widest = Math.max(widest, g.measureText(l).width);
  const size = Math.min(p.max || 60, (100 * width) / widest);
  const stretch = p.stretch || 1.45;
  const lineH = size * stretch * 0.98;
  g.font = font(900, size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = lineH * lines.length;
  const wipe = p.wipe === undefined ? 1 : p.wipe;
  if (wipe < 1) {
    g.beginPath();
    g.rect(-width / 2 - 20, -total / 2 - 10, width + 40, (total + 20) * wipe);
    g.clip();
  }
  g.globalAlpha = p.alpha * 0.93;
  g.fillStyle = p.color || '#F4F1E8';
  lines.forEach((l, i) => {
    g.save();
    g.translate(0, -total / 2 + lineH * (i + 0.5));
    g.scale(1, stretch);
    g.fillText(l, 0, size * 0.04);
    g.restore();
  });
  // Worn grain.
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = p.alpha * 0.3;
  const rng = createRng(hashString(lines.join('/')));
  for (let i = 0; i < 30 * lines.length; i++) g.fillRect(rng.float(-width / 2, width / 2), rng.float(-total / 2, total / 2), 3, 2);
  g.restore();
}

/** A painted turn arrow: the brand curl, worn into the road. p: { x, y, size, alpha, color } */
function drawPaintArrow(g, p) {
  const s = p.size || 40;
  g.save();
  g.translate(p.x, p.y);
  g.globalAlpha = p.alpha * 0.93;
  curl(g, s, p.color || '#F4F1E8');
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = p.alpha * 0.3;
  const rng = createRng(77);
  for (let i = 0; i < 26; i++) g.fillRect(rng.float(-s, s), rng.float(-s, s), 3, 2);
  g.restore();
}

