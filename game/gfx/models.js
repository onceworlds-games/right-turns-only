// The bought-in models (Quaternius, CC0: see CREDITS.md): seven cars, eight people and two dogs, loaded once. Cars are
// flattened into one geometry each with a `part` attribute (paint, headlights, tail lights, glass) so a whole street of
// them draws as one instanced mesh; people and dogs keep their skeletons and clips and are cloned per person.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export const CAR_KINDS = ['car1', 'car2', 'suv', 'sports1', 'sports2', 'taxi', 'police'];
export const PEOPLE_KINDS = ['man', 'man2', 'man-long', 'man-suit', 'woman', 'woman-casual', 'woman-dress', 'woman-tank'];
export const DOG_KINDS = ['shiba', 'husky'];

// Which material is the paint (recoloured per car), which are lights and glass.
const PAINT = new Set(['Blue', 'LightBlue', 'White', 'Orange', 'Yellow']);
const PAINT_DARK = new Set(['DarkOrange']);
export const PART = { body: 0, paint: 1, head: 2, tail: 3, glass: 4, paintDark: 5, beacon: 6 };

let loading = null;
const lib = { ready: false, cars: new Map(), people: new Map(), dogs: new Map() };

function url(name) {
  return new URL(`models/${name}.glb`, document.baseURI).href;
}

/** Load everything (once). Resolves to the library; `lib.ready` turns true. Failing models are skipped. */
export function loadModels() {
  if (loading) return loading;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const get = (name) =>
    new Promise((resolve) => {
      loader.load(url(name), resolve, undefined, () => resolve(null));
    });
  loading = Promise.all([
    ...CAR_KINDS.map(async (k) => {
      const g = await get(k);
      if (g) lib.cars.set(k, flattenCar(g.scene, k));
    }),
    ...PEOPLE_KINDS.map(async (k) => {
      const g = await get(k);
      if (g) lib.people.set(k, rigged(g, 1.62));
    }),
    ...DOG_KINDS.map(async (k) => {
      const g = await get(k);
      if (g) lib.dogs.set(k, rigged(g, 0.62));
    }),
  ]).then(() => {
    lib.ready = true;
    return lib;
  });
  return loading;
}

export function models() {
  return lib;
}

/** One car as a single indexed geometry: position, normal, color (linear) and part. Forward is +z, wheels on y = 0. */
function flattenCar(scene, kind) {
  scene.updateMatrixWorld(true);
  const pos = [];
  const nor = [];
  const col = [];
  const part = [];
  const idx = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const m = o.material;
    const name = m.name || '';
    let p = PART.body;
    if (PAINT.has(name) && !(kind === 'taxi' && name !== 'Yellow')) p = PART.paint;
    else if (PAINT_DARK.has(name)) p = PART.paintDark;
    else if (name === 'Headlights' || name === 'WhiteLights') p = PART.head;
    else if (name === 'TailLights') p = PART.tail;
    else if (name === 'Windows') p = PART.glass;
    else if (name === 'BlueLights') p = PART.beacon;
    if (kind === 'police' && p === PART.paint) p = PART.body; // the police keep their white
    if (kind === 'taxi' && p === PART.paint) p = PART.body; // and the taxis their yellow
    const c = m.color.clone();
    const P = g.attributes.position;
    const N = g.attributes.normal;
    nm.getNormalMatrix(o.matrixWorld);
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
      pos.push(v.x, v.y, v.z);
      if (N) n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      else n.set(0, 1, 0);
      nor.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
      part.push(p);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  // Wheels on the ground, centred front to back.
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const size = new THREE.Vector3();
  geo.boundingBox.getSize(size);
  return { geo, len: size.z, wid: size.x, hgt: size.y };
}

/** A skinned model: its scene, clips by name and the scale that makes it `height` metres tall. */
function rigged(gltf, height) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const h = box.max.y - box.min.y || 1;
  const clips = new Map(gltf.animations.map((a) => [a.name, a]));
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
    }
  });
  return { scene, clips, scale: height / h, foot: -box.min.y * (height / h) };
}

/**
 * A new animated copy of a person or dog: { root, mixer, play(name, fade), mats }. Its materials are its own (they fade).
 */
export function spawnRigged(entry, opts = {}) {
  const inner = SkeletonUtils.clone(entry.scene);
  inner.scale.setScalar(entry.scale * (opts.scale || 1));
  inner.position.y = entry.foot * (opts.scale || 1);
  const root = new THREE.Group();
  root.add(inner);
  const mats = [];
  const named = [];
  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.roughness = 0.8;
    o.material.metalness = 0;
    if (/Skin/.test(o.material.name)) o.material.color.multiplyScalar(1.25);
    named.push({ m: o.material, n: o.material.name, base: o.material.color.clone() });
    mats.push(o.material);
    o.castShadow = true;
    o.receiveShadow = false;
  });
  /** Dress them: { top, top2, bottom } colours (left out: the model's own). */
  const tint = (t = {}) => {
    for (const { m, n, base } of named) {
      if (t.top && /^(Shirt|LightJacket|Dress)$/.test(n)) m.color.set(t.top);
      else if (t.top2 && /^(Jacket|Shirt2)$/.test(n)) m.color.set(t.top2);
      else if (t.bottom && n === 'Pants') m.color.set(t.bottom);
      else m.color.copy(base);
    }
  };
  tint(opts);
  const mixer = new THREE.AnimationMixer(inner);
  let current = null;
  let currentName = '';
  const play = (name, fade = 0.2, speed = 1) => {
    if (name === currentName) {
      if (current) current.timeScale = speed;
      return current;
    }
    const clip = entry.clips.get(name);
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.reset();
    a.timeScale = speed;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (current) a.crossFadeFrom(current, fade, false);
    a.play();
    current = a;
    currentName = name;
    return a;
  };
  let opacity = 1;
  const fade = (o) => {
    if (Math.abs(o - opacity) < 0.001) return;
    opacity = o;
    for (const m of mats) {
      m.transparent = o < 0.999;
      m.opacity = o;
      m.depthWrite = o > 0.5;
    }
    root.visible = o > 0.01;
  };
  return {
    root,
    mixer,
    play,
    fade,
    tint,
    stop() {
      mixer.stopAllAction();
      current = null;
      currentName = '';
    },
    get clip() {
      return currentName;
    },
    dispose() {
      mixer.stopAllAction();
      for (const m of mats) m.dispose();
    },
  };
}
