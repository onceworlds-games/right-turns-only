// The vans: modelled in code (seven bodies and the garage's extras), each on a rig that springs and leans: wheels that
// roll and steer, a body that rolls out of a turn and dips under the brakes, the right indicator blinking while you hold,
// brake lights, headlights at night, parcels strapped on the roof. Model space: +x forward, +y up, +z the right side.

import * as THREE from 'three';
import { S } from './style.js';
import { Builder, shade } from './build.js';
import { patch } from './material.js';
import { WRAPS } from '../career.js';

const WHEEL_R = 0.42;

/** Geometry for one body: { paint, trim, glass, lights: { head, tail, ind }, wheels: [[x, z, r]], rack: [x, y, z][] } */
function shape(body) {
  const paint = new Builder();
  const trim = new Builder();
  const glass = new Builder();
  const head = [];
  const tail = [];
  const ind = [];
  let wheels = [
    [1.55, -1.0],
    [1.55, 1.0],
    [-1.55, -1.0],
    [-1.55, 1.0],
  ];
  let rack = [];
  const W = 2.3;
  const hw = W / 2;
  const dark = '#20242B';
  const steel = '#B9BEC6';
  const curlSide = (x, y, r) => {
    // The Clockwise Couriers curl on both sides: a blue disc with a white three-quarter ring and its arrowhead.
    for (const s of [-1, 1]) {
      const m = new THREE.Matrix4().makeTranslation(x, y, s * (hw + 0.012)).multiply(new THREE.Matrix4().makeRotationX(s > 0 ? Math.PI / 2 : -Math.PI / 2));
      trim.pushMatrix(m);
      trim.disc(0, 0, 0, r, '#1E5BC6', 20);
      ringArc(trim, r * 0.68, r * 0.22, -Math.PI * 0.95, Math.PI * 0.55, 0.004, '#F4F1E8', s);
      trim.pop();
    }
  };
  // The curl again on the roof, big, so the van reads as ours from above.
  const curlTop = (x, y, r, rot = 0) => {
    trim.push(x, y, 0, rot);
    trim.disc(0, 0, 0, r, '#1E5BC6', 28);
    ringArc(trim, r * 0.66, r * 0.22, -Math.PI * 0.95, Math.PI * 0.55, 0.006, '#F4F1E8', -1);
    trim.pop();
  };
  const lightsAt = (xf, xb, y, zOff = hw - 0.28) => {
    head.push([xf, y, -zOff], [xf, y, zOff]);
    tail.push([xb, y, -zOff], [xb, y, zOff]);
    ind.push([xf, y - 0.02, zOff + 0.18], [xb, y + 0.18, zOff]);
  };

  if (body === 'pickup') {
    // Cab and an open bed.
    paint.box(1.25, 0.55, 0, 2.3, 0.75, W, '#ffffff'); // hood + cab base
    paint.box(0.55, 1.3, 0, 1.3, 0.85, W - 0.1, '#ffffff'); // cab
    glass.quad([1.22, 1.32, -hw + 0.12], [1.22, 1.32, hw - 0.12], [1.02, 2.1, hw - 0.15], [1.02, 2.1, -hw + 0.15], '#ffffff');
    paint.box(-1.3, 0.55, 0, 2.2, 0.75, W, '#ffffff'); // bed
    trim.box(-1.3, 1.25, 0, 2.0, 0.06, W - 0.3, '#3A3F48');
    for (const s of [-1, 1]) {
      glass.quad([0.95, 1.45, s * (hw - 0.04)], [0.15, 1.45, s * (hw - 0.04)], [0.15, 2.05, s * (hw - 0.04)], [0.95, 2.05, s * (hw - 0.04)], '#ffffff');
    }
    rack = [
      [-0.8, 1.31, -0.45],
      [-0.8, 1.31, 0.45],
      [-1.75, 1.31, 0],
    ];
    curlSide(-1.3, 0.92, 0.32);
    lightsAt(2.41, -2.41, 0.95);
  } else if (body === 'tuk') {
    // A three-wheeler: a rounded nose, a bench and a canopy.
    paint.box(1.4, 0.45, 0, 1.0, 1.0, 1.1, '#ffffff');
    paint.box(-0.4, 0.5, 0, 2.6, 0.8, W - 0.2, '#ffffff');
    trim.box(-0.4, 2.15, 0, 3.0, 0.12, W, dark);
    for (const [x, z] of [
      [1.05, -0.95],
      [1.05, 0.95],
      [-1.75, -0.95],
      [-1.75, 0.95],
    ])
      trim.box(x, 1.3, z, 0.08, 0.85, 0.08, dark);
    glass.quad([1.08, 1.3, -0.9], [1.08, 1.3, 0.9], [1.0, 2.05, 0.9], [1.0, 2.05, -0.9], '#ffffff');
    wheels = [
      [1.55, 0],
      [-1.5, -1.0],
      [-1.5, 1.0],
    ];
    rack = [
      [-0.8, 2.27, -0.4],
      [-0.8, 2.27, 0.4],
      [-1.6, 2.27, 0],
    ];
    curlSide(-0.6, 0.95, 0.3);
    head.push([1.92, 1.0, 0]);
    tail.push([-1.72, 0.95, -0.85], [-1.72, 0.95, 0.85]);
    ind.push([1.9, 1.2, 0.4], [-1.72, 1.15, 0.85]);
  } else if (body === 'bread') {
    // A tall rounded loaf of a van.
    paint.box(1.85, 0.5, 0, 1.1, 0.9, W, '#ffffff');
    const rows = 6;
    for (let i = 0; i < rows; i++) {
      const a0 = (i / rows) * (Math.PI / 2);
      const a1 = ((i + 1) / rows) * (Math.PI / 2);
      const r = 0.55;
      for (const s of [-1, 1]) void s;
      // Rounded roof edge front (a quarter round at the top front).
      paint.quad([1.3 + Math.sin(a0) * r, 2.2 + Math.cos(a0) * r, -hw], [1.3 + Math.sin(a0) * r, 2.2 + Math.cos(a0) * r, hw], [1.3 + Math.sin(a1) * r, 2.2 + Math.cos(a1) * r, hw], [1.3 + Math.sin(a1) * r, 2.2 + Math.cos(a1) * r, -hw], '#ffffff');
    }
    paint.box(-0.35, 0.5, 0, 3.3, 2.25, W, '#ffffff', { skip: new Set(['top']) });
    paint.box(-0.6, 2.75, 0, 3.8, 0.0001, W, '#ffffff');
    paint.box(1.55, 0.5, 0, 0.5, 2.2, W, '#ffffff', { skip: new Set(['top']) });
    paint.quad([-2.0, 2.75, hw], [1.3, 2.75, hw], [1.3, 2.75, -hw], [-2.0, 2.75, -hw], '#ffffff');
    glass.quad([1.82, 1.45, -hw + 0.15], [1.82, 1.45, hw - 0.15], [1.82, 2.25, hw - 0.15], [1.82, 2.25, -hw + 0.15], '#ffffff');
    for (const s of [-1, 1]) glass.quad([1.65, 1.5, s * (hw + 0.005)], [1.0, 1.5, s * (hw + 0.005)], [1.0, 2.2, s * (hw + 0.005)], [1.65, 2.2, s * (hw + 0.005)], '#ffffff');
    trim.box(-0.35, 1.25, 0, 3.4, 0.25, W + 0.02, '#F4F1E8');
    rack = [
      [-0.2, 2.82, -0.45],
      [-0.2, 2.82, 0.45],
      [-1.1, 2.82, 0],
    ];
    curlSide(-0.6, 1.85, 0.42);
    curlTop(0.75, 2.755, 0.46);
    lightsAt(2.41, -2.01, 0.95);
  } else if (body === 'mail') {
    // A mail truck: a short sloped hood and a tall square body, white with the blue stripe.
    paint.box(1.9, 0.5, 0, 1.0, 0.8, W, '#ffffff');
    paint.box(-0.35, 0.5, 0, 3.5, 2.05, W, '#ffffff');
    glass.quad([1.42, 1.35, -hw + 0.12], [1.42, 1.35, hw - 0.12], [1.42, 2.3, hw - 0.12], [1.42, 2.3, -hw + 0.12], '#ffffff');
    for (const s of [-1, 1]) glass.quad([1.4, 1.45, s * (hw + 0.005)], [0.6, 1.45, s * (hw + 0.005)], [0.6, 2.25, s * (hw + 0.005)], [1.4, 2.25, s * (hw + 0.005)], '#ffffff');
    trim.box(-0.35, 1.0, 0, 3.52, 0.16, W + 0.02, '#1E5BC6');
    trim.box(-0.35, 1.2, 0, 3.52, 0.08, W + 0.02, '#D9573B');
    rack = [
      [-0.5, 2.62, -0.45],
      [-0.5, 2.62, 0.45],
      [-1.4, 2.62, 0],
    ];
    curlSide(-0.6, 1.75, 0.42);
    curlTop(0.55, 2.555, 0.46);
    lightsAt(2.41, -2.11, 0.95);
  } else if (body === 'icecream') {
    paint.box(1.85, 0.5, 0, 1.1, 0.85, W, '#ffffff');
    paint.box(-0.35, 0.5, 0, 3.3, 2.15, W, '#ffffff');
    glass.quad([1.32, 1.4, -hw + 0.12], [1.32, 1.4, hw - 0.12], [1.32, 2.4, hw - 0.12], [1.32, 2.4, -hw + 0.12], '#ffffff');
    // The serving hatch on the right with a striped awning.
    glass.quad([0.6, 1.4, hw + 0.01], [-1.4, 1.4, hw + 0.01], [-1.4, 2.25, hw + 0.01], [0.6, 2.25, hw + 0.01], '#ffffff');
    for (let k = 0; k < 6; k++) trim.box(0.6 - 0.33 * k - 0.165, 2.4, hw + 0.25, 0.33, 0.06, 0.5, k % 2 ? '#F4F1E8' : '#E98FA4');
    // A giant cone on the roof.
    trim.cyl(-0.5, 2.65, 0, 0.12, 0.05, '#E0A85A', 10);
    trim.cyl(-0.5, 2.65, 0, 0.04, 0.9, '#E0A85A', 10, { r1: 0.45 });
    trim.blob(-0.5, 3.75, 0, 0.5, '#F7D9E6', 1, 1, 0.08, 3);
    trim.blob(-0.5, 4.15, 0, 0.12, '#D9573B', 1, 0, 0.05, 4);
    trim.box(-0.35, 1.05, 0, 3.32, 0.2, W + 0.02, '#E98FA4');
    rack = [
      [0.55, 2.72, -0.4],
      [0.55, 2.72, 0.4],
      [-1.5, 2.72, 0],
    ];
    curlSide(-0.6, 1.75, 0.0001);
    lightsAt(2.41, -2.01, 0.95);
  } else {
    // The box van (and the golden one): a cab with a sloped screen and a tall box.
    paint.box(1.95, 0.5, 0, 0.9, 0.8, W, '#ffffff');
    paint.box(1.05, 0.5, 0, 1.2, 1.15, W, '#ffffff');
    // The cab's screen slope and roof.
    paint.quad([1.65, 1.65, -hw], [1.65, 1.65, hw], [1.35, 2.25, hw], [1.35, 2.25, -hw], '#ffffff');
    paint.box(0.95, 2.25, 0, 0.8, 0.02, W, '#ffffff', { skip: new Set(['n', 's', 'e', 'w']) });
    for (const s of [-1, 1]) {
      paint.quad(s > 0 ? [0.45, 1.65, s * hw] : [1.65, 1.65, s * hw], s > 0 ? [1.65, 1.65, s * hw] : [0.45, 1.65, s * hw], s > 0 ? [1.35, 2.25, s * hw] : [0.45, 2.25, s * hw], s > 0 ? [0.45, 2.25, s * hw] : [1.35, 2.25, s * hw], '#ffffff');
    }
    glass.quad([1.665, 1.7, -hw + 0.1], [1.665, 1.7, hw - 0.1], [1.365, 2.2, hw - 0.1], [1.365, 2.2, -hw + 0.1], '#ffffff');
    for (const s of [-1, 1]) {
      const z = s * (hw + 0.006);
      if (s > 0) glass.quad([0.55, 1.72, z], [1.55, 1.72, z], [1.3, 2.18, z], [0.55, 2.18, z], '#ffffff');
      else glass.quad([1.55, 1.72, z], [0.55, 1.72, z], [0.55, 2.18, z], [1.3, 2.18, z], '#ffffff');
    }
    paint.box(-0.75, 0.5, 0, 3.3, 2.15, W + 0.06, '#ffffff');
    trim.box(-0.75, 2.65, 0, 3.32, 0.06, W + 0.08, shade('#F4F1E8', -0.1));
    // Rear doors' seam and handles.
    trim.box(-2.41, 0.6, 0, 0.02, 1.95, 0.04, dark);
    trim.box(-2.42, 1.5, -0.12, 0.04, 0.3, 0.06, steel);
    trim.box(-2.42, 1.5, 0.12, 0.04, 0.3, 0.06, steel);
    rack = [
      [-0.35, 2.72, -0.45],
      [-0.35, 2.72, 0.45],
      [-1.35, 2.72, 0],
    ];
    curlSide(-0.75, 1.62, 0.55);
    curlTop(0.32, 2.715, 0.52);
    lightsAt(2.41, -2.41, 0.95);
  }
  // Everything has a chassis, bumpers, mirrors and wheel arches.
  const len = body === 'tuk' ? 3.8 : 4.8;
  const xf = body === 'tuk' ? 1.9 : 2.4;
  const xb = body === 'tuk' ? -1.9 : -2.4;
  trim.box((xf + xb) / 2, 0.28, 0, len - 0.2, 0.26, W - 0.3, '#2A2E36');
  if (body !== 'tuk') {
    trim.box(xf + 0.06, 0.38, 0, 0.18, 0.32, W + 0.04, '#3A3F48');
    trim.box(xb - 0.06, 0.38, 0, 0.18, 0.32, W + 0.04, '#3A3F48');
    // A grille and a plate.
    trim.box(xf + 0.005, 0.75, 0, 0.04, 0.32, 0.9, '#2A2E36');
    trim.box(xb - 0.16, 0.42, 0, 0.02, 0.18, 0.55, '#F2D24A');
    for (const s of [-1, 1]) {
      trim.box(1.3, 1.62, s * (hw + 0.16), 0.08, 0.06, 0.3, dark);
      trim.box(1.32, 1.5, s * (hw + 0.3), 0.12, 0.3, 0.06, dark);
    }
  }
  for (const [x, z] of wheels) trim.box(x, 0.48, z, 0.95, 0.5, z === 0 ? 0.5 : 0.36, '#20242B', { skip: new Set(['bottom']) });
  return { paint, trim, glass, head, tail, ind, wheels, rack, len };
}

