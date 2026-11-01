// Town traffic in 3D: the cars (seven bought-in models, one instanced mesh each, recoloured per car), the buses and the
// tram (modelled here), and the cars parked on driveways. Every car leans out of its turns, dips under the brakes, lights
// its brake lights when it slows and its headlights at night. Pure presentation of view.env.cars.

import * as THREE from 'three';
import { S } from './style.js';
import { Builder, SURF } from './build.js';
import { patch } from './material.js';
import { CAR_KINDS, PART, loadModels, models } from './models.js';

const CAP = 72; // per car model
const SCALE = 1.08;

/** Pick a model for a traffic car from its id: mostly ordinary cars, now and then a taxi, rarely the police. */
export function carKind(id, town) {
  const h = (Math.imul((id | 0) + 17, 2654435761) >>> 0) % 100;
  const taxis = town && (town.neon || town.night) ? 16 : 7;
  if (h < 4) return 'police';
  if (h < 4 + taxis) return 'taxi';
  const rest = ['car1', 'car2', 'suv', 'sports1', 'car1', 'sports2', 'car2', 'suv'];
  return rest[h % rest.length];
}

function carMaterial() {
  const m = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }), { patterns: false });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.uniforms.uBlink = blinkU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float part;\nattribute vec3 iPaint;\nattribute vec3 iLamp;\nvarying float vPart;\nvarying vec3 vLamp;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
