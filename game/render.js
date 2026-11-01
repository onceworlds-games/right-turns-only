// The world on a canvas: the town baked into cached chunks, then rings, traffic, vans, trees, light and weather on top.
// Draws whatever it is handed (a view); it decides nothing about the game.

import { T, DX, DY, DRIVE, DELIVERY, PALETTE, clamp } from './config.js';
import { lightState, bridgeState, isRoadChar } from './city.js';
import { hashString, createRng } from './rng.js';
import { canvas, vanSprite, vanShadow, carSprite, carShadow, walkerSprite, treeSprite, coneSprite, glowSprite, beamSprite, bigParcel, parcelSprite, stamp, rr, shade, curl } from './sprites.js';

const CHUNK = 480;
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const LOTS = new Set(['h', 'b', 'g', 'x', 'Q', 'w']);

export const font = (weight, px) => `${weight} ${px}px ${FONT}`;

export function createRenderer(cv) {
  const ctx = cv.getContext('2d');
  const r = {
    cv,
    ctx,
    w: 1,
    h: 1,
    pr: 1,
    city: null,
    chunks: new Map(),
    chunkScale: 1,
    quality: 'high',
    marks: null, // skid marks and snow tracks (world, half resolution)
    light: null, // the night layer (screen, half resolution)
    trees: [],
  };

  r.resize = (w, h, pr) => {
    r.w = Math.max(1, w);
    r.h = Math.max(1, h);
    r.pr = pr;
    cv.width = Math.round(r.w * pr);
    cv.height = Math.round(r.h * pr);
    r.light = null;
  };

  /** Use a town (builds its trees and empties the chunk cache). */
  r.setCity = (city) => {
    if (r.city === city) return;
    r.city = city;
    r.chunks.clear();
    r.marks = canvas(Math.ceil(city.W / 2), Math.ceil(city.H / 2));
    r.trees = treesFor(city);
  };

  r.clearMarks = () => {
    if (r.marks) r.marks.getContext('2d').clearRect(0, 0, r.marks.width, r.marks.height);
  };

  /** A tyre mark at a world point. */
  r.mark = (x, y, h, kind) => {
    if (!r.marks) return;
    const g = r.marks.getContext('2d');
    g.save();
    g.translate(x / 2, y / 2);
    g.rotate(h);
    g.fillStyle = kind === 'snow' ? 'rgba(150,165,185,0.22)' : 'rgba(18,20,26,0.16)';
    g.fillRect(-1.5, -7.5, 3, 2.4);
    g.fillRect(-1.5, 5.1, 3, 2.4);
    g.restore();
  };

  // ------------------------------------------------------------ the frame

  /**
   * view: { cam: { x, y, zoom, shake: [x, y] }, t, env, vans: [...], rings: [...], beacons: [...], ghost, depotGlow,
   *         paint: [...], fx, night, dust, rain, snow, dim, drawFx(ctx, worldToScreen) }
   */
  r.frame = (view) => {
    const { pr } = r;
    const city = r.city;
    const cam = view.cam;
    const z = cam.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = city ? edgeColour(city) : PALETTE.asphalt;
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!city) return;
    const sx = (cam.shake && cam.shake[0]) || 0;
    const sy = (cam.shake && cam.shake[1]) || 0;
    const ox = r.w / 2 - (cam.x + sx) * z;
    const oy = r.h / 2 - (cam.y + sy) * z;
    const toWorld = () => ctx.setTransform(pr * z, 0, 0, pr * z, pr * ox, pr * oy);
    toWorld();
    // Visible world rect.
    const vx0 = cam.x + sx - r.w / 2 / z;
    const vy0 = cam.y + sy - r.h / 2 / z;
    const vx1 = vx0 + r.w / z;
    const vy1 = vy0 + r.h / z;
    const view4 = [vx0 - 40, vy0 - 40, vx1 + 40, vy1 + 40];

    // The baked town.
    const want = chunkScaleFor(z * pr, r.quality);
    if (Math.abs(want - r.chunkScale) > 0.01) {
      r.chunkScale = want;
      r.chunks.clear();
    }
    let baked = 0;
    for (let cy = Math.floor(vy0 / CHUNK); cy <= Math.floor(vy1 / CHUNK); cy++) {
      for (let cx = Math.floor(vx0 / CHUNK); cx <= Math.floor(vx1 / CHUNK); cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= city.W || cy * CHUNK >= city.H) continue;
        const key = cx + cy * 1000;
        let ch = r.chunks.get(key);
        if (!ch && (baked < 3 || view.bakeAll)) {
          ch = bakeChunk(city, cx, cy, r.chunkScale);
          r.chunks.set(key, ch);
          baked++;
        }
        if (ch) ctx.drawImage(ch, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
      }
    }
    if (r.marks) ctx.drawImage(r.marks, 0, 0, city.W, city.H);
    const t = view.t || 0;
    const env = view.env;

    // Painted words (hints, titles) lie on the road under everything.
    if (view.paint) for (const p of view.paint) drawPaint(ctx, p);

    // Rings round the open addresses.
    if (view.rings) for (const ring of view.rings) drawRing(ctx, ring, t);
    if (view.depotGlow) drawDepotGlow(ctx, city, t);

    // Road furniture that changes: cones, drawbridge decks, lights.
    if (env && env.closed && env.closed.size) drawCones(ctx, city, env.closed);
    if (city.drawbridges.length) drawBridges(ctx, city, t);
    if (city.lights.length) drawLights(ctx, city, t);

    // Traffic and vans.
    const cars = env && env.cars ? env.cars : [];
    for (const c of cars) {
      if (c.walker || !inView(view4, c.x, c.y, 100)) continue;
      stamp(ctx, carShadow(c.kind), c.x + 5, c.y + 6, c.h);
    }
    for (const c of cars) {
      if (!inView(view4, c.x, c.y, 100)) continue;
      if (c.walker) drawWalker(ctx, c, view.vans, !!city.town.rain);
      else drawCar(ctx, c, t);
    }
    if (view.ghost) drawGhost(ctx, view.ghost);
    if (view.vans) {
      for (const v of view.vans) if (inView(view4, v.x, v.y, 80)) stamp(ctx, vanShadow(), v.x + 5, v.y + 7, v.h);
      for (const v of view.vans) if (inView(view4, v.x, v.y, 80)) drawVan(ctx, v, t);
    }

    // Things above the traffic: trees, the depot gantry, parcels floating over houses.
    for (const tr of r.trees) if (inView(view4, tr.x, tr.y, tr.r + 20)) stamp(ctx, tr.s, tr.x, tr.y, 0);
    drawGantry(ctx, city, z);
    if (view.beacons) for (const b of view.beacons) drawBeacon(ctx, b, t);
    if (view.chevrons) for (const c of view.chevrons) drawChevron(ctx, c, t);
    if (view.drawWorldFx) view.drawWorldFx(ctx);

    // Light and weather, in screen space.
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    const toScreen = (x, y) => [(x - cam.x - sx) * z + r.w / 2, (y - cam.y - sy) * z + r.h / 2];
    if (view.dark > 0) drawNight(r, view, toScreen, z);
    if (view.rain) drawRain(ctx, r.w, r.h, t, view.reduced);
    if (view.snow) drawSnow(ctx, r.w, r.h, t, view.reduced);
    if (view.dust > 0) drawDust(ctx, r.w, r.h, view.dust, view.dustAt ? toScreen(view.dustAt.x, view.dustAt.y) : [r.w / 2, r.h / 2], z, t);
    if (view.desaturate) {
      ctx.fillStyle = 'rgba(30,34,42,0.45)';
      ctx.fillRect(0, 0, r.w, r.h);
    }
    // Name tags over the vans, in screen pixels.
    if (view.vans) for (const v of view.vans) if (v.tag) drawTag(ctx, v, toScreen(v.x, v.y), z);
    r.toScreen = toScreen;
  };

  return r;
}

