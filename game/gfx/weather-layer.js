// Weather round the camera, moved on the GPU: rain streaks and splashes in Rainmoor, snow in Frostby, sand storms
// blowing through Dustwater (the fog closes in and turns the colour of sand), leaves drifting down Maple Row and fireflies
// over the parks at dusk.

import * as THREE from 'three';
import { S } from './style.js';

const BOX = new THREE.Vector3(90, 34, 70);

function field(n, perVertex = 1) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * perVertex * 3);
  const end = new Float32Array(n * perVertex);
  const seed = new Float32Array(n * perVertex);
  for (let i = 0; i < n; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = Math.random();
    const s = Math.random();
    for (let k = 0; k < perVertex; k++) {
      const j = i * perVertex + k;
      pos[j * 3] = x;
      pos[j * 3 + 1] = y;
      pos[j * 3 + 2] = z;
      end[j] = k;
      seed[j] = s;
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const WRAP = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uPx;
attribute float aEnd;
attribute float aSeed;
vec3 wrapPos(vec3 p0, vec3 vel) {
  vec3 p = p0 * uBox + vel * (uTime + aSeed * 7.0);
  return uCenter + mod(p - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;
}
`;

function rainMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    vertexShader: `${WRAP}
varying float vA;
void main() {
  vec3 w = wrapPos(position, uVel);
  w.y = max(w.y, 0.0);
  w -= normalize(uVel) * 1.1 * aEnd;
  vA = (1.0 - aEnd) * 0.55 + 0.1;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`,
    fragmentShader: `uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, vA * 0.6); }`,
  });
}

function flakeMaterial(u, kind) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: kind === 'fly' ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `${WRAP}
uniform float uSize;
varying float vSeed;
varying float vSpin;
void main() {
  vec3 w = wrapPos(position, uVel);
  float t = uTime + aSeed * 40.0;
  w.x += sin(t * 0.9) * 0.9 + sin(t * 2.3) * 0.25;
  w.z += cos(t * 0.7) * 0.9;
  ${kind === 'fly' ? 'w.y = 0.6 + fract(aSeed * 13.7) * 3.0 + sin(t * 1.3) * 0.6;' : ''}
  vSeed = aSeed;
  vSpin = t;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPx * (0.6 + aSeed * 0.8) / -mv.z;
}`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uColor2; uniform float uTime; varying float vSeed; varying float vSpin;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  ${
    kind === 'leaf'
      ? `float c = cos(vSpin * 1.7), s = sin(vSpin * 1.7);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  q.x *= 1.0 + 0.8 * abs(sin(vSpin * 2.3));
  float d = length(q * vec2(1.0, 1.9)) * 2.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(mix(uColor, uColor2, fract(vSeed * 7.3)), 1.0);`
      : kind === 'fly'
        ? `float d = length(q) * 2.0;
  float a = smoothstep(1.0, 0.0, d) * (0.5 + 0.5 * sin(vSpin * 3.1));
  gl_FragColor = vec4(uColor * a * 3.0, a);`
        : `float d = length(q) * 2.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(uColor, smoothstep(1.0, 0.5, d) * 0.9);`
  }
}`,
  });
}

function splashMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    vertexShader: `${WRAP}
varying float vK;
void main() {
  vec3 w = wrapPos(position, vec3(0.0));
  w.y = 0.06;
  float k = fract(uTime * 1.6 + aSeed * 11.0);
  vK = k;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.25 + k * 1.1) * uPx / -mv.z;
}`,
    fragmentShader: `uniform vec3 uColor; varying float vK;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float ring = smoothstep(0.65, 0.85, d) * smoothstep(1.0, 0.88, d);
  gl_FragColor = vec4(uColor, ring * (1.0 - vK) * 0.7);
}`,
  });
}

