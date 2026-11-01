// Painted signs: shop names, the depot's own sign and LOAD, drawn once into one texture. Signs are quads into it; at
// night the same picture is their glow (neon in Neon Heights).

import * as THREE from 'three';

const W = 1024;
const H = 2048;
const CW = 256;
const CH = 64;
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

export const SHOPS = [
  'BAKERY', 'BOOKS', 'CAFÉ', 'FLOWERS', 'HARDWARE', 'LAUNDRY', 'PIZZA', 'BARBER', 'DELI', 'TOYS', 'RECORDS', 'NOODLES',
  'GROCER', 'CYCLES', 'TAILOR', 'PHARMACY', 'DINER', 'FISH & CHIPS', 'ICE CREAM', 'HOTEL', 'CINEMA', 'ARCADE', 'BANK',
  'GYM', 'TACOS', 'BAGELS', 'PETS', 'PAINT', 'CAMERAS', 'KEYS CUT', 'SUSHI', 'DONUTS', 'BURGERS', 'TEA ROOM', 'COMICS',
  'BAR', 'JAZZ CLUB', 'KARAOKE', 'BOWLING', 'POST',
];
const LOOKS = [
  ['#24323F', '#F4F1E8'], ['#B8442F', '#F4F1E8'], ['#F2B544', '#24323F'], ['#2F6E4F', '#F4F1E8'], ['#F4F1E8', '#B8442F'],
  ['#2F5D8C', '#F4F1E8'], ['#5B3F73', '#F2B544'], ['#E98FA4', '#24323F'], ['#1E5BC6', '#FFC22E'], ['#F4F1E8', '#24323F'],
];
const NEON = ['#FF4FA8', '#4FE3FF', '#FFD23F', '#7CFF6B', '#B07CFF', '#FF7A3D'];

let atlas = null;

function cells() {
  const out = new Map();
  let i = 0;
  const put = (name, w = 1) => {
    const col = i % 4;
    if (col + w > 4) i += 4 - col;
    const c = i % 4;
    const r = Math.floor(i / 4);
    out.set(name, { x: c * CW, y: r * CH, w: w * CW, h: CH, u0: (c * CW) / W, u1: ((c + w) * CW) / W, v0: 1 - ((r + 1) * CH) / H, v1: 1 - (r * CH) / H });
    i += w;
  };
  put('CLOCKWISE COURIERS', 4);
  put('LOAD');
  put('ROAD CLOSED');
  put('DEPOT');
  put('SLOW');
  for (const s of SHOPS) put(s);
  for (const s of SHOPS) put(`neon:${s}`);
  return out;
}

function draw(a) {
  const g = a.canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  let k = 0;
  for (const [name, c] of a.cells) {
    const neon = name.startsWith('neon:');
    const text = neon ? name.slice(5) : name;
    let bg;
    let fg;
    if (name === 'CLOCKWISE COURIERS') [bg, fg] = ['#FFC22E', '#141A22'];
    else if (name === 'LOAD' || name === 'DEPOT') [bg, fg] = ['#1E5BC6', '#F4F1E8'];
    else if (name === 'ROAD CLOSED') [bg, fg] = ['#F4F1E8', '#D9573B'];
    else if (name === 'SLOW') [bg, fg] = ['#D9573B', '#F4F1E8'];
    else if (neon) [bg, fg] = ['#10121C', NEON[k % NEON.length]];
    else [bg, fg] = LOOKS[k % LOOKS.length];
    k++;
    const pad = 4;
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(c.x + pad, c.y + pad, c.w - pad * 2, c.h - pad * 2, 8);
    g.fill();
    if (!neon) {
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 3;
      g.stroke();
    }
    let size = 46;
    g.font = `900 ${size}px ${FONT}`;
    const maxW = c.w - 28;
    while (g.measureText(text).width > maxW && size > 18) {
      size -= 2;
      g.font = `900 ${size}px ${FONT}`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (neon) {
      g.shadowColor = fg;
      g.shadowBlur = 12;
      g.lineWidth = 3;
      g.strokeStyle = fg;
      g.strokeText(text, c.x + c.w / 2, c.y + c.h / 2 + 2);
      g.fillStyle = '#FFFFFF';
      g.fillText(text, c.x + c.w / 2, c.y + c.h / 2 + 2);
      g.shadowBlur = 0;
    } else {
      g.fillStyle = fg;
      g.fillText(text, c.x + c.w / 2, c.y + c.h / 2 + 2);
    }
  }
  a.tex.needsUpdate = true;
}

/** The shared sign texture (made once; drawn again when the fonts arrive). */
export function signAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  atlas = { canvas, tex, cells: cells(), redraw: () => draw(atlas) };
  draw(atlas);
  try {
    document.fonts.load(`900 40px "Barlow Condensed"`).then(() => draw(atlas));
  } catch {
    /* the fallback font is fine */
  }
  return atlas;
}

/** Sign quads in one geometry: position, normal and uv into the atlas. */
export class SignBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.m = new THREE.Matrix4();
    this.stack = [];
  }
  push(x, y, z, ry) {
    this.stack.push(this.m.clone());
    this.m.multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1)));
    return this;
  }
  pop() {
    this.m = this.stack.pop() || new THREE.Matrix4();
    return this;
  }
  /** A sign facing +z (local), centred at (x, y, z), w × h, showing atlas cell `name`. */
  sign(name, x, y, z, w, h) {
    const c = signAtlas().cells.get(name);
    if (!c) return;
    const pts = [
      [x - w / 2, y - h / 2, z],
      [x + w / 2, y - h / 2, z],
      [x + w / 2, y + h / 2, z],
      [x - w / 2, y + h / 2, z],
    ].map((p) => new THREE.Vector3(...p).applyMatrix4(this.m));
    const n = new THREE.Vector3(0, 0, 1).transformDirection(this.m);
    const uvs = [
      [c.u0, c.v0],
      [c.u1, c.v0],
      [c.u1, c.v1],
      [c.u0, c.v1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(pts[i].x, pts[i].y, pts[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
    }
  }
  /** A flat sign lying on the ground (facing up), its top edge toward -z local. */
  flat(name, x, y, z, w, h) {
    const c = signAtlas().cells.get(name);
    if (!c) return;
    const pts = [
      [x - w / 2, y, z + h / 2],
      [x + w / 2, y, z + h / 2],
      [x + w / 2, y, z - h / 2],
      [x - w / 2, y, z - h / 2],
    ].map((p) => new THREE.Vector3(...p).applyMatrix4(this.m));
    const n = new THREE.Vector3(0, 1, 0).transformDirection(this.m);
    const uvs = [
      [c.u0, c.v0],
      [c.u1, c.v0],
      [c.u1, c.v1],
      [c.u0, c.v1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(pts[i].x, pts[i].y, pts[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
    }
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
