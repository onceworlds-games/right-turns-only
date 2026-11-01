// Effects in 3D: sparks that bloom, confetti that flutters down, smoke that rises and spreads, parcels flying in an arc
// from the roof rack to the doormat, ring bursts on the road, tyre marks and snow tracks that stay where the van went,
// chimney smoke, and the rising numbers drawn over it all on the HUD. Draws the effects state of fx.js (in px) as is.

import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { S } from './style.js';
import { KERB } from './town.js';
import { parcelGeometry } from './van.js';
import { font } from '../draw2d.js';

const MAX_PARTS = 260;
const MAX_MARKS = 900;

const SMOKE_VERT = /* glsl */ `
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vColor = aColor;
  // Billboard: the quad faces the camera, sized by the instance's scale.
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
}`;
const SMOKE_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export function createFxLayer(R) {
  const group = new THREE.Group();
  R.scene.add(group);
  const C = new THREE.Color();
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const E = new THREE.Euler();
  const P = new THREE.Vector3();
  const V = new THREE.Vector3();

  // Sparks: little bright gems (they bloom).
  const sparkMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const sparks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), sparkMat, MAX_PARTS);
  sparks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTS * 3), 3);
  sparks.frustumCulled = false;
  // Confetti and chips: lit paper.
  const paperGeo = new THREE.PlaneGeometry(1, 0.75);
  const paper = new THREE.InstancedMesh(paperGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.7 }), MAX_PARTS);
  paper.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTS * 3), 3);
  paper.frustumCulled = false;
  paper.castShadow = true;
  // Smoke and dust: soft billboards.
  const smokeGeo = new THREE.PlaneGeometry(1, 1);
  smokeGeo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTS + 120), 1));
  smokeGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array((MAX_PARTS + 120) * 3), 3));
  const smoke = new THREE.InstancedMesh(smokeGeo, new THREE.ShaderMaterial({ vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false }), MAX_PARTS + 120);
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;
  group.add(sparks, paper, smoke);

  // Flying parcels.
  const flying = [];
  const throwMesh = (gold, wrap) => {
    let m = flying.find((f) => !f.visible);
    if (!m) {
      m = new THREE.Mesh(parcelGeometry(false), R.mats.town);
      m.castShadow = true;
      flying.push(m);
      group.add(m);
    }
    m.geometry = parcelGeometry(gold, wrap);
    m.visible = true;
    return m;
  };

  // Ring bursts.
  const ringGeo = new THREE.RingGeometry(0.82, 1, 64);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  const ringMesh = () => {
    let m = rings.find((r) => !r.visible);
    if (!m) {
      m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = 4;
      rings.push(m);
      group.add(m);
    }
    m.visible = true;
    return m;
  };

  // Tyre marks and snow tracks: a ring buffer of dark (or pressed) quads.
  const markGeo = new THREE.PlaneGeometry(0.34, 1);
  markGeo.rotateX(-Math.PI / 2);
  const makeMarks = (color, opacity) => {
    const im = new THREE.InstancedMesh(markGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), MAX_MARKS);
    im.count = 0;
    im.frustumCulled = false;
    im.renderOrder = 1;
    group.add(im);
    return { im, next: 0, last: [null, null], at: 0 };
  };
  const tyres = makeMarks('#15171B', 0.42);
  const snowMarks = makeMarks('#8FA4BA', 0.55);

  // Chimney smoke: puffs from the chimneys near the camera.
  const puffs = [];
  let chimneys = [];
  let puffClock = 0;

  const layer = {
    setCity(tn) {
      layer.clearMarks();
      chimneys = tn.data.smoke || [];
      puffs.length = 0;
    },
    clearMarks() {
      for (const m of [tyres, snowMarks]) {
        m.im.count = 0;
        m.next = 0;
        m.last = [null, null];
      }
    },
    /** A mark on the ground at (x, y) px heading h: two tyre tracks. */
    mark(x, y, h, kind) {
      // Each new mark joins the last one on that side into one unbroken track.
      const m = kind === 'snow' ? snowMarks : tyres;
      const c = Math.cos(h);
      const s = Math.sin(h);
      const now = performance.now();
      if (now - m.at > 250) m.last = [null, null];
      m.at = now;
      [-1, 1].forEach((side, k) => {
        const px = x * S - s * side * 0.95;
        const pz = y * S + c * side * 0.95;
        const prev = m.last[k];
        m.last[k] = [px, pz];
        let dx = c;
        let dz = s;
        let len = 0.6;
        let mx = px;
        let mz = pz;
        if (prev) {
          const d = Math.hypot(px - prev[0], pz - prev[1]);
          if (d > 0.05 && d < 4) {
            dx = (px - prev[0]) / d;
            dz = (pz - prev[1]) / d;
            len = d + 0.05;
            mx = (px + prev[0]) / 2;
            mz = (pz + prev[1]) / 2;
          }
        }
        Q.setFromAxisAngle(V.set(0, 1, 0), Math.atan2(dx, dz));
        P.set(mx, 0.025, mz);
        M.compose(P, Q, V.set(1, 1, len));
        m.im.setMatrixAt(m.next, M);
        m.next = (m.next + 1) % MAX_MARKS;
        m.im.count = Math.min(MAX_MARKS, m.im.count + 1);
      });
      m.im.instanceMatrix.needsUpdate = true;
    },
    frame(view) {
      const fx = view.fx;
      const dt = Math.min(0.1, R.dt || 0.016);
      let ns = 0;
      let np = 0;
      let nk = 0;
      const alpha = smokeGeo.attributes.aAlpha;
      const acol = smokeGeo.attributes.aColor;
      if (fx) {
        for (const p of fx.parts) {
          if (!p.on) continue;
          const k = p.life / p.max;
          const x = p.x * S;
          const y = (p.z || 0) * S + 0.05;
          const z = p.y * S;
          if (p.kind === 2) {
            if (nk >= MAX_PARTS + 120) continue;
            const sz = p.size * S * (1.2 + k * 3);
            M.makeScale(sz, sz, sz).setPosition(x, y + 0.3, z);
            smoke.setMatrixAt(nk, M);
            alpha.setX(nk, (1 - k) * 0.55);
            C.set(p.color);
            acol.setXYZ(nk, C.r, C.g, C.b);
            nk++;
          } else if (p.kind === 1) {
            const sz = p.size * S * 1.1;
            E.set(p.rot * 0.7, p.rot, p.rot * 0.4);
            Q.setFromEuler(E);
            const fade = k > 0.8 ? (1 - k) / 0.2 : 1;
            M.compose(P.set(x, y, z), Q, V.set(sz * fade, sz * fade, sz * fade));
            paper.setMatrixAt(np, M);
            paper.setColorAt(np, C.set(p.color));
            np++;
          } else {
            const sz = p.size * S * 0.8 * (1 - k * 0.6);
            M.makeScale(sz, sz, sz).setPosition(x, y, z);
            sparks.setMatrixAt(ns, M);
            C.set(p.color).multiplyScalar(2.6);
            sparks.setColorAt(ns, C);
            ns++;
          }
        }
      }
      // Chimney smoke (and steam off the depot) near the camera.
      const cam = view.cam || { x: 0, y: 0 };
      puffClock += dt;
      if (puffClock > 0.25 && !view.still) {
        puffClock = 0;
        for (const c of chimneys) {
          if (Math.abs(c[0] - cam.x * S) > 60 || Math.abs(c[2] - cam.y * S) > 50) continue;
          if (Math.random() < 0.55) puffs.push({ x: c[0], y: c[1], z: c[2], t: 0, max: 3 + Math.random() * 2, s: 0.5 + Math.random() * 0.3 });
        }
        if (puffs.length > 110) puffs.splice(0, puffs.length - 110);
      }
      const night = R.style ? R.style.night : 0;
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.t += dt;
        if (p.t > p.max) {
          puffs.splice(i, 1);
          continue;
        }
        if (nk >= MAX_PARTS + 120) continue;
        const k = p.t / p.max;
        const sz = p.s * (1 + k * 3.2);
        M.makeScale(sz, sz, sz).setPosition(p.x + k * 2.2, p.y + k * 3.5, p.z - k * 0.8);
        smoke.setMatrixAt(nk, M);
        alpha.setX(nk, Math.min(1, k * 6) * (1 - k) * 0.42);
        const g = 0.86 - night * 0.55;
        acol.setXYZ(nk, g, g, g * 1.02);
        nk++;
      }
      sparks.count = ns;
      paper.count = np;
      smoke.count = nk;
      sparks.instanceMatrix.needsUpdate = true;
      if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
      paper.instanceMatrix.needsUpdate = true;
      if (paper.instanceColor) paper.instanceColor.needsUpdate = true;
      smoke.instanceMatrix.needsUpdate = true;
      alpha.needsUpdate = true;
      acol.needsUpdate = true;

      // Parcels in the air: off the roof rack in a high arc, spinning, onto the mat.
      for (const f of flying) f.visible = false;
      if (fx) {
        const houseAt = R.town && R.town.data.houseAt;
        for (const th of fx.throws) {
          const k = Math.min(1, th.t / th.dur);
          const e = k; // linear along, eased in height
          const hs = th.house !== undefined && houseAt ? houseAt.get(th.house) : null;
          const x0 = th.x0 * S;
          const z0 = th.y0 * S;
          const x1 = hs ? hs.mat[0] : th.x1 * S;
          const z1 = hs ? hs.mat[1] : th.y1 * S;
          const y0 = 2.7;
          const y1 = (hs ? hs.y : KERB) + 0.25;
          const d = Math.hypot(x1 - x0, z1 - z0);
          const lift = Math.sin(k * Math.PI) * (1.8 + d * 0.22);
          const m = throwMesh(!!th.gold, th.wrap);
          m.position.set(x0 + (x1 - x0) * e, y0 + (y1 - y0) * k + lift, z0 + (z1 - z0) * e);
          const spin = th.spin || (th.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3));
          m.rotation.set(k * spin * 0.6, Math.atan2(x1 - x0, z1 - z0) + k * spin, k * spin * 0.25);
          const sc = 1.25 + Math.sin(k * Math.PI) * 0.35;
          m.scale.setScalar(sc);
        }
        // Ring bursts.
        for (const r of rings) r.visible = false;
        for (const rg of fx.rings) {
          const k = rg.t / rg.dur;
          const m = ringMesh();
          const r = (30 + k * 90) * S;
          m.position.set(rg.x * S, 0.08, rg.y * S);
          m.scale.set(r, 1, r);
          C.set(rg.color).multiplyScalar(1.6 * (1 - k));
          m.material.color.copy(C);
          m.material.opacity = 1 - k;
        }
      }
    },
    overlay(ctx, view) {
      const fx = view.fx;
      if (!fx) return;
      for (const tx of fx.texts) {
        const k = tx.t / tx.dur;
        const [sx, sy] = R.toScreen(tx.x, tx.y, 2.6 + k * 4.5);
        ctx.save();
        ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.15, (k - 0.15) * 0.4);
        ctx.translate(sx, sy);
        ctx.scale(pop, pop);
        ctx.font = font(900, tx.size);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 8;
        ctx.strokeStyle = PALETTE.ink;
        ctx.strokeText(tx.text, 0, 0);
        ctx.fillStyle = tx.color;
        ctx.fillText(tx.text, 0, 0);
        ctx.restore();
      }
    },
  };
  return layer;
}
