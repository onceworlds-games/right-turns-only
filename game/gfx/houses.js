// Houses, downtown buildings, gardens and trees, generated from a seed into the town's builders. Everything is in a lot's
// local frame: the lot is 12 × 12 m centred on the origin, the street is on +z, the ground is y = 0 (the kerb top).

import { SURF, shade, mix } from './build.js';

const HALF = 6;

/** Emit a window on a wall facing +z at (x, y) (y = sill height), w × h. */
export function windowOn(b, x, y, z, w, h, frame, opts = {}) {
  const d = 0.07;
  // Frame (front and sides), then glass inset, then a sill.
  b.box(x, y - 0.06, z + d / 2, w + 0.2, h + 0.18, d, frame, { skip: new Set(['n']) });
  const gz = z + d + 0.005;
  b.quad([x - w / 2, y, gz], [x + w / 2, y, gz], [x + w / 2, y + h, gz], [x - w / 2, y + h, gz], opts.glass || '#3E5C78', SURF.litWindow);
  // Glazing bars.
  if (opts.bars !== false) {
    b.box(x, y, gz + 0.005, 0.05, h, 0.02, frame);
    b.box(x, y + h * 0.55, gz + 0.005, w, 0.05, 0.02, frame);
  }
  b.box(x, y - 0.12, z + 0.1, w + 0.32, 0.08, 0.2, shade(frame, -0.12));
  if (opts.shutters) {
    b.box(x - w / 2 - 0.28, y - 0.02, z + 0.04, 0.32, h + 0.04, 0.05, opts.shutters, { surf: SURF.planks });
    b.box(x + w / 2 + 0.28, y - 0.02, z + 0.04, 0.32, h + 0.04, 0.05, opts.shutters, { surf: SURF.planks });
  }
  if (opts.box) {
    // A flower box under the window.
    b.box(x, y - 0.42, z + 0.18, w + 0.1, 0.26, 0.28, '#8A5A3C', { surf: SURF.planks });
    for (let i = 0; i < 4; i++) b.blob(x - w / 2 + 0.15 + (i * (w - 0.3)) / 3, y - 0.14, z + 0.2, 0.13, opts.box[i % opts.box.length], 0.8, 0, 0.2, i + x);
  }
}

/** Walls of a box (no top) with pattern; returns nothing. Windows are added separately. */
function walls(b, x, z, w, d, h, color, surf) {
  b.box(x, 0, z, w, h, d, color, { surf, skip: new Set(['top']), bottomDark: 0.18 });
}

/** A door on a wall facing +z: the frame and step are static; the leaf is recorded for animation. */
function door(b, doors, x, z, color, trim, lot) {
  const w = 1.0;
  const h = 2.1;
  b.box(x, 0, z + 0.04, w + 0.24, h + 0.14, 0.08, trim, { skip: new Set(['n']) });
  b.quad([x - w / 2, 0.02, z + 0.081], [x + w / 2, 0.02, z + 0.081], [x + w / 2, h, z + 0.081], [x - w / 2, h, z + 0.081], '#1C1712', 0); // the dark doorway
  // The step.
  b.box(x, 0, z + 0.45, w + 0.7, 0.14, 0.7, '#B9B2A6', { surf: SURF.paving });
  doors.push({ lot, x: x - w / 2, z: z + 0.1, w, h, color });
}

/** A porch canopy over a door on a wall facing +z. */
function porch(b, x, z, roof, trim, kind) {
  const pw = 2.4;
  const pd = 1.3;
  const y = 2.55;
  if (kind === 0) {
    // Posts and a small gable.
    b.box(x - pw / 2 + 0.1, 0.14, z + pd - 0.1, 0.14, y - 0.14, 0.14, trim);
    b.box(x + pw / 2 - 0.1, 0.14, z + pd - 0.1, 0.14, y - 0.14, 0.14, trim);
    b.box(x, y, z + pd / 2, pw, 0.12, pd, trim);
    b.push(x, y + 0.12, z + pd / 2, Math.PI / 2);
    b.gable(0, 0, 0, pd, pw, 0.55, roof, trim, 0.12, { ridge: false });
    b.pop();
  } else {
    // A flat canopy on brackets.
    b.box(x, y, z + pd / 2 - 0.1, pw, 0.14, pd - 0.2, shade(roof, -0.1));
    b.box(x - pw / 2 + 0.15, y - 0.4, z + 0.15, 0.08, 0.4, 0.3, trim);
    b.box(x + pw / 2 - 0.15, y - 0.4, z + 0.15, 0.08, 0.4, 0.3, trim);
  }
}

