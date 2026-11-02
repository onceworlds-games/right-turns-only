// The people of the town: walkers who gather at the kerb, cross the zebras and stroll off (and jump out of a van's way),
// people out for a walk along the pavements, dogs in front gardens that race the van along the fence, and at every
// delivery the resident who opens the door, comes out to the mat, cheers and carries the parcel in.

import * as THREE from 'three';
import { T, DX, DY } from '../config.js';
import { S } from './style.js';
import { KERB } from './town.js';
import { PEOPLE_KINDS, DOG_KINDS, loadModels, models, spawnRigged } from './models.js';
import { parcelGeometry } from './van.js';

const TOPS = ['#E2574C', '#F2A541', '#3E7CB1', '#5BB06A', '#E8E4DA', '#8C5BD1', '#F28C3B', '#2FA3A3', '#D94F70', '#F4D35E', '#4D5A9C', '#C9CCD2'];
const BOTTOMS = ['#2E3440', '#3F5A7A', '#6B5B4B', '#4A4E57', '#7A6A55', '#33495E', '#1F2328'];
const MAX_PEOPLE = 44;
const MAX_DOGS = 6;
const NEAR = 75; // metres from the camera's target: people further out are not shown

const hash = (a, b = 0) => (Math.imul((a | 0) * 31 + (b | 0) + 7, 2654435761) >>> 0) / 4294967296;