function inView(v, x, y, m) {
  return x > v[0] - m && x < v[2] + m && y > v[1] - m && y < v[3] + m;
}

function chunkScaleFor(devicePerWorld, quality) {
  const cap = quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2;
  const s = clamp(Math.ceil(devicePerWorld * 4) / 4, 0.5, cap);
  return s;
}

function edgeColour(city) {
  const p = city.town.palette;
  return city.town.id === 5 || city.town.id === 12 ? p.water : shade(p.hedge, -0.25);
}

// ---------------------------------------------------------------- baking the town

function treesFor(city) {
  const out = [];
  const p = city.town.palette;
  const green = city.town.snow ? '#4F7A62' : city.town.dust ? '#7F9A4E' : city.town.night ? '#2E5440' : p.hedge;
  for (const tr of city.trees) out.push({ x: tr.x, y: tr.y, r: tr.r + 10, s: treeSprite(tr.r + 10, shade(green, 0.12), (tr.x * 7 + tr.y) % 5) });
  // Gardens get a tree or two.
  const rng = createRng(city.seed ^ 0x7ee);
  for (let ty = 0; ty < city.h; ty++) {
    for (let tx = 0; tx < city.w; tx++) {
      if (city.at(tx, ty) !== 'g' || city.cut.has(city.idx(tx, ty))) continue;
      const n = 1 + rng.int(2);
      for (let i = 0; i < n; i++) {
        const rr2 = 20 + rng.int(10);
        out.push({ x: (tx + 0.5) * T + rng.float(-22, 22), y: (ty + 0.5) * T + rng.float(-22, 22), r: rr2, s: treeSprite(rr2, shade(green, rng.float(-0.05, 0.2)), rng.int(5)) });
      }
    }
  }
  return out;
}

function bakeChunk(city, cx, cy, scale) {
  const size = Math.ceil(CHUNK * scale);
  const c = canvas(size, size);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.translate(-cx * CHUNK, -cy * CHUNK);
  const x0 = Math.floor((cx * CHUNK) / T) - 1;
  const y0 = Math.floor((cy * CHUNK) / T) - 1;
  const x1 = Math.floor(((cx + 1) * CHUNK) / T) + 1;
  const y1 = Math.floor(((cy + 1) * CHUNK) / T) + 1;
  drawTown(g, city, x0, y0, x1, y1);
  return c;
}

const isRoad = (ch) => isRoadChar(ch);
const roadish = (city, tx, ty) => {
  const ch = city.at(tx, ty);
  return isRoad(ch) || ch === 'a';
};

/** Draw the tiles in [x0..x1] × [y0..y1] (world coordinates already set). */
export function drawTown(g, city, x0, y0, x1, y1) {
  const town = city.town;
  const p = town.palette;
  const each = (fn) => {
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (tx >= 0 && ty >= 0 && tx < city.w && ty < city.h) fn(tx, ty, city.at(tx, ty));
  };
  // 1. Ground.
  each((tx, ty, ch) => {
    const X = tx * T;
    const Y = ty * T;
    if (ch === 'w' || ch === '=' || ch === 'd') {
      g.fillStyle = p.water;
      g.fillRect(X, Y, T, T);
      const rng = createRng(hashString(`w${tx},${ty}`));
      g.strokeStyle = shade(p.water, 0.18);
      g.lineWidth = 3;
      g.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const wx = X + rng.float(10, 100);
        const wy = Y + rng.float(10, 110);
        g.beginPath();
        g.moveTo(wx, wy);
        g.quadraticCurveTo(wx + 7, wy - 5, wx + 14, wy);
        g.stroke();
      }
    } else if (isRoad(ch) || ch === 'a') {
      g.fillStyle = p.asphalt;
      g.fillRect(X, Y, T, T);
    } else if (ch === 'p' || ch === 't') {
      g.fillStyle = p.lawn;
      g.fillRect(X, Y, T, T);
      g.fillStyle = p.lawn2;
      const horiz = tx % 2 === 0;
      for (let i = 0; i < 4; i += 2) {
        if (horiz) g.fillRect(X, Y + i * 30, T, 30);
        else g.fillRect(X + i * 30, Y, 30, T);
      }
    } else if (ch === 'b' || ch === 'Q') {
      g.fillStyle = p.pave;
      g.fillRect(X, Y, T, T);
    } else {
      g.fillStyle = p.lawn;
      g.fillRect(X, Y, T, T);
    }
  });
  // Asphalt texture: faint speckle.
  each((tx, ty, ch) => {
    if (!isRoad(ch)) return;
    const rng = createRng(hashString(`a${tx},${ty}`));
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let i = 0; i < 26; i++) g.fillRect(tx * T + rng.float(0, T), ty * T + rng.float(0, T), 2, 2);
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let i = 0; i < 12; i++) g.fillRect(tx * T + rng.float(0, T), ty * T + rng.float(0, T), 3, 2);
  });
  // 2. Pavements and kerbs where lots meet roads.
  each((tx, ty, ch) => {
    if (!(LOTS.has(ch) && ch !== 'w') && ch !== 'p' && ch !== 't') return;
    for (let d = 0; d < 4; d++) {
      if (!roadish(city, tx + DX[d], ty + DY[d])) continue;
      if (city.at(tx + DX[d], ty + DY[d]) === 'a') continue;
      pavement(g, city, tx, ty, d, ch === 'p' || ch === 't' ? 8 : 14);
    }
  });
  // 3. Road markings.
  each((tx, ty, ch) => {
    if (isRoad(ch)) markings(g, city, tx, ty, ch);
  });
  // 4. Lots.
  each((tx, ty, ch) => {
    if (city.cut.has(city.idx(tx, ty)) && ch !== 'Q') {
      lot(g, city, tx, ty, ch, true);
      return;
    }
    lot(g, city, tx, ty, ch, false);
  });
  // The depot building as one roof.
  depotRoof(g, city, x0, y0, x1, y1);
  // 5. Loop zones over the lots they cut into.
  for (const zone of city.loops) {
    if (zone.tx < x0 - 2 || zone.tx > x1 + 2 || zone.ty < y0 - 2 || zone.ty > y1 + 2) continue;
    loopZone(g, city, zone);
  }
  // 6. Puddles.
  for (const pd of city.puddles) {
    g.fillStyle = 'rgba(120,150,180,0.35)';
    g.beginPath();
    g.ellipse(pd.x, pd.y, pd.r * 1.3, pd.r * 0.85, 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(200,220,240,0.25)';
    g.beginPath();
    g.ellipse(pd.x - 6, pd.y - 5, pd.r * 0.6, pd.r * 0.3, 0.3, 0, Math.PI * 2);
    g.fill();
  }
}