function chimney(b, x, y, z, h) {
  b.box(x, y, z, 0.7, h, 0.7, '#9C5A44', { surf: SURF.brick });
  b.box(x, y + h, z, 0.86, 0.14, 0.86, '#6E6A66');
  b.box(x, y + h + 0.14, z, 0.3, 0.2, 0.3, '#4A4644');
}

/** Solar panels flush on a gable's front slope (rising from z1 at y0 to the ridge at z, y1). */
function solar(b, x, w, zEave, yEave, zRidge, yRidge) {
  const n = Math.max(2, Math.floor(w / 1.1));
  const len = Math.hypot(zEave - zRidge, yEave - yRidge);
  const ux = (zRidge - zEave) / len;
  const uy = (yRidge - yEave) / len;
  const along = 0.45;
  const span = len * 0.62;
  for (let i = 0; i < n; i++) {
    const cx = x - (n - 1) * 0.55 + i * 1.1;
    const z0 = zEave + ux * along;
    const y0 = yEave + uy * along + 0.06;
    const z1 = zEave + ux * (along + span);
    const y1 = yEave + uy * (along + span) + 0.06;
    b.quad([cx - 0.5, y0, z0], [cx + 0.5, y0, z0], [cx + 0.5, y1, z1], [cx - 0.5, y1, z1], '#1D2B45', SURF.glass);
  }
}

/** A tree crown and trunk at (x, z), height h (crown radius r), in the given style. */
export function tree(b, leaves, x, z, r, style, rng, opts = {}) {
  const kind = opts.kind || style.trees;
  const leaf = style.leaf;
  const pick = () => leaf[rng.int(leaf.length)];
  const y0 = opts.y || 0;
  if (kind === 'pine' || kind === 'snowpine') {
    const h = r * 3.4;
    b.cyl(x, y0, z, r * 0.12, h * 0.35, '#6B4A33', 6);
    const c = pick();
    for (let i = 0; i < 3; i++) {
      const rr = r * (1.05 - i * 0.28);
      const yy = y0 + h * (0.22 + i * 0.24);
      leaves.cyl(x, yy, z, rr, h * 0.36, c, 7, { r1: 0.02, cap: false });
      if (kind === 'snowpine') leaves.cyl(x, yy + h * 0.17, z, rr * 0.55, h * 0.19, '#F2F6FA', 7, { r1: 0.02, cap: false });
    }
    return;
  }
  if (kind === 'palm') {
    const h = r * 2.6;
    const lean = rng.float(-0.5, 0.5);
    for (let i = 0; i < 5; i++) b.box(x + lean * (i / 5), y0 + (i * h) / 5, z, 0.32 - i * 0.03, h / 5 + 0.05, 0.32 - i * 0.03, i % 2 ? '#8A6A48' : '#7A5C3E');
    const tx = x + lean;
    const ty = y0 + h;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rng.float(0, 0.4);
      const ex = tx + Math.cos(a) * r * 1.2;
      const ez = z + Math.sin(a) * r * 1.2;
      const sx = -Math.sin(a) * 0.35;
      const sz = Math.cos(a) * 0.35;
      leaves.tri([tx, ty + 0.1, z], [ex + sx, ty - 0.7, ez + sz], [ex - sx, ty - 0.7, ez - sz], pick(), SURF.plain);
      leaves.tri([tx, ty + 0.1, z], [ex - sx, ty - 0.7, ez - sz], [ex + sx, ty - 0.7, ez + sz], pick(), SURF.plain);
    }
    leaves.blob(tx, ty, z, 0.45, '#6B5236', 1, 0, 0.1, x);
    return;
  }
  if (kind === 'cactus') {
    const h = r * 1.6;
    b.cyl(x, y0, z, 0.32, h, '#5E8C4E', 7);
    b.cyl(x + 0.5, y0 + h * 0.4, z, 0.2, h * 0.35, '#5E8C4E', 6);
    b.box(x + 0.25, y0 + h * 0.4, z, 0.5, 0.25, 0.25, '#5E8C4E');
    return;
  }
  // Round: a trunk and three or four overlapping crowns.
  const h = r * 1.5;
  b.cyl(x, y0, z, r * 0.13, h, '#6E5038', 6, { r1: r * 0.09 });
  const base = pick();
  const top = shade(base, 0.18);
  leaves.blob(x, y0 + h + r * 0.35, z, r, base, 0.85, 1, 0.16, x * 3 + z, top);
  const n = 2 + rng.int(2);
  for (let i = 0; i < n; i++) {
    const a = rng.float(0, Math.PI * 2);
    leaves.blob(x + Math.cos(a) * r * 0.55, y0 + h + rng.float(-0.1, 0.5) * r, z + Math.sin(a) * r * 0.55, r * rng.float(0.55, 0.75), base, 0.85, 0, 0.18, i + x, top);
  }
}