export function createPeopleLayer(R) {
  const group = new THREE.Group();
  R.scene.add(group);
  let ready = false;
  let city = null;
  let houseAt = null;
  const pool = new Map(); // kind → free rigs
  let live = 0;
  const walkers = new Map(); // key → person
  const greets = []; // residents at their doors
  const strollers = [];
  const dogs = new Map(); // house id → dog
  const kennel = new Map(); // kind → dogs out of sight, kept for reuse
  loadModels().then(() => {
    ready = true;
  });

  function acquire(kind, look) {
    const free = pool.get(kind);
    let rig = free && free.pop();
    if (!rig) {
      if (live >= MAX_PEOPLE) return null;
      const lib = models();
      const entry = lib.people.get(kind);
      if (!entry) return null;
      rig = spawnRigged(entry, { scale: 1.42 });
      rig.kind = kind;
      live++;
    }
    rig.tint(look);
    rig.fade(1);
    rig.root.visible = true;
    group.add(rig.root);
    return rig;
  }

  function release(rig) {
    if (!rig) return;
    group.remove(rig.root);
    rig.carry && rig.root.remove(rig.carry);
    rig.carry = null;
    const free = pool.get(rig.kind) || [];
    free.push(rig);
    pool.set(rig.kind, free);
    rig.stop();
  }

  function lookFor(seed) {
    const r = (k) => hash(seed, k);
    return {
      kind: PEOPLE_KINDS[Math.floor(r(1) * PEOPLE_KINDS.length)],
      top: TOPS[Math.floor(r(2) * TOPS.length)],
      top2: TOPS[Math.floor(r(3) * TOPS.length)],
      bottom: BOTTOMS[Math.floor(r(4) * BOTTOMS.length)],
    };
  }

  /** Move a person to (x, z) metres facing heading h (y-down, 0 east), playing the clip their speed asks for. */
  function place(p, x, y, z, h, speed, dt) {
    const rig = p.rig;
    rig.root.position.set(x, y, z);
    if (h !== null) {
      const want = Math.PI / 2 - h;
      let d = want - rig.root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      rig.root.rotation.y += d * Math.min(1, dt * 10);
    }
    if (p.clip) rig.play(p.clip, 0.18);
    else if (speed > 2.4) rig.play('Run', 0.18, Math.min(1.4, speed / 3.6));
    else if (speed > 0.25) rig.play('Walk', 0.22, Math.min(1.5, Math.max(0.7, speed / 1.3)));
    else rig.play('Idle', 0.3);
  }

  // ------------------------------------------------------------------ zebra walkers

  function zebraPeople(view, cx, cz, dt) {
    const t = view.t || 0;
    const rain = !!(city.town && city.town.rain);
    const n = rain ? 3 : 2;
    const vans = view.vans || [];
    const want = new Set();
    city.zebras.forEach((zb, zi) => {
      if (Math.abs(zb.x * S - cx) > NEAR || Math.abs(zb.y * S - cz) > NEAR) return;
      const c = (t + zb.offset) % 10;
      for (let i = 0; i < n; i++) {
        const dir = (zb.tx + zb.ty + i) % 2 ? 1 : -1;
        const along = (zb.tx * 3 + zb.ty + i) % 2 ? 1 : -1; // which way they stroll on the pavement
        const side = (i - (n - 1) / 2) * 16;
        const lag = i * 0.12;
        let off; // across the road, px from the zebra's middle
        let slide = 0; // along the pavement, px
        let speed;
        let fade = 1;
        let h;
        const acrossH = zb.across === 'v' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
        const alongH = zb.across === 'v' ? (along > 0 ? 0 : Math.PI) : along > 0 ? Math.PI / 2 : -Math.PI / 2;
        if (c <= 3.4) {
          const k = c / 3.4;
          const kk = Math.max(0, Math.min(1, (k - lag) / (1 - 0.24)));
          off = (kk - 0.5) * 128 * dir;
          speed = kk > 0 && kk < 1 ? 128 / (3.4 * 0.76) / 10 : 0;
          h = speed > 0 ? acrossH : acrossH;
        } else if (c <= 6.4) {
          // Off along the far pavement, fading as they go.
          const a = c - 3.4;
          off = 70 * dir;
          slide = along * a * 13;
          speed = 1.3;
          h = alongH;
          fade = Math.max(0, Math.min(1, (3.0 - a) / 0.7));
          if (a < 0.25) h = acrossH;
        } else if (c >= 7.4) {
          // Coming along the near pavement to wait at the kerb.
          const a = 10 - c; // seconds until they step out
          off = -70 * dir;
          const walk = Math.max(0, a - 0.9);
          slide = -along * walk * 13;
          speed = walk > 0 ? 1.3 : 0;
          h = walk > 0 ? alongH + Math.PI : acrossH;
          fade = Math.max(0, Math.min(1, (2.6 - a) / 0.6));
        } else continue;
        let x = zb.across === 'v' ? zb.x + side + slide : zb.x + off;
        let y = zb.across === 'v' ? zb.y + off : zb.y + side + slide;
        // Out of a van's way: a hop to whichever side they were on.
        let dodge = 0;
        for (const v of vans) {
          const dx = x - v.x;
          const dy = y - v.y;
          const d = Math.hypot(dx, dy);
          if (d >= 52) continue;
          const nx = -Math.sin(v.h);
          const ny = Math.cos(v.h);
          const s = dx * nx + dy * ny >= 0 ? 1 : -1;
          const k = 1 - d / 52;
          x += nx * s * k * 36;
          y += ny * s * k * 36;
          dodge = Math.max(dodge, k);
        }
        const key = `${zi}:${i}`;
        want.add(key);
        let p = walkers.get(key);
        if (!p) {
          const look = lookFor(zi * 7 + i * 131 + Math.floor((t + zb.offset) / 10) * 17);
          const rig = acquire(look.kind, look);
          if (!rig) continue;
          p = { rig, dodge: 0 };
          walkers.set(key, p);
          rig.root.rotation.y = Math.PI / 2 - h;
        }
        p.dodge = Math.max(dodge, p.dodge - dt * 2.5);
        const ground = Math.abs(off) > 58 ? KERB : 0;
        p.clip = p.dodge > 0.35 ? 'Jump' : null;
        place(p, x * S, ground, y * S, h, p.dodge > 0.2 ? 3 : speed, dt);
        p.rig.fade(fade);
      }
    });
    for (const [key, p] of walkers) {
      if (want.has(key)) continue;
      release(p.rig);
      walkers.delete(key);
    }
  }

  // ------------------------------------------------------------------ residents

  /** A delivery to house `id`: the parcel on the mat, the door opens, out they come. */
  function greet(id, opts = {}) {
    if (!ready || !houseAt) return;
    const hs = houseAt.get(id);
    if (!hs) return;
    // One at a time per house.
    const old = greets.find((g) => g.id === id);
    if (old) old.t = Math.max(old.t, 4.2);
    const look = lookFor(id * 977 + 3);
    const rig = acquire(look.kind, look);
    if (!rig) return;
    const parcel = new THREE.Mesh(parcelGeometry(!!opts.gold, opts.wrap), R.mats.town);
    parcel.castShadow = true;
    parcel.position.set(hs.mat[0], hs.y + 0.02, hs.mat[1]);
    parcel.rotation.y = hs.ry + (hash(id) - 0.5) * 0.6;
    group.add(parcel);
    rig.root.position.set(hs.inside[0], hs.y, hs.inside[1]);
    rig.root.rotation.y = hs.ry;
    rig.fade(0);
    greets.push({ id, hs, rig, parcel, t: 0, gold: !!opts.gold, mat: !!opts.mat });
  }

  function residents(dt) {
    for (let i = greets.length - 1; i >= 0; i--) {
      const g = greets[i];
      g.t += dt;
      const { hs, rig } = g;
      const t = g.t;
      const door = hs.door;
      const mat = hs.mat;
      const ins = hs.inside;
      // 0.25 door opens, 0.3–1.2 walk out to just behind the mat, 1.2–2.8 cheer, 2.8 pick up, 3.0–4.0 back in, 4.4 shut.
      if (t > 0.15 && !g.opened) {
        R.door(g.id, true);
        g.opened = true;
      }
      const stand = [mat[0] + (door[0] - mat[0]) * 0.55, mat[1] + (door[1] - mat[1]) * 0.55];
      let x;
      let z;
      let speed = 0;
      let face = hs.ry;
      let clip = null;
      if (t < 0.3) {
        x = ins[0];
        z = ins[1];
      } else if (t < 1.2) {
        const k = (t - 0.3) / 0.9;
        x = ins[0] + (stand[0] - ins[0]) * k;
        z = ins[1] + (stand[1] - ins[1]) * k;
        speed = Math.hypot(stand[0] - ins[0], stand[1] - ins[1]) / 0.9;
      } else if (t < 2.8) {
        x = stand[0];
        z = stand[1];
        clip = g.gold || g.mat ? (t < 2.0 ? 'Jump' : 'Clapping') : 'Clapping';
      } else if (t < 3.05) {
        x = stand[0];
        z = stand[1];
        clip = 'Idle';
        if (!rig.carry) {
          group.remove(g.parcel);
          rig.carry = g.parcel;
          g.parcel.position.set(0, 1.05, 0.38);
          g.parcel.rotation.set(0, 0, 0);
          g.parcel.scale.setScalar(0.85);
          rig.root.add(g.parcel);
        }
      } else if (t < 4.0) {
        const k = (t - 3.05) / 0.95;
        x = stand[0] + (ins[0] - stand[0]) * k;
        z = stand[1] + (ins[1] - stand[1]) * k;
        speed = Math.hypot(stand[0] - ins[0], stand[1] - ins[1]) / 0.95;
        face = hs.ry + Math.PI;
      } else {
        x = ins[0];
        z = ins[1];
        face = hs.ry + Math.PI;
      }
      rig.fade(t < 0.3 ? t / 0.3 : t > 3.8 ? Math.max(0, (4.2 - t) / 0.4) : 1);
      // Facing: the model faces +z; the lot's ry turns +z to the street.
      let d = face - rig.root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      rig.root.rotation.y += d * Math.min(1, dt * 9);
      rig.root.position.set(x, hs.y, z);
      if (clip) rig.play(clip, 0.2);
      else if (speed > 0.2) rig.play('Walk', 0.2, 1.2);
      else rig.play('Idle', 0.25);
      if (t > 4.4 && !g.shut) {
        R.door(g.id, false);
        g.shut = true;
      }
      if (t > 4.6) {
        if (rig.carry) rig.root.remove(rig.carry);
        rig.carry = null;
        group.remove(g.parcel);
        release(rig);
        greets.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ strollers

  const roadAt = (tx, ty) => {
    const ch = city.at(tx, ty);
    return ch === '.' || ch === 'z' || ch === 'L' || ch === 'R' || ch === 'r' || ch === 'k' || ch === '~';
  };
  const lotAt = (tx, ty) => {
    const ch = city.at(tx, ty);
    return ch === 'h' || ch === 'b' || ch === 'g';
  };

  function spawnStroller(cx, cz, zoom) {
    // A pavement on screen: a road tile with a lot on one side; they walk along it.
    const spanX = (R.w / Math.max(0.3, zoom)) / T;
    const spanY = (R.h / Math.max(0.3, zoom)) / T;
    for (let tries = 0; tries < 12; tries++) {
      const tx = Math.floor(cx / (T * S) + (Math.random() - 0.5) * spanX);
      const ty = Math.floor(cz / (T * S) + (Math.random() - 0.5) * spanY);
      if (!roadAt(tx, ty)) continue;
      const sides = [0, 1, 2, 3].filter((d) => lotAt(tx + DX[d], ty + DY[d]));
      if (!sides.length) continue;
      const d = sides[Math.floor(Math.random() * sides.length)];
      const dir = Math.random() < 0.5 ? (d + 1) % 4 : (d + 3) % 4;
      const look = lookFor(Math.floor(Math.random() * 1e6));
      const rig = acquire(look.kind, look);
      if (!rig) return;
      const off = 66 + Math.random() * 6; // px from the road's middle: on the pavement
      const x = (tx + 0.5) * T + DX[d] * off;
      const y = (ty + 0.5) * T + DY[d] * off;
      rig.fade(0);
      strollers.push({ rig, x, y, d, dir, tx, ty, t: 0, speed: 11 + Math.random() * 5, life: 8 + Math.random() * 10, dog: null });
      return;
    }
  }

  function walkStrollers(view, cx, cz, dt) {
    const want = Math.min(9, Math.floor((R.style && R.style.night > 0.5 ? 4 : 8) * (city.town.rain || city.town.snow ? 0.6 : 1)));
    if (strollers.length < want && Math.random() < dt * 1.5) spawnStroller(cx, cz, (view.cam && view.cam.zoom) || 1);
    for (let i = strollers.length - 1; i >= 0; i--) {
      const s = strollers[i];
      s.t += dt;
      // Keep to the pavement: stop where the lot beside it ends.
      const nx = s.x + DX[s.dir] * s.speed * dt;
      const ny = s.y + DY[s.dir] * s.speed * dt;
      const tx = Math.floor(nx / T);
      const ty = Math.floor(ny / T);
      let blocked = false;
      if (tx !== s.tx || ty !== s.ty) {
        if (!roadAt(tx, ty) || !lotAt(tx + DX[s.d], ty + DY[s.d])) blocked = true;
        else {
          s.tx = tx;
          s.ty = ty;
        }
      }
      if (blocked) s.life = Math.min(s.life, s.t);
      else {
        s.x = nx;
        s.y = ny;
      }
      const out = s.t > s.life;
      const far = Math.abs(s.x * S - cx) > NEAR + 10 || Math.abs(s.y * S - cz) > NEAR + 10;
      const fade = Math.min(1, s.t / 0.6, out ? Math.max(0, 1 - (s.t - s.life) / 0.6) : 1);
      const h = Math.atan2(DY[s.dir], DX[s.dir]);
      place(s, s.x * S, KERB, s.y * S, h, blocked || out ? 0 : s.speed / 10, dt);
      s.rig.fade(fade);
      if ((out && fade <= 0) || far) {
        release(s.rig);
        strollers.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ dogs

  function gardenDogs(view, cx, cz, dt) {
    const lib = models();
    if (!lib.dogs.size) return;
    const vans = view.vans || [];
    // Every fifth house has a dog; only those near the camera are out.
    for (const h of city.houses) {
      if (hash(h.id, 99) > 0.2) continue;
      const hs = houseAt.get(h.id);
      if (!hs) continue;
      const near = Math.abs(hs.mat[0] - cx) < NEAR && Math.abs(hs.mat[1] - cz) < NEAR;
      let dog = dogs.get(h.id);
      if (!near) {
        if (dog) {
          group.remove(dog.rig.root);
          dog.rig.stop();
          (kennel.get(dog.kind) || kennel.set(dog.kind, []).get(dog.kind)).push(dog.rig);
          dogs.delete(h.id);
        }
        continue;
      }
      if (!dog) {
        if (dogs.size >= MAX_DOGS) continue;
        const kind = DOG_KINDS[h.id % DOG_KINDS.length];
        // Dogs that went out of sight wait in the kennel for the next garden.
        const spare = kennel.get(kind);
        const rig = (spare && spare.pop()) || spawnRigged(lib.dogs.get(kind), { scale: 1.7 });
        rig.root.rotation.y = 0;
        group.add(rig.root);
        // The garden runs along the street, between the door and the pavement.
        const fx = Math.cos(hs.ry);
        const fz = -Math.sin(hs.ry);
        dog = { rig, kind, home: [hs.mat[0] + Math.sin(hs.ry) * 0.85, hs.mat[1] + Math.cos(hs.ry) * 0.85], ax: [fx, fz], s: 0, v: 0, bark: 0 };
        dog.rig.root.position.set(dog.home[0], hs.y, dog.home[1]);
        dogs.set(h.id, dog);
      }
      // Race the nearest van along the fence (they never leave their garden).
      let target = 0;
      let chase = false;
      for (const v of vans) {
        const vx = v.x * S - dog.home[0];
        const vz = v.y * S - dog.home[1];
        const along = vx * dog.ax[0] + vz * dog.ax[1];
        const across = Math.abs(vx * -dog.ax[1] + vz * dog.ax[0]);
        if (across < 14 && Math.abs(along) < 14) {
          target = Math.max(-4.2, Math.min(4.2, along));
          chase = true;
        }
      }
      const want = chase ? target : Math.sin(R.t * 0.2 + h.id) * 1.5;
      const prev = dog.s;
      dog.s += Math.max(-dt * 9, Math.min(dt * 9, want - dog.s));
      dog.v = Math.abs(dog.s - prev) / Math.max(dt, 0.001);
      const x = dog.home[0] + dog.ax[0] * dog.s;
      const z = dog.home[1] + dog.ax[1] * dog.s;
      dog.rig.root.position.set(x, hs.y, z);
      const facing = dog.v > 0.3 ? (dog.s - prev > 0 ? Math.atan2(dog.ax[0], dog.ax[1]) : Math.atan2(-dog.ax[0], -dog.ax[1])) : hs.ry;
      let d = facing - dog.rig.root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      dog.rig.root.rotation.y += d * Math.min(1, dt * 8);
      if (dog.v > 3) dog.rig.play('Gallop', 0.15, 1.3);
      else if (dog.v > 0.3) dog.rig.play('Walk', 0.2);
      else if (chase) dog.rig.play('Attack', 0.2);
      else dog.rig.play(h.id % 2 ? 'Idle' : 'Idle_2', 0.4);
      dog.rig.mixer.update(dt);
    }
  }

  const layer = {
    greet,
    setCity(tn) {
      city = tn.city;
      houseAt = tn.data.houseAt;
      for (const p of walkers.values()) release(p.rig);
      walkers.clear();
      for (const g of greets) {
        group.remove(g.parcel);
        release(g.rig);
      }
      greets.length = 0;
      for (const s of strollers) release(s.rig);
      strollers.length = 0;
      for (const d of dogs.values()) {
        group.remove(d.rig.root);
        d.rig.dispose();
      }
      dogs.clear();
      for (const list of kennel.values()) for (const rig of list) rig.dispose();
      kennel.clear();
    },
    frame(view) {
      if (!ready || !city) return;
      const dt = Math.min(0.1, R.dt || 0.016);
      const cam = view.cam || { x: 0, y: 0 };
      const cx = cam.x * S;
      const cz = cam.y * S;
      zebraPeople(view, cx, cz, dt);
      residents(dt);
      if (!view.still) walkStrollers(view, cx, cz, dt);
      gardenDogs(view, cx, cz, dt);
      for (const p of walkers.values()) p.rig.mixer.update(dt);
      for (const g of greets) g.rig.mixer.update(dt);
      for (const s of strollers) s.rig.mixer.update(dt);
    },
  };
  return layer;
}