function pavement(g, city, tx, ty, d, w) {
  const p = city.town.palette;
  const X = tx * T;
  const Y = ty * T;
  let x = X;
  let y = Y;
  let ww = T;
  let hh = T;
  if (d === 0) hh = w;
  if (d === 2) {
    y = Y + T - w;
    hh = w;
  }
  if (d === 3) ww = w;
  if (d === 1) {
    x = X + T - w;
    ww = w;
  }
  g.fillStyle = p.pave;
  g.fillRect(x, y, ww, hh);
  // Slabs.
  g.fillStyle = 'rgba(0,0,0,0.07)';
  if (d === 0 || d === 2) for (let i = 0; i <= 4; i++) g.fillRect(X + i * 30, y, 1.5, hh);
  else for (let i = 0; i <= 4; i++) g.fillRect(x, Y + i * 30, ww, 1.5);
  // The kerb edge.
  g.fillStyle = shade(p.pave, -0.25);
  if (d === 0) g.fillRect(X, Y, T, 3);
  if (d === 2) g.fillRect(X, Y + T - 3, T, 3);
  if (d === 3) g.fillRect(X, Y, 3, T);
  if (d === 1) g.fillRect(X + T - 3, Y, 3, T);
}

function oneWayOf(city, tx, ty, axis) {
  const ow = city.town.oneWay;
  if (!ow) return undefined;
  return axis === 'h' ? ow.rows && ow.rows[ty] : ow.cols && ow.cols[tx];
}

function markings(g, city, tx, ty, ch) {
  const X = tx * T;
  const Y = ty * T;
  const n = [0, 1, 2, 3].map((d) => roadish(city, tx + DX[d], ty + DY[d]));
  const count = n.filter(Boolean).length;
  const paint = 'rgba(244,241,232,0.9)';
  if (ch === 'O' || ch === 'c') return;
  if (ch === 'D') {
    // The loading bay: a yellow hatched box.
    g.strokeStyle = '#FFC22E';
    g.lineWidth = 5;
    g.strokeRect(X + 10, Y + 10, T - 20, T - 20);
    g.save();
    g.beginPath();
    g.rect(X + 12, Y + 12, T - 24, T - 24);
    g.clip();
    g.strokeStyle = 'rgba(255,194,46,0.35)';
    g.lineWidth = 6;
    for (let i = -T; i < T * 2; i += 22) {
      g.beginPath();
      g.moveTo(X + i, Y);
      g.lineTo(X + i + T, Y + T);
      g.stroke();
    }
    g.restore();
    return;
  }
  const straightV = count === 2 && n[0] && n[2];
  const straightH = count === 2 && n[1] && n[3];
  if (ch === 'z') {
    g.fillStyle = paint;
    const across = city.zebras.find((zb) => zb.tx === tx && zb.ty === ty);
    for (let i = 0; i < 7; i++) {
      if (across && across.across === 'v') g.fillRect(X + 6 + i * 16, Y + 18, 10, T - 36);
      else g.fillRect(X + 18, Y + 6 + i * 16, T - 36, 10);
    }
    return;
  }
  if (ch === 'r' || ch === 'R') rails(g, city, tx, ty);
  if (ch === '=' || ch === 'd') bridgeDeck(g, city, tx, ty, ch);
  if (straightV || straightH) {
    const ow = oneWayOf(city, tx, ty, straightH ? 'h' : 'v');
    if (ow !== undefined) {
      if ((tx + ty) % 2 === 0) arrow(g, X + T / 2, Y + T / 2, [-Math.PI / 2, 0, Math.PI / 2, Math.PI][ow], paint);
      return;
    }
    if (ch === 'r' || ch === 'd') return;
    g.fillStyle = paint;
    for (let i = 0; i < 3; i++) {
      if (straightV) g.fillRect(X + T / 2 - 2, Y + 8 + i * 40, 4, 22);
      else g.fillRect(X + 8 + i * 40, Y + T / 2 - 2, 22, 4);
    }
    return;
  }
  if (count >= 3) {
    // Junction: a give-way (or a stop line at lights) across the lane coming in on each arm. Traffic keeps left.
    for (let d = 0; d < 4; d++) {
      if (!n[d]) continue;
      // Arm on side d: traffic arrives moving (d + 2) % 4; its lane is on its left.
      const m = (d + 2) % 4;
      const lx = DY[m];
      const ly = -DX[m];
      const ex = X + T / 2 + DX[d] * (T / 2 - 4);
      const ey = Y + T / 2 + DY[d] * (T / 2 - 4);
      g.fillStyle = paint;
      for (let k = 0; k < (ch === 'L' || ch === 'R' ? 1 : 4); k++) {
        const a = ch === 'L' || ch === 'R' ? 4 : 6 + k * 14;
        const b = ch === 'L' || ch === 'R' ? 56 : 6 + k * 14 + 8;
        const ax = ex + lx * a;
        const ay = ey + ly * a;
        const bx = ex + lx * b;
        const by = ey + ly * b;
        g.fillRect(Math.min(ax, bx) - (DX[d] ? 2.5 : 0), Math.min(ay, by) - (DY[d] ? 2.5 : 0), Math.abs(bx - ax) + (DX[d] ? 5 : 0), Math.abs(by - ay) + (DY[d] ? 5 : 0));
      }
    }
  }
}

function arrow(g, x, y, h, color) {
  g.save();
  g.translate(x, y);
  g.rotate(h);
  g.fillStyle = color;
  g.fillRect(-30, -4, 34, 8);
  g.beginPath();
  g.moveTo(4, -13);
  g.lineTo(28, 0);
  g.lineTo(4, 13);
  g.closePath();
  g.fill();
  g.restore();
}

function rails(g, city, tx, ty) {
  const X = tx * T;
  const Y = ty * T;
  const rail = (x, y) => {
    const c = city.at(x, y);
    return c === 'r' || c === 'R';
  };
  g.strokeStyle = 'rgba(190,196,206,0.85)';
  g.lineWidth = 3;
  const cx = X + T / 2;
  const cy = Y + T / 2;
  for (const off of [-14, 14]) {
    for (let d = 0; d < 4; d++) {
      if (!rail(tx + DX[d], ty + DY[d])) continue;
      g.beginPath();
      g.moveTo(cx + DY[d] * off, cy - DX[d] * off);
      g.lineTo(cx + DX[d] * (T / 2) + DY[d] * off, cy + DY[d] * (T / 2) - DX[d] * off);
      g.stroke();
    }
  }
}

