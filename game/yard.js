// The yard (the lobby) and the podium, drawn in screen pixels: Clockwise Couriers' loading bays with everyone's vans.

import { PALETTE, SEATS } from './config.js';
import { vanSprite, vanShadow, curl, shade } from './sprites.js';
import { font, symbol } from './render.js';
import { outlined } from './hud.js';

const BODY_IDS = ['box', 'bread', 'pickup', 'mail', 'tuk', 'icecream', 'gold'];

function ground(g, w, h, t) {
  g.fillStyle = PALETTE.asphalt;
  g.fillRect(0, 0, w, h);
  // Big faded concrete slabs.
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x = 0; x < w; x += 160) for (let y = 0; y < h; y += 160) if (((x + y) / 160) % 2 === 0) g.fillRect(x, y, 160, 160);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  for (let x = 0; x < w; x += 160) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
}

/** The depot building across the top: returns its bottom edge. */
function depot(g, w, top, short) {
  const H = short ? 64 : Math.min(120, Math.max(84, w * 0.1));
  const y = top;
  g.fillStyle = 'rgba(10,14,22,0.35)';
  g.fillRect(14, y + 14, w - 20, H);
  g.fillStyle = PALETTE.ink;
  g.fillRect(4, y - 3, w - 8, H + 6);
  g.fillStyle = '#E9E4D6';
  g.fillRect(7, y, w - 14, H);
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let x = 7; x < w - 7; x += 10) g.fillRect(x, y, 4, H);
  g.fillStyle = '#FFC22E';
  g.fillRect(7, y + H - (short ? 14 : 26), w - 14, short ? 14 : 26);
  // Logo and name.
  const band = short ? 14 : 26;
  const r = (H - band) * 0.36;
  g.save();
  g.translate(w / 2 - Math.min(170, w * 0.28), y + (H - band) / 2);
  g.fillStyle = '#1E5BC6';
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  curl(g, r * 0.8, '#F4F1E8');
  g.restore();
  g.save();
  g.fillStyle = PALETTE.ink;
  g.font = font(900, Math.min(40, (H - band) * 0.55));
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('CLOCKWISE COURIERS', w / 2 - Math.min(170, w * 0.28) + r + 12, y + (H - band) / 2 + 2, w - 40);
  if (!short) {
    g.font = font(900, 18);
    g.textAlign = 'center';
    g.fillText('ALWAYS RIGHT ON TIME', w / 2, y + H - 12);
  }
  g.restore();
  return y + H + 6;
}

/**
 * The yard. seats: [{ name, color, symbol, body, ready, host, me, bot, empty }]. area: { top, bottom } free band in px.
 * Returns the bays' rects.
 */
export function drawYard(g, w, h, seats, area, t) {
  ground(g, w, h, t);
  const y0 = depot(g, w, area.top, h < 500);
  const y1 = h - area.bottom;
  const portrait = w < h * 0.9;
  const cols = portrait ? 2 : seats.length;
  const rows = Math.ceil(seats.length / cols);
  const avail = Math.max(120, y1 - y0 - 10);
  const bw = Math.min(170, (w - 32) / cols - 8);
  const bh = Math.min(avail / rows - 8, bw * 1.25);
  const totalW = cols * bw + (cols - 1) * 8;
  const x0 = (w - totalW) / 2;
  const rects = [];
  seats.forEach((s, i) => {
    const cx = x0 + (i % cols) * (bw + 8);
    const cy = y0 + 6 + Math.floor(i / cols) * (bh + 8);
    rects.push({ x: cx, y: cy, w: bw, h: bh, seat: s });
    // Bay lines (open at the bottom).
    g.strokeStyle = s.ready ? '#6FAE5B' : 'rgba(244,241,232,0.85)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx + 3, cy + bh);
    g.lineTo(cx + 3, cy + 3);
    g.lineTo(cx + bw - 3, cy + 3);
    g.lineTo(cx + bw - 3, cy + bh);
    g.stroke();
    // The bay light.
    g.fillStyle = PALETTE.ink;
    g.beginPath();
    g.arc(cx + bw / 2, cy + 3, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = s.ready ? '#3BE07A' : s.empty ? '#555' : '#FFB020';
    g.beginPath();
    g.arc(cx + bw / 2, cy + 3, 6, 0, Math.PI * 2);
    g.fill();
    // The van, parked nose-up above its name.
    const scale = Math.min(bw / 57, (bh * 0.6) / 56, 2.6);
    const vx = cx + bw / 2;
    const vy = cy + 12 + 28 * scale;
    g.save();
    g.globalAlpha = s.empty ? 0.38 : 1;
    g.translate(vx, vy);
    g.rotate(-Math.PI / 2);
    g.scale(scale, scale);
    const sh = vanShadow();
    g.drawImage(sh.c, -32 + 4, -21 + 5, 64, 42);
    const bounce = s.ready && !s.empty ? Math.abs(Math.sin(t * 6 + i)) * 1.5 : 0;
    const sp = vanSprite(BODY_IDS[s.body] || 'box', s.color);
    g.drawImage(sp.c, -28 + bounce, -17, 56, 34);
    g.restore();
    if (s.host && !s.empty) {
      // A courier cap on the roof: the host.
      g.save();
      g.translate(vx + scale * 12, vy - scale * 20);
      g.fillStyle = PALETTE.ink;
      g.beginPath();
      g.arc(0, 0, 13, Math.PI, 0);
      g.fillRect(-13, -1, 30, 6);
      g.fill();
      g.fillStyle = '#1E5BC6';
      g.beginPath();
      g.arc(0, 0, 10.5, Math.PI, 0);
      g.fill();
      g.fillRect(-11, 0, 25, 3);
      g.restore();
    }
    // Name and state painted on the bay floor.
    const nameY = Math.max(vy + 30 * scale + 12, cy + bh - 16);
    g.save();
    g.globalAlpha = s.empty ? 0.5 : 1;
    let name = s.name.toUpperCase();
    let size = Math.min(26, bw / 5.2);
    g.font = font(900, size);
    while (g.measureText(name).width > bw - 34 && name.length > 3) name = name.slice(0, -1);
    if (name !== s.name.toUpperCase()) name = name.slice(0, -1) + '…';
    symbol(g, s.symbol, cx + 16, nameY, 6, s.color);
    g.fillStyle = s.me ? '#FFC22E' : '#F4F1E8';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, cx + bw / 2 + 8, nameY);
    g.restore();
  });
  return rects;
}