function ringArc(b, r, w, a0, a1, y, color, s) {
  const n = 18;
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const pts = [
      [Math.cos(t0) * (r - w / 2), y, Math.sin(t0) * (r - w / 2)],
      [Math.cos(t1) * (r - w / 2), y, Math.sin(t1) * (r - w / 2)],
      [Math.cos(t1) * (r + w / 2), y, Math.sin(t1) * (r + w / 2)],
      [Math.cos(t0) * (r + w / 2), y, Math.sin(t0) * (r + w / 2)],
    ];
    if (s > 0) b.quad(pts[0], pts[3], pts[2], pts[1], color);
    else b.quad(pts[0], pts[1], pts[2], pts[3], color);
  }
  const hx = Math.cos(a1) * r;
  const hz = Math.sin(a1) * r;
  const tx = -Math.sin(a1);
  const tz = Math.cos(a1);
  const A = [hx + tx * r * 0.55, y, hz + tz * r * 0.55];
  const B = [hx + Math.cos(a1) * r * 0.42, y, hz + Math.sin(a1) * r * 0.42];
  const C = [hx - Math.cos(a1) * r * 0.42, y, hz - Math.sin(a1) * r * 0.42];
  if (s > 0) b.tri(A, C, B, color);
  else b.tri(A, B, C, color);
}