function bridgeDeck(g, city, tx, ty, ch) {
  const X = tx * T;
  const Y = ty * T;
  const horiz = roadish(city, tx - 1, ty) || roadish(city, tx + 1, ty);
  const p = city.town.palette;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  if (horiz) g.fillRect(X, Y + T - 4, T, 10);
  else g.fillRect(X + T - 4, Y, 10, T);
  if (ch === 'd') {
    // The drawbridge's deck is drawn live; here, its abutments.
    g.fillStyle = p.water;
    g.fillRect(X, Y, T, T);
    g.fillStyle = shade(p.pave, -0.2);
    if (horiz) {
      g.fillRect(X, Y - 6, 10, T + 12);
      g.fillRect(X + T - 10, Y - 6, 10, T + 12);
    } else {
      g.fillRect(X - 6, Y, T + 12, 10);
      g.fillRect(X - 6, Y + T - 10, T + 12, 10);
    }
    return;
  }
  // Railings.
  g.fillStyle = shade(p.pave, -0.1);
  if (horiz) {
    g.fillRect(X, Y, T, 7);
    g.fillRect(X, Y + T - 7, T, 7);
  } else {
    g.fillRect(X, Y, 7, T);
    g.fillRect(X + T - 7, Y, 7, T);
  }
  g.fillStyle = PALETTE.ink;
  for (let i = 0; i < 4; i++) {
    if (horiz) {
      g.fillRect(X + i * 30 + 12, Y + 1, 5, 5);
      g.fillRect(X + i * 30 + 12, Y + T - 6, 5, 5);
    } else {
      g.fillRect(X + 1, Y + i * 30 + 12, 5, 5);
      g.fillRect(X + T - 6, Y + i * 30 + 12, 5, 5);
    }
  }
}