export function bush(leaves, x, z, r, color, rng, y = 0) {
  leaves.blob(x, y + r * 0.55, z, r, color, 0.75, 0, 0.22, x * 7 + z, shade(color, 0.15));
  if (rng.chance(0.5)) leaves.blob(x + r * 0.6, y + r * 0.45, z + rng.float(-0.3, 0.3), r * 0.7, color, 0.75, 0, 0.2, x + z * 3, shade(color, 0.15));
}

export function flowers(leaves, x0, z0, x1, z1, style, rng, n, y = 0.15) {
  for (let i = 0; i < n; i++) {
    const x = rng.float(x0, x1);
    const z = rng.float(z0, z1);
    leaves.blob(x, y + 0.12, z, 0.16, style.flowers[rng.int(style.flowers.length)], 0.7, 0, 0.25, i * 13 + x);
  }
}

export function fenceRun(b, x0, z0, x1, z1, color, h = 0.9) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 0.45));
  const dx = (x1 - x0) / n;
  const dz = (z1 - z0) / n;
  for (let i = 0; i <= n; i++) b.box(x0 + dx * i, 0, z0 + dz * i, 0.1, h, 0.1, color);
  // Two rails.
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  for (const y of [h * 0.3, h * 0.72]) b.box(cx, y, cz, alongX ? len : 0.06, 0.08, alongX ? 0.06 : len, color);
}

export function hedgeRun(leaves, x0, z0, x1, z1, color, h = 1.05, w = 0.7) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const len = Math.hypot(x1 - x0, z1 - z0);
  leaves.box(cx, 0, cz, alongX ? len : w, h, alongX ? w : len, color, { top: shade(color, 0.14), bottomDark: 0.25 });
}

function mailbox(b, x, z, color) {
  b.box(x, 0, z, 0.1, 1.0, 0.1, '#5A4A3C');
  b.box(x, 1.0, z, 0.36, 0.3, 0.5, color);
  b.box(x + 0.2, 1.05, z - 0.1, 0.04, 0.32, 0.06, '#D9573B');
}

export function bins(b, x, z, rng) {
  const cols = ['#2F6E4F', '#24323F', '#2F5D8C', '#6E6A66'];
  for (let i = 0; i < 2; i++) {
    const c = cols[rng.int(cols.length)];
    b.box(x + i * 0.7, 0, z, 0.6, 1.0, 0.7, c);
    b.box(x + i * 0.7, 1.0, z - 0.02, 0.66, 0.08, 0.76, shade(c, -0.2));
  }
}

