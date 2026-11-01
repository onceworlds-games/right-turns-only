// Pre-drawn pictures: vans (seven bodies, any colour), cars, buses, the tram, people, trees, parcels and the brand curl.
// Each is drawn once into a small canvas at 2× and stamped with drawImage. Everything faces +x (east) and is centred.

import { PALETTE } from './config.js';

const S = 2; // sprite resolution: canvas px per world px
const cache = new Map();

export function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function sprite(key, w, h, draw) {
  let s = cache.get(key);
  if (!s) {
    const c = canvas(Math.ceil(w * S), Math.ceil(h * S));
    const g = c.getContext('2d');
    g.scale(S, S);
    g.translate(w / 2, h / 2);
    draw(g);
    s = { c, w, h };
    cache.set(key, s);
  }
  return s;
}

/** Stamp a sprite centred at (x, y), rotated by h (world units). */
export function stamp(ctx, s, x, y, h, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  if (h) ctx.rotate(h);
  ctx.drawImage(s.c, (-s.w / 2) * scale, (-s.h / 2) * scale, s.w * scale, s.h * scale);
  ctx.restore();
}

export function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let gg = (n >> 8) & 255;
  let b = n & 255;
  if (k >= 0) {
    r += (255 - r) * k;
    gg += (255 - gg) * k;
    b += (255 - b) * k;
  } else {
    r *= 1 + k;
    gg *= 1 + k;
    b *= 1 + k;
  }
  return `rgb(${r | 0},${gg | 0},${b | 0})`;
}