// Shared bits.
const geoCache = new Map();
let wheelGeo = null;
let hubGeo = null;
let parcelGeo = null;
let goldParcelGeo = null;
let lampGeo = null;
let tagMats = null;

function wheelGeos() {
  if (wheelGeo) return;
  wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.34, 16);
  wheelGeo.rotateX(Math.PI / 2);
  const b = new Builder();
  b.cyl(0, -0.18, 0, WHEEL_R * 0.55, 0.37, '#C9CED6', 8);
  for (let k = 0; k < 4; k++) b.box(0, -0.19, 0, 0.1, 0.38, WHEEL_R * 1.0, '#8E949C');
  hubGeo = b.toGeometry();
  hubGeo.rotateX(Math.PI / 2);
  const p = new Builder();
  parcelBox(p, '#C8925A', '#E9D8B4');
  parcelGeo = p.toGeometry();
  const g = new Builder();
  parcelBox(g, '#FFD23F', '#D9573B');
  goldParcelGeo = g.toGeometry();
  lampGeo = new THREE.BoxGeometry(0.06, 0.2, 0.36);
}

/** A parcel: cardboard with tape and a label, 0.62 × 0.42 × 0.5, base at y = 0. */
export function parcelBox(b, card, tape) {
  b.box(0, 0, 0, 0.62, 0.42, 0.5, card, { bottomDark: 0.15 });
  b.box(0, 0.42, 0, 0.64, 0.012, 0.1, tape);
  b.box(0, 0.0, 0.251, 0.1, 0.43, 0.006, tape);
  b.box(0, 0.0, -0.251, 0.1, 0.43, 0.006, tape);
  b.box(0.16, 0.2, 0.252, 0.2, 0.13, 0.004, '#F4F1E8');
}

