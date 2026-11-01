// Routing with right turns only: a graph over (tile, direction). From each state a van can go straight on, turn right, or, in a
// loop zone (roundabout or bulb), leave by any arm. Used by the bots, par times and the last-call pick.
// Pure: no page, no platform.

import { T, DX, DY, DRIVE } from './config.js';
import { tileDrivable, isParkChar } from './city.js';

const STRAIGHT = T / DRIVE.straight;
const TURN = 0.62;

/** Build the graph once per town (and per closure set). */
export function buildGraph(city, closed = null) {
  const n = city.w * city.h;
  const ok = new Uint8Array(n);
  for (let ty = 0; ty < city.h; ty++) {
    for (let tx = 0; tx < city.w; tx++) {
      const i = city.idx(tx, ty);
      ok[i] = tileDrivable(city, tx, ty) && !(closed && closed.has(i)) ? 1 : 0;
    }
  }
  const drivable = (tx, ty) => tx >= 0 && ty >= 0 && tx < city.w && ty < city.h && ok[city.idx(tx, ty)] === 1;
  // edges[node] = [to, cost, to, cost, ...]
  const edges = new Array(n * 4);
  for (let ty = 0; ty < city.h; ty++) {
    for (let tx = 0; tx < city.w; tx++) {
      const i = city.idx(tx, ty);
      if (!ok[i]) continue;
      const ch = city.at(tx, ty);
      const loop = ch === 'O' || ch === 'c';
      const slow = isParkChar(ch) ? 1 / DRIVE.grass : 1;
      for (let d = 0; d < 4; d++) {
        const out = [];
        if (loop) {
          for (let k = 0; k < 4; k++) {
            const e = (d + k) % 4;
            if (!drivable(tx + DX[e], ty + DY[e])) continue;
            out.push(city.idx(tx + DX[e], ty + DY[e]) * 4 + e, k === 0 ? STRAIGHT * 1.2 : 0.45 + k * 0.62);
          }
        } else {
          if (drivable(tx + DX[d], ty + DY[d])) out.push(city.idx(tx + DX[d], ty + DY[d]) * 4 + d, STRAIGHT * slow);
          const r = (d + 1) % 4;
          if (ch !== 'a' && drivable(tx + DX[r], ty + DY[r])) out.push(city.idx(tx + DX[r], ty + DY[r]) * 4 + r, TURN * slow);
        }
        edges[i * 4 + d] = out;
      }
    }
  }
  return { city, n, edges, ok, drivable };
}

/** Shortest times from a state to every state. Returns { dist: Float64Array, prev: Int32Array }. */
export function dijkstra(graph, start) {
  const N = graph.n * 4;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  if (start < 0 || start >= N || !graph.edges[start]) return { dist, prev };
  dist[start] = 0;
  const heap = [start];
  const hd = [0];
  const push = (node, d) => {
    heap.push(node);
    hd.push(d);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      [hd[p], hd[i]] = [hd[i], hd[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const td = hd[0];
    const lastN = heap.pop();
    const lastD = hd.pop();
    if (heap.length) {
      heap[0] = lastN;
      hd[0] = lastD;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && hd[l] < hd[m]) m = l;
        if (r < heap.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        [hd[m], hd[i]] = [hd[i], hd[m]];
        i = m;
      }
    }
    return [top, td];
  };
  while (heap.length) {
    const [u, du] = pop();
    if (du > dist[u]) continue;
    const out = graph.edges[u];
    if (!out) continue;
    for (let k = 0; k < out.length; k += 2) {
      const v = out[k];
      const nd = du + out[k + 1];
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        push(v, nd);
      }
    }
  }
  return { dist, prev };
}

/** The state a van is in: its tile and the direction nearest its heading. */
export function stateOf(city, x, y, h) {
  const tx = Math.max(0, Math.min(city.w - 1, Math.floor(x / T)));
  const ty = Math.max(0, Math.min(city.h - 1, Math.floor(y / T)));
  const d = ((Math.round((h + Math.PI / 2) / (Math.PI / 2)) % 4) + 4) % 4;
  return city.idx(tx, ty) * 4 + d;
}

/** The best time to reach a tile (any direction) and the state that does it. */
export function bestTo(result, tileIndex) {
  let best = Infinity;
  let node = -1;
  for (let d = 0; d < 4; d++) {
    const v = result.dist[tileIndex * 4 + d];
    if (v < best) {
      best = v;
      node = tileIndex * 4 + d;
    }
  }
  return { time: best, node };
}

/** The states from the start to `node`, in order. */
export function pathTo(result, node) {
  const out = [];
  let cur = node;
  for (let guard = 0; cur >= 0 && guard < 5000; guard++) {
    out.push(cur);
    cur = result.prev[cur];
  }
  return out.reverse();
}

/** The tile a house's drop point is on. */
export function dropTile(city, house) {
  return city.idx(Math.floor(house.dropX / T), Math.floor(house.dropY / T));
}
