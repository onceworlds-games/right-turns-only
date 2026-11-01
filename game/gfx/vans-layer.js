// The vans in the view (and the ghost of the best run): a rig per van, kept from frame to frame so their springs carry
// on, name tags drawn over them on the HUD.

import * as THREE from 'three';
import { S } from './style.js';
import { createVanRig, updateRig, paintRig, disposeRig, kickRig, setTopper, setWrap } from './van.js';
import { symbol } from '../draw2d.js';
import { font } from '../draw2d.js';

export function createVansLayer(R) {
  const group = new THREE.Group();
  R.scene.add(group);
  let rigs = []; // index → rig
  let ghost = null;
  // Podium plinths: painted blocks on a dark foot, made on demand.
  const plinthGeo = new THREE.BoxGeometry(1, 1, 1);
  plinthGeo.translate(0, 0.5, 0);
  const lipGeo = new THREE.BoxGeometry(1, 1, 1);
  lipGeo.translate(0, -0.5, 0);
  const plinths = [];
  function plinth(i) {
    if (!plinths[i]) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(plinthGeo, new THREE.MeshStandardMaterial({ color: '#FFC22E', roughness: 0.55 }));
      const lip = new THREE.Mesh(lipGeo, new THREE.MeshStandardMaterial({ color: '#141A22', roughness: 0.8 }));
      top.castShadow = top.receiveShadow = true;
      lip.receiveShadow = true;
      g.add(top, lip);
      group.add(g);
      plinths[i] = { g, top, lip };
    }
    return plinths[i];
  }
  const layer = {
    rigs,
    setCity() {
      for (const r of rigs) {
        group.remove(r.root);
        disposeRig(r);
      }
      rigs = layer.rigs = [];
    },
    frame(view, R2) {
      const vans = view.vans || [];
      const env = { t: R2.t, dt: R2.dt, night: R2.style ? R2.style.night : 0 };
      for (let i = 0; i < vans.length; i++) {
        const v = vans[i];
        let rig = rigs[i];
        const body = v.body || 'box';
        if (!rig || rig.kind !== body) {
          if (rig) {
            group.remove(rig.root);
            disposeRig(rig);
          }
          rig = createVanRig(body, v.color || '#FFC22E');
          rigs[i] = rig;
          group.add(rig.root);
        }
        paintRig(rig, v.color || '#FFC22E');
        setTopper(rig, v.topper || 'none');
        setWrap(rig, v.wrap || 'kraft');
        rig.root.visible = true;
        updateRig(rig, v, env);
        const fade = v.away ? 0.4 : 1;
        for (const m of Object.values(rig.mats)) {
          m.transparent = fade < 1;
          m.opacity = fade;
        }
        if (v.kick) kickRig(rig, v.kick);
      }
      for (let i = vans.length; i < rigs.length; i++) rigs[i].root.visible = false;
      const ps = view.plinths || [];
      ps.forEach((p, i) => {
        const o = plinth(i);
        o.g.visible = true;
        o.g.position.set(p.x * S, 0, p.y * S);
        o.top.scale.set(p.w * S, p.hgt, p.d * S);
        o.top.material.color.set(p.color);
        // A dark plinth foot.
        o.lip.scale.set(p.w * S + 0.16, 0.22, p.d * S + 0.16);
        o.lip.position.y = 0.22;
      });
      for (let i = ps.length; i < plinths.length; i++) plinths[i].g.visible = false;
      // The ghost: a pale see-through box van.
      if (view.ghost) {
        if (!ghost) {
          ghost = createVanRig('box', '#F4F1E8');
          for (const m of Object.values(ghost.mats)) {
            m.transparent = true;
            m.opacity = 0.32;
            m.depthWrite = false;
          }
          ghost.root.traverse((o) => {
            o.castShadow = false;
          });
          group.add(ghost.root);
        }
        ghost.root.visible = true;
        updateRig(ghost, { x: view.ghost.x, y: view.ghost.y, h: view.ghost.h, v: 200, parcels: 0 }, env);
      } else if (ghost) ghost.root.visible = false;
      // The camera's van: the cutaway and the headlights follow it.
      const me = vans.find((v) => v.me) || (view.focusVan !== undefined ? vans[view.focusVan] : vans.length === 1 ? vans[0] : null);
      R.focus = me ? { x: me.x, y: me.y, h: me.h, head: true } : null;
    },
    overlay(ctx, view) {
      for (const v of view.vans || []) {
        if (!v.tag) continue;
        const [x, y] = R.toScreen(v.x, v.y, 3.6);
        ctx.save();
        ctx.font = font(800, 18);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(v.tag).width + 30;
        const ty = y - 18;
        ctx.fillStyle = 'rgba(20,26,34,0.82)';
        ctx.beginPath();
        ctx.roundRect(x - w / 2, ty - 13, w, 26, 6);
        ctx.fill();
        symbol(ctx, v.symbol, x - w / 2 + 12, ty, 6, v.color);
        ctx.fillStyle = '#F4F1E8';
        ctx.fillText(v.tag, x + 6, ty + 1);
        ctx.restore();
      }
    },
  };
  return layer;
}

export { S };