/**
 * A house on a lot. ctx: { b, leaves, doors, lamps, smoke, parked, style, rng, roof, night, face }.
 * Returns the door's local position (for deliveries).
 */
export function house(ctx) {
  const { b, leaves, doors, style, rng } = ctx;
  const roof = ctx.roof;
  const wallC = style.walls[rng.int(style.walls.length)];
  const brick = wallC === style.walls[style.walls.length - 1] || rng.chance(0.18);
  const wallSurf = brick ? SURF.brick : rng.chance(0.4) ? SURF.planks : SURF.stucco;
  const wall = brick && wallC !== style.walls[style.walls.length - 1] ? '#B8674E' : wallC;
  const trim = style.trim;
  const doorC = style.doors[rng.int(style.doors.length)];
  const kind = rng.pick(['bungalow', 'bungalow', 'two', 'two', 'hip', 'wing', 'gableFront']);
  rng.next();
  const ox = 0; // the door stays on the lot's centre line, where the parcel lands
  const zf = 2.0; // the front wall (the door plane)
  const shutters = rng.chance(0.35) ? shade(doorC, -0.05) : null;
  const flowerBox = rng.chance(0.35) ? style.flowers : null;

  // Ground details first: path, beds, lawn edges.
  b.ground(ox - 0.55, zf + 0.6, ox + 0.55, 4.6, 0.01, '#C9C1B2', SURF.paving);
  // The doormat (a dark rug just past the step).
  b.ground(ox - 0.5, zf + 0.82, ox + 0.5, zf + 1.42, 0.02, '#6B4A33', SURF.plain);
  b.ground(ox - 0.42, zf + 0.9, ox + 0.42, zf + 1.34, 0.025, '#8A6244', SURF.plain);
  // Flower beds along the front.
  b.ground(-4.8, zf + 0.15, ox - 0.9, zf + 0.75, 0.012, '#5C4433', SURF.soil);
  b.ground(ox + 0.9, zf + 0.15, 4.8, zf + 0.75, 0.012, '#5C4433', SURF.soil);
  flowers(leaves, -4.6, zf + 0.25, ox - 1.1, zf + 0.65, style, rng, 6, 0.02);
  flowers(leaves, ox + 1.1, zf + 0.25, 4.6, zf + 0.65, style, rng, 6, 0.02);

  let w = rng.float(6.6, 8.2);
  let d = rng.float(5.2, 6.0);
  const wallH = kind === 'two' ? 5.4 : 2.9;
  const roofH = kind === 'two' ? rng.float(2.0, 2.6) : rng.float(1.8, 2.4);
  if (kind === 'wing') w = rng.float(5.6, 6.0);
  const zc = zf - d / 2;
  walls(b, ox, zc, w, d, wallH, wall, wallSurf);
  // A plinth.
  b.box(ox, 0, zc, w + 0.06, 0.32, d + 0.06, shade(wall, -0.25), { skip: new Set(['top']) });

  // Roof.
  let ridgeY = wallH + roofH;
  if (kind === 'hip') b.hip(ox, wallH, zc, w, d, roofH, roof, 0.45);
  else if (kind === 'gableFront') {
    b.push(ox, wallH, zc, Math.PI / 2);
    b.gable(0, 0, 0, d, w, roofH + 0.4, roof, wall, 0.45, { wallSurf });
    b.pop();
    ridgeY += 0.4;
  } else b.gable(ox, wallH, zc, w, d, roofH, roof, wall, 0.45, { wallSurf });

  // Windows: front (two floors for 'two'), sides, back.
  const floors = kind === 'two' ? [0.95, 3.6] : [0.95];
  for (const y of floors) {
    const slots = w > 7.4 ? [-2.6, -1.4, 1.4, 2.6] : [-2.2, 2.2];
    for (const sx of slots) {
      if (y < 2 && Math.abs(sx) < 1.0) continue;
      windowOn(b, ox + sx * (w / 7.6), y, zf, 1.0, 1.25, trim, { shutters, box: y < 2 ? flowerBox : null });
    }
    if (y > 2) windowOn(b, ox, y, zf, 0.9, 1.1, trim, { shutters });
    // Sides.
    for (const s of [-1, 1]) {
      b.push(ox + (s * w) / 2, 0, zc, (s * Math.PI) / 2);
      windowOn(b, rng.float(-1.2, 1.2), y, 0, 0.9, 1.15, trim, {});
      b.pop();
    }
    // Back.
    b.push(ox, 0, zc - d / 2, Math.PI);
    windowOn(b, -1.6, y, 0, 1.0, 1.2, trim, {});
    windowOn(b, 1.6, y, 0, 1.0, 1.2, trim, {});
    b.pop();
  }
  // Door and porch.
  door(b, doors, ox, zf, doorC, trim, ctx.lot);
  porch(b, ox, zf, roof, trim, rng.int(2));
  ctx.lamps.push([ox + 0.85, 2.3, zf + 0.15, 'porch']);

  // Chimney or solar.
  if (kind !== 'gableFront' && rng.chance(0.5)) {
    const cx = ox + rng.float(-w / 2 + 1, w / 2 - 1);
    chimney(b, cx, wallH + roofH * 0.4, zc - d * 0.22, roofH * 0.8 + 0.6);
    ctx.smoke.push([cx, wallH + roofH * 1.2 + 0.9, zc - d * 0.22]);
  } else if (kind !== 'gableFront' && kind !== 'hip' && rng.chance(0.6)) {
    solar(b, ox, w * 0.7, zf + 0.45, wallH - 0.45 * (roofH / (d / 2)), zc, ridgeY);
  }

  // A wing with a garage and a driveway.
  if (kind === 'wing') {
    const side = rng.chance(0.5) ? 1 : -1;
    const gx = ox + side * (w / 2 + 1.35);
    const gw = 2.6;
    const gd = 5.0;
    const gz = zf - 0.4 - gd / 2;
    walls(b, gx, gz, gw, gd, 2.6, wall, wallSurf);
    b.push(gx, 2.6, gz, Math.PI / 2);
    b.gable(0, 0, 0, gd, gw, 1.1, roof, wall, 0.3, { wallSurf });
    b.pop();
    // Garage door.
    b.quad([gx - 1.05, 0.05, gz + gd / 2 + 0.02], [gx + 1.05, 0.05, gz + gd / 2 + 0.02], [gx + 1.05, 2.1, gz + gd / 2 + 0.02], [gx - 1.05, 2.1, gz + gd / 2 + 0.02], '#E6E2D8', SURF.metal);
    // The driveway.
    b.ground(gx - 1.2, gz + gd / 2, gx + 1.2, 4.6, 0.011, '#9C968C', SURF.paving);
    if (rng.chance(0.55)) ctx.parked.push({ x: gx, z: gz + gd / 2 + 2.2, ry: 0 });
  } else if (rng.chance(0.3)) {
    // A driveway beside the house with a car on it.
    const side = ox > 0 ? -1 : 1;
    const gx = side * 4.4;
    if (Math.abs(gx - ox) > w / 2 + 1.3) {
      b.ground(gx - 1.2, zf - 2.5, gx + 1.2, 4.6, 0.011, '#9C968C', SURF.paving);
      ctx.parked.push({ x: gx, z: zf + 0.4, ry: 0 });
    }
  }

  // Side and back boundaries are the town's (one per shared edge); the front is the lot's own.
  const hedgeC = style.palette.hedge;
  if (rng.chance(0.5)) {
    // A low picket along the front, open at the path.
    fenceRun(b, -5.4, 4.45, ox - 0.8, 4.45, '#F4F1E8', 0.7);
    fenceRun(b, ox + 0.8, 4.45, 5.4, 4.45, '#F4F1E8', 0.7);
  } else {
    bush(leaves, -4.3, 3.9, 0.7, hedgeC, rng);
    bush(leaves, 4.2, 3.9, 0.65, hedgeC, rng);
  }
  mailbox(b, ox + 1.1, 4.25, rng.pick(['#24323F', '#B8442F', '#2F5D8C', '#F4F1E8']));
  if (kind !== 'wing') bins(b, ox + (ox > 0 ? -w / 2 - 1.5 : w / 2 + 0.8), zf - 1.6, rng);

  // The back garden.
  const back = rng.float(0, 1);
  if (back < 0.55) tree(b, leaves, rng.float(-3.5, 3.5), -4.6, rng.float(1.5, 2.1), style, rng);
  else if (back < 0.7) {
    // A shed.
    b.box(3.6, 0, -4.4, 1.8, 1.8, 1.6, '#8A6A4E', { surf: SURF.planks });
    b.gable(3.6, 1.8, -4.4, 1.8, 1.6, 0.6, '#5A4A3C', '#8A6A4E', 0.15);
  } else if (back < 0.82) {
    // A trampoline.
    b.cyl(-2.8, 0, -4.3, 1.3, 0.55, '#24323F', 14, { top: '#1C222B' });
    b.disc(-2.8, 0.56, -4.3, 1.32, '#2F7FD1', 14, 0, 1.12);
  } else if (back < 0.92 && !style.snow) {
    // A little pool.
    b.box(0, 0, -4.5, 4.2, 0.08, 1.9, '#E6E2D8', { surf: SURF.paving });
    b.ground(-1.9, -5.3, 1.9, -3.7, 0.09, '#4FB7E0', SURF.glass);
  } else {
    // A washing line.
    b.box(-3, 0, -4.6, 0.08, 1.8, 0.08, '#8A8A8A');
    b.box(3, 0, -4.6, 0.08, 1.8, 0.08, '#8A8A8A');
    const cols = ['#F4F1E8', '#D9573B', '#2F7FD1', '#F2B544', '#E98FA4'];
    for (let i = 0; i < 5; i++) b.box(-2.3 + i * 1.15, 1.15, -4.6, 0.55, 0.6, 0.04, cols[(i + rng.int(5)) % 5]);
    b.box(0, 1.76, -4.6, 6, 0.03, 0.03, '#DDDDDD');
  }
  return { doorX: ox, doorZ: zf + 0.95, matX: ox, matZ: zf + 1.12, ridge: ridgeY };
}

