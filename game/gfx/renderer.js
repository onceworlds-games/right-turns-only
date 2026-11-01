// The world in 3D. Draws whatever it is handed (a view, the same shape the game always built) and decides nothing about
// the game: the town is built once per town, then each frame places the camera, the sun and its shadows, the lamps at
// night, traffic lights, doors and bridges, and hands vans, traffic, people and effects to their own modules. A 2D canvas
// over the top carries the HUD.

import * as THREE from 'three';
import { T, clamp } from '../config.js';
import { lightState, bridgeState } from '../city.js';
import { S, styleFor } from './style.js';
import { buildTown, TS, KERB, WATER_Y } from './town.js';
import { townMaterial, foliageMaterial, litMaterial, shared, MAX_LAMPS, patch } from './material.js';
import { signAtlas } from './signs.js';
import { createPost } from './post.js';
import { Builder, SURF, shade } from './build.js';

const PITCH = (59 * Math.PI) / 180;
const FOV = 30;

export function createRenderer(hud, opts = {}) {
  const gl = document.createElement('canvas');
  gl.id = 'gl';
  hud.parentNode.insertBefore(gl, hud);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: !!opts.preserve });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  const ctx = hud.getContext('2d');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 2, 2000);
  const sun = new THREE.DirectionalLight('#ffffff', 2.5);
  sun.castShadow = true;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#ffffff', '#666666', 1);
  scene.add(hemi);
  const post = createPost(renderer);
  const pmrem = new THREE.PMREMGenerator(renderer);

  const mats = {
    town: townMaterial(),
    leaves: foliageMaterial(),
    signs: patch(new THREE.MeshStandardMaterial({ map: signAtlas().tex, emissiveMap: signAtlas().tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.1, roughness: 0.55 }), { patterns: false }),
    water: waterMaterial(),
    ground: new THREE.MeshStandardMaterial({ color: '#777777', roughness: 1 }),
    lens: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    door: litMaterial({ color: '#ffffff', roughness: 0.6 }),
    leaf: litMaterial({ vertexColors: true, roughness: 0.6 }),
  };

  const R = {
    cv: hud,
    ctx,
    gl,
    three: renderer,
    scene,
    camera,
    w: 1,
    h: 1,
    pr: 1,
    city: null,
    town: null, // the built town (see makeTown)
    style: null,
    quality: 'high',
    chunks: { clear: () => signAtlas().redraw() },
    layers: [], // { setCity(town), frame(view, ctx) } from the other modules
    mats,
    focus: null,
    t: 0,
  };

  const towns = new Map(); // city → built town, the last few
  const envs = new Map();

  R.resize = (w, h, pr) => {
    R.w = Math.max(1, w);
    R.h = Math.max(1, h);
    R.pr = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(R.w, R.h, false);
    hud.width = Math.round(R.w * pr);
    hud.height = Math.round(R.h * pr);
    camera.aspect = R.w / R.h;
    camera.updateProjectionMatrix();
  };

  // ---------------------------------------------------------------- towns

  function makeTown(city) {
    const style = styleFor(city.town);
    const data = buildTown(city, style);
    const group = new THREE.Group();
    for (const c of data.chunks.values()) {
      if (c.main.count) {
        const m = new THREE.Mesh(c.main.toGeometry(), mats.town);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
      if (c.leaves.count) {
        const m = new THREE.Mesh(c.leaves.toGeometry(), mats.leaves);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
    }
    if (data.signs.pos.length) {
      const m = new THREE.Mesh(data.signs.toGeometry(), mats.signs);
      m.receiveShadow = true;
      group.add(m);
    }
    // Water under everything (it shows where the ground is water), or a far field beyond the edge of town.
    const wx = data.water;
    if (data.outside === 'w' || city.chars.includes('w')) {
      const g = new THREE.PlaneGeometry(wx.x1 - wx.x0 + 1600, wx.z1 - wx.z0 + 1600);
      g.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(g, mats.water);
      water.position.set((wx.x0 + wx.x1) / 2, WATER_Y + 0.25, (wx.z0 + wx.z1) / 2);
      water.receiveShadow = true;
      group.add(water);
      // The bed under the water, dark.
      const bed = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: shade(city.town.palette.water, -0.6) }));
      bed.position.copy(water.position);
      bed.position.y = WATER_Y - 1.5;
      group.add(bed);
    }
    if (data.outside !== 'w') {
      const g = new THREE.PlaneGeometry(3000, 3000);
      g.rotateX(-Math.PI / 2);
      const col = data.edgeKind === 'city' ? '#5E5B58' : data.edgeKind === 'desert' ? city.town.palette.lawn : data.edgeKind === 'snow' ? '#E8EEF3' : shade(city.town.palette.lawn, -0.15);
      const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 1 }));
      ground.position.set((wx.x0 + wx.x1) / 2, -0.08, (wx.z0 + wx.z1) / 2);
      ground.receiveShadow = true;
      group.add(ground);
    }
    // Traffic light lenses (3 per head), zebra beacons, doors, drawbridge leaves.
    const dyn = { heads: null, beacons: null, doors: null, bridges: [] };
    if (data.heads.length) {
      const lens = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 12);
      lens.rotateX(Math.PI / 2);
      const im = new THREE.InstancedMesh(lens, mats.lens, data.heads.length * 3);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      data.heads.forEach((hd, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hd.ry);
        for (let k = 0; k < 3; k++) {
          const local = new THREE.Vector3(0, 3.98 - k * 0.38, 0.31).applyQuaternion(q);
          m.compose(new THREE.Vector3(hd.x + local.x, local.y, hd.z + local.z), q, new THREE.Vector3(1, 1, 1));
          im.setMatrixAt(i * 3 + k, m);
          im.setColorAt(i * 3 + k, new THREE.Color(0.05, 0.05, 0.05));
        }
      });
      im.frustumCulled = false;
      group.add(im);
      dyn.heads = im;
    }
    if (data.beacons.length) {
      const g = new THREE.SphereGeometry(0.24, 12, 8);
      const im = new THREE.InstancedMesh(g, mats.lens, data.beacons.length);
      const m = new THREE.Matrix4();
      data.beacons.forEach((bc, i) => {
        m.makeTranslation(bc.x, bc.y, bc.z);
        im.setMatrixAt(i, m);
        im.setColorAt(i, new THREE.Color(1, 0.6, 0.1));
      });
      im.frustumCulled = false;
      group.add(im);
      dyn.beacons = im;
    }
    const doors = data.doors.filter((d) => !d.hidden);
    if (doors.length) {
      const g = new THREE.BoxGeometry(1, 1, 0.08);
      g.translate(0.5, 0.5, 0);
      const im = new THREE.InstancedMesh(g, mats.door, doors.length);
      im.castShadow = true;
      im.receiveShadow = true;
      doors.forEach((d, i) => {
        d.angle = 0;
        d.target = 0;
        d.index = i;
        setDoor(im, d);
        im.setColorAt(i, new THREE.Color(d.color));
      });
      group.add(im);
      dyn.doors = im;
      dyn.doorList = doors;
      dyn.doorByHouse = new Map(doors.filter((d) => d.house >= 0).map((d) => [d.house, d]));
    }
    for (const br of data.bridges) dyn.bridges.push(makeDrawbridge(br, city, group));
    return { city, style, data, group, dyn, env: envFor(city, style) };
  }

  function setDoor(im, d) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.ry + d.angle);
    m.compose(new THREE.Vector3(d.x, d.y + 0.02, d.z), q, new THREE.Vector3(d.w, d.h - 0.04, 1));
    im.setMatrixAt(d.index, m);
    im.instanceMatrix.needsUpdate = true;
  }

  function makeDrawbridge(br, city, group) {
    const leaves = [];
    for (const s of [-1, 1]) {
      const b = new Builder();
      // A leaf: 6 m long from its hinge (at the tile's end) to the middle, the whole width.
      b.box(-s * 3, -0.45, 0, 6, 0.45, 11.6, city.town.palette.asphalt, { top: city.town.palette.asphalt, topSurf: SURF.asphalt });
      b.box(-s * 3, 0, -5.6, 6, 0.12, 0.3, '#C9A13A');
      b.box(-s * 3, 0, 5.6, 6, 0.12, 0.3, '#C9A13A');
      for (let k = 0; k < 2; k++) b.ground(-s * 3 - 1.1 + k * 2.2 - 0.15 - s * 0, -0.15, -s * 3 - 1.1 + k * 2.2 + 0.15, 0.15, 0.01, '#ECE8DC');
      const geo = b.toGeometry();
      const mesh = new THREE.Mesh(geo, mats.town);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const pivot = new THREE.Group();
      pivot.position.set(br.x + (br.horiz ? s * 6 : 0), 0, br.z + (br.horiz ? 0 : s * 6));
      pivot.rotation.y = br.horiz ? 0 : Math.PI / 2;
      const hinge = new THREE.Group();
      hinge.add(mesh);
      pivot.add(hinge);
      group.add(pivot);
      leaves.push({ hinge, s });
    }
    // Barriers either side with warning lights.
    const bars = [];
    for (const s of [-1, 1]) {
      const b = new Builder();
      for (let k = 0; k < 6; k++) b.box(0, 0, -0.8 - k * 0.9, 0.12, 0.14, 0.9, k % 2 ? '#F4F1E8' : '#D9573B');
      const arm = new THREE.Mesh(b.toGeometry(), mats.town);
      const post = new THREE.Group();
      const ox = br.horiz ? s * 7.0 : (s < 0 ? -5.4 : 5.4);
      const oz = br.horiz ? (s < 0 ? -5.4 : 5.4) : s * 7.0;
      post.position.set(br.x + ox, 1.0, br.z + oz);
      post.rotation.y = br.horiz ? (s < 0 ? Math.PI : 0) : s < 0 ? -Math.PI / 2 : Math.PI / 2;
      post.add(arm);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mats.lens.clone());
      lamp.position.set(0, 0.4, 0);
      post.add(lamp);
      group.add(post);
      bars.push({ post, arm, lamp });
    }
    return { br, leaves, bars };
  }

  /** A soft sky for reflections and fill light: the town's sky colour above, its ground below, the sun bright. */
  function envFor(city, style) {
    const key = city.town.id;
    if (envs.has(key)) return envs.get(key);
    const s = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 32, 16);
    const sky = new THREE.Color(style.sky);
    const fog = new THREE.Color(style.fog);
    const grd = new THREE.Color(style.ground);
    const sunCol = new THREE.Color(style.sun.color);
    const dir = sunDir(style);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uSky: { value: sky }, uFog: { value: fog }, uGround: { value: grd }, uSun: { value: sunCol }, uDir: { value: dir }, uNight: { value: style.night } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uSky; uniform vec3 uFog; uniform vec3 uGround; uniform vec3 uSun; uniform vec3 uDir; uniform float uNight; varying vec3 vDir;
        void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(uFog, uSky, smoothstep(0.0, 0.6, y)) : mix(uFog, uGround * 0.6, smoothstep(0.0, -0.4, y));
        float s = max(0.0, dot(normalize(vDir), normalize(uDir)));
        c += uSun * (pow(s, 64.0) * 6.0 + pow(s, 6.0) * 0.4) * (1.0 - uNight * 0.85);
        gl_FragColor = vec4(c, 1.0); }`,
    });
    s.add(new THREE.Mesh(geo, mat));
    const rt = pmrem.fromScene(s, 0.02);
    geo.dispose();
    mat.dispose();
    envs.set(key, rt.texture);
    return rt.texture;
  }

  function sunDir(style) {
    const a = style.sun.azimuth;
    const e = style.sun.elevation;
    return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
  }

  /** Use a town (built once, kept while recently used). */
  R.setCity = (city) => {
    if (R.city === city) return;
    R.city = city;
    let tn = towns.get(city);
    if (!tn) {
      tn = makeTown(city);
      towns.set(city, tn);
      if (towns.size > 3) {
        for (const [k, v] of towns) {
          if (v === tn || v === R.town) continue;
          disposeTown(v);
          towns.delete(k);
          break;
        }
      }
    }
    if (R.town) scene.remove(R.town.group);
    R.town = tn;
    R.style = tn.style;
    scene.add(tn.group);
    applyStyle(tn.style, city);
    for (const l of R.layers) if (l.setCity) l.setCity(tn);
  };

  function disposeTown(tn) {
    tn.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }

  function applyStyle(st, city) {
    sun.color.set(st.sun.color);
    sun.intensity = st.sun.intensity;
    hemi.color.set(st.sky);
    waterSky.value.set(st.sky);
    hemi.groundColor.set(st.ground);
    hemi.intensity = st.hemi * 0.55;
    scene.background = new THREE.Color(st.fog);
    scene.fog = new THREE.Fog(st.fog, st.fogNear, st.fogFar);
    scene.environment = R.town.env;
    scene.environmentIntensity = 0.55 * (1 - st.night * 0.7);
    shared.uNight.value = st.night;
    shared.uWet.value = st.wet;
    shared.uSnow.value = st.snow;
    shared.uLampPower.value = st.night * 5;
    mats.signs.emissiveIntensity = 0.08 + st.night * (city.town.night ? 2.4 : 1.2);
    mats.water.color.set(city.town.palette.water);
    const g = post.final.uniforms;
    g.uSat.value = st.grade.sat;
    g.uContrast.value = st.grade.contrast;
    g.uVignette.value = st.grade.vignette;
    g.uLift.value.set(...st.grade.lift);
    g.uGain.value.set(...st.grade.gain);
    g.uExposure.value = st.exposure;
    g.uBloom.value = 0.12 + st.bloom * 0.5;
  }

  // ---------------------------------------------------------------- marks (skid marks, tracks in the snow)

  R.clearMarks = () => {
    for (const l of R.layers) if (l.clearMarks) l.clearMarks();
  };
  R.mark = (x, y, h, kind) => {
    for (const l of R.layers) if (l.mark) l.mark(x, y, h, kind);
  };

  // ---------------------------------------------------------------- the camera

  const tmpV = new THREE.Vector3();
  /** World px (and a height in metres) to CSS px on screen. */
  R.toScreen = (x, y, hgt = 0) => {
    tmpV.set(x * S, hgt, y * S).project(camera);
    return [((tmpV.x + 1) / 2) * R.w, ((1 - tmpV.y) / 2) * R.h, tmpV.z];
  };
  /** The ground point (world px) under a screen point. */
  R.toWorld = (sx, sy) => {
    tmpV.set((sx / R.w) * 2 - 1, 1 - (sy / R.h) * 2, 0.5).unproject(camera);
    const o = camera.position;
    const d = tmpV.sub(o).normalize();
    const t = -o.y / d.y;
    return [(o.x + d.x * t) / S, (o.z + d.z * t) / S];
  };

  function placeCamera(cam) {
    const z = Math.max(0.02, cam.zoom || 1);
    const sx = (cam.shake && cam.shake[0]) || 0;
    const sy = (cam.shake && cam.shake[1]) || 0;
    const tx = (cam.x + sx) * S;
    const tz = (cam.y + sy) * S;
    const viewH = (R.h / z) * S;
    const pitch = cam.pitch ?? PITCH;
    const fov = (camera.fov * Math.PI) / 180;
    const dist = (viewH * Math.sin(pitch)) / (2 * Math.tan(fov / 2));
    const yaw = cam.yaw || 0;
    camera.position.set(tx + Math.sin(yaw) * dist * Math.cos(pitch), dist * Math.sin(pitch), tz + Math.cos(yaw) * dist * Math.cos(pitch));
    camera.up.set(0, 1, 0);
    camera.lookAt(tx, 0, tz);
    if (cam.roll) camera.rotateZ(cam.roll);
    camera.near = Math.max(1, dist * 0.2);
    camera.far = dist * 3 + 600;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return { tx, tz, dist, viewH };
  }

  function placeSun(st, tx, tz, viewH) {
    const dir = sunDir(st);
    const half = clamp(viewH * (R.w / R.h) * 0.62 + 8, 22, 220);
    const sc = sun.shadow.camera;
    const size = R.quality === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    // Snap the shadow camera to its texels so shadows don't crawl.
    const texel = (half * 2) / size;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const fwd = new THREE.Vector3().crossVectors(dir, right).normalize();
    const p = new THREE.Vector3(tx, 0, tz);
    const a = Math.round(p.dot(right) / texel) * texel;
    const b = Math.round(p.dot(fwd) / texel) * texel;
    const c = p.dot(dir);
    p.copy(right).multiplyScalar(a).addScaledVector(fwd, b).addScaledVector(dir, c);
    sun.target.position.copy(p);
    sun.position.copy(p).addScaledVector(dir, 160);
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 10;
    sc.far = 360;
    sc.updateProjectionMatrix();
    sun.shadow.normalBias = 0.02 + half * 0.0012;
    sun.target.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- lamps at night

  const lampV = new THREE.Vector3();
  function placeLamps(tx, tz) {
    const tn = R.town;
    if (!tn || !(shared.uNight.value > 0)) {
      shared.uLampCount.value = 0;
      return;
    }
    const all = tn.lampList || (tn.lampList = tn.data.lamps.concat(tn.data.porch));
    const pick = all
      .map((l) => ({ l, d: (l.x - tx) ** 2 + (l.z - tz) ** 2 - (l.r > 6 ? 600 : 0) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_LAMPS);
    pick.forEach(({ l }, i) => {
      lampV.set(l.x, l.y, l.z).applyMatrix4(camera.matrixWorldInverse);
      shared.uLamps.value[i].set(lampV.x, lampV.y, lampV.z, l.r);
    });
    shared.uLampCount.value = pick.length;
  }

  // ---------------------------------------------------------------- the frame

  const RED = new THREE.Color(5, 0.35, 0.2);
  const AMBER = new THREE.Color(5, 2.2, 0.2);
  const GREEN = new THREE.Color(0.3, 4.5, 1.4);
  const OFF = new THREE.Color(0.05, 0.05, 0.05);
  const OFF_R = new THREE.Color(0.18, 0.03, 0.03);
  const OFF_A = new THREE.Color(0.18, 0.12, 0.02);
  const OFF_G = new THREE.Color(0.03, 0.14, 0.06);

  function dynamics(view, t) {
    const tn = R.town;
    const dyn = tn.dyn;
    if (dyn.heads) {
      tn.data.heads.forEach((hd, i) => {
        const st = hd.light ? lightState(hd.light, t) : { axis: 'v', color: 'red' };
        const mine = st.axis === hd.axis;
        const on = mine ? st.color : 'red';
        dyn.heads.setColorAt(i * 3, on === 'red' ? RED : OFF_R);
        dyn.heads.setColorAt(i * 3 + 1, on === 'amber' ? AMBER : OFF_A);
        dyn.heads.setColorAt(i * 3 + 2, on === 'green' ? GREEN : OFF_G);
      });
      dyn.heads.instanceColor.needsUpdate = true;
    }
    if (dyn.beacons) {
      const on = Math.floor(t * 1.6) % 2 === 0;
      const c = on ? AMBER : OFF_A;
      for (let i = 0; i < tn.data.beacons.length; i++) dyn.beacons.setColorAt(i, c);
      dyn.beacons.instanceColor.needsUpdate = true;
    }
    if (dyn.doors) {
      let any = false;
      for (const d of dyn.doorList) {
        if (Math.abs(d.angle - d.target) < 0.001) continue;
        d.angle += (d.target - d.angle) * Math.min(1, R.dt * 9);
        if (Math.abs(d.angle - d.target) < 0.002) d.angle = d.target;
        setDoor(dyn.doors, d);
        any = true;
      }
      void any;
    }
    if (dyn.bridges.length) {
      const st = bridgeState(t);
      const blink = Math.floor(t * 4) % 2 === 0;
      for (const b of dyn.bridges) {
        for (const lf of b.leaves) lf.hinge.rotation.z = lf.s * st.lift * 1.15;
        const down = st.warn || st.up ? 1 : 0;
        for (const bar of b.bars) {
          bar.arm.rotation.x = 0;
          bar.post.rotation.z = 0;
          bar.arm.rotation.y = 0;
          bar.arm.position.y = 0;
          bar.arm.rotation.x = (1 - down) * -1.3;
          bar.lamp.material.color.copy(down && blink ? RED : OFF_R);
        }
      }
    }
  }

  /** Where a house's doormat is, in px (the 3D house's, when it is built; the map's door otherwise). */
  R.matAt = (house) => {
    const hs = R.town && R.town.data.houseAt.get(house.id);
    return hs ? { x: hs.mat[0] / S, y: hs.mat[1] / S } : { x: house.doorX, y: house.doorY };
  };
  R.greet = () => {};

  /** Open (or shut) a house's door. */
  R.door = (houseId, open) => {
    const dyn = R.town && R.town.dyn;
    const d = dyn && dyn.doorByHouse ? dyn.doorByHouse.get(houseId) : null;
    if (d) d.target = open ? -1.6 : 0;
  };

  R.frame = (view) => {
    const now = performance.now();
    R.dt = Math.min(0.1, R.last ? (now - R.last) / 1000 : 0.016);
    R.last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, hud.width, hud.height);
    const city = R.city;
    if (!city || !R.town) return;
    const t = view.t || 0;
    R.t = t;
    R.view = view;
    shared.uTime.value = now / 1000;
    const { tx, tz, dist, viewH } = placeCamera(view.cam);
    const st = R.style;
    scene.fog.color.set(st.fog);
    scene.fog.near = dist * 0.9 + st.fogNear * 0.35;
    scene.fog.far = dist * 1.1 + st.fogFar;
    placeSun(st, tx, tz, viewH);
    placeLamps(tx, tz);
    dynamics(view, t);
    for (const l of R.layers) if (l.frame) l.frame(view, R);
    if (scene.background && scene.background.isColor) scene.background.copy(scene.fog.color);
    // The cutaway round the van the camera follows.
    const f = R.focus;
    if (f && R.quality !== 'low') {
      const [sx, sy, sz] = R.toScreen(f.x, f.y, 1.2);
      tmpV.set(f.x * S, 1.2, f.y * S).applyMatrix4(camera.matrixWorldInverse);
      const rpx = clamp((R.h / Math.max(0.2, view.cam.zoom)) > 0 ? 70 * view.cam.zoom : 70, 40, 160) * R.pr;
      shared.uXray.value.set(sx * R.pr, (R.h - sy) * R.pr, rpx, -tmpV.z);
      void sz;
    } else shared.uXray.value.set(-9999, -9999, 0, 0);
    // Headlights at night.
    if (f && f.head && shared.uNight.value > 0) {
      tmpV.set(f.x * S + Math.cos(f.h) * 2.2, 0.9, f.y * S + Math.sin(f.h) * 2.2).applyMatrix4(camera.matrixWorldInverse);
      shared.uHeadPos.value.copy(tmpV);
      tmpV.set(Math.cos(f.h), -0.12, Math.sin(f.h)).normalize().transformDirection(camera.matrixWorldInverse);
      shared.uHeadDir.value.copy(tmpV);
      shared.uHeadPower.value = shared.uNight.value * 1.2;
    } else shared.uHeadPower.value = 0;
    // Draw.
    const pf = post.final.uniforms;
    pf.uTime.value = (now / 1000) % 100;
    pf.uFade.value += ((view.desaturate ? 0.75 : 0) - pf.uFade.value) * Math.min(1, R.dt * 8);
    pf.uFlash.value.set(...(view.flash || [0, 0, 0]));
    pf.uFocus.value = view.focusY ?? 0.5;
    pf.uTilt.value = view.tilt ?? 1;
    pf.uBand.value = view.band ?? 0.17;
    if (R.quality === 'low') {
      renderer.shadowMap.enabled = false;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = st.exposure;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    } else {
      renderer.shadowMap.enabled = true;
      renderer.toneMapping = THREE.NoToneMapping;
      const pw = Math.round(R.w * R.pr);
      const ph = Math.round(R.h * R.pr);
      post.resize(pw, ph, R.quality === 'high' ? 4 : 0);
      post.render(scene, camera, { threshold: st.night > 0.5 ? 0.85 : 1.6, blurRadius: 1.4 });
    }
    // World-anchored 2D: name tags and rising numbers.
    ctx.setTransform(R.pr, 0, 0, R.pr, 0, 0);
    for (const l of R.layers) if (l.overlay) l.overlay(ctx, view, R);
  };

  return R;
}

const waterSky = { value: new THREE.Color('#BFD7F2') };

function waterMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#3E8FC4', roughness: 0.06, metalness: 0.0, transparent: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uSkyCol = waterSky;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nuniform float uTime;\nuniform vec3 uSkyCol;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec2 p = vWP.xz;
  float a = sin(p.x * 0.55 + uTime * 1.1) * cos(p.y * 0.45 - uTime * 0.9);
  float b = sin(p.x * 1.7 - uTime * 1.7 + p.y * 1.3) * 0.5;
  float c = sin(p.y * 2.9 + uTime * 2.3 - p.x * 0.7) * 0.25;
  vec3 nw = normalize(vec3((a + b + c) * 0.09, 1.0, (a - b + c) * 0.09));
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vWP.xz;
  float glint = smoothstep(0.75, 1.0, sin(p.x * 0.8 + uTime * 0.7) * sin(p.y * 0.6 - uTime * 0.5));
  diffuseColor.rgb *= 0.9 + glint * 0.25;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  // The sky in the water at a glancing angle, and sun sparkles on the ripples.
  float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, uSkyCol, clamp(fres * 0.9 + 0.12, 0.0, 0.7));
  vec2 q = vWP.xz;
  float sp = sin(q.x * 3.1 + uTime * 2.0) * sin(q.y * 2.7 - uTime * 1.6) * sin((q.x + q.y) * 1.3 + uTime);
  totalEmissiveRadiance += uSkyCol * smoothstep(0.82, 0.98, sp) * 0.35;
}`,
      );
  };
  return m;
}