/** The brand: a fat arrow curling right (clockwise), centred, about `r` in radius. */
export function curl(g, r, color, width = r * 0.42) {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  g.lineCap = 'butt';
  g.beginPath();
  // From the bottom-left, up and over clockwise, ending pointing down on the right.
  g.arc(0, r * 0.12, r * 0.62, Math.PI * 0.82, Math.PI * 2.02);
  g.stroke();
  const a = Math.PI * 2.02;
  const ex = Math.cos(a) * r * 0.62;
  const ey = r * 0.12 + Math.sin(a) * r * 0.62;
  g.beginPath();
  g.moveTo(ex - width * 1.05, ey - width * 0.15);
  g.lineTo(ex + width * 1.05, ey - width * 0.15);
  g.lineTo(ex, ey + width * 1.25);
  g.closePath();
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------- vans

/** A van body (no lights; those are drawn live). 56×34 box with the van inside. */
export function vanSprite(body, color) {
  return sprite(`van:${body}:${color}`, 56, 34, (g) => drawVan(g, body, color));
}

export function vanShadow() {
  return sprite('vanShadow', 64, 42, (g) => {
    g.fillStyle = 'rgba(10,14,22,0.32)';
    rr(g, -27, -16, 54, 32, 9);
    g.fill();
    g.fillStyle = 'rgba(10,14,22,0.16)';
    rr(g, -30, -19, 60, 38, 12);
    g.fill();
  });
}

function drawVan(g, body, color) {
  const ink = PALETTE.ink;
  const dark = shade(color, -0.32);
  const light = shade(color, 0.28);
  g.lineJoin = 'round';
  // Wheels peeking out.
  g.fillStyle = '#1b1f26';
  for (const [x, y] of [[-15, -14], [-15, 10], [13, -14], [13, 10]]) {
    rr(g, x - 5, y, 10, 4, 1.5);
    g.fill();
  }
  if (body === 'tuk') {
    // A three-wheeler: narrow nose, wide canopy.
    g.fillStyle = ink;
    rr(g, -22, -13, 40, 26, 7);
    g.fill();
    g.fillStyle = dark;
    g.beginPath();
    g.moveTo(-21, -12);
    g.lineTo(10, -12);
    g.quadraticCurveTo(24, -6, 24, 0);
    g.quadraticCurveTo(24, 6, 10, 12);
    g.lineTo(-21, 12);
    g.closePath();
    g.fill();
    g.fillStyle = color;
    rr(g, -20, -11, 28, 22, 5);
    g.fill();
    g.fillStyle = light;
    rr(g, -18, -9, 24, 6, 3);
    g.fill();
    // Stripes on the canopy.
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 3; i++) g.fillRect(-16 + i * 8, -11, 3, 22);
    g.fillStyle = '#26303d';
    rr(g, 9, -8, 7, 16, 3);
    g.fill();
    return;
  }
  const front = 24;
  const back = -24;
  const cab = body === 'pickup' ? 4 : 8; // where the cab starts
  // Outline.
  g.fillStyle = ink;
  rr(g, back - 1.5, -15, front - back + 3, 30, 7);
  g.fill();
  // Cargo / body.
  g.fillStyle = body === 'mail' ? '#F4F1E8' : color;
  rr(g, back, -13.5, front - back, 27, 6);
  g.fill();
  // Side shading (sun from top-left): lighter top edge, darker bottom edge.
  g.fillStyle = 'rgba(255,255,255,0.22)';
  rr(g, back + 1, -13, front - back - 2, 5, 3);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.16)';
  rr(g, back + 1, 8, front - back - 2, 5, 3);
  g.fill();
  // Cab and windscreen.
  g.fillStyle = body === 'mail' ? shade('#F4F1E8', -0.08) : light;
  rr(g, cab, -12.5, front - cab - 1, 25, 5);
  g.fill();
  g.fillStyle = '#25303d';
  rr(g, front - 9, -11, 6, 22, 2.5);
  g.fill();
  g.fillStyle = 'rgba(190,225,255,0.55)';
  g.fillRect(front - 8, -9.5, 1.6, 9);
  // Mirrors.
  g.fillStyle = ink;
  g.fillRect(front - 10, -16.5, 3, 3);
  g.fillRect(front - 10, 13.5, 3, 3);
  if (body === 'pickup') {
    // Open bed with a tarp.
    g.fillStyle = dark;
    rr(g, back + 2, -11.5, cab - back - 4, 23, 3);
    g.fill();
    g.fillStyle = '#C79A5B';
    rr(g, back + 5, -8, cab - back - 10, 16, 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1;
    g.strokeRect(back + 5, -8, cab - back - 10, 16);
    return;
  }
  // Roof panel on the cargo box.
  g.fillStyle = body === 'mail' ? '#ECE7DA' : shade(color, 0.1);
  rr(g, back + 2.5, -11, cab - back - 4, 22, 4);
  g.fill();
  if (body === 'mail') {
    g.fillStyle = '#D9573B';
    g.fillRect(back, -13.5, front - back - 10, 3);
    g.fillStyle = '#1E5BC6';
    g.fillRect(back, 10.5, front - back - 10, 3);
  }
  if (body === 'bread') {
    // A round-topped bakery van: a loaf on the roof.
    g.fillStyle = '#D9A15B';
    rr(g, back + 6, -6, 18, 12, 6);
    g.fill();
    g.strokeStyle = '#A8723A';
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(back + 10 + i * 5, -4);
      g.lineTo(back + 8 + i * 5, 4);
      g.stroke();
    }
    return;
  }
  if (body === 'icecream') {
    // A cone on the roof.
    g.fillStyle = '#E3B062';
    g.beginPath();
    g.moveTo(back + 4, 0);
    g.lineTo(back + 16, -5);
    g.lineTo(back + 16, 5);
    g.closePath();
    g.fill();
    g.fillStyle = '#F6B6C8';
    g.beginPath();
    g.arc(back + 18, 0, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(back + 16.5, -1.5, 2, 0, Math.PI * 2);
    g.fill();
    return;
  }
  if (body === 'gold') {
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.moveTo(back + 6, -9);
    g.lineTo(back + 12, -9);
    g.lineTo(back + 4, 9);
    g.lineTo(back - 2, 9);
    g.closePath();
    g.fill();
  }
  // The courier curl on the roof.
  g.save();
  g.translate((back + cab) / 2, 0);
  g.rotate(Math.PI / 2);
  curl(g, 7.5, body === 'mail' ? '#1E5BC6' : '#1B2A4A');
  g.restore();
}

/** Parcels for the roof rack. */
export function parcelSprite() {
  return sprite('parcel', 12, 12, (g) => {
    g.fillStyle = PALETTE.ink;
    rr(g, -5.5, -5.5, 11, 11, 1.5);
    g.fill();
    g.fillStyle = '#C8925A';
    rr(g, -4.5, -4.5, 9, 9, 1);
    g.fill();
    g.fillStyle = '#E3B47A';
    g.fillRect(-4.5, -4.5, 9, 3);
    g.fillStyle = '#F4E3B8';
    g.fillRect(-0.8, -4.5, 1.6, 9);
  });
}