/** A downtown building filling the lot. ctx as for house, plus { roads: [n, e, s, w] booleans in local frame }. */
export function building(ctx) {
  const { b, leaves, doors, style, rng } = ctx;
  const facade = style.walls[rng.int(style.walls.length)];
  const brick = rng.chance(0.35);
  const surf = brick ? SURF.brick : SURF.stucco;
  const wall = brick ? mix(facade, '#A55A44', 0.6) : facade;
  const trim = shade(facade, 0.35);
  const floors = 2 + rng.int(ctx.tall ? 4 : 3);
  const g = 3.7;
  const fh = 3.1;
  const H = g + (floors - 1) * fh;
  // Footprint: up to the pavement on street sides.
  const rs = ctx.roads; // local: [back(-z), right(+x), front(+z), left(-x)]
  const x0 = rs[3] ? -4.6 : -5.85;
  const x1 = rs[1] ? 4.6 : 5.85;
  const z0 = rs[0] ? -4.6 : -5.85;
  const z1 = 4.6;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const d = z1 - z0;
  b.box(cx, 0, cz, w, H, d, wall, { surf, skip: new Set(['top']), bottomDark: 0.15 });
  // Ground floor band.
  b.box(cx, 0, cz, w + 0.08, g - 0.2, d + 0.08, shade(wall, -0.22), { skip: new Set(['top']), surf: SURF.stucco });
  // Ledges at each floor and a cornice.
  for (let f = 0; f < floors; f++) b.box(cx, g + f * fh - 0.2, cz, w + 0.22, 0.2, d + 0.22, trim);
  b.box(cx, H - 0.05, cz, w + 0.4, 0.35, d + 0.4, trim);
  b.parapet(cx, H + 0.3, cz, w + 0.3, d + 0.3, trim, '#8E8A84', 0.3, 0.55);
  // Windows on every street side; shopfront on the front.
  const sides = [
    [0, 2, w, cz + d / 2, cx], // front (+z)
    [Math.PI / 2, 1, d, cx + w / 2, cz], // right (+x)
    [Math.PI, 0, w, cz - d / 2, cx], // back
    [-Math.PI / 2, 3, d, cx - w / 2, cz], // left
  ];
  for (const [rot, si, len, off, c] of sides) {
    const street = si === 2 || rs[si];
    if (!street && !rng.chance(0.3)) continue;
    if (si === 2 || si === 0) b.push(c, 0, off, rot);
    else b.push(off, 0, c, rot);
    const n = Math.max(2, Math.floor(len / 2.3));
    for (let f = 1; f < floors; f++) {
      for (let i = 0; i < n; i++) {
        const wx = -len / 2 + (len / n) * (i + 0.5);
        windowOn(b, wx, g + (f - 1) * fh + 0.75, 0, 1.15, 1.55, trim, { bars: false, glass: '#34506B' });
      }
    }
    if (si === 2 && ctx.face >= 0) {
      // The shopfront: glass, a door and an awning.
      const sw = Math.min(len - 1.2, 8);
      b.quad([-sw / 2, 0.35, 0.04], [sw / 2, 0.35, 0.04], [sw / 2, 2.7, 0.04], [-sw / 2, 2.7, 0.04], '#3E5C78', SURF.litWindow);
      b.box(0, 0, 0.02, sw + 0.3, 0.35, 0.1, shade(wall, -0.4));
      b.box(0, 2.7, 0.02, sw + 0.3, 0.16, 0.12, shade(wall, -0.4));
      for (let k = -2; k <= 2; k++) b.box((k * sw) / 4.5, 0.35, 0.05, 0.08, 2.35, 0.06, shade(wall, -0.4));
      const aw = ctx.awning;
      // Striped awning sloping out.
      const stripes = 8;
      for (let k = 0; k < stripes; k++) {
        const ax0 = -sw / 2 + (sw / stripes) * k;
        const ax1 = ax0 + sw / stripes;
        b.quad([ax0, 2.4, 1.4], [ax1, 2.4, 1.4], [ax1, 3.05, 0.05], [ax0, 3.05, 0.05], k % 2 ? aw[1] : aw[0], 0);
      }
      b.box(0, 2.25, 1.4, sw, 0.16, 0.04, aw[0]);
      // The sign over the awning.
      ctx.signs.push({ x: 0, y: 3.35, z: 0.06, w: Math.min(sw, 5.5), h: 0.7 });
      // A bench and a planter outside some shops.
      if (rng.chance(0.4)) bush(leaves, sw / 2 - 0.3, 3.9, 0.45, style.palette.hedge, rng, 0.0);
    } else if (si !== 2 || ctx.face < 0) {
      for (let i = 0; i < n; i++) {
        const wx = -len / 2 + (len / n) * (i + 0.5);
        windowOn(b, wx, 0.9, 0, 1.2, 1.5, trim, { bars: false, glass: '#34506B' });
      }
    }
    b.pop();
  }
  if (ctx.face >= 0) {
    // A door into the building beside the shop (deliveries go here).
    doors.push({ lot: ctx.lot, x: -0.5, z: z1 + 0.05, w: 1.0, h: 2.2, color: style.doors[rng.int(style.doors.length)], hidden: true });
  }
  // Roof things.
  const rx = cx + rng.float(-1.5, 1.5);
  const rz = cz + rng.float(-1.5, 1.5);
  const roofY = H + 0.36;
  const k = rng.int(4);
  if (k === 0) {
    // A water tower on legs.
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) b.box(rx + lx, roofY, rz + lz, 0.14, 1.6, 0.14, '#4A3C30');
    b.cyl(rx, roofY + 1.6, rz, 1.2, 1.9, '#9C6B45', 10, { surf: SURF.planks });
    b.cyl(rx, roofY + 3.5, rz, 1.3, 0.8, '#5A4A3C', 10, { r1: 0.05 });
  } else if (k === 1) {
    for (let i = 0; i < 2 + rng.int(2); i++) {
      const ax = cx + rng.float(-w / 2 + 1.2, w / 2 - 1.2);
      const az = cz + rng.float(-d / 2 + 1.2, d / 2 - 1.2);
      b.box(ax, roofY, az, 1.3, 0.8, 1.1, '#C9CED6', { surf: SURF.metal });
      b.cyl(ax, roofY + 0.8, az, 0.4, 0.04, '#5A626E', 10);
    }
  } else if (k === 2) {
    // A stair hut and an antenna.
    b.box(rx, roofY, rz, 2.2, 2.2, 2.0, shade(wall, -0.1), { surf });
    b.box(rx, roofY + 2.2, rz, 2.4, 0.15, 2.2, trim);
    b.box(rx + 0.6, roofY + 2.35, rz, 0.06, 2.4, 0.06, '#8A8A8A');
  } else {
    // A roof garden.
    for (let i = 0; i < 3; i++) bush(leaves, cx + rng.float(-w / 2 + 1, w / 2 - 1), cz + rng.float(-d / 2 + 1, d / 2 - 1), 0.6, style.palette.hedge, rng, roofY);
  }
  return { doorX: 0, doorZ: z1 + 0.9, matX: 0, matZ: z1 + 0.9, ridge: H + 0.9 };
}

