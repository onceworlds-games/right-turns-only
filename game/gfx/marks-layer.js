// What the game marks on the town: rings round the open addresses (dashes turning clockwise, the doormat line, a glow),
// parcels floating over the houses on a pillar of light, the depot's loading box, rivals' chevrons, and words sprayed on
// the road (each a decal with its own little canvas).

import * as THREE from 'three';
import { DELIVERY } from '../config.js';
import { S } from './style.js';
import { parcelGeometry } from './van.js';
import { drawPaint, font } from '../draw2d.js';
import { patch } from './material.js';

const DECAL_VERT = /* glsl */ `
varying vec2 vP;
#include <common>
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uGold;
uniform float uR;
uniform float uMat;
uniform float uAlpha;
uniform float uSpin;
varying vec2 vP;
void main() {
  float d = length(vP);
  if (d > uR + 0.6) discard;
  float a = atan(-vP.y, vP.x);
  float pulse = 0.5 + 0.5 * sin(uTime * 4.0 + uSpin);
  float fill = (0.1 + pulse * 0.08) * smoothstep(uR, uR * 0.15, d);
  float w = uGold > 0.5 ? 0.95 : 0.7;
  float ring = smoothstep(w * 0.5, w * 0.5 - 0.1, abs(d - (uR - 0.45)));
  float dash = smoothstep(0.32, 0.38, fract(a / 6.2831853 * 16.0 - uTime * 0.55));
  ring *= dash;
  float matl = smoothstep(0.17, 0.08, abs(d - uMat));
  float dotc = smoothstep(0.75, 0.65, d);
  float alpha = max(fill, max(ring, max(matl * 0.9, dotc)));
  vec3 c = uColor * (1.0 + ring * 0.6 + uGold * ring * 1.5);
  c = mix(c, vec3(0.95, 0.94, 0.9) * 1.2, matl * (1.0 - ring));
  gl_FragColor = vec4(c, alpha * uAlpha);
}
`;

const BOX_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uR;
varying vec2 vP;
void main() {
  vec2 q = abs(vP);
  float d = max(q.x, q.y);
  float band = smoothstep(0.45, 0.33, abs(d - uR));
  float per = (q.x > q.y ? vP.y * sign(vP.x) : -vP.x * sign(vP.y)) + (q.x > q.y ? (vP.x > 0.0 ? 0.0 : 2.0) : (vP.y > 0.0 ? 1.0 : 3.0)) * uR * 2.0;
  float dash = smoothstep(0.3, 0.38, fract(per / 1.6 - uTime * 0.9));
  float pulse = 0.65 + 0.35 * sin(uTime * 5.0);
  float fill = smoothstep(uR, uR - 2.0, d) * 0.12 * pulse;
  float a = max(band * dash * pulse, fill);
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * (1.0 + band), a);
}
`;

const PILLAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv2;
void main() {
  float y = vUv2.y;
  float edge = 1.0 - abs(vUv2.x - 0.5) * 2.0;
  float a = (1.0 - y * 0.85) * (0.5 + 0.18 * sin(uTime * 3.0 + y * 8.0)) * smoothstep(0.0, 0.6, edge);
  gl_FragColor = vec4(uColor * 1.8, a);
}
`;