/** A bigger parcel for the beacon over a house and the throw. */
export function bigParcel(gold = false) {
  return sprite(`bigParcel:${gold}`, 30, 30, (g) => {
    g.fillStyle = PALETTE.ink;
    rr(g, -12, -12, 24, 24, 3);
    g.fill();
    g.fillStyle = gold ? '#F2B320' : '#C8925A';
    rr(g, -10, -10, 20, 20, 2);
    g.fill();
    g.fillStyle = gold ? '#FFD966' : '#E3B47A';
    g.fillRect(-10, -10, 20, 7);
    g.fillStyle = gold ? '#FFF4C2' : '#F4E3B8';
    g.fillRect(-1.8, -10, 3.6, 20);
    if (gold) {
      g.fillStyle = '#FFFFFF';
      g.fillRect(-7, -7, 3, 3);
    }
  });
}

// ---------------------------------------------------------------- traffic

export function carSprite(kind, color, id = 0) {
  if (kind === 'bus') return sprite(`bus:${color}`, 96, 38, (g) => drawBus(g, color));
  if (kind === 'tram') return sprite('tram', 154, 44, drawTram);
  const style = id % 4;
  return sprite(`car:${color}:${style}`, 50, 30, (g) => drawCar(g, color, style));
}

export function carShadow(kind) {
  const w = kind === 'tram' ? 156 : kind === 'bus' ? 98 : 52;
  const h = kind === 'tram' ? 48 : kind === 'bus' ? 42 : 32;
  return sprite(`carShadow:${kind}`, w, h, (g) => {
    g.fillStyle = 'rgba(10,14,22,0.3)';
    rr(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 8);
    g.fill();
  });
}

function drawCar(g, color, style) {
  const ink = PALETTE.ink;
  g.fillStyle = '#16191f';
  for (const [x, y] of [[-14, -14], [-14, 10], [12, -14], [12, 10]]) g.fillRect(x - 4, y, 8, 4);
  g.fillStyle = ink;
  rr(g, -24, -14, 48, 28, 8);
  g.fill();
  g.fillStyle = color;
  rr(g, -22.5, -12.5, 45, 25, 7);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.2)';
  rr(g, -21, -12, 42, 5, 3);
  g.fill();
  // Glass: windscreen, roof, rear window.
  g.fillStyle = '#26303d';
  rr(g, 4, -10, 9, 20, 3);
  g.fill();
  rr(g, -16, -9.5, 6, 19, 3);
  g.fill();
  g.fillStyle = style === 1 ? shade(color, -0.15) : shade(color, 0.12);
  rr(g, -10, -10, 14, 20, 3);
  g.fill();
  if (style === 2) {
    // A taxi sign.
    g.fillStyle = ink;
    g.fillRect(-5, -4, 5, 8);
    g.fillStyle = '#FFE680';
    g.fillRect(-4.2, -3.2, 3.4, 6.4);
  }
  if (style === 3) {
    // Roof bars.
    g.fillStyle = 'rgba(20,24,30,0.55)';
    g.fillRect(-8, -10, 2, 20);
    g.fillRect(0, -10, 2, 20);
  }
  g.fillStyle = 'rgba(190,225,255,0.5)';
  g.fillRect(5.5, -8.5, 1.4, 7);
}

function drawBus(g, color) {
  const ink = PALETTE.ink;
  g.fillStyle = ink;
  rr(g, -47, -18, 94, 36, 7);
  g.fill();
  g.fillStyle = color;
  rr(g, -45.5, -16.5, 91, 33, 6);
  g.fill();
  g.fillStyle = shade(color, 0.2);
  rr(g, -43, -13, 86, 26, 4);
  g.fill();
  // Roof vents and the windscreen.
  g.fillStyle = 'rgba(0,0,0,0.14)';
  for (let i = 0; i < 3; i++) g.fillRect(-30 + i * 22, -6, 12, 12);
  g.fillStyle = '#26303d';
  rr(g, 38, -14, 6, 28, 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(-42, -16.5, 80, 2.4);
}

function drawTram(g) {
  const ink = PALETTE.ink;
  const body = '#2FA36B';
  g.fillStyle = ink;
  rr(g, -76, -21, 152, 42, 10);
  g.fill();
  for (const x of [-74, -24, 26]) {
    g.fillStyle = body;
    rr(g, x, -19.5, 48, 39, 7);
    g.fill();
    g.fillStyle = '#F4F1E8';
    rr(g, x + 3, -15, 42, 30, 5);
    g.fill();
    g.fillStyle = shade(body, -0.2);
    g.fillRect(x + 10, -6, 28, 12);
  }
  // Pantograph.
  g.strokeStyle = '#1b1f26';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-10, -8);
  g.lineTo(10, 8);
  g.moveTo(-10, 8);
  g.lineTo(10, -8);
  g.stroke();
  g.fillStyle = '#26303d';
  rr(g, 66, -15, 7, 30, 3);
  g.fill();
  rr(g, -73, -15, 7, 30, 3);
  g.fill();
}