/** A garden lot: lawn, beds, a tree and something to look at. */
export function garden(ctx) {
  const { b, leaves, style, rng } = ctx;
  const k = rng.int(4);
  // A path cross.
  b.ground(-0.6, -5.4, 0.6, 5.4, 0.011, '#CFC6B5', SURF.paving);
  b.ground(-5.4, -0.6, 5.4, 0.6, 0.011, '#CFC6B5', SURF.paving);
  for (const [qx, qz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) {
    if (rng.chance(0.5)) {
      b.ground(qx - 1.6, qz - 1.6, qx + 1.6, qz + 1.6, 0.012, '#5C4433', SURF.soil);
      flowers(leaves, qx - 1.4, qz - 1.4, qx + 1.4, qz + 1.4, style, rng, 10, 0.02);
    } else tree(b, leaves, qx, qz, rng.float(1.4, 2.0), style, rng);
  }
  if (k === 0) {
    // A fountain.
    b.cyl(0, 0, 0, 1.6, 0.5, '#CFC6B5', 16, { top: '#4FA3C8', topSurf: SURF.glass });
    b.cyl(0, 0.5, 0, 0.25, 1.0, '#CFC6B5', 8);
    b.cyl(0, 1.5, 0, 0.6, 0.18, '#CFC6B5', 10, { top: '#4FA3C8' });
    ctx.fountains.push([0, 1.7, 0]);
  } else if (k === 1) {
    // A gazebo.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5, 0.14, 2.4, 0.14, '#F4F1E8');
    }
    b.cyl(0, 0, 0, 1.8, 0.15, '#CFC6B5', 6);
    b.cyl(0, 2.4, 0, 2.0, 1.1, '#B8442F', 6, { r1: 0.05, surf: SURF.tiles });
  } else if (k === 2) {
    // A statue on a plinth.
    b.box(0, 0, 0, 1.2, 1.1, 1.2, '#CFC6B5');
    b.box(0, 1.1, 0, 0.5, 1.3, 0.4, '#7F9AA0');
    b.blob(0, 2.6, 0, 0.32, '#7F9AA0', 1, 0, 0.05, 3);
  } else {
    // Benches round a big tree.
    tree(b, leaves, 0, 0, 2.4, style, rng);
  }
  return null;
}