function lot(g, city, tx, ty, ch, cut) {
  const town = city.town;
  const p = town.palette;
  const X = tx * T;
  const Y = ty * T;
  const rng = createRng(hashString(`lot${town.id}:${tx},${ty}`));
  if (ch === 'x') {
    edgeLot(g, city, tx, ty, rng);
    return;
  }
  if (ch === 'g') {
    // A garden: flowerbeds and a bench.
    g.fillStyle = shade(p.lawn, 0.06);
    g.fillRect(X + 16, Y + 16, T - 32, T - 32);
    const flowers = ['#F2B544', '#E98FA4', '#F4F1E8', '#D9573B'];
    for (let i = 0; i < 18; i++) {
      g.fillStyle = flowers[rng.int(4)];
      g.beginPath();
      g.arc(X + rng.float(20, 100), Y + rng.float(20, 100), 2.5, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  if (ch === 'h') {
    const house = city.houses.find((hs) => hs.tx === tx && hs.ty === ty);
    if (house && !cut) drawHouse(g, city, house, rng);
    else if (cut) hedgeBlob(g, X + 60, Y + 60, 30, p.hedge, rng);
    return;
  }
  if (ch === 'b') {
    const house = city.houses.find((hs) => hs.tx === tx && hs.ty === ty);
    drawBuilding(g, city, tx, ty, house, rng);
  }
}

function edgeLot(g, city, tx, ty, rng) {
  const town = city.town;
  const p = town.palette;
  const X = tx * T;
  const Y = ty * T;
  if (town.night || town.id === 4 || town.id === 11) {
    // Downtown edge: dark buildings.
    g.fillStyle = shade(p.roofs[rng.int(5)], -0.3);
    g.fillRect(X + 2, Y + 2, T - 4, T - 4);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(X + 10, Y + 10, T - 20, 6);
    return;
  }
  if (town.snow) {
    for (let i = 0; i < 5; i++) {
      const x = X + rng.float(15, 105);
      const y = Y + rng.float(15, 105);
      g.fillStyle = 'rgba(150,170,190,0.35)';
      g.beginPath();
      g.arc(x + 5, y + 6, 26, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.arc(x, y, 26, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  if (town.dust) {
    g.fillStyle = shade(p.lawn, -0.08);
    g.fillRect(X, Y, T, T);
    for (let i = 0; i < 4; i++) {
      const x = X + rng.float(20, 100);
      const y = Y + rng.float(20, 100);
      g.fillStyle = 'rgba(80,50,30,0.25)';
      g.beginPath();
      g.ellipse(x + 5, y + 5, 16, 11, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#B98A5E';
      g.beginPath();
      g.ellipse(x, y, 16, 11, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#5E8C4E';
      g.fillRect(x - 3 + 18, y - 12, 6, 22);
    }
    return;
  }
  hedgeBlob(g, X + 60, Y + 60, 52, p.hedge, rng);
}

function hedgeBlob(g, x, y, r, color, rng) {
  g.fillStyle = 'rgba(10,20,14,0.25)';
  g.beginPath();
  g.arc(x + 6, y + 7, r, 0, Math.PI * 2);
  g.fill();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const bx = x + Math.cos(a) * r * 0.5;
    const by = y + Math.sin(a) * r * 0.5;
    g.fillStyle = shade(color, -0.2);
    g.beginPath();
    g.arc(bx, by, r * 0.56, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r * 0.82, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade(color, 0.15);
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.arc(x + rng.float(-r * 0.5, r * 0.4), y + rng.float(-r * 0.5, r * 0.3), r * 0.22, 0, Math.PI * 2);
    g.fill();
  }
}

/** Rotate the lot so its face points down (+y), and draw in -60..60 local units. */
function withFace(g, x, y, face, fn) {
  g.save();
  g.translate(x, y);
  const rot = face === 2 ? 0 : face === 0 ? Math.PI : face === 1 ? -Math.PI / 2 : Math.PI / 2;
  g.rotate(rot);
  fn(rot);
  g.restore();
}

function drawHouse(g, city, house, rng) {
  const p = city.town.palette;
  const face = house.face >= 0 ? house.face : 2;
  const roof = p.roofs[house.roof % p.roofs.length];
  const night = !!city.town.night;
  withFace(g, house.x, house.y, face, (rot) => {
    const w = 66 + rng.int(10);
    const back = -46;
    const front = 14 + rng.int(4);
    const ox = rng.float(-6, 6);
    // Front path and the doormat.
    if (house.face >= 0) {
      g.fillStyle = shade(p.pave, -0.05);
      g.fillRect(ox - 7, front, 14, 46 - front);
      g.fillStyle = '#7A4E33';
      g.fillRect(ox - 9, 26, 18, 9);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(ox - 7, 28, 14, 1.5);
      // Mailbox.
      g.fillStyle = PALETTE.ink;
      g.fillRect(ox + 16, 38, 7, 6);
      g.fillStyle = '#D9573B';
      g.fillRect(ox + 16.8, 38.8, 5.4, 4.4);
    }
    // Side hedges or a fence.
    if (rng.chance(0.6)) {
      g.fillStyle = shade(p.hedge, -0.1);
      g.fillRect(-58, -56, 8, 100);
      g.fillRect(50, -56, 8, 100);
      g.fillStyle = p.hedge;
      g.fillRect(-57, -55, 6, 98);
      g.fillRect(51, -55, 6, 98);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 9; i++) {
        g.fillRect(-57, -54 + i * 11, 3, 7);
        g.fillRect(54, -54 + i * 11, 3, 7);
      }
    }
    // Shadow (the sun is top-left in the world: shadow goes down-right in world).
    const sdx = Math.cos(-rot) * 9 - Math.sin(-rot) * 11;
    const sdy = Math.sin(-rot) * 9 + Math.cos(-rot) * 11;
    g.fillStyle = 'rgba(12,16,22,0.3)';
    g.fillRect(ox - w / 2 + sdx, back + sdy, w, front - back);
    // Walls peek out under the eaves.
    g.fillStyle = PALETTE.ink;
    g.fillRect(ox - w / 2 - 1.5, back - 1.5, w + 3, front - back + 3);
    // Gable roof: the ridge runs across (parallel to the street).
    const mid = (back + front) / 2;
    const sunFront = sunLit(rot, 0, 1);
    const lightC = shade(roof, 0.18);
    const darkC = shade(roof, -0.18);
    g.fillStyle = sunFront ? darkC : lightC;
    g.fillRect(ox - w / 2, back, w, mid - back);
    g.fillStyle = sunFront ? lightC : darkC;
    g.fillRect(ox - w / 2, mid, w, front - mid);
    // Roof tiles.
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let yy = back + 6; yy < front - 2; yy += 7) if (Math.abs(yy - mid) > 3) g.fillRect(ox - w / 2, yy, w, 1.5);
    g.fillStyle = shade(roof, -0.35);
    g.fillRect(ox - w / 2, mid - 1.5, w, 3);
    // Chimney or solar panels.
    if (rng.chance(0.55)) {
      const cx = ox + rng.float(-w / 2 + 12, w / 2 - 20);
      g.fillStyle = PALETTE.ink;
      g.fillRect(cx - 1, back + 5, 12, 12);
      g.fillStyle = '#A65A44';
      g.fillRect(cx, back + 6, 10, 10);
      g.fillStyle = '#3a2a24';
      g.fillRect(cx + 2.5, back + 8.5, 5, 5);
    } else {
      g.fillStyle = '#23324A';
      const sx0 = ox - w / 2 + 8;
      g.fillRect(sx0, back + 5, 26, mid - back - 9);
      g.fillStyle = 'rgba(160,200,255,0.25)';
      for (let i = 0; i < 3; i++) g.fillRect(sx0 + 1 + i * 8.5, back + 6, 7, mid - back - 11);
    }
    // Porch over the door.
    if (house.face >= 0) {
      g.fillStyle = PALETTE.ink;
      g.fillRect(ox - 12, front - 2, 24, 10);
      g.fillStyle = shade(roof, -0.05);
      g.fillRect(ox - 11, front - 1, 22, 8);
      if (night) {
        g.fillStyle = 'rgba(255,214,120,0.9)';
        g.fillRect(ox - 3, front + 7, 6, 3);
      }
    }
  });
}

/** Is the roof half with local normal (nx, ny) facing the sun (top-left) after rotating by rot? */
function sunLit(rot, nx, ny) {
  const wx = nx * Math.cos(rot) - ny * Math.sin(rot);
  const wy = nx * Math.sin(rot) + ny * Math.cos(rot);
  return wx * -1 + wy * -1 > 0;
}

function drawBuilding(g, city, tx, ty, house, rng) {
  const p = city.town.palette;
  const X = tx * T;
  const Y = ty * T;
  const face = house && house.face >= 0 ? house.face : -1;
  const roof = p.roofs[rng.int(p.roofs.length)];
  const inset = 16;
  // Shadow then walls then roof.
  g.fillStyle = 'rgba(12,16,22,0.32)';
  g.fillRect(X + inset + 10, Y + inset + 12, T - inset * 2, T - inset * 2);
  g.fillStyle = PALETTE.ink;
  g.fillRect(X + inset - 2, Y + inset - 2, T - inset * 2 + 4, T - inset * 2 + 4);
  g.fillStyle = roof;
  g.fillRect(X + inset, Y + inset, T - inset * 2, T - inset * 2);
  // Parapet: lighter top-left edges, darker bottom-right.
  g.fillStyle = shade(roof, 0.22);
  g.fillRect(X + inset, Y + inset, T - inset * 2, 4);
  g.fillRect(X + inset, Y + inset, 4, T - inset * 2);
  g.fillStyle = shade(roof, -0.22);
  g.fillRect(X + inset, Y + T - inset - 4, T - inset * 2, 4);
  g.fillRect(X + T - inset - 4, Y + inset, 4, T - inset * 2);
  // Rooftop things.
  const k = rng.int(3);
  if (k === 0) {
    // AC units.
    for (let i = 0; i < 2; i++) {
      const ax = X + 30 + i * 30 + rng.float(-4, 4);
      const ay = Y + 34 + rng.float(-4, 20);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(ax + 3, ay + 4, 18, 18);
      g.fillStyle = '#C9CED6';
      g.fillRect(ax, ay, 18, 18);
      g.fillStyle = '#7E8794';
      g.beginPath();
      g.arc(ax + 9, ay + 9, 6, 0, Math.PI * 2);
      g.fill();
    }
  } else if (k === 1) {
    // A water tower.
    const wx = X + 60 + rng.float(-10, 10);
    const wy = Y + 55;
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.arc(wx + 7, wy + 8, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PALETTE.ink;
    g.beginPath();
    g.arc(wx, wy, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#9C6B45';
    g.beginPath();
    g.arc(wx, wy, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#B98457';
    g.beginPath();
    g.moveTo(wx, wy);
    g.arc(wx, wy, 16, Math.PI, Math.PI * 1.75);
    g.fill();
  } else {
    // Skylights.
    g.fillStyle = 'rgba(160,200,255,0.5)';
    for (let i = 0; i < 3; i++) g.fillRect(X + 28 + i * 22, Y + 40, 14, 30);
  }
  if (city.town.night) {
    // Lit windows on the edge of the roof.
    g.fillStyle = 'rgba(255,214,120,0.85)';
    for (let i = 0; i < 4; i++) if (rng.chance(0.6)) g.fillRect(X + inset + 8 + i * 20, Y + inset + 6, 8, 4);
  }
  // A shop awning on the street side.
  if (face >= 0) {
    withFace(g, X + 60, Y + 60, face, () => {
      const colors = [['#D9573B', '#F4F1E8'], ['#1E5BC6', '#F4F1E8'], ['#6FAE5B', '#F4F1E8'], ['#FFC22E', '#34383F']][rng.int(4)];
      g.fillStyle = PALETTE.ink;
      g.fillRect(-32, 40, 64, 10);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = colors[i % 2];
        g.fillRect(-31 + i * 7.75, 41, 7.75, 8);
      }
      g.fillStyle = '#7A4E33';
      g.fillRect(-8, 30, 16, 6);
    });
  }
}

function depotRoof(g, city, x0, y0, x1, y1) {
  const qs = [];
  for (let ty = 0; ty < city.h; ty++) for (let tx = 0; tx < city.w; tx++) if (city.at(tx, ty) === 'Q') qs.push([tx, ty]);
  if (!qs.length) return;
  const minX = Math.min(...qs.map((q) => q[0]));
  const maxX = Math.max(...qs.map((q) => q[0]));
  const minY = Math.min(...qs.map((q) => q[1]));
  const maxY = Math.max(...qs.map((q) => q[1]));
  if (maxX < x0 - 1 || minX > x1 + 1 || maxY < y0 - 1 || minY > y1 + 1) return;
  const X = minX * T + 10;
  const Y = minY * T + 10;
  const W = (maxX - minX + 1) * T - 20;
  const H = (maxY - minY + 1) * T - 20;
  g.fillStyle = 'rgba(12,16,22,0.35)';
  g.fillRect(X + 12, Y + 14, W, H);
  g.fillStyle = PALETTE.ink;
  g.fillRect(X - 3, Y - 3, W + 6, H + 6);
  g.fillStyle = '#E9E4D6';
  g.fillRect(X, Y, W, H);
  // Corrugated roof.
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 0; i < W; i += 8) g.fillRect(X + i, Y, 3, H);
  // Brand stripe and logo.
  g.fillStyle = '#FFC22E';
  g.fillRect(X, Y + H - 22, W, 22);
  g.fillStyle = PALETTE.ink;
  g.fillRect(X, Y + H - 24, W, 2);
  g.save();
  g.translate(X + W / 2, Y + (H - 22) / 2);
  const s = Math.min(W, H - 22) / 2 - 8;
  g.fillStyle = '#1E5BC6';
  g.beginPath();
  g.arc(0, 0, s, 0, Math.PI * 2);
  g.fill();
  curl(g, s * 0.8, '#F4F1E8');
  g.restore();
  g.save();
  g.fillStyle = PALETTE.ink;
  g.font = font(900, 15);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('CLOCKWISE COURIERS', X + W / 2, Y + H - 11, W - 10);
  g.restore();
}

function loopZone(g, city, zone) {
  const p = city.town.palette;
  // Kerb ring where the circle bites into lots.
  g.save();
  g.beginPath();
  let any = false;
  for (const [i, z] of city.cut) {
    if (z !== zone) continue;
    any = true;
    const tx = i % city.w;
    const ty = Math.floor(i / city.w);
    g.rect(tx * T, ty * T, T, T);
  }
  if (any) {
    g.clip();
    g.fillStyle = p.pave;
    g.beginPath();
    g.arc(zone.x, zone.y, zone.r + 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = shade(p.pave, -0.25);
    g.beginPath();
    g.arc(zone.x, zone.y, zone.r + 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  g.fillStyle = p.asphalt;
  g.beginPath();
  g.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
  g.fill();
  const paint = 'rgba(244,241,232,0.9)';
  if (zone.kind === 'plaza') {
    // A mini-roundabout: a raised white dome and clockwise arrows.
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(zone.x + 3, zone.y + 4, 21, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#F4F1E8';
    g.beginPath();
    g.arc(zone.x, zone.y, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#D6D2C6';
    g.beginPath();
    g.arc(zone.x + 4, zone.y + 4, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(zone.x - 5, zone.y - 5, 7, 0, Math.PI * 2);
    g.fill();
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * Math.PI * 2 + 0.3;
      g.strokeStyle = paint;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(zone.x, zone.y, 52, a0, a0 + 1.1);
      g.stroke();
      const a1 = a0 + 1.1;
      const hx = zone.x + Math.cos(a1) * 52;
      const hy = zone.y + Math.sin(a1) * 52;
      g.save();
      g.translate(hx, hy);
      g.rotate(a1 + Math.PI / 2);
      g.fillStyle = paint;
      g.beginPath();
      g.moveTo(9, 0);
      g.lineTo(-5, -8);
      g.lineTo(-5, 8);
      g.closePath();
      g.fill();
      g.restore();
    }
  } else {
    // A turning circle: the orbit line, dashed.
    g.strokeStyle = 'rgba(244,241,232,0.55)';
    g.lineWidth = 4;
    g.setLineDash([12, 12]);
    g.beginPath();
    g.arc(zone.x, zone.y, DRIVE.loopRadius + 6, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(244,241,232,0.5)';
    g.beginPath();
    g.arc(zone.x, zone.y, 5, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------------------------------------------------------------- live layers

function drawRing(g, ring, t) {
  const R = DELIVERY.ring;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 + ring.x * 0.01);
  const color = ring.gold ? '#FFD23F' : ring.color || '#FFC22E';
  g.save();
  g.translate(ring.x, ring.y);
  // Soft glow on the asphalt.
  g.globalAlpha = 0.16 + pulse * 0.08;
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  // The painted ring: dashes that turn clockwise.
  g.strokeStyle = color;
  g.lineWidth = ring.gold ? 9 : 7;
  g.setLineDash([22, 12]);
  g.lineDashOffset = -t * 30;
  g.beginPath();
  g.arc(0, 0, R - 4, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  // The bullseye (the doormat line).
  g.strokeStyle = 'rgba(244,241,232,0.85)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, DELIVERY.mat, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, 8, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawDepotGlow(g, city, t) {
  const d = city.depot;
  const pulse = 0.5 + 0.5 * Math.sin(t * 5);
  g.save();
  g.strokeStyle = `rgba(30,91,198,${0.55 + pulse * 0.4})`;
  g.lineWidth = 8;
  g.setLineDash([18, 10]);
  g.lineDashOffset = -t * 30;
  g.strokeRect(d.x - DELIVERY.depotZone - 4, d.y - DELIVERY.depotZone - 4, (DELIVERY.depotZone + 4) * 2, (DELIVERY.depotZone + 4) * 2);
  g.restore();
}

function drawGantry(g, city, z = 1) {
  const d = city.depot;
  // A beam across the bay with the LOAD sign, above the vans.
  const horiz = d.dir === 0 || d.dir === 2; // the van drives north/south: the beam runs east-west
  g.save();
  g.translate(d.x, d.y);
  if (!horiz) g.rotate(Math.PI / 2);
  g.fillStyle = 'rgba(12,16,22,0.3)';
  g.fillRect(-60 + 8, -6 + 10, 120, 12);
  g.fillStyle = PALETTE.ink;
  g.fillRect(-62, -7, 124, 14);
  g.fillStyle = '#FFC22E';
  g.fillRect(-60, -5, 120, 10);
  g.fillStyle = '#1E5BC6';
  rr(g, -30, -13, 60, 26, 4);
  g.fill();
  // The word only where it can be read; from far off the blue plate says it.
  if (20 * z >= 11) {
    g.fillStyle = '#F4F1E8';
    g.font = font(900, 20);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('LOAD', 0, 1);
  }
  g.restore();
}

function drawBeacon(g, b, t) {
  const bob = Math.sin(t * 3 + b.x * 0.02) * 5;
  const s = bigParcel(!!b.gold);
  g.save();
  g.translate(b.x, b.y - 18 + bob);
  // Shadow on the roof below.
  g.fillStyle = 'rgba(10,14,22,0.25)';
  g.beginPath();
  g.ellipse(8, 26 - bob, 13, 6, 0, 0, Math.PI * 2);
  g.fill();
  const sc = b.scale || 1;
  g.drawImage(s.c, -15 * sc, -15 * sc, 30 * sc, 30 * sc);
  if (b.gold) {
    g.fillStyle = PALETTE.ink;
    g.font = font(900, 20);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.strokeStyle = PALETTE.ink;
    g.fillStyle = '#FFD23F';
    g.strokeText('×3', 0, -26);
    g.fillText('×3', 0, -26);
  }
  g.restore();
}

/** Chevrons of a rival's colour near a contested ring: who's heading there. */
function drawChevron(g, c, t) {
  g.save();
  g.translate(c.x, c.y);
  g.rotate(c.h);
  g.globalAlpha = 0.9;
  g.fillStyle = PALETTE.ink;
  g.beginPath();
  g.moveTo(12, 0);
  g.lineTo(-6, -10);
  g.lineTo(-2, 0);
  g.lineTo(-6, 10);
  g.closePath();
  g.lineWidth = 4;
  g.strokeStyle = PALETTE.ink;
  g.stroke();
  g.fillStyle = c.color;
  g.fill();
  g.restore();
}

function drawCones(g, city, closed) {
  const cone = coneSprite();
  for (const i of closed) {
    const tx = i % city.w;
    const ty = Math.floor(i / city.w);
    const horiz = roadish(city, tx - 1, ty) || roadish(city, tx + 1, ty);
    // Two lines of cones across the street at both ends of the closed tile, and a ROAD CLOSED sign.
    for (const end of [6, T - 6]) {
      for (let k = 0; k < 6; k++) {
        const a = 12 + k * 19;
        const x = horiz ? tx * T + end : tx * T + a;
        const y = horiz ? ty * T + a : ty * T + end;
        stamp(g, cone, x, y, 0);
      }
    }
    g.save();
    g.translate((tx + 0.5) * T, (ty + 0.5) * T);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(-36 + 5, -14 + 6, 72, 28);
    g.fillStyle = PALETTE.ink;
    g.fillRect(-36, -14, 72, 28);
    for (let k = 0; k < 6; k++) {
      g.fillStyle = k % 2 ? '#F4F1E8' : '#D9573B';
      g.fillRect(-34 + k * 11.33, -12, 11.33, 24);
    }
    g.restore();
  }
}

function drawBridges(g, city, t) {
  const st = bridgeState(t);
  const p = city.town.palette;
  for (const b of city.drawbridges) {
    const horiz = b.axis === 'h';
    g.save();
    g.translate(b.x, b.y);
    if (!horiz) g.rotate(Math.PI / 2);
    // Two leaves that part as the bridge lifts.
    const gap = st.lift * 34;
    for (const s of [-1, 1]) {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(s < 0 ? -60 + 6 : gap / 2 + 6, -56 + 8, 60 - gap / 2, 112);
      g.fillStyle = shade(p.asphalt, st.lift * 0.25);
      g.fillRect(s < 0 ? -60 : gap / 2, -56, 60 - gap / 2, 112);
      g.fillStyle = '#C9A13A';
      g.fillRect(s < 0 ? -60 : gap / 2, -56, 60 - gap / 2, 6);
      g.fillRect(s < 0 ? -60 : gap / 2, 50, 60 - gap / 2, 6);
    }
    // Barriers with lights before it lifts.
    if (st.warn || st.up) {
      const on = Math.floor(t * 4) % 2 === 0;
      for (const s of [-1, 1]) {
        g.fillStyle = PALETTE.ink;
        g.fillRect(s * 66 - 3, -56, 6, 112);
        for (let k = 0; k < 5; k++) {
          g.fillStyle = k % 2 ? '#F4F1E8' : '#D9573B';
          g.fillRect(s * 66 - 2, -54 + k * 22, 4, 22);
        }
        g.fillStyle = on ? '#FF4B2B' : '#5A1A10';
        g.beginPath();
        g.arc(s * 66, 0, 5, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }
}

function drawLights(g, city, t) {
  for (const l of city.lights) {
    const st = lightState(l, t);
    // A head on each corner facing traffic: north-south heads show 'v', east-west show 'h'.
    for (const [cx, cy, axis] of [
      [-56, -56, 'h'],
      [56, 56, 'h'],
      [56, -56, 'v'],
      [-56, 56, 'v'],
    ]) {
      const x = l.x + cx;
      const y = l.y + cy;
      const mine = st.axis === axis;
      const color = mine ? (st.color === 'green' ? '#3BE07A' : st.color === 'amber' ? '#FFB020' : '#FF3B2B') : '#FF3B2B';
      g.fillStyle = PALETTE.ink;
      rr(g, x - 7, y - 7, 14, 14, 3);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawCar(g, c, t) {
  stamp(g, carSprite(c.kind, c.color, c.id || 0), c.x, c.y, c.h);
  // Brake lights when slow or stopped.
  if (c.kind === 'tram' || c.v < 60) {
    g.save();
    g.translate(c.x, c.y);
    g.rotate(c.h);
    const back = -c.len / 2;
    g.fillStyle = c.kind === 'tram' && c.bell > 0 && Math.floor(t * 6) % 2 ? '#FFE680' : '#FF3B2B';
    g.fillRect(back - 1, -c.wid / 2 + 3, 3, 5);
    g.fillRect(back - 1, c.wid / 2 - 8, 3, 5);
    g.restore();
  }
}

function drawGhost(g, gh) {
  g.save();
  g.globalAlpha = 0.38;
  stamp(g, vanSprite('box', '#F4F1E8'), gh.x, gh.y, gh.h);
  g.restore();
}

/**
 * v: { x, y, h, v, hold, body, color, parcels, braking, stall, spin, blinkOn, away, roll, squash, me, tag }
 */
function drawVan(g, v, t) {
  const s = vanSprite(v.body || 'box', v.color || '#FFC22E');
  g.save();
  g.translate(v.x, v.y);
  g.rotate(v.h + (v.spin || 0));
  if (v.squash) g.scale(1 + v.squash * 0.12, 1 - v.squash * 0.1);
  // Body roll in turns: shift the body a hair outward.
  const roll = v.roll || 0;
  g.drawImage(s.c, -28, -17 - roll, 56, 34);
  // Parcels on the rack (rear half of the roof).
  const pc = parcelSprite();
  for (let i = 0; i < (v.parcels || 0); i++) g.drawImage(pc.c, -21 + i * 9.5, -6 - roll, 11, 11);
  // Lights.
  const tail = v.braking ? '#FF3B2B' : '#8A2018';
  g.fillStyle = tail;
  g.fillRect(-25, -12, 3, 5);
  g.fillRect(-25, 7, 3, 5);
  if (v.braking) {
    g.fillStyle = 'rgba(255,59,43,0.35)';
    g.beginPath();
    g.arc(-27, -9.5, 7, 0, Math.PI * 2);
    g.arc(-27, 9.5, 7, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#FFF6D6';
  g.fillRect(22.5, -12, 2.5, 5);
  g.fillRect(22.5, 7, 2.5, 5);
  // The right indicator (y+ is the van's right) blinks while holding; hazards when stalled or away.
  const blink = Math.floor(t * 5) % 2 === 0;
  if (blink && (v.hold || v.stall > 0 || v.away)) {
    g.fillStyle = '#FFB020';
    const both = v.stall > 0 || v.away;
    g.beginPath();
    g.arc(23, 13, 3.6, 0, Math.PI * 2);
    g.arc(-23, 13, 3.6, 0, Math.PI * 2);
    if (both) {
      g.moveTo(23, -13);
      g.arc(23, -13, 3.6, 0, Math.PI * 2);
      g.moveTo(-23, -13);
      g.arc(-23, -13, 3.6, 0, Math.PI * 2);
    }
    g.fill();
  }
  g.restore();
  if (v.stall > 0) {
    // Steam puffs.
    g.fillStyle = 'rgba(240,240,240,0.55)';
    for (let i = 0; i < 3; i++) {
      const a = t * 3 + i * 2.1;
      g.beginPath();
      g.arc(v.x + Math.cos(v.h) * 18 + Math.sin(a) * 6, v.y + Math.sin(v.h) * 18 - ((t * 30 + i * 10) % 24), 5 + i, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (v.me) {
    // A white ring and chevron mark your own van.
    g.save();
    g.strokeStyle = 'rgba(244,241,232,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(v.x, v.y, 36, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
}

function drawTag(g, v, [x, y], z) {
  const text = v.tag;
  g.save();
  g.font = font(800, 18);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const ty = y - 34 * z - 18;
  const w = g.measureText(text).width + 30;
  g.fillStyle = 'rgba(20,26,34,0.82)';
  rr(g, x - w / 2, ty - 13, w, 26, 6);
  g.fill();
  // Seat symbol.
  symbol(g, v.symbol, x - w / 2 + 12, ty, 6, v.color);
  g.fillStyle = '#F4F1E8';
  g.fillText(text, x + 6, ty + 1);
  g.restore();
}

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

// ---------------------------------------------------------------- light and weather

function drawNight(r, view, toScreen, z) {
  const w = Math.ceil(r.w / 2);
  const h = Math.ceil(r.h / 2);
  if (!r.light || r.light.width !== w || r.light.height !== h) r.light = canvas(w, h);
  const L = r.light.getContext('2d');
  L.globalCompositeOperation = 'source-over';
  L.clearRect(0, 0, w, h);
  L.fillStyle = view.darkColor || 'rgba(8,10,30,1)';
  L.globalAlpha = view.dark;
  L.fillRect(0, 0, w, h);
  L.globalAlpha = 1;
  L.globalCompositeOperation = 'destination-out';
  const glow = glowSprite();
  const beam = beamSprite();
  const put = (x, y, rad, a = 1) => {
    const [sx, sy] = toScreen(x, y);
    const R = (rad * z) / 2;
    if (sx + R < 0 || sy + R < 0 || sx / 2 - R > w || sy / 2 - R > h) return;
    L.globalAlpha = a;
    L.drawImage(glow.c, sx / 2 - R, sy / 2 - R, R * 2, R * 2);
  };
  const city = r.city;
  for (const lamp of lampsFor(city)) put(lamp.x, lamp.y, 210, 0.85);
  if (view.rings) for (const ring of view.rings) put(ring.x, ring.y, 220, 1);
  put(city.depot.x, city.depot.y, 260, 1);
  const beamAt = (x, y, hh, a) => {
    const [sx, sy] = toScreen(x, y);
    L.save();
    L.globalAlpha = a;
    L.translate(sx / 2, sy / 2);
    L.rotate(hh);
    L.drawImage(beam.c, 0, (-100 * z) / 2, (340 * z) / 2, (200 * z) / 2);
    L.restore();
  };
  if (view.vans) for (const v of view.vans) {
    beamAt(v.x + Math.cos(v.h) * 20, v.y + Math.sin(v.h) * 20, v.h, 0.95);
    put(v.x, v.y, 120, 0.8);
  }
  if (view.env && view.env.cars) for (const c of view.env.cars) if (!c.walker) beamAt(c.x + Math.cos(c.h) * c.len * 0.4, c.y + Math.sin(c.h) * c.len * 0.4, c.h, 0.6);
  L.globalAlpha = 1;
  L.globalCompositeOperation = 'source-over';
  r.ctx.drawImage(r.light, 0, 0, r.w, r.h);
  // Coloured glows on top (neon).
  if (view.neon) {
    const ctx = r.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const colors = ['#FF4FA3', '#3FD0FF', '#B46BFF', '#FFC22E'];
    let i = 0;
    for (const lamp of lampsFor(city)) {
      const [sx, sy] = toScreen(lamp.x, lamp.y);
      if (sx < -80 || sy < -80 || sx > r.w + 80 || sy > r.h + 80) continue;
      const g2 = glowSprite(colors[i++ % 4]);
      ctx.globalAlpha = 0.28;
      ctx.drawImage(g2.c, sx - 60 * z, sy - 60 * z, 120 * z, 120 * z);
    }
    ctx.restore();
  }
}

const lampCache = new Map();
function lampsFor(city) {
  let l = lampCache.get(city.id);
  if (!l) {
    l = [];
    for (let ty = 0; ty < city.h; ty++) {
      for (let tx = 0; tx < city.w; tx++) {
        const ch = city.at(tx, ty);
        if (!isRoad(ch)) continue;
        const n = [0, 1, 2, 3].filter((d) => roadish(city, tx + DX[d], ty + DY[d])).length;
        if (n >= 3 || (tx + ty) % 3 === 0) l.push({ x: (tx + 0.5) * T + 50, y: (ty + 0.5) * T - 50 });
      }
    }
    lampCache.set(city.id, l);
  }
  return l;
}

function drawRain(g, w, h, t, reduced) {
  g.save();
  g.fillStyle = 'rgba(20,30,45,0.18)';
  g.fillRect(0, 0, w, h);
  if (!reduced) {
    g.strokeStyle = 'rgba(200,220,240,0.35)';
    g.lineWidth = 1.5;
    g.beginPath();
    const n = Math.floor((w * h) / 9000);
    for (let i = 0; i < n; i++) {
      const x = (i * 97.13 + t * 120) % (w + 40) - 20;
      const y = (i * 53.71 + t * 900) % (h + 40) - 20;
      g.moveTo(x, y);
      g.lineTo(x - 4, y + 16);
    }
    g.stroke();
  }
  g.restore();
}

function drawSnow(g, w, h, t, reduced) {
  if (reduced) return;
  g.save();
  g.fillStyle = 'rgba(255,255,255,0.75)';
  const n = Math.floor((w * h) / 12000);
  for (let i = 0; i < n; i++) {
    const x = ((i * 131.7 + Math.sin(t + i) * 20 + t * 15) % (w + 20)) - 10;
    const y = ((i * 71.3 + t * 60) % (h + 20)) - 10;
    g.beginPath();
    g.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawDust(g, w, h, amount, [cx, cy], z, t) {
  g.save();
  const inner = 140 * z;
  const outer = 260 * z;
  const grd = g.createRadialGradient(cx, cy, inner, cx, cy, outer);
  grd.addColorStop(0, `rgba(214,170,110,${0.2 * amount})`);
  grd.addColorStop(1, `rgba(196,150,92,${0.97 * amount})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = `rgba(240,210,160,${0.35 * amount})`;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 40; i++) {
    const x = (i * 211.3 + t * 500) % (w + 100) - 50;
    const y = (i * 97.1 + Math.sin(i + t) * 30) % h;
    g.moveTo(x, y);
    g.lineTo(x + 40, y + 4);
  }
  g.stroke();
  g.restore();
}

export { drawRing, drawBeacon };

/** A person on a zebra crossing. One near a van leaps clear of its path (only on this page: it's comedy, not a rule). */
function drawWalker(ctx, c, vans, rain) {
  let x = c.x;
  let y = c.y;
  let hop = 1;
  if (vans) {
    for (const v of vans) {
      const dx = c.x - v.x;
      const dy = c.y - v.y;
      const d = Math.hypot(dx, dy);
      if (d >= 46) continue;
      // Sideways out of the van's line, to whichever side they were on.
      const nx = -Math.sin(v.h);
      const ny = Math.cos(v.h);
      const side = dx * nx + dy * ny >= 0 ? 1 : -1;
      const k = 1 - d / 46;
      x += nx * side * k * 34;
      y += ny * side * k * 34;
      hop = Math.max(hop, 1 + k * 0.35);
    }
  }
  stamp(ctx, walkerSprite(c.i + (c.zebra ? c.zebra.tx : 0), rain), x, y, c.h, hop);
}