const SHIRTS = ['#D9573B', '#1E5BC6', '#FFC22E', '#6FAE5B', '#A174F2', '#F28C3B', '#F4F1E8'];
export function walkerSprite(i, umbrella = false) {
  return sprite(`walker:${i % 7}:${umbrella}`, 20, 20, (g) => {
    if (umbrella) {
      g.fillStyle = PALETTE.ink;
      g.beginPath();
      g.arc(0, 0, 9.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = SHIRTS[i % 7];
      g.beginPath();
      g.arc(0, 0, 8.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos((k * Math.PI) / 2) * 8.5, Math.sin((k * Math.PI) / 2) * 8.5);
        g.stroke();
      }
      return;
    }
    g.fillStyle = PALETTE.ink;
    rr(g, -4.5, -7.5, 9, 15, 4.5);
    g.fill();
    g.fillStyle = SHIRTS[i % 7];
    rr(g, -3.5, -6.5, 7, 13, 3.5);
    g.fill();
    g.fillStyle = ['#5A3B2A', '#E9C29C', '#8C5A3C', '#2B1D16', '#C68E62'][i % 5];
    g.beginPath();
    g.arc(0.5, 0, 3.2, 0, Math.PI * 2);
    g.fill();
  });
}

// ---------------------------------------------------------------- trees and props

export function treeSprite(r, color, variant = 0) {
  const R = Math.ceil(r);
  return sprite(`tree:${R}:${color}:${variant}`, R * 2 + 16, R * 2 + 16, (g) => {
    const blobs = [];
    const n = 5 + (variant % 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + variant;
      blobs.push([Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42, R * (0.55 + ((i * 37 + variant * 11) % 10) / 50)]);
    }
    blobs.push([0, 0, R * 0.62]);
    // Shadow down-right.
    g.fillStyle = 'rgba(10,20,14,0.28)';
    for (const [x, y, rr2] of blobs) {
      g.beginPath();
      g.arc(x + 6, y + 7, rr2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = shade(color, -0.35);
    for (const [x, y, rr2] of blobs) {
      g.beginPath();
      g.arc(x, y, rr2 + 1.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = color;
    for (const [x, y, rr2] of blobs) {
      g.beginPath();
      g.arc(x, y, rr2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = shade(color, 0.22);
    for (const [x, y, rr2] of blobs) {
      g.beginPath();
      g.arc(x - rr2 * 0.28, y - rr2 * 0.3, rr2 * 0.55, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function coneSprite() {
  return sprite('cone', 16, 16, (g) => {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.arc(2, 2.5, 6.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PALETTE.ink;
    g.fillRect(-6.5, -6.5, 13, 13);
    g.fillStyle = '#F26B1D';
    g.fillRect(-5.5, -5.5, 11, 11);
    g.fillStyle = '#F4F1E8';
    g.beginPath();
    g.arc(0, 0, 3.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#F26B1D';
    g.beginPath();
    g.arc(0, 0, 1.8, 0, Math.PI * 2);
    g.fill();
  });
}

/** A soft round light for the night layer. */
export function glowSprite(color = '#ffffff') {
  return sprite(`glow:${color}`, 64, 64, (g) => {
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 32);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(-32, -32, 64, 64);
  });
}

/** A headlight cone pointing +x from the origin (at the left edge of the sprite). */
export function beamSprite() {
  const s = sprite('beam', 340, 200, (g) => {
    const grd = g.createRadialGradient(-170, 0, 0, -170, 0, 340);
    grd.addColorStop(0, 'rgba(255,250,230,1)');
    grd.addColorStop(1, 'rgba(255,250,230,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-170, -10);
    g.lineTo(170, -95);
    g.lineTo(170, 95);
    g.lineTo(-170, 10);
    g.closePath();
    g.fill();
  });
  return s;
}