export function createMarksLayer(R) {
  const group = new THREE.Group();
  R.scene.add(group);
  const time = { value: 0 };
  const RING = DELIVERY.ring * S;
  const ringGeo = new THREE.PlaneGeometry(RING * 2 + 1.4, RING * 2 + 1.4);
  const rings = [];
  const ringMat = () =>
    new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT,
      fragmentShader: RING_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uTime: time, uGold: { value: 0 }, uR: { value: 7 }, uMat: { value: 2.8 }, uAlpha: { value: 1 }, uSpin: { value: 0 } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
  const ring = (i) => {
    if (!rings[i]) {
      const m = new THREE.Mesh(ringGeo, ringMat());
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 2;
      group.add(m);
      rings[i] = m;
    }
    return rings[i];
  };
  // Beacons: a parcel turning in the air over the house, a pillar of light under it.
  const beacons = [];
  // Wider at the foot: a cone of light standing on the doormat.
  const pillarGeo = new THREE.CylinderGeometry(0.3, 0.75, 1, 20, 1, true);
  pillarGeo.translate(0, 0.5, 0);
  const pillarMat = (color) =>
    new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv2; void main(){ vUv2 = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: PILLAR_FRAG,
      uniforms: { uColor: { value: new THREE.Color(color) }, uTime: time },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  const parcelMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: new THREE.Color('#000000') }), { patterns: false });
  // A soft glow behind the parcel so it reads from far away and at night.
  const haloTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const beacon = (i) => {
    if (!beacons[i]) {
      const g = new THREE.Group();
      const p = new THREE.Mesh(parcelGeometry(false), parcelMat);
      p.scale.setScalar(2.8);
      p.castShadow = true;
      const gp = new THREE.Mesh(parcelGeometry(true), parcelMat);
      gp.scale.setScalar(3.2);
      gp.castShadow = true;
      const pil = new THREE.Mesh(pillarGeo, pillarMat('#FFC22E'));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: '#FFC22E', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      halo.scale.set(5.5, 5.5, 1);
      halo.renderOrder = 3;
      g.add(p, gp, pil, halo);
      group.add(g);
      beacons[i] = { g, p, gp, pil, halo };
    }
    return beacons[i];
  };
  // The depot's loading box.
  const box = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.ShaderMaterial({ vertexShader: DECAL_VERT, fragmentShader: BOX_FRAG, uniforms: { uColor: { value: new THREE.Color('#3D7BFF') }, uTime: time, uR: { value: (DELIVERY.depotZone + 4) * S } }, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  box.rotation.x = -Math.PI / 2;
  box.renderOrder = 2;
  group.add(box);
  // Chevrons.
  const chevGeo = new THREE.BufferGeometry();
  chevGeo.setAttribute('position', new THREE.Float32BufferAttribute([1.3, 0, 0, -0.7, 0, -1.1, -0.25, 0, 0, 1.3, 0, 0, -0.25, 0, 0, -0.7, 0, 1.1], 3));
  chevGeo.computeVertexNormals();
  const chevs = [];
  // Painted words.
  const decals = new Map(); // paint object → { mesh, canvas, tex, wipe }

  const keyOf = (p) => `${(p.lines || [p.text]).join('/')}|${p.arrow ? 'a' : ''}|${p.color || ''}|${p.upright ? 1 : 0}|${Math.round((p.h || 0) * 100)}|${p.width || ''}|${p.max || ''}|${p.size || ''}`;

  function paintDecal(p) {
    let d = decals.get(p);
    const key = keyOf(p);
    if (!d || d.key !== key) {
      if (d) {
        group.remove(d.mesh);
        d.tex.dispose();
        d.mesh.material.dispose();
        d.mesh.geometry.dispose();
      }
      // Size the decal to the words: the widest line fills `width`, lines stack along the road.
      const g0 = document.createElement('canvas').getContext('2d');
      const lines = p.lines || [p.text];
      g0.font = font(900, 100);
      let widest = 1;
      for (const l of lines) widest = Math.max(widest, g0.measureText(l).width);
      const width = p.width || 104;
      const size = Math.min(p.max || 60, (100 * width) / widest);
      const total = size * (p.stretch || 1.45) * 0.98 * lines.length;
      const ext = p.arrow ? (p.size || 40) * 2.4 : Math.max(width + 50, total + 30) * 1.05;
      const px = Math.min(1536, Math.ceil(ext * 2.2));
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = patch(new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { patterns: false });
      const geo = new THREE.PlaneGeometry(ext * S, ext * S);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      mesh.receiveShadow = true;
      group.add(mesh);
      d = { mesh, canvas, tex, key, ext, wipe: -1 };
      decals.set(p, d);
    }
    const wipe = p.wipe === undefined ? 1 : p.wipe;
    if (Math.abs(wipe - d.wipe) > 0.001) {
      d.wipe = wipe;
      const g = d.canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, d.canvas.width, d.canvas.height);
      const k = d.canvas.width / d.ext;
      g.setTransform(k, 0, 0, k, d.canvas.width / 2, d.canvas.height / 2);
      drawPaint(g, { ...p, x: 0, y: 0, alpha: 1, wipe });
      d.tex.needsUpdate = true;
    }
    d.mesh.position.set(p.x * S, 0.022, p.y * S);
    d.mesh.material.opacity = p.alpha ?? 1;
    d.mesh.visible = true;
    d.seen = true;
  }

  return {
    setCity() {
      for (const d of decals.values()) {
        group.remove(d.mesh);
        d.tex.dispose();
      }
      decals.clear();
    },
    frame(view, R2) {
      time.value = performance.now() / 1000;
      // Rings.
      const rs = view.rings || [];
      rs.forEach((r, i) => {
        const m = ring(i);
        m.visible = true;
        const R0 = RING;
        m.position.set(r.x * S, 0.03, r.y * S);
        const u = m.material.uniforms;
        u.uColor.value.set(r.gold ? '#FFD23F' : r.color || '#FFC22E');
        u.uGold.value = r.gold ? 1 : 0;
        u.uR.value = R0;
        u.uMat.value = DELIVERY.mat * S;
        u.uAlpha.value = r.alpha ?? 1;
        u.uSpin.value = r.x * 0.01;
      });
      for (let i = rs.length; i < rings.length; i++) rings[i].visible = false;
      // Beacons.
      const bs = view.beacons || [];
      const t = R2.t;
      bs.forEach((b, i) => {
        const bc = beacon(i);
        bc.g.visible = true;
        const hgt = b.height || 8.6;
        const bob = Math.sin(time.value * 2.6 + b.x * 0.02) * 0.35;
        bc.g.position.set(b.x * S, 0, b.y * S);
        bc.p.visible = !b.gold;
        bc.gp.visible = !!b.gold;
        const pm = b.gold ? bc.gp : bc.p;
        if (!b.gold) pm.geometry = parcelGeometry(false, b.wrap);
        pm.scale.setScalar((b.gold ? 3.2 : 2.8) * (b.size || 1));
        pm.position.set(0, hgt + bob, 0);
        pm.rotation.y = time.value * 1.4 + i;
        pm.rotation.z = Math.sin(time.value * 1.9 + i) * 0.15;
        bc.pil.scale.set(1, hgt, 1);
        bc.pil.material.uniforms.uColor.value.set(b.gold ? '#FFD23F' : b.color || '#FFC22E');
        bc.halo.position.set(0, hgt + bob + 0.4, 0);
        const pulse = 1 + Math.sin(time.value * 4 + i) * 0.08;
        bc.halo.scale.setScalar((b.gold ? 7 : 5.5) * pulse * (b.scale || 1));
        bc.halo.material.color.set(b.gold ? '#FFD23F' : b.color || '#FFC22E');
        bc.halo.material.opacity = 0.55 + R2.style.night * 0.35;
      });
      for (let i = bs.length; i < beacons.length; i++) beacons[i].g.visible = false;
      void t;
      // The depot box.
      box.visible = !!view.depotGlow && !!R.city;
      if (box.visible) box.position.set(R.city.depot.x * S, 0.035, R.city.depot.y * S);
      // Chevrons.
      const cs = view.chevrons || [];
      cs.forEach((c, i) => {
        if (!chevs[i]) {
          chevs[i] = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, side: THREE.DoubleSide }));
          group.add(chevs[i]);
        }
        const m = chevs[i];
        m.visible = true;
        m.position.set(c.x * S, 0.06, c.y * S);
        m.rotation.y = -c.h;
        m.material.color.set(c.color);
      });
      for (let i = cs.length; i < chevs.length; i++) chevs[i].visible = false;
      // Paint.
      for (const d of decals.values()) d.seen = false;
      const shown = (view.paint || []).filter((p) => p.alpha > 0);
      // A view may hand over the same words as new objects each frame: those take over the decal already painted rather
      // than painting (and uploading) a new one every frame.
      const current = new Set(shown);
      for (const p of shown) {
        if (decals.has(p)) continue;
        const key = keyOf(p);
        for (const [q, d] of decals) {
          if (current.has(q) || d.key !== key) continue;
          decals.delete(q);
          decals.set(p, d);
          break;
        }
      }
      for (const p of shown) paintDecal(p);
      for (const [p, d] of decals) {
        if (d.seen) continue;
        group.remove(d.mesh);
        d.tex.dispose();
        d.mesh.material.dispose();
        d.mesh.geometry.dispose();
        decals.delete(p);
      }
    },
  };
}