export function createWeatherLayer(R) {
  const group = new THREE.Group();
  R.scene.add(group);
  const common = () => ({ uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: BOX }, uVel: { value: new THREE.Vector3() }, uPx: { value: 600 } });
  const rainU = { ...common(), uColor: { value: new THREE.Color('#C8D8EA') } };
  rainU.uVel.value.set(3.5, -24, 2);
  const rain = new THREE.LineSegments(field(3200, 2), rainMaterial(rainU));
  const splashU = { ...common(), uColor: { value: new THREE.Color('#D8E6F2') } };
  const splash = new THREE.Points(field(900), splashMaterial(splashU));
  const snowU = { ...common(), uColor: { value: new THREE.Color('#ffffff') }, uColor2: { value: new THREE.Color('#ffffff') }, uSize: { value: 0.22 } };
  snowU.uVel.value.set(1.2, -2.2, 0.4);
  const snow = new THREE.Points(field(2600), flakeMaterial(snowU, 'snow'));
  const dustU = { ...common(), uColor: { value: new THREE.Color('#E2C08E') }, uColor2: { value: new THREE.Color('#E2C08E') }, uSize: { value: 0.16 } };
  dustU.uVel.value.set(26, -1.2, 6);
  const dust = new THREE.Points(field(3000), flakeMaterial(dustU, 'snow'));
  const leafU = { ...common(), uColor: { value: new THREE.Color('#E0782A') }, uColor2: { value: new THREE.Color('#C9452B') }, uSize: { value: 0.42 } };
  leafU.uVel.value.set(1.6, -1.3, 0.6);
  const leaves = new THREE.Points(field(160), flakeMaterial(leafU, 'leaf'));
  const flyU = { ...common(), uColor: { value: new THREE.Color('#FFE58A') }, uColor2: { value: new THREE.Color('#FFE58A') }, uSize: { value: 0.3 } };
  flyU.uVel.value.set(0.3, 0, 0.2);
  const flies = new THREE.Points(field(220), flakeMaterial(flyU, 'fly'));
  const all = [
    [rain, rainU],
    [splash, splashU],
    [snow, snowU],
    [dust, dustU],
    [leaves, leafU],
    [flies, flyU],
  ];
  for (const [m] of all) {
    m.frustumCulled = false;
    m.renderOrder = 6;
    m.visible = false;
    group.add(m);
  }
  const fogBase = new THREE.Color();
  const sand = new THREE.Color('#D2AE78');
  let town = null;

  return {
    setCity(tn) {
      town = tn.city.town;
    },
    frame(view) {
      if (!town) return;
      const cam = view.cam || { x: 0, y: 0 };
      const cx = cam.x * S;
      const cz = cam.y * S;
      const t = performance.now() / 1000;
      const px = (R.h * R.pr) / (2 * Math.tan((R.camera.fov * Math.PI) / 360));
      const reduced = !!view.reduced || R.quality === 'low';
      for (const [, u] of all) {
        u.uTime.value = t;
        u.uCenter.value.set(cx, BOX.y / 2, cz);
        u.uPx.value = px;
      }
      rain.visible = splash.visible = !!view.rain || !!town.rain;
      snow.visible = !!view.snow || !!town.snow;
      leaves.visible = town.id === 1 || town.id === 2;
      flies.visible = !!town.dusk || town.id === 2;
      rain.geometry.setDrawRange(0, reduced ? 2000 : Infinity);
      snow.geometry.setDrawRange(0, reduced ? 900 : Infinity);
      // Sand storms: a cloud of blowing sand, the fog closing in, the colour of the air turning to sand.
      const d = view.dust || 0;
      dust.visible = d > 0.02;
      dust.material.opacity = d;
      dustU.uColor.value.copy(sand).multiplyScalar(0.9 + 0.2 * d);
      if (d > 0 && R.scene.fog) {
        fogBase.copy(R.scene.fog.color);
        R.scene.fog.color.lerp(sand, d * 0.85);
        R.scene.fog.near *= 1 - d * 0.75;
        R.scene.fog.far *= 1 - d * 0.55;
        dust.geometry.setDrawRange(0, Math.floor(3000 * d));
      }
    },
  };
}