vPart = part; vLamp = iLamp;
if (part > 0.5 && part < 1.5) vColor.rgb = iPaint;
if (part > 4.5 && part < 5.5) vColor.rgb = iPaint * 0.8;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPart;\nvarying vec3 vLamp;\nuniform float uBlink;')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if (vPart > 0.5 && vPart < 1.5 || vPart > 4.5 && vPart < 5.5) roughnessFactor = 0.3;
if (vPart > 3.5 && vPart < 4.5) roughnessFactor = 0.08;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if (vPart > 1.5 && vPart < 2.5) totalEmissiveRadiance += vec3(1.0, 0.86, 0.62) * (0.15 + vLamp.y * 4.0);
if (vPart > 2.5 && vPart < 3.5) totalEmissiveRadiance += vec3(1.0, 0.06, 0.03) * (0.12 + vLamp.x * 4.5 + vLamp.y * 0.9);
if (vPart > 5.5) totalEmissiveRadiance += vec3(0.15, 0.35, 1.0) * vLamp.z * (0.5 + 4.0 * uBlink);`,
      );
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `${key()}car`;
  return m;
}

const blinkU = { value: 0 };

/** A bus or the tram, modelled in boxes: +x forward, wheels on y = 0. */
function vehicleGeometry(kind, color) {
  const b = new Builder();
  const glass = '#2A3A48';
  const dark = '#22262C';
  if (kind === 'bus') {
    const L = 9.4;
    const W = 2.5;
    b.box(0, 0.35, 0, L, 0.55, W, dark); // skirt
    b.box(0, 0.75, 0, L, 1.05, W, color); // lower body
    b.box(0, 1.8, 0, L - 0.1, 0.95, W - 0.04, glass, { surf: SURF.glass, top: color }); // window band
    b.box(0, 2.75, 0, L, 0.4, W, color, { top: '#F4F1E8' }); // roof rail
    b.box(-0.6, 3.15, 0, 3.2, 0.3, 1.6, '#D8D6D0'); // roof pod
    b.box(L / 2 - 0.02, 2.4, 0, 0.06, 0.3, 1.5, '#1A1A1A'); // the destination display
    b.box(L / 2 - 0.04, 0.85, 0, 0.1, 0.25, W - 0.3, '#E8E4DA'); // bumper strip
    for (const z of [-1, 1]) b.box(-0.8, 1.15, z * (W / 2 + 0.01), L - 2.4, 0.14, 0.02, '#F4F1E8'); // side stripe
    for (const x of [2.9, -2.6]) for (const z of [-1, 1]) wheelBox(b, x, z * (W / 2 - 0.15), 0.5);
    return { geo: b.toGeometry(), len: L, lights: { head: [[L / 2, 0.75, 0.9], [L / 2, 0.75, -0.9]], tail: [[-L / 2, 0.85, 0.95], [-L / 2, 0.85, -0.95]], sign: [L / 2 + 0.02, 2.55, 0] } };
  }
  // The tram: two sections and a bellows, a pantograph on the roof.
  const L = 15;
  const W = 2.6;
  const half = L / 2 - 0.4;
  for (const sx of [-1, 1]) {
    const cx = sx * (half / 2 + 0.4);
    b.box(cx, 0.3, 0, half, 0.55, W, '#E9E3D3'); // cream skirt
    b.box(cx, 0.85, 0, half, 0.95, W, color);
    b.box(cx, 1.8, 0, half - 0.1, 1.05, W - 0.04, glass, { surf: SURF.glass, top: color });
    b.box(cx, 2.85, 0, half, 0.35, W, color, { top: '#DADCDC' });
  }
  b.box(0, 0.4, 0, 0.8, 2.6, W - 0.3, '#2B2E33'); // bellows
  // Rounded-ish noses.
  for (const sx of [-1, 1]) b.box(sx * (L / 2 - 0.1), 0.3, 0, 0.2, 2.6, W - 0.35, color);
  // Pantograph.
  b.box(1.5, 3.2, 0, 1.8, 0.12, 1.2, '#3A3F48');
  b.quad([1.0, 3.32, -0.05], [1.0, 3.32, 0.05], [2.0, 4.1, 0.05], [2.0, 4.1, -0.05], '#3A3F48');
  b.box(2.0, 4.1, 0, 0.12, 0.06, 1.6, '#C9CCD2');
  for (const x of [-5.5, -2.0, 2.0, 5.5]) for (const z of [-1, 1]) wheelBox(b, x, z * (W / 2 - 0.2), 0.36);
  return { geo: b.toGeometry(), len: L, lights: { head: [[L / 2, 0.7, 0.85], [L / 2, 0.7, -0.85]], tail: [[-L / 2, 0.7, 0.85], [-L / 2, 0.7, -0.85]], sign: [L / 2 + 0.02, 2.65, 0] } };
}

function wheelBox(b, x, z, r) {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a, s) => [x + Math.cos(a) * r, r + Math.sin(a) * r, z + s * 0.16];
    b.quad(p(a1, 1), p(a0, 1), p(a0, -1), p(a1, -1), '#1C1E22');
    b.tri([x, r, z + 0.161 * Math.sign(z)], p(Math.sign(z) > 0 ? a0 : a1, Math.sign(z)), p(Math.sign(z) > 0 ? a1 : a0, Math.sign(z)), '#8C9096');
  }
}

export function createTrafficLayer(R) {
  const group = new THREE.Group();
  R.scene.add(group);
  const mat = carMaterial();
  const meshes = new Map(); // kind → InstancedMesh
  const state = new Map(); // car id → { h, v, roll, pitch, kind }
  const big = new Map(); // bus/tram id → { mesh, lamps }
  let parked = [];
  let city = null;
  let ready = false;
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const lampGeo = new THREE.SphereGeometry(0.16, 8, 6);

  loadModels().then((lib) => {
    for (const kind of CAR_KINDS) {
      const m = lib.cars.get(kind);
      if (!m) continue;
      const geo = m.geo.clone();
      geo.setAttribute('iPaint', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3));
      geo.setAttribute('iLamp', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3));
      const im = new THREE.InstancedMesh(geo, mat, CAP);
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      group.add(im);
      meshes.set(kind, im);
    }
    ready = true;
  });

  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const E = new THREE.Euler(0, 0, 0, 'YXZ');
  const P = new THREE.Vector3();
  const SC = new THREE.Vector3(SCALE, SCALE, SCALE);
  const C = new THREE.Color();

  function put(im, i, x, y, z, ry, pitch, roll, paint, brake, head, beacon) {
    E.set(pitch, ry, roll);
    Q.setFromEuler(E);
    P.set(x, y, z);
    M.compose(P, Q, SC);
    im.setMatrixAt(i, M);
    const pa = im.geometry.attributes.iPaint;
    C.set(paint);
    pa.setXYZ(i, C.r, C.g, C.b);
    im.geometry.attributes.iLamp.setXYZ(i, brake, head, beacon);
  }

  const layer = {
    setCity(tn) {
      city = tn.city;
      state.clear();
      for (const v of big.values()) {
        group.remove(v.mesh);
        v.mesh.geometry.dispose();
      }
      big.clear();
      // Parked cars: random models and sober colours, fixed per town.
      parked = (tn.data.parked || []).map((p, i) => {
        const kind = ['car1', 'car2', 'suv', 'sports1', 'car2'][(i * 7 + 3) % 5];
        const colors = ['#C9CCD2', '#3F5A7A', '#7A2E2E', '#E8E4DA', '#2E3440', '#5B7F6A', '#B79C6B'];
        return { ...p, kind, color: colors[(i * 5 + 1) % colors.length] };
      });
    },
    frame(view) {
      if (!ready || !city) return;
      const night = R.style ? R.style.night : 0;
      blinkU.value = Math.floor(R.t * 4) % 2;
      for (const im of meshes.values()) im.count = 0;
      const add = (kind, x, y, z, ry, pitch, roll, paint, brake, head, beacon) => {
        const im = meshes.get(kind) || meshes.get('car1');
        if (!im || im.count >= CAP) return;
        put(im, im.count, x, y, z, ry, pitch, roll, paint, brake, head, beacon);
        im.count++;
      };
      for (const p of parked) add(p.kind, p.x, p.y + 0.0, p.z, p.ry, 0, 0, p.color, 0, 0, 0);
      const cars = (view.env && view.env.cars) || [];
      const dt = Math.max(0.001, R.dt || 0.016);
      const seen = new Set();
      for (const c of cars) {
        if (c.walker) continue;
        const id = c.kind === 'tram' ? 'tram' : c.id;
        seen.add(id);
        let st = state.get(id);
        if (!st) {
          st = { h: c.h, v: c.v, roll: 0, pitch: 0, brake: 0, kind: c.kind === 'car' ? carKind(c.id, city.town) : c.kind };
          state.set(id, st);
        }
        // Lean out of turns, dip under the brakes, rise when pulling away.
        let dh = c.h - st.h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        const yawRate = dh / dt;
        const accel = (c.v - st.v) / dt;
        st.h = c.h;
        st.v = c.v;
        const k = Math.min(1, dt * 7);
        const big2 = c.kind !== 'car';
        st.roll += (Math.max(-0.09, Math.min(0.09, -yawRate * (c.v / 100) * 0.05)) * (big2 ? 0.5 : 1) - st.roll) * k;
        st.pitch += (Math.max(-0.05, Math.min(0.05, accel * 0.0004)) - st.pitch) * k;
        const braking = c.v < 60 || accel < -40 ? 1 : 0;
        st.brake += (braking - st.brake) * Math.min(1, dt * 12);
        const x = c.x * S;
        const z = c.y * S;
        if (c.kind === 'car') {
          // Model forward is +z: heading 0 (east) is a quarter turn.
          add(st.kind, x, 0, z, Math.PI / 2 - c.h, -st.pitch, st.roll, c.color, st.brake, night, st.kind === 'police' ? 1 : 0);
        } else {
          let v = big.get(id);
          if (!v) {
            const g = vehicleGeometry(c.kind, c.color || (c.kind === 'tram' ? '#2FA36B' : '#F0B43C'));
            const mesh = new THREE.Mesh(g.geo, R.mats.town);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const lamps = [];
            for (const [kind2, list] of [
              ['head', g.lights.head],
              ['tail', g.lights.tail],
            ]) {
              for (const p of list) {
                const lm = new THREE.Mesh(lampGeo, lampMat.clone());
                lm.position.set(...p);
                lm.scale.set(0.6, 1, 1.4);
                lm.userData.kind = kind2;
                mesh.add(lm);
                lamps.push(lm);
              }
            }
            v = { mesh, lamps };
            big.set(id, v);
            group.add(mesh);
          }
          v.mesh.visible = true;
          v.mesh.position.set(x, 0, z);
          v.mesh.rotation.set(0, -c.h, 0, 'YXZ');
          v.mesh.rotation.z = st.pitch * 0.6;
          v.mesh.rotation.x = -st.roll;
          const bell = c.kind === 'tram' && c.bell > 0 && Math.floor(R.t * 6) % 2;
          for (const lm of v.lamps) {
            if (lm.userData.kind === 'head') lm.material.color.setRGB(1 + night * 3, 0.9 + night * 2.5, 0.7 + night * 1.6);
            else if (bell) lm.material.color.setRGB(3, 2.4, 0.6);
            else lm.material.color.setRGB(0.5 + st.brake * 3.5, 0.03, 0.02);
          }
        }
      }
      for (const [id, v] of big) if (!seen.has(id)) v.mesh.visible = false;
      for (const id of state.keys()) if (!seen.has(id)) state.delete(id);
      for (const im of meshes.values()) {
        im.instanceMatrix.needsUpdate = true;
        im.geometry.attributes.iPaint.needsUpdate = true;
        im.geometry.attributes.iLamp.needsUpdate = true;
      }
    },
  };
  return layer;
}