const wrapGeos = new Map();
/** A parcel's geometry: gold (express, last call) or in a wrap from the garage (brown paper by default). */
export function parcelGeometry(gold = false, wrap = 'kraft') {
  wheelGeos();
  if (gold) return goldParcelGeo;
  if (!wrap || wrap === 'kraft') return parcelGeo;
  let g = wrapGeos.get(wrap);
  if (!g) {
    const w = WRAPS.find((x) => x.id === wrap);
    if (!w) return parcelGeo;
    const b = new Builder();
    parcelBox(b, w.card, w.tape);
    g = b.toGeometry();
    wrapGeos.set(wrap, g);
  }
  return g;
}

/** Wrap the parcels on a rig's roof. */
export function setWrap(rig, wrap) {
  if (rig.wrapId === wrap) return;
  rig.wrapId = wrap;
  const geo = parcelGeometry(false, wrap);
  for (const m of rig.rack) m.geometry = geo;
}

function bodyGeos(body) {
  let g = geoCache.get(body);
  if (g) return g;
  const sh = shape(body);
  g = { paint: sh.paint.toGeometry(), trim: sh.trim.toGeometry(), glass: sh.glass.toGeometry(), sh };
  geoCache.set(body, g);
  return g;
}

/** A van model on its rig. */
export function createVanRig(body, color) {
  wheelGeos();
  const g = bodyGeos(body);
  const gold = body === 'gold';
  const paintMat = patch(new THREE.MeshStandardMaterial({ color: gold ? '#E8B830' : color, roughness: gold ? 0.22 : 0.32, metalness: gold ? 0.85 : 0.15 }), { patterns: false });
  const trimMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), { patterns: false });
  const glassMat = patch(new THREE.MeshStandardMaterial({ color: '#1C2836', roughness: 0.05, metalness: 0.2 }), { patterns: false });
  const tyreMat = patch(new THREE.MeshStandardMaterial({ color: '#1A1C20', roughness: 0.85 }), { patterns: false });
  const hubMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.4 }), { patterns: false });
  const headMat = new THREE.MeshBasicMaterial({ color: '#FFF4D6', toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#7A1010', toneMapped: false });
  const indMat = new THREE.MeshBasicMaterial({ color: '#5A3A08', toneMapped: false });
  const root = new THREE.Group();
  const bodyG = new THREE.Group(); // springs: roll, pitch, bounce, squash
  root.add(bodyG);
  const mk = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    bodyG.add(m);
    return m;
  };
  mk(g.paint, paintMat);
  mk(g.trim, trimMat);
  mk(g.glass, glassMat);
  const lamps = (list, mat, sx = 1) =>
    list.map(([x, y, z]) => {
      const m = new THREE.Mesh(lampGeo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, 1, 1);
      bodyG.add(m);
      return m;
    });
  lamps(g.sh.head, headMat);
  lamps(g.sh.tail, tailMat);
  lamps(g.sh.ind, indMat, 1.2).forEach((m) => m.scale.set(1.2, 0.6, 0.45));
  // Wheels: a steer group (front) holding a spin group.
  const wheels = g.sh.wheels.map(([x, z]) => {
    const steer = new THREE.Group();
    steer.position.set(x, WHEEL_R, z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(wheelGeo, tyreMat);
    tyre.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    if (z < 0) hub.rotation.y = Math.PI;
    spin.add(tyre, hub);
    steer.add(spin);
    root.add(steer);
    return { steer, spin, front: x > 0 };
  });
  // Parcels on the roof.
  const rack = g.sh.rack.map(([x, y, z], i) => {
    const m = new THREE.Mesh(parcelGeo, trimMat);
    m.position.set(x, y, z);
    m.rotation.y = (i - 1) * 0.12;
    m.castShadow = true;
    bodyG.add(m);
    return m;
  });
  // A roof rail for the parcels.
  const rail = new Builder();
  if (body !== 'pickup' && body !== 'icecream') {
    const y = g.sh.rack[0][1];
    const x0 = Math.min(...g.sh.rack.map((r) => r[0])) - 0.55;
    const x1 = Math.max(...g.sh.rack.map((r) => r[0])) + 0.55;
    for (const s of [-1, 1]) rail.box((x0 + x1) / 2, y - 0.02, s * 0.85, x1 - x0, 0.08, 0.06, '#3A3F48');
    for (const x of [x0, x1]) for (const s of [-1, 1]) rail.box(x, y - 0.08, s * 0.85, 0.06, 0.14, 0.06, '#3A3F48');
  }
  if (rail.count) mk(rail.toGeometry(), trimMat);
  // The seat's colour as a roof panel in multiplayer (a stripe), set by the layer.
  return {
    root,
    body: bodyG,
    wheels,
    rack,
    mats: { paint: paintMat, trim: trimMat, glass: glassMat, tyre: tyreMat, hub: hubMat, head: headMat, tail: tailMat, ind: indMat },
    kind: body,
    color,
    len: g.sh.len,
    // Spring state.
    roll: 0,
    rollV: 0,
    pitch: 0,
    pitchV: 0,
    bounce: 0,
    bounceV: 0,
    steer: 0,
    spinA: 0,
    drift: 0,
    lastH: null,
    lastV: 0,
    yawRate: 0,
  };
}

/** Recolour a rig's paint. */
export function paintRig(rig, color) {
  if (rig.kind === 'gold' || rig.color === color) return;
  rig.color = color;
  rig.mats.paint.color.set(color);
}

const HEAD_ON = new THREE.Color(6, 5.6, 4.6);
const HEAD_DAY = new THREE.Color(1.1, 1.08, 1.0);
const TAIL_ON = new THREE.Color(6, 0.4, 0.3);
const TAIL_OFF = new THREE.Color(0.55, 0.06, 0.05);
const IND_ON = new THREE.Color(6, 2.8, 0.3);
const IND_OFF = new THREE.Color(0.45, 0.25, 0.04);

/**
 * Move a rig to a van's state. v: { x, y, h, v, hold, stall, spin, braking, parcels, squash, gold }; env: { t, dt, night }.
 */
export function updateRig(rig, v, env) {
  const dt = Math.max(0.0001, Math.min(0.05, env.dt));
  const speed = (v.v || 0) * S; // m/s
  // Heading change → yaw rate; speed change → longitudinal acceleration.
  let yaw = 0;
  if (rig.lastH !== null) {
    let d = v.h - rig.lastH;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    yaw = d / dt;
  }
  rig.lastH = v.h;
  if (Math.abs(yaw) > 12) yaw = 0; // a teleport (respawn), not a turn
  rig.yawRate += (yaw - rig.yawRate) * Math.min(1, dt * 10);
  const acc = (speed - rig.lastV) / dt;
  rig.lastV = speed;
  // Roll out of the turn, pitch with the brakes and the throttle: damped springs.
  const lat = rig.yawRate * speed; // m/s² sideways
  const rollT = Math.max(-0.16, Math.min(0.16, -lat * 0.016));
  const pitchT = Math.max(-0.08, Math.min(0.08, acc * 0.006 - (v.braking && speed > 2 ? 0.025 : 0)));
  const k = 140;
  const c = 11;
  rig.rollV += ((rollT - rig.roll) * k - rig.rollV * c) * dt;
  rig.roll += rig.rollV * dt;
  rig.pitchV += ((pitchT - rig.pitch) * k - rig.pitchV * c) * dt;
  rig.pitch += rig.pitchV * dt;
  rig.bounceV += (-rig.bounce * 220 - rig.bounceV * 9) * dt;
  rig.bounce += rig.bounceV * dt;
  // Drifting: a hard held turn at speed swings the tail out.
  const driftT = v.hold && speed > 18 ? Math.min(0.3, (speed - 18) * 0.05 + 0.12) : 0;
  rig.drift += (driftT - rig.drift) * Math.min(1, dt * (driftT > rig.drift ? 6 : 4));
  // Place.
  rig.root.position.set(v.x * S, v.z || 0, v.y * S);
  rig.root.rotation.y = -(v.h + rig.drift * 0.6) + (v.spin || 0);
  const squash = v.squash || 0;
  rig.body.position.y = 0.02 + rig.bounce + Math.sin(env.t * 31) * Math.min(0.012, speed * 0.0006);
  rig.body.rotation.set(rig.roll, 0, rig.pitch);
  rig.body.scale.set(1 + squash * 0.12, 1 - squash * 0.18, 1 + squash * 0.1);
  // Wheels.
  rig.spinA -= (speed / WHEEL_R) * dt;
  const steerT = v.hold ? -0.5 : 0;
  rig.steer += (steerT - rig.steer) * Math.min(1, dt * 12);
  for (const w of rig.wheels) {
    w.spin.rotation.z = rig.spinA;
    if (w.front) w.steer.rotation.y = rig.steer;
  }
  // Lights.
  rig.mats.head.color.copy(env.night > 0.3 ? HEAD_ON : HEAD_DAY);
  rig.mats.tail.color.copy(v.braking || (v.v || 0) < 30 ? TAIL_ON : env.night > 0.3 ? TAIL_OFF.clone().multiplyScalar(2.4) : TAIL_OFF);
  const blink = v.hold && Math.floor(env.t * 3.2) % 2 === 0;
  rig.mats.ind.color.copy(blink ? IND_ON : IND_OFF);
  const n = Math.max(0, Math.min(rig.rack.length, v.parcels || 0));
  rig.rack.forEach((m, i) => {
    m.visible = i < n;
    if (m.visible) {
      m.position.y = m.userData.y ?? (m.userData.y = m.position.y);
      m.position.y = m.userData.y + Math.max(0, Math.sin(env.t * 19 + i * 2) * Math.min(0.03, speed * 0.002));
    }
  });
}

/** A kick to the springs (a crash, a load, a bump). */
export function kickRig(rig, amount) {
  rig.bounceV += amount * 2.2;
  rig.rollV += (Math.random() - 0.5) * amount * 3;
  rig.pitchV -= amount * 1.5;
}

export function disposeRig(rig) {
  for (const m of Object.values(rig.mats)) m.dispose();
}

void tagMats;
void goldParcelGeo;

// ---------------------------------------------------------------- toppers (the garage's roof extras)

const topperCache = new Map();

/** A topper's geometry, base at y = 0, centred on x = z = 0. */
function topperGeometry(id) {
  if (topperCache.has(id)) return topperCache.get(id);
  const b = new Builder();
  if (id === 'cone') {
    b.box(0, 0, 0, 0.62, 0.06, 0.62, '#2A2E36');
    b.cyl(0, 0.06, 0, 0.26, 0.72, '#F26B1D', 14, { r1: 0.05, top: '#F26B1D' });
    b.cyl(0, 0.3, 0, 0.18, 0.12, '#F4F1E8', 14, { r1: 0.15, cap: false });
  } else if (id === 'flag') {
    b.cyl(0, 0, 0, 0.04, 1.7, '#C9CED6', 6);
    b.tri([0, 1.68, 0], [-0.9, 1.5, 0], [0, 1.28, 0], '#D9412E');
    b.tri([0, 1.68, 0], [0, 1.28, 0], [-0.9, 1.5, 0], '#D9412E');
    b.blob(0, 1.72, 0, 0.07, '#FFC22E', 1, 0, 0.03);
  } else if (id === 'duck') {
    b.blob(0, 0.28, 0, 0.36, '#FFD23F', 0.8, 1, 0.03);
    b.blob(0.22, 0.62, 0, 0.21, '#FFD23F', 1, 1, 0.03);
    b.box(0.46, 0.58, 0, 0.18, 0.07, 0.16, '#F26B1D');
    for (const s of [-1, 1]) b.blob(0.36, 0.7, s * 0.12, 0.035, '#141A22', 1, 0, 0.03);
    b.blob(-0.32, 0.42, 0, 0.12, '#FFD23F', 1, 0, 0.03);
  } else if (id === 'lightbar') {
    b.box(0, 0, 0, 0.4, 0.08, 1.7, '#2A2E36');
    b.box(0, 0.08, -0.45, 0.32, 0.18, 0.8, '#3D7BFF');
    b.box(0, 0.08, 0.45, 0.32, 0.18, 0.8, '#FF8A1E');
    b.box(0, 0.08, 0, 0.34, 0.2, 0.12, '#F4F1E8');
  } else if (id === 'stack') {
    for (let i = 0; i < 4; i++) {
      b.push(0, i * 0.42, 0, (i % 2 ? 0.18 : -0.12) + i * 0.05);
      parcelBox(b, i === 3 ? '#FFD23F' : '#C8925A', i === 3 ? '#D9573B' : '#E9D8B4');
      b.pop();
    }
  } else if (id === 'dish') {
    b.cyl(0, 0, 0, 0.06, 0.45, '#8E949C', 6);
    b.push(0, 0.55, 0, 0);
    const m = new THREE.Matrix4().makeRotationZ(0.7);
    b.pushMatrix(m);
    b.cyl(0, -0.05, 0, 0.5, 0.18, '#E8E8EC', 16, { r1: 0.12, cap: false });
    b.cyl(0, -0.05, 0, 0.12, 0.02, '#C9CED6', 10);
    b.cyl(0, 0, 0, 0.025, 0.55, '#8E949C', 4);
    b.pop();
    b.pop();
  } else if (id === 'tree') {
    b.cyl(0, 0, 0, 0.08, 0.3, '#6B4A2E', 6);
    b.cyl(0, 0.25, 0, 0.5, 0.6, '#2F6E4F', 10, { r1: 0.02 });
    b.cyl(0, 0.6, 0, 0.38, 0.5, '#3A8A5E', 10, { r1: 0.02 });
    b.cyl(0, 0.92, 0, 0.26, 0.42, '#46A06C', 10, { r1: 0.02 });
    b.blob(0, 1.38, 0, 0.09, '#FFD23F', 1, 0, 0.03);
  } else if (id === 'crown') {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const r = 0.42;
      const p = (a, y, rr = r) => [Math.cos(a) * rr, y, Math.sin(a) * rr];
      b.quad(p(a1, 0), p(a0, 0), p(a0, 0.3), p(a1, 0.3), '#E8B931');
      b.quad(p(a0, 0), p(a1, 0), p(a1, 0.3, r - 0.04), p(a0, 0.3, r - 0.04), '#C9962A');
      b.tri(p(a0, 0.3), p((a0 + a1) / 2, 0.62), p(a1, 0.3), '#E8B931');
      b.tri(p(a1, 0.3, r - 0.04), p((a0 + a1) / 2, 0.62, r - 0.04), p(a0, 0.3, r - 0.04), '#C9962A');
      b.blob(Math.cos((a0 + a1) / 2) * r, 0.64, Math.sin((a0 + a1) / 2) * r, 0.05, i % 2 ? '#D9412E' : '#3D7BFF', 1, 0, 0.03);
    }
  }
  const g = b.count ? b.toGeometry() : null;
  topperCache.set(id, g);
  return g;
}

/** Put a topper on a rig's roof (at the back of the roof rack), or take it off ('none'). */
export function setTopper(rig, id) {
  if (rig.topperId === id) return;
  rig.topperId = id;
  if (rig.topper) {
    rig.body.remove(rig.topper);
    rig.topper = null;
  }
  const g = id && id !== 'none' ? topperGeometry(id) : null;
  if (!g) return;
  const sh = bodyGeos(rig.kind).sh;
  const y = sh.rack.length ? sh.rack[0][1] : 2.3;
  const x0 = sh.rack.length ? Math.min(...sh.rack.map((r) => r[0])) - 0.75 : -1.6;
  const m = new THREE.Mesh(g, rig.mats.trim);
  m.position.set(Math.max(x0, -sh.len / 2 + 0.4), y, 0);
  m.castShadow = true;
  rig.body.add(m);
  rig.topper = m;
}