/** The podium after a scramble: three raised docks, the winner spinning donuts. rows: standings with colors. */
export function drawPodium(g, w, h, rows, t, top, bottom) {
  ground(g, w, h, t);
  const y1 = h - bottom;
  const cx = w / 2;
  const unit = Math.min(w / 3.6, (y1 - top) / 2.6, 220);
  const docks = [
    { place: 2, x: cx - unit * 1.05, rise: 0.55 },
    { place: 1, x: cx, rise: 0.85 },
    { place: 3, x: cx + unit * 1.05, rise: 0.35 },
  ];
  const base = top + (y1 - top) * 0.78;
  for (const d of docks) {
    const row = rows.find((r) => r.place === d.place) || null;
    const dh = unit * d.rise;
    const x = d.x - unit * 0.48;
    g.fillStyle = 'rgba(10,14,22,0.35)';
    g.fillRect(x + 10, base - dh + 12, unit * 0.96, dh);
    g.fillStyle = PALETTE.ink;
    g.fillRect(x - 3, base - dh - 3, unit * 0.96 + 6, dh + 6);
    g.fillStyle = d.place === 1 ? '#FFC22E' : '#E9E4D6';
    g.fillRect(x, base - dh, unit * 0.96, dh);
    g.fillStyle = shade(d.place === 1 ? '#FFC22E' : '#E9E4D6', -0.15);
    g.fillRect(x, base - 12, unit * 0.96, 12);
    outlined(g, String(d.place), d.x, base - dh / 2 + 6, Math.min(64, unit * 0.4), '#F4F1E8');
    if (!row) continue;
    const vy = base - dh - unit * 0.32;
    const spin = d.place === 1 ? t * 3.2 : -Math.PI / 2;
    const sc = unit / 70;
    g.save();
    g.translate(d.x + (d.place === 1 ? Math.cos(t * 3.2) * unit * 0.08 : 0), vy);
    g.rotate(spin);
    g.scale(sc, sc);
    g.drawImage(vanShadow().c, -32 + 4, -21 + 5, 64, 42);
    g.drawImage(vanSprite(BODY_IDS[row.body] || 'box', row.color).c, -28, -17, 56, 34);
    g.restore();
    let name = row.name.toUpperCase();
    const size = Math.max(18, Math.min(36, unit * 0.16));
    g.font = font(900, size);
    while (g.measureText(name).width > unit * 1.0 && name.length > 3) name = name.slice(0, -1);
    // Above the spinning van's reach (its half-length is 0.4 unit).
    outlined(g, name, d.x, vy - unit * 0.42 - size * 0.75, size, row.me ? '#FFC22E' : '#F4F1E8');
    outlined(g, `${row.pts}`, d.x, base + 26, 28, '#F4F1E8');
  }
}

export { SEATS };
