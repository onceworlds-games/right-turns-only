// Right Turns Only: the page. Screens, input, the solo shift loop, the scramble glue, the camera and the HUD.

import { T, DT, DX, DY, DIR_HEADING, DELIVERY, SCRAMBLE, SEATS, BOTS, VAN_BODIES, PALETTE, STARS, clamp, dirOf, angleDiff } from './config.js';
import { TOWNS, TITLE_TOWN } from './towns.js';
import { createRenderer } from './gfx/renderer.js';
import { createVansLayer } from './gfx/vans-layer.js';
import { createMarksLayer } from './gfx/marks-layer.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';
import { clockSign, manifest, edgeArrows, plates, shiftCones, outlined, fmtTime, fmtClock } from './hud.js';
import { drawYard, drawPodium } from './yard.js';
import { cityFor, createSoloWorld, createScrambleWorld, parFor, estimateFor, dailyShift } from './world.js';
import { starsFor, minPlausible, DAILY_PARCELS } from './shift.js';
import { createRecorder, decodeGhost, ghostAt } from './ghost.js';
import { createDriver, graphFor, houseTarget, depotTarget } from './driver.js';
import { dayNumber } from './rng.js';
import { connect, shiftTime } from './net.js';
import { openList, scrambleTargets } from './scramble.js';

const ow = globalThis.onceworlds || null;
const params = new URLSearchParams(location.search);
const BODY_IDS = ['box', 'bread', 'pickup', 'mail', 'tuk', 'icecream', 'gold'];

if (params.has('poster')) {
  import('./poster.js').then((m) => m.renderPoster(params.get('poster')));
} else {
  boot();
}

function boot() {
  const cv = document.getElementById('cv');
  const R = createRenderer(cv);
  R.layers.push(createMarksLayer(R), createVansLayer(R));
  const fx = createFx();
  const audio = createAudio();
  const production = ow ? ow.mode === 'production' : !import.meta.env.DEV;
  const autoplay = !production && params.get('autoplay') === '1';
  // Capture only: a closer camera for footage (outside production).
  const zoomBoost = production ? 1 : clamp(Number(params.get('zoom')) || 1, 0.5, 2.5);
  const noHints = !production && params.get('hints') === '0';

  const S = {
    mode: '',
    w: 1,
    h: 1,
    t: 0,
    keys: new Set(),
    pointers: new Set(),
    cam: { x: 600, y: 400, zoom: 1, shake: fx.shake },
    profile: defaultProfile(),
    net: null,
    title: null,
    solo: null,
    preview: null, // { town, city, traffic, t }
    lastPhase: '',
    lastRound: '',
    scr: { lastSecond: -1, follow: null, lastCallAt: -1 },
    fontsReady: false,
    autoDriver: autoplay ? createDriver({ skill: 1, seed: 5 }) : null,
  };

  const totalStars = () => totalStarsOf(S.profile);
  let lastPublish = 0;
  /** Presence at most 10 times a second while driving, twice a second elsewhere. */
  function publish(state) {
    const now = performance.now();
    if (now - lastPublish < (state === 'play' ? 100 : 500)) return;
    lastPublish = now;
    S.net.publish(state);
  }

  const ui = createUI(document.getElementById('ui'), {
    play: () => {
      audio.unlock();
      audio.play('click');
      if (!S.profile.played && (!S.net || S.net.room.players.size <= 1)) startSolo(TOWNS[0]);
      else toYard();
    },
    route: () => (audio.play('click'), toRoute()),
    daily: () => (audio.play('click'), toDaily()),
    body: () => cycleBody(),
    invite: () => {
      try {
        ow.ui.showInvite();
      } catch {
        /* no invite here */
      }
    },
    card: (town) => (audio.play('click'), toCard(town)),
    drive: () => {
      audio.unlock();
      audio.play('click');
      if (S.mode === 'daily') startSolo(S.preview.town, { daily: S.preview.day });
      else startSolo(S.preview.town);
    },
    back: () => (audio.play('click'), back()),
    again: () => restartSolo(),
    next: () => nextTown(),
    yard: () => toYard(),
    resume: () => resume(),
    restart: () => restartSolo(),
  });

  // ------------------------------------------------------------ sizing, fonts, platform

  function pixelRatio() {
    try {
      if (ow && ow.settings) return ow.settings.pixelRatio(2);
    } catch {
      /* fall through */
    }
    return Math.min(2, devicePixelRatio || 1);
  }
  function resize() {
    S.w = innerWidth;
    S.h = innerHeight;
    R.resize(S.w, S.h, pixelRatio());
    R.quality = ow && ow.settings ? ow.settings.quality : 'high';
    relayout();
  }
  /** DOM screens placed around the platform's pieces are placed again when those (or the window) move. */
  function relayout() {
    if (S.mode === 'yard') renderYardUI();
  }
  addEventListener('resize', resize);
  resize();

  Promise.race([Promise.all([document.fonts.load('900 40px "Barlow Condensed"'), document.fonts.load('700 20px "Barlow Condensed"')]), new Promise((r) => setTimeout(r, 1500))])
    .catch(() => {})
    .then(() => {
      S.fontsReady = true;
      R.chunks.clear();
    });

  if (ow) {
    try {
      ow.controls.set(null);
      ow.ui.setLook({ accent: '#FFC22E', panel: '#34383F', text: '#F4F1E8' });
      ow.on('reserved', () => relayout());
      ow.on('pause', () => {
        if (S.mode === 'solo' && S.solo && S.solo.phase === 'drive') pause();
        audio.duck(true);
      });
      ow.on('resume', () => audio.duck(false));
      ow.settings.on('change', () => {
        resize();
        fx.reduced = !!ow.settings.reducedMotion;
        fx.lite = ow.settings.quality === 'low';
      });
      fx.reduced = !!ow.settings.reducedMotion;
      fx.lite = ow.settings.quality === 'low';
    } catch {
      /* every optional API is guarded */
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && S.mode === 'solo' && S.solo && S.solo.phase === 'drive') pause();
  });

  // Join first, then everything else.
  if (ow) {
    connect(ow, (room) => {
      // The Ready strip only belongs on the yard: hide it at once, before the helpers load.
      try {
        if (S.mode !== 'yard' && room.hideLobby) room.hideLobby(true);
      } catch {
        /* older rooms */
      }
    }).then((net) => {
      if (!net) return;
      S.net = net;
      net.myBody = S.profile.body;
      const room = net.room;
      room.on('close', (reason) => closed(reason));
      if (net.match) {
        net.match.on('change', () => lobbyStrip());
        net.match.on('results', (standings, mine) => onResults(standings, mine));
        net.onDrop = (res, p) => onMyDrop(res, p);
      }
      lobbyStrip();
    });
    loadProfile();
  }

  async function loadProfile() {
    try {
      const p = await ow.save.get('profile');
      if (p && typeof p === 'object') S.profile = { ...defaultProfile(), ...p, hints: { ...(p.hints || {}) }, best: { ...(p.best || {}) }, stars: { ...(p.stars || {}) } };
      S.profile.body = clamp(S.profile.body | 0, 0, VAN_BODIES.length - 1);
      if (S.net) S.net.myBody = S.profile.body;
      if (S.mode === 'yard') toYard();
    } catch {
      /* a guest or offline: defaults */
    }
  }
  let saveTimer = 0;
  function saveProfile() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (ow) ow.save.set('profile', S.profile);
      } catch {
        /* saves are best effort */
      }
    }, 300);
  }

  function today() {
    try {
      return dayNumber(ow ? ow.now() : Date.now());
    } catch {
      return dayNumber(Date.now());
    }
  }

  function award(id) {
    try {
      if (ow) ow.badges.award(id);
    } catch {
      /* badges are best effort */
    }
  }

  /** The platform's Ready strip: only on the yard. */
  function lobbyStrip() {
    const room = S.net && S.net.room;
    if (!room || !room.hideLobby) return;
    const hide = S.mode !== 'yard';
    const key = `${hide}|${room.match ? `${room.match.phase}:${room.match.id}` : ''}`;
    if (key === S.stripKey) return;
    S.stripKey = key;
    try {
      room.hideLobby(hide);
    } catch {
      /* older rooms */
    }
  }

  // ------------------------------------------------------------ input

  const HOLD_KEYS = new Set(['Space', 'ArrowRight', 'KeyD']);
  addEventListener('keydown', (e) => {
    if (driving() && HOLD_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) S.keys.add(e.code);
      audio.unlock();
      return;
    }
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (S.mode === 'solo' && S.solo && S.solo.phase === 'drive') pause();
      else if (S.mode === 'solo' && S.solo && S.solo.phase === 'paused') resume();
      else if (e.code === 'Escape') back();
      return;
    }
    if (e.code === 'KeyR' && (S.mode === 'solo' || S.mode === 'soloResults')) return restartSolo();
    if (e.code === 'Enter' && S.mode === 'soloResults') {
      e.preventDefault();
      return nextTown();
    }
    // Space or Enter press the screen's main sign when nothing has the focus.
    const focused = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if ((e.code === 'Space' || e.code === 'Enter') && !focused && S.mode !== 'yard') {
      const main = document.querySelector('#ui .play, #ui .sign.blue');
      if (main) {
        e.preventDefault();
        main.click();
      }
    }
  });
  addEventListener('keyup', (e) => S.keys.delete(e.code));
  addEventListener('blur', () => {
    S.keys.clear();
    S.pointers.clear();
  });
  cv.addEventListener('pointerdown', (e) => {
    audio.unlock();
    if (!driving()) {
      if (S.mode === 'scramble' && S.net && !S.net.playing()) S.scr.followNext = true; // a watcher's tap: the next van
      return;
    }
    S.pointers.add(e.pointerId);
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
  });
  const up = (e) => S.pointers.delete(e.pointerId);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  const driving = () => (S.mode === 'solo' && S.solo && (S.solo.phase === 'drive' || S.solo.phase === 'intro')) || (S.mode === 'scramble' && S.net && S.net.playing());
  const holding = () => S.keys.size > 0 || S.pointers.size > 0;
  function clearInput() {
    S.keys.clear();
    S.pointers.clear();
  }

  // ------------------------------------------------------------ screens

  function setMode(mode) {
    S.mode = mode;
    clearInput();
    lobbyStrip();
  }

  function toTitle() {
    setMode('title');
    if (!S.title) {
      const drivers = [1, 0.95, 0.9, 0.97].map((skill, i) => ({ id: `t${i}`, skill, style: 'steady', seed: 40 + i }));
      // No addresses on the painted avenue: the words stay clear.
      const city = cityFor(TITLE_TOWN);
      const avoid = new Set(city.houses.filter((h) => Math.abs(h.dropX - 5.5 * T) < 100 && h.dropY > 1.5 * T && h.dropY < 6.5 * T).map((h) => h.id));
      S.title = { world: createScrambleWorld(TITLE_TOWN, { seed: 11, seconds: 1e9, drivers, avoid }), acc: 0 };
      // Warm it up so vans are out on the streets.
      for (let i = 0; i < 60 * 8; i++) S.title.world.step();
    }
    R.setCity(S.title.world.city);
    ui.title();
    audio.music('sunny', true);
  }

  function toYard() {
    if (S.solo) S.solo = null;
    setMode('yard');
    fx.clear();
    renderYardUI();
    audio.music('sunny', true);
  }

  function renderYardUI() {
    const net = S.net;
    const room = net && net.room;
    const isHost = !!(room && room.isHost);
    const settings = (room && room.settings) || {};
    const towns = settings.towns || 'mixed';
    const shift = settings.shift || 123;
    const lobby = !net || !net.match || net.match.phase === 'lobby';
    const posts = [
      { label: 'TOWNS', value: towns.toUpperCase(), onClick: isHost && lobby ? () => setSetting('towns', { mixed: 'easy', easy: 'hard', hard: 'mixed' }[towns] || 'mixed') : null },
      { label: 'SHIFT', value: shift > 150 ? '3:00' : '2:00', onClick: isHost && lobby ? () => setSetting('shift', shift > 150 ? 120 + SCRAMBLE.intro : 180 + SCRAMBLE.intro) : null },
    ];
    const d = dailyShift(today());
    let watching = null;
    if (net && net.match && net.match.phase !== 'lobby' && !net.playing()) watching = 'SHIFT IN PROGRESS · WATCH';
    ui.yard({
      posts,
      stars: totalStars(),
      dailyTown: d.town.name.toUpperCase(),
      body: ui.bodyName(S.profile.body),
      invite: !!(ow && ow.ui && ow.ui.showInvite),
      top: topInset(),
      bottom: bottomInset(true) + 8,
      watching,
    });
    if (watching) {
      const w = document.querySelector('.watching');
      if (w) {
        w.classList.add('hit');
        w.style.pointerEvents = 'auto';
        w.addEventListener('click', () => toScramble());
      }
    }
  }

  function setSetting(id, v) {
    audio.play('click');
    try {
      S.net.room.setSetting(id, v);
    } catch {
      /* host only */
    }
    setTimeout(renderYardUI, 60);
  }

  function cycleBody() {
    const i = (S.profile.body + 1) % VAN_BODIES.length;
    const next = VAN_BODIES[i];
    if (next.stars > totalStars()) {
      ui.toast(`${next.name.toUpperCase()}: ${next.stars} STARS`);
      S.profile.body = 0;
    } else S.profile.body = i;
    if (S.net) S.net.myBody = S.profile.body;
    audio.play('click');
    saveProfile();
    renderYardUI();
  }

  function toRoute() {
    setMode('route');
    ui.route({ unlocked: S.profile.unlocked, best: S.profile.best, stars: S.profile.stars });
    setPreview(TOWNS[Math.min(TOWNS.length, S.profile.unlocked) - 1]);
  }

  function setPreview(town, day) {
    if (!S.preview || S.preview.town !== town) {
      const city = cityFor(town);
      S.preview = { town, city, traffic: null, t: 0, day };
      import('./traffic.js').then((m) => {
        if (S.preview && S.preview.town === town) S.preview.traffic = m.createTraffic(city);
      });
    }
    S.preview.day = day;
    R.setCity(S.preview.city);
  }

  async function toCard(town) {
    setMode('card');
    setPreview(town);
    const par = parFor(town);
    const show = (top) => {
      if (S.mode !== 'card' || S.preview.town !== town) return;
      ui.card({ title: town.name, sub: `${town.parcels} PARCELS`, best: S.profile.best[town.id], two: par * STARS.two, three: par * STARS.three, top });
    };
    show(ow ? [] : null);
    if (ow) {
      try {
        const res = await ow.leaderboards.top(`town-${town.id}`, { limit: 5 });
        const me = S.net && S.net.room.me ? S.net.room.me.id : '';
        show((res && res.entries ? res.entries : []).map((e) => ({ name: String(e.player && e.player.name ? e.player.name : '?').slice(0, 24), time: Number(e.score), me: e.player && e.player.id === me })));
      } catch {
        /* boards are optional */
      }
    }
  }

  async function toDaily() {
    const d = dailyShift(today());
    setMode('daily');
    setPreview(d.town, d.day);
    const par = parFor(d.town, { daily: d.day });
    const best = S.profile.daily && S.profile.daily.day === d.day ? S.profile.daily.best : null;
    const show = (top) => {
      if (S.mode !== 'daily') return;
      ui.card({ title: `DAILY · ${d.town.name}`, sub: `${DAILY_PARCELS} PARCELS`, best, two: par * STARS.two, three: par * STARS.three, top, daily: true });
    };
    show(ow ? [] : null);
    if (ow) show(await dailyTop(d));
  }

  /** Today's top 10 from the shared list: today's entries only, each player's best, nothing impossible. */
  async function dailyTop(d) {
    try {
      const list = await ow.data.game.get('daily');
      if (!Array.isArray(list)) return [];
      const floor = minPlausible(estimateFor(d.town, { daily: d.day }), DAILY_PARCELS) * 100;
      const me = S.net && S.net.room.me ? S.net.room.me.id : '';
      const best = new Map();
      for (const it of list) {
        const v = it && it.value;
        if (!v || v.d !== d.day || !Number.isInteger(v.t) || v.t < floor || v.t > 90000) continue;
        const by = it.by && typeof it.by.id === 'string' ? it.by : null;
        if (!by) continue;
        const prev = best.get(by.id);
        if (!prev || v.t < prev.t) best.set(by.id, { t: v.t, name: String(by.name || '?').slice(0, 24), me: by.id === me });
      }
      return [...best.values()].sort((a, b) => a.t - b.t).slice(0, 10).map((r) => ({ name: r.name, time: r.t / 100, me: r.me }));
    } catch {
      return [];
    }
  }

  function back() {
    if (S.mode === 'card') toRoute();
    else if (S.mode === 'route' || S.mode === 'daily') toYard();
    else if (S.mode === 'soloResults') toYard();
  }

  function closed(reason) {
    setMode('closed');
    const text = reason === 'kicked' ? 'You were removed' : reason === 'replaced' ? 'Playing in another tab' : reason === 'left' ? 'You left' : 'Connection lost';
    const label = reason === 'replaced' ? 'PLAY HERE' : reason === 'disconnected' ? 'REJOIN' : 'PLAY';
    ui.closed(text, label, () => location.reload());
  }

  // ------------------------------------------------------------ solo

  function startSolo(town, opts = {}) {
    audio.unlock();
    fx.clear();
    const daily = opts.daily;
    const world = createSoloWorld(town, daily !== undefined ? { daily } : {});
    R.setCity(world.city);
    R.clearMarks();
    const key = daily !== undefined ? 'daily' : `ghost-${town.id}`;
    S.solo = {
      town,
      daily,
      world,
      phase: 'intro',
      t: 0,
      acc: 0,
      rec: createRecorder(),
      ghost: null,
      par: parFor(town, daily !== undefined ? { daily } : {}),
      states: world.shift.houses.map(() => 'todo'),
      drops: 0,
      nonMat: 0,
      stuckT: 0,
      lastHoldT: 0,
      squash: 0,
      ghostDelta: null,
      first: !S.profile.played && town.id === 1 && daily === undefined,
      hinted: new Set(),
    };
    S.profile.played = true;
    setMode('solo');
    ui.clear('solo');
    // The ghost of the best run.
    if (ow) {
      ow.save
        .get(key)
        .then((g) => {
          if (!S.solo || S.solo.world !== world) return;
          if (daily !== undefined) g = g && g.day === daily ? g.ghost : null;
          S.solo.ghost = decodeGhost(g);
        })
        .catch(() => {});
    }
    // Swoop in from the whole town.
    const fit = fitTown(world.city);
    S.cam.x = fit.x;
    S.cam.y = fit.y;
    S.cam.zoom = fit.zoom;
    audio.music(town.music || 'sunny', false);
  }

  function restartSolo() {
    if (!S.solo) return;
    startSolo(S.solo.town, S.solo.daily !== undefined ? { daily: S.solo.daily } : {});
  }

  function nextTown() {
    const so = S.solo;
    if (!so || so.daily !== undefined) return;
    const town = TOWNS.find((t) => t.id === so.town.id + 1);
    if (town && S.profile.unlocked >= town.id) startSolo(town);
  }

  function pause() {
    if (!S.solo) return;
    S.solo.phase = 'paused';
    clearInput();
    ui.pause();
    audio.duck(true);
  }
  function resume() {
    if (!S.solo || S.solo.phase !== 'paused') return;
    S.solo.phase = 'drive';
    clearInput();
    ui.clear('solo');
    audio.duck(false);
  }

  /** Where to paint words ahead of a van: the middle of the road a tile or two ahead. */
  function paintAhead(van, tiles = 2) {
    const d = dirOf(van.h);
    const tx = Math.floor(van.x / T) + DX[d] * tiles;
    const ty = Math.floor(van.y / T) + DY[d] * tiles;
    const across = d === 0 || d === 2;
    return { x: across ? Math.floor(van.x / T) * T + T / 2 : (tx + 0.5) * T, y: across ? (ty + 0.5) * T : Math.floor(van.y / T) * T + T / 2, h: DIR_HEADING[d] };
  }

  function hint(id, lines, opts = {}) {
    const so = S.solo;
    if (!so || so.hinted.has(id) || noHints) return;
    if (S.profile.hints[id] && !opts.again) return;
    // One hint on the road at a time: two painted in one spot can't be read. A skipped one comes back the next time.
    if (fx.paint.some((p) => p.key.startsWith('hint:') && p.t < 0.35 + p.hold)) return;
    so.hinted.add(id);
    S.profile.hints[id] = 1;
    saveProfile();
    fx.spray(`hint:${id}`, { lines, ...paintAhead(so.world.van, opts.tiles || 2), width: 106, hold: opts.hold || 3.2 });
  }

  function updSolo(dt) {
    const so = S.solo;
    const w = so.world;
    if (so.phase === 'paused' || so.phase === 'done') return;
    so.t += dt;
    if (so.phase === 'intro') {
      w.step(false, false);
      if (so.t > 1.3) {
        so.phase = 'drive';
        w.shift.start();
        audio.play('go');
        if (so.first) hint('turn', ['HOLD', 'TO TURN', 'RIGHT'], { tiles: 3, hold: 5 });
      }
      return;
    }
    so.acc += dt;
    let steps = 0;
    while (so.acc >= DT && steps < 6 && so.phase === 'drive') {
      so.acc -= DT;
      steps++;
      const hold = S.autoDriver ? S.autoDriver.drive(w.van, w.botCtx(), DT) : holding();
      const events = w.step(hold);
      so.rec.add(w.shift.clock, w.van.x, w.van.y, w.van.h);
      for (const e of events) soloEvent(e);
      if (w.van.hold) so.lastHoldT = so.t;
      // Tyre marks while turning fast.
      if (w.van.hold && w.van.v > 150 && Math.floor(w.t * 30) % 2 === 0) R.mark(w.van.x - Math.cos(w.van.h) * 14, w.van.y - Math.sin(w.van.h) * 14, w.van.h, w.city.snow ? 'snow' : 'tyre');
      else if (w.city.snow && Math.floor(w.t * 30) % 3 === 0) R.mark(w.van.x, w.van.y, w.van.h, 'snow');
    }
    if (steps >= 6) so.acc = 0;
    // A stuck player (pressed on a wall with no input for 3 s) gets the hint again.
    if (w.van.v < 40 && so.t - so.lastHoldT > 3 && so.phase === 'drive') {
      so.hinted.delete('stuck');
      hint('stuck', ['HOLD', 'TO TURN'], { again: true, tiles: 1, hold: 2.5 });
      so.lastHoldT = so.t;
    }
    // The roundabout hint, the first time one is just ahead.
    if (!S.profile.hints.round) {
      const d = dirOf(w.van.h);
      const tx = Math.floor(w.van.x / T) + DX[d] * 2;
      const ty = Math.floor(w.van.y / T) + DY[d] * 2;
      if (w.city.at(tx, ty) === 'O') hint('round', ['HOLD TO', 'GO ROUND'], { tiles: 1 });
    }
    // Ghost delta at each delivery.
    if (so.ghost) so.ghostPos = ghostAt(so.ghost, w.shift.clock, so.ghostPos || {});
    audio.drive(true, w.van.v / 260, w.van.hold, w.van.hold && w.van.v > 200 ? 1 : 0);
    so.squash = Math.max(0, so.squash - dt * 4);
  }

  function soloEvent(e) {
    const so = S.solo;
    const w = so.world;
    const van = w.van;
    switch (e.type) {
      case 'drop': {
        so.drops++;
        const h = e.house;
        const i = w.shift.houses.indexOf(h);
        if (i >= 0) so.states[i] = e.mat ? 'mat' : 'done';
        so.rec.drop(w.shift.clock);
        throwParcel(van, h, false, e.mat, () => {
          if (e.mat) {
            audio.play('ding');
            fx.add('text', { x: h.doorX, y: h.doorY, text: '−2.0', color: '#FFC22E', size: 34 });
            fx.add('ring', { x: h.dropX, y: h.dropY, color: '#FFFFFF' });
            S.profile.mats++;
            if (S.profile.mats >= 10) award('doormat');
          } else fx.add('text', { x: h.doorX, y: h.doorY, text: '+1', color: '#F4F1E8' });
        });
        if (!e.mat) so.nonMat++;
        S.profile.deliveries++;
        if (S.profile.deliveries === 1) award('first-drop');
        // Ghost delta.
        if (so.ghost && so.ghost.drops[so.drops - 1] !== undefined) so.ghostDelta = { d: w.shift.clock - so.ghost.drops[so.drops - 1], t: so.t };
        // Tutorial hints.
        if (so.first && so.drops === 2) hint('left', ['THREE', 'RIGHTS', 'MAKE A', 'LEFT'], { hold: 4 });
        if (w.shift.needsDepot()) hint('depot', ['BACK TO', 'DEPOT']);
        if (so.nonMat >= 2 && !e.mat && so.drops >= 3) hint('mat', ['SLOW', 'THROUGH', 'THE MIDDLE'], { hold: 3.5 });
        break;
      }
      case 'load':
        audio.play('load');
        so.squash = 1;
        fx.spawn(van.x, van.y, 10, { color: ['#C8925A', '#FFC22E'], kind: 1, speed: 90, life: 0.5 });
        break;
      case 'done':
        finishSolo(e);
        break;
      case 'feat':
        award(e.id);
        if (e.id === 'roundabout-regular') audio.play('lap');
        break;
      case 'closures':
        fx.spray('cones', { lines: ['ROAD', 'WORKS'], ...paintAhead(van, 2), width: 100, hold: 1.5 });
        break;
      default:
        physicsFx(e, van);
    }
  }

  function physicsFx(e, van) {
    switch (e.type) {
      case 'crash':
        audio.play('crash');
        fx.kick(0.35);
        fx.spawn(e.x, e.y, 14, { color: ['#FFD27A', '#FFFFFF'], speed: 220, life: 0.35, size: 3 });
        break;
      case 'car':
        audio.play('bump');
        audio.play('horn');
        fx.kick(0.22);
        fx.spawn(e.x, e.y, 10, { color: ['#FFFFFF', '#FFD27A'], speed: 180, life: 0.3, size: 3 });
        break;
      case 'soft':
        audio.play('soft');
        fx.kick(0.1);
        fx.spawn(e.x, e.y, 12, { color: S.solo && S.solo.world.city.snow ? ['#FFFFFF', '#DCE6EE'] : ['#4E8F44', '#7DBA62', '#F26B1D'], kind: 1, speed: 140, life: 0.5, size: 5 });
        break;
      case 'scrape':
        if (Math.random() < 0.3) {
          audio.play('scrape');
          fx.spawn(e.x, e.y, 3, { color: '#FFD27A', speed: 160, life: 0.2, size: 2 });
        }
        break;
      case 'puddle':
        fx.spawn(e.x, e.y, 12, { color: ['#B8D4F0', '#FFFFFF'], speed: 120, life: 0.4, size: 3 });
        break;
      case 'bump':
        audio.play('bump');
        break;
      case 'nudge':
        if (Math.random() < 0.3) audio.play('horn');
        break;
      default:
    }
  }

  function throwParcel(van, house, gold, mat, onLand) {
    audio.play('throw');
    fx.add('throw', {
      x0: van.x,
      y0: van.y,
      x1: house.doorX,
      y1: house.doorY,
      gold,
      dur: mat ? 0.36 : 0.42,
      onDone() {
        audio.play('thud');
        fx.spawn(house.doorX, house.doorY, 8, { color: '#D8C9A8', kind: 2, speed: 50, life: 0.5, size: 4 });
        if (onLand) onLand();
      },
    });
  }

  async function finishSolo(e) {
    const so = S.solo;
    const town = so.town;
    so.phase = 'done';
    audio.play('whistle');
    audio.drive(false, 0, false, 0);
    fx.spray('done', { lines: ['SHIFT', 'DONE'], ...paintAhead(so.world.van, 1), width: 110, hold: Infinity });
    fx.spawn(so.world.van.x, so.world.van.y, 40, { color: ['#C8925A', '#FFC22E', '#F4F1E8', '#1E5BC6'], kind: 1, speed: 260, life: 1.2, size: 6 });
    const final = Math.round(e.final * 100) / 100;
    const stars = starsFor(final, so.par);
    let newBest = false;
    const ghost = so.rec.encode();
    if (so.daily !== undefined) {
      const d = S.profile.daily && S.profile.daily.day === so.daily ? S.profile.daily : { day: so.daily, best: null };
      if (!d.best || final < d.best) {
        newBest = !!d.best;
        d.best = final;
        S.profile.daily = d;
        try {
          if (ow) {
            ow.save.set('daily', { day: so.daily, best: final, ghost });
            const floor = minPlausible(estimateFor(town, { daily: so.daily }), DAILY_PARCELS);
            if (final >= floor) ow.data.game.push('daily', { d: so.daily, t: Math.round(final * 100) });
          }
        } catch {
          /* best effort */
        }
      }
      award('daily-driver');
    } else {
      const prev = S.profile.best[town.id];
      if (!prev || final < prev) {
        newBest = !!prev;
        S.profile.best[town.id] = final;
        try {
          if (ow) {
            ow.save.set(`ghost-${town.id}`, ghost);
            ow.leaderboards.submit(`town-${town.id}`, final, { lowerIsBetter: true });
          }
        } catch {
          /* best effort */
        }
      }
      S.profile.stars[town.id] = Math.max(S.profile.stars[town.id] || 0, stars);
      S.profile.unlocked = Math.max(S.profile.unlocked, Math.min(TOWNS.length, town.id + 1));
      if (TOWNS.every((t) => S.profile.best[t.id])) award('twelve-towns');
      if (TOWNS.every((t) => (S.profile.stars[t.id] || 0) >= 3)) award('all-stars');
    }
    if (so.world.shift.houses.length >= 9 && so.world.shift.crashes === 0) award('no-scratches');
    try {
      if (ow) ow.leaderboards.submit('deliveries', S.profile.deliveries);
    } catch {
      /* best effort */
    }
    saveProfile();
    so.result = { time: e.time, final, mats: e.mats, stars, newBest, at: S.t };
    setTimeout(() => showSoloResults(), 1100);
  }

  function showSoloResults() {
    const so = S.solo;
    if (!so || !so.result || S.mode !== 'solo') return;
    setMode('soloResults');
    const done = fx.paint.findIndex((p) => p.key === 'done');
    if (done >= 0) fx.paint.splice(done, 1);
    const r = so.result;
    const nextTown = so.daily === undefined ? TOWNS.find((t) => t.id === so.town.id + 1) : null;
    const handle = ui.results({ time: r.time, final: r.final, mats: r.mats, parcels: so.world.shift.houses.length, par: so.par, next: !!nextTown && S.profile.unlocked >= nextTown.id, bottom: bottomInset(false) + 18 });
    for (let i = 0; i < r.stars; i++) {
      setTimeout(() => {
        if (S.mode !== 'soloResults') return;
        handle.star(i);
        audio.play('star', i);
      }, 450 + i * 420);
    }
    if (r.newBest) fx.spray('best', { lines: ['NEW', 'BEST'], x: so.world.city.depot.x, y: so.world.city.depot.y - 140, h: -Math.PI / 2, width: 110, hold: Infinity });
  }

  // ------------------------------------------------------------ scramble

  function toScramble() {
    setMode('scramble');
    ui.clear('scramble');
    fx.clear();
    S.scr.follow = null;
  }

  function onMyDrop(res, p) {
    if (res === 'won') return;
    // Lost (or refused): the parcel bounces back onto the roof.
    const w = S.net && S.net.world;
    if (!w) return;
    w.me.p = Math.min(DELIVERY.perLoad, w.me.p + 1);
    audio.play('taken');
    fx.add('text', { x: w.me.van.x, y: w.me.van.y - 20, text: 'TAKEN', color: '#D9573B', size: 30 });
  }

  function onResults(standings, mine) {
    if (!mine || mine.place !== 1) return;
    S.profile.wins = (S.profile.wins || 0) + 1;
    try {
      ow.leaderboards.submit('wins', S.profile.wins);
    } catch {
      /* best effort */
    }
    saveProfile();
  }

  function updScramble(dt) {
    const net = S.net;
    if (!net || !net.match) return toYard();
    const m = net.match;
    const phase = m.phase;
    if (phase === 'lobby' || phase === 'countdown') return toYard();
    const w = net.ensureWorld();
    if (w && R.city !== w.city) {
      R.setCity(w.city);
      R.clearMarks();
    }
    if (m.roundId !== S.lastRound && phase === 'round') {
      S.lastRound = m.roundId;
      S.scr.lastCallAt = -1;
      S.scr.prevAddrs = null;
      if (S.autoDriver) S.autoDriver = createDriver({ skill: 1, seed: 5 });
      fx.clear();
      if (w) {
        const fit = fitTown(w.city);
        Object.assign(S.cam, { x: fit.x, y: fit.y, zoom: fit.zoom });
      }
      audio.music(w ? w.town.music : 'sunny', false);
    }
    if (phase === 'roundEnd' && S.lastPhase !== 'roundEnd') {
      audio.play('whistle');
      // Rush Hour: first place in a shift with 3 or more vans.
      const d = net.lastData;
      if (d && net.playing() && m.seats.length >= 3) {
        const mine = d.pts[net.room.me.id] || 0;
        if (mine > 0 && Object.values(d.pts).every((v) => v <= mine)) award('rush-hour');
      }
    }
    if (phase === 'results' && S.lastPhase !== 'results') audio.play('fanfare');
    S.lastPhase = phase;
    if (m.data && phase === 'round') net.lastData = m.data;
    if (phase === 'round' && w) {
      const auto = S.autoDriver && net.playing();
      const st = shiftTime(m);
      let hold = holding();
      if (auto) {
        const ctxW = scrambleCtx(w, m);
        hold = S.autoDriver.drive(w.me.van, ctxW, DT);
      }
      const events = net.step(hold);
      for (const e of events) scrambleEvent(e, w);
      if (net.playing()) {
        const v = w.me.van;
        audio.drive(st > 0, v.v / 260, v.hold, v.hold && v.v > 200 ? 1 : 0);
        if (v.hold && v.v > 150 && Math.floor(st * 30) % 2 === 0) R.mark(v.x - Math.cos(v.h) * 14, v.y - Math.sin(v.h) * 14, v.h, w.city.snow ? 'snow' : 'tyre');
      } else audio.drive(false, 0, false, 0);
      // Clock ticks and the last call.
      const left = Math.ceil(m.secondsLeft);
      if (left <= 10 && left !== S.scr.lastSecond && left > 0) audio.play('countdown');
      if (st <= 0 && left !== S.scr.lastSecond && m.elapsed > 200) audio.play('countdown');
      if (st > 0 && S.scr.wasIntro) audio.play('go');
      S.scr.wasIntro = st <= 0;
      S.scr.lastSecond = left;
      if (m.data && m.data.lastCall && S.scr.lastCallAt < 0) {
        S.scr.lastCallAt = S.t;
        audio.play('lastcall');
      }
      // Rings popping: addresses that closed since last frame.
      const ids = new Set((m.data ? m.data.addrs : []).map((a) => a.id));
      if (S.scr.prevAddrs) for (const a of S.scr.prevAddrs) if (!ids.has(a.id)) addrClosed(a, w, m);
      S.scr.prevAddrs = m.data ? m.data.addrs.slice() : [];
    } else audio.drive(false, 0, false, 0);
    publish(net.playing() && phase === 'round' ? 'play' : 'watch');
  }

  function scrambleCtx(w, m) {
    return { city: w.city, graph: graphFor(w.city, w.env.closed, `k${w.closureK}`), targets: scrambleTargets(w.city, m.data, w.me, houseTarget, depotTarget), env: w.env };
  }

  function scrambleEvent(e, w) {
    if (e.type === 'pass') {
      const p = e.pass;
      throwParcel(w.me.van, p.house, p.gold, p.mat, () => {
        if (p.mat) audio.play('ding');
        fx.add('text', { x: p.house.doorX, y: p.house.doorY, text: `+${(p.gold ? 3 : 1) + (p.mat ? 1 : 0)}`, color: p.gold ? '#FFD23F' : '#F4F1E8', size: p.gold ? 40 : 32 });
      });
      return;
    }
    if (e.type === 'load') {
      audio.play('load');
      return;
    }
    physicsFx(e, w.me.van);
  }

  function addrClosed(a, w, m) {
    const h = w.city.houses[a.house];
    if (!h) return;
    const log = m.data && m.data.log ? m.data.log[m.data.log.length - 1] : null;
    const by = log && log[1] === a.house ? log[0] : null;
    const idx = by ? S.net.seatIndex(by) : 0;
    fx.add('ring', { x: h.dropX, y: h.dropY, color: SEATS[idx % SEATS.length].color });
    if (by && by !== S.net.room.me.id) {
      audio.play('boop');
      // A rival's parcel flies to the porch too.
      fx.add('throw', { x0: h.dropX, y0: h.dropY, x1: h.doorX, y1: h.doorY, gold: a.gold, dur: 0.35 });
    }
    audio.play('ping');
  }

  // ------------------------------------------------------------ camera

  function fitTown(city, pad = 0.92, topPx = 0, bottomPx = 0, rightPx = 0) {
    const availH = Math.max(100, S.h - topPx - bottomPx);
    const availW = Math.max(100, S.w - rightPx);
    const zoom = Math.max(0.05, Math.min((availW * pad) / city.W, (availH * pad) / city.H));
    return { x: city.W / 2 + rightPx / 2 / zoom, y: city.H / 2 - (topPx - bottomPx) / 2 / zoom, zoom };
  }

  function follow(van, dt, city) {
    const lead = 110 * clamp(van.v / 260, 0, 1);
    const tx = van.x + Math.cos(van.h) * lead;
    const ty = van.y + Math.sin(van.h) * lead;
    // About 700 world px across the short side (less on a tall phone, so the vans stay big); a little more at speed so the
    // next turn is in view.
    const base = driveZoom();
    const tz = clamp(base * (1 - 0.08 * clamp(van.v / 260, 0, 1)), 0.4, 1.6) * zoomBoost;
    const k = 1 - Math.exp(-dt / 0.18);
    const kz = 1 - Math.exp(-dt / 0.6);
    S.cam.x += (tx - S.cam.x) * k;
    S.cam.y += (ty - S.cam.y) * k;
    S.cam.zoom += (tz - S.cam.zoom) * kz;
    clampCam(city);
  }

  function driveZoom() {
    return Math.max(Math.min(S.w, S.h) / 700, Math.sqrt(S.w * S.h) / 820);
  }

  function clampCam(city) {
    const z = S.cam.zoom;
    const hw = S.w / 2 / z;
    const hh = S.h / 2 / z;
    const m = 90;
    if (city.W + m * 2 < hw * 2) S.cam.x = city.W / 2;
    else S.cam.x = clamp(S.cam.x, hw - m, city.W + m - hw);
    if (city.H + m * 2 < hh * 2) S.cam.y = city.H / 2;
    else S.cam.y = clamp(S.cam.y, hh - m, city.H + m - hh);
  }

  function easeCam(target, dt, tau = 0.5) {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !(target.zoom > 0)) return;
    if (!Number.isFinite(S.cam.x) || !Number.isFinite(S.cam.y) || !(S.cam.zoom > 0)) Object.assign(S.cam, { x: target.x, y: target.y, zoom: target.zoom });
    const k = 1 - Math.exp(-dt / tau);
    S.cam.x += (target.x - S.cam.x) * k;
    S.cam.y += (target.y - S.cam.y) * k;
    S.cam.zoom += (target.zoom - S.cam.zoom) * k;
  }

  // ------------------------------------------------------------ layout helpers

  function reservedRects() {
    let live = null;
    try {
      live = ow && ow.ui ? ow.ui.reserved : null;
    } catch {
      live = null;
    }
    if (Array.isArray(live)) return live.filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h));
    const out = [{ kind: 'menu', x: 0, y: 0, w: 150, h: 70 }];
    if (S.mode === 'yard') out.push({ kind: 'lobby', x: 0, y: S.h - 88, w: S.w, h: 88 });
    return out;
  }
  function topInset() {
    let top = 12;
    // A menu across the top centre pushes things down; one in a corner doesn't.
    for (const r of reservedRects()) if (r.kind === 'menu' && r.y < 20 && r.x + r.w > S.w / 2 - 60 && r.x < S.w / 2 + 60) top = Math.max(top, r.y + r.h + 6);
    return top;
  }
  function bottomInset(lobby) {
    let b = 12;
    for (const r of reservedRects()) {
      if (r.kind === 'lobby' && lobby) b = Math.max(b, S.h - r.y);
      if (r.kind === 'menu' && r.y > S.h / 2) b = Math.max(b, S.h - r.y);
    }
    if (lobby && !reservedRects().some((r) => r.kind === 'lobby')) b = Math.max(b, 96);
    return b;
  }
  function menuRect() {
    return reservedRects().find((r) => r.kind === 'menu') || { x: 0, y: 0, w: 150, h: 70 };
  }
  /** The top-right corner for the clock, clear of the menu. */
  function clockSpot(r) {
    const menu = menuRect();
    let x = S.w - 16 - r;
    let y = 14 + r;
    if (menu.x > S.w / 2 && menu.y < 100) y = menu.y + menu.h + 10 + r;
    return [x, y];
  }

  // ------------------------------------------------------------ drawing

  function vanView(v, extra = {}) {
    return { x: v.x, y: v.y, h: v.h, v: v.v, hold: v.hold, stall: v.stall, spin: v.spin, braking: v.v < DELIVERY.matSpeed - 5 && v.stall <= 0, ...extra };
  }

  function draw(dt) {
    const g = R.ctx;
    if (S.mode === 'yard') return drawYardScene();
    if (S.mode === 'scramble' && S.net && S.net.match && S.net.match.phase === 'results') return drawResultsScene();
    let view = null;
    if (S.mode === 'title' && S.title) view = titleView(dt);
    else if ((S.mode === 'route' || S.mode === 'card' || S.mode === 'daily') && S.preview) view = previewView(dt);
    else if ((S.mode === 'solo' || S.mode === 'soloResults') && S.solo) view = soloView(dt);
    else if (S.mode === 'scramble' && S.net && S.net.world) view = scrambleView(dt);
    if (!view) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = PALETTE.asphalt;
      g.fillRect(0, 0, R.cv.width, R.cv.height);
      return;
    }
    view.cam = S.cam;
    view.paint = (view.paint || []).concat(fx.paint);
    view.drawWorldFx = (ctx) => {
      if (view.trail) drawTrail(ctx, view.trail);
      fx.drawWorld(ctx);
    };
    view.reduced = fx.reduced;
    R.frame(view);
    g.setTransform(R.pr, 0, 0, R.pr, 0, 0);
    if (view.hud) view.hud(g);
  }

  function weather(view, city, t, focus) {
    const town = city.town;
    if (town.night) {
      view.dark = 0.8;
      view.darkColor = '#0B1030';
      view.neon = true;
    } else if (town.dusk) {
      view.dark = 0.42;
      view.darkColor = '#3A1F3A';
    } else if (town.rain) {
      view.rain = true;
    }
    if (town.snow) view.snow = true;
    if (town.dust && focus) {
      const c = t % 25;
      view.dust = c > 18 ? Math.min(1, (c - 18) / 0.8, (25 - c) / 0.8) : 0;
      view.dustAt = focus;
    }
  }

  function titleView(dt) {
    const tw = S.title;
    tw.acc += Math.min(dt, 0.1);
    while (tw.acc >= DT) {
      tw.acc -= DT;
      tw.world.step();
    }
    const city = tw.world.city;
    // Frame the painted title on the avenue, above the Play sign.
    const zoom = clamp(Math.min((S.h * (S.h < 500 ? 0.36 : 0.42)) / 210, S.w < S.h ? S.w / 300 : S.w / 1050), 0.45, 2);
    const f = S.h < 500 ? 0.3 : 0.36;
    const target = { x: 5.5 * T + Math.sin(S.t * 0.25) * 10, y: 4.15 * T + ((0.5 - f) * S.h) / zoom, zoom };
    if (!tw.placed) {
      tw.placed = true;
      Object.assign(S.cam, target);
    }
    easeCam(target, dt, 0.8);
    const w = tw.world;
    const vans = w.runners.map((r, i) => vanView(r.van, { color: ['#FFC22E', '#F0573C', '#3EA6F0', '#37C98A'][i], body: BODY_IDS[[0, 1, 3, 5][i]], parcels: r.p }));
    const open = openList(city, w.data);
    return {
      t: w.t,
      env: w.env,
      vans,
      rings: open.map((o) => ({ x: o.house.dropX, y: o.house.dropY, gold: o.gold })),
      beacons: open.map((o) => ({ x: o.house.doorX, y: o.house.doorY - 10, gold: o.gold })),
      paint: [
        { lines: ['RIGHT', 'TURNS', 'ONLY'], x: 5.5 * T, y: 4.15 * T, upright: true, width: 112, max: 80, stretch: 1.45, alpha: 1 },
        { arrow: true, x: 5.5 * T, y: 2.45 * T, alpha: 1 },
      ],
    };
  }

  function previewView(dt) {
    const p = S.preview;
    p.t += dt;
    if (p.traffic) p.traffic.advanceTo(p.t);
    const city = p.city;
    const bottomUI = Math.min(S.h * 0.55, 420);
    const fit = fitTown(city, 0.94, topInset() + 40, S.mode === 'route' ? 0 : bottomUI);
    easeCam(fit, dt, 0.5);
    const view = { t: p.t, env: { cars: p.traffic ? p.traffic.bodies(p.t) : [], closed: new Set() }, bakeAll: true };
    weather(view, city, p.t, null);
    view.dark = view.dark ? view.dark * 0.6 : 0;
    return view;
  }

  function soloView(dt) {
    const so = S.solo;
    const w = so.world;
    const city = w.city;
    const van = w.van;
    if (S.mode === 'soloResults' || so.phase === 'done') {
      // The town beside the results on a wide screen, above them on a tall one.
      const panel = S.mode === 'soloResults' ? document.querySelector('.results') : null;
      let fit;
      if (panel && S.w > S.h * 1.25) {
        let left = S.w;
        for (const e of panel.children) if (!e.classList.contains('toast')) left = Math.min(left, e.getBoundingClientRect().left);
        fit = fitTown(city, 0.92, topInset() + 50, 12, S.w - left + 16);
      } else {
        const big = panel && panel.querySelector('.bigtime');
        fit = fitTown(city, 0.94, topInset() + 50, big ? S.h - big.getBoundingClientRect().top + 8 : Math.min(S.h * 0.45, 330));
      }
      easeCam(fit, dt, 0.6);
    } else if (so.phase === 'intro') {
      const k = clamp(so.t / 1.3, 0, 1);
      const fit = fitTown(city);
      const e = k * k * (3 - 2 * k);
      const near = { x: van.x, y: van.y, zoom: clamp(driveZoom(), 0.4, 1.6) };
      S.cam.x = fit.x + (near.x - fit.x) * e;
      S.cam.y = fit.y + (near.y - fit.y) * e;
      S.cam.zoom = fit.zoom + (near.zoom - fit.zoom) * e;
    } else follow(van, dt, city);
    const lit = so.phase === 'done' || S.mode === 'soloResults' ? [] : w.shift.lit;
    const depot = w.shift.needsDepot();
    const view = {
      t: w.t,
      env: w.env,
      vans: [vanView(van, { color: '#FFC22E', body: BODY_IDS[S.profile.body] || 'box', parcels: Math.min(3, w.shift.lit.length), squash: so.squash })],
      rings: lit.map((h) => ({ x: h.dropX, y: h.dropY })),
      beacons: lit.map((h) => ({ x: h.doorX, y: h.doorY - 10 })),
      depotGlow: depot && so.phase === 'drive',
      ghost: so.ghostPos && so.phase === 'drive' ? so.ghostPos : null,
      trail: S.mode === 'soloResults' ? w.shift.trail : null,
    };
    weather(view, city, w.t, van);
    if (so.phase === 'paused') view.desaturate = true;
    view.hud = (g) => soloHud(g, so, depot);
    return view;
  }

  function soloHud(g, so, depot) {
    if (S.mode === 'soloResults' || so.phase === 'paused') return;
    const w = so.world;
    const r = S.w < 500 ? 38 : 46;
    const [cx, cy] = clockSpot(r);
    const delta = so.ghostDelta && S.t - so.ghostDelta.t < 3 ? so.ghostDelta.d : null;
    clockSign(g, cx, cy, r, fmtTime(w.shift.final()), { sub: delta !== null ? `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}` : null, subColor: delta !== null && delta <= 0 ? '#6FAE5B' : '#FF8A6E' });
    // The manifest beside the menu when it fits at a good size, else under it.
    const menu = menuRect();
    const left = menu.x < S.w / 2 ? menu.x + menu.w + 10 : 16;
    const right = S.w - (r * 2 + 30);
    const box =
      right - left >= so.states.length * 26 + 16
        ? manifest(g, (left + right) / 2, 14, so.states, right - left)
        : manifest(g, 0, menu.y + menu.h + 14, so.states, S.w - (r * 2 + 30) - 16, 16);
    // Arrows to what's off screen.
    const targets = depot ? [{ kind: 'depot', x: w.city.depot.x, y: w.city.depot.y }] : w.shift.lit.map((h) => ({ kind: 'house', x: h.dropX, y: h.dropY }));
    arrowsFor(g, targets, w.van, [box, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 + 30 }]);
    if (so.phase === 'intro') {
      const n = Math.ceil(1.3 - so.t);
      outlined(g, so.town.name.toUpperCase(), S.w / 2, S.h * 0.34, Math.min(72, S.w / 9), '#F4F1E8');
      if (so.daily !== undefined) outlined(g, 'DAILY SHIFT', S.w / 2, S.h * 0.34 + 54, 28, '#FFC22E');
      else outlined(g, `PAR ${fmtTime(so.par)}`, S.w / 2, S.h * 0.34 + 54, 28, '#FFC22E');
      if (n > 0) outlined(g, 'READY', S.w / 2, S.h * 0.62, 40, '#F4F1E8');
    }
  }

  function arrowsFor(g, targets, van, avoid) {
    const toS = R.toScreen;
    if (!toS) return;
    const from = toS(van.x, van.y);
    const list = targets.map((t) => {
      const [sx, sy] = toS(t.x, t.y);
      return { ...t, sx, sy };
    });
    const top = Math.max(70, topInset() + 60);
    const box = { x0: 40, y0: top, x1: S.w - 40, y1: S.h - 44 - bottomInset(false) };
    edgeArrows(g, list, from, box, avoid.concat(reservedRects()), S.t);
  }

  function drawTrail(g, trail) {
    if (!trail || trail.length < 2) return;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(20,26,34,0.5)';
    g.lineWidth = 12;
    g.beginPath();
    trail.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
    for (let i = 1; i < trail.length; i++) {
      g.strokeStyle = trail[i][3] ? '#FFC22E' : '#F4F1E8';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(trail[i - 1][0], trail[i - 1][1]);
      g.lineTo(trail[i][0], trail[i][1]);
      g.stroke();
    }
    g.restore();
  }

  function seatLook(i, seat, body) {
    const s = SEATS[i % SEATS.length];
    return { color: s.color, symbol: s.symbol, body: BODY_IDS[body] || 'box' };
  }

  function scrambleView(dt) {
    const net = S.net;
    const m = net.match;
    const w = net.world;
    const city = w.city;
    const st = shiftTime(m);
    const intro = m.phase === 'round' && st <= 0;
    const between = m.phase === 'roundEnd';
    const playing = net.playing();
    const others = net.others();
    // Who the camera follows.
    let focus = null;
    if (playing) focus = w.me.van;
    else {
      const list = others.filter((o) => !o.away);
      if (S.scr.followNext && list.length) {
        S.scr.follow = list[(list.findIndex((o) => o.id === S.scr.follow) + 1) % list.length].id;
        S.scr.followNext = false;
      }
      if (!S.scr.follow || !list.some((o) => o.id === S.scr.follow)) {
        const stand = m.standings || [];
        const lead = stand.find((s) => list.some((o) => o.id === s.id));
        S.scr.follow = lead ? lead.id : list[0] ? list[0].id : null;
      }
      focus = list.find((o) => o.id === S.scr.follow) || null;
    }
    if (intro || between || !focus) easeCam(overviewFit(city, between), dt, 0.4);
    else follow(focus, dt, city);
    const data = m.data || net.lastData || { addrs: [], pts: {}, log: [] };
    const open = between ? [] : openList(city, data);
    const vans = [];
    const tagged = S.w >= 360;
    m.seats.forEach((seat, i) => {
      const look = seatLook(i, seat, 0);
      if (seat.me && playing) {
        vans.push(vanView(w.me.van, { ...seatLook(i, seat, S.profile.body), parcels: w.me.p, me: true }));
        return;
      }
      const o = others.find((v) => v.id === seat.id);
      if (!o) return;
      vans.push({
        x: o.x,
        y: o.y,
        h: o.h,
        v: o.v,
        hold: o.k,
        stall: o.s ? 1 : 0,
        braking: o.v < 200,
        parcels: o.p,
        color: look.color,
        symbol: look.symbol,
        body: seat.bot ? BODY_IDS[i % 4] : BODY_IDS[o.body] || 'box',
        away: o.away,
        tag: tagged ? seat.name : null,
      });
    });
    const view = {
      t: st,
      env: w.env,
      vans,
      rings: open.map((o) => ({ x: o.house.dropX, y: o.house.dropY, gold: o.gold })),
      beacons: open.map((o) => ({ x: o.house.doorX, y: o.house.doorY - 10, gold: o.gold, scale: o.gold ? 1.3 : 1 })),
      depotGlow: playing && w.me.p <= 0,
      chevrons: chevronsFor(open, vans),
    };
    weather(view, city, st, focus);
    view.hud = (g) => scrambleHud(g, m, w, open, intro, between, playing, focus, data);
    if (between) {
      const trails = [];
      m.seats.forEach((seat, i) => {
        const tr = net.trails.get(seat.id);
        if (tr && tr.length > 1) trails.push({ pts: tr, color: SEATS[i % SEATS.length].color });
      });
      view.trails = trails;
    }
    S.scr.view = view;
    return view;
  }

  /** Rivals heading for an address: a chevron in their colour at the ring's edge, at most two per ring. */
  function chevronsFor(open, vans) {
    const out = [];
    for (const o of open) {
      let n = 0;
      for (const v of vans) {
        if (v.me || n >= 2) continue;
        const dx = o.house.dropX - v.x;
        const dy = o.house.dropY - v.y;
        const d = Math.hypot(dx, dy);
        if (d > 520 || d < 80) continue;
        if (Math.abs(angleDiff(v.h, Math.atan2(dy, dx))) > 0.6) continue;
        const a = Math.atan2(-dy, -dx);
        out.push({ x: o.house.dropX + Math.cos(a) * (DELIVERY.ring + 14), y: o.house.dropY + Math.sin(a) * (DELIVERY.ring + 14), h: a + Math.PI, color: v.color });
        n++;
      }
    }
    return out;
  }

  const wideScreen = () => S.w > S.h * 1.1;

  /** The whole town for the intro and between shifts, kept clear of the standings plates. */
  function overviewFit(city, between) {
    const plateW = S.w < 600 ? 170 : 210;
    if (wideScreen()) return fitTown(city, 0.94, topInset() + 50, 20, plateW + 28);
    const seats = S.net && S.net.match ? S.net.match.seats.length : 6;
    const top = between ? topInset() + 80 + seats * 40 : Math.max(topInset() + 50, S.scr.platesBottom || 0);
    return fitTown(city, 0.94, top, 20);
  }

  function scrambleHud(g, m, w, open, intro, between, playing, focus, data) {
    const net = S.net;
    if (between) drawTrailsScreen(g, S.scr.view.trails);
    const r = S.w < 500 ? 38 : 46;
    const [cx, cy] = clockSpot(r);
    const left = Math.max(0, m.secondsLeft);
    const driveLeft = Math.min(left, ((net.room.settings && net.room.settings.shift) || 120 + SCRAMBLE.intro) - SCRAMBLE.intro);
    if (!between) clockSign(g, cx, cy, r, fmtClock(driveLeft), { red: driveLeft <= 10 });
    // Standings: this match's points so far.
    const totals = {};
    for (const s of m.seats) totals[s.id] = (m.scores[s.id] || 0) + (m.phase === 'round' ? data.pts[s.id] || 0 : 0);
    const order = m.seats.map((s, i) => ({ s, i })).sort((a, b) => totals[b.s.id] - totals[a.s.id] || a.i - b.i);
    let place = 0;
    let lastPts = null;
    const rows = order.map(({ s, i }, k) => {
      if (totals[s.id] !== lastPts) place = k + 1;
      lastPts = totals[s.id];
      return { place, name: s.name, pts: totals[s.id], color: SEATS[i % SEATS.length].color, symbol: SEATS[i % SEATS.length].symbol, me: s.me };
    });
    const narrow = S.w < 600;
    const plateW = narrow ? 170 : 210;
    if (between && wideScreen()) {
      // The town on the left, the standings beside it.
      const cxL = (S.w - plateW - 28) / 2;
      outlined(g, `SHIFT ${m.round} DONE`, cxL, topInset() + 40, Math.min(64, cxL / 4), '#F4F1E8');
      plates(g, S.w - plateW - 14, topInset() + 80, rows, plateW);
    } else if (between) {
      outlined(g, `SHIFT ${m.round} DONE`, S.w / 2, topInset() + 40, Math.min(64, S.w / 8), '#F4F1E8');
      plates(g, S.w / 2 - plateW / 2, topInset() + 80, rows, plateW);
    } else {
      let shown = rows;
      if (narrow) {
        shown = rows.slice(0, 3);
        const mine = rows.find((x) => x.me);
        if (mine && !shown.includes(mine)) shown = shown.concat([mine]);
      }
      S.scr.platesBottom = plates(g, S.w - plateW - 14, cy + r + 14, shown, plateW);
      shiftCones(g, S.w / 2, topInset() + 22, m.round, m.rounds);
    }
    if (intro && net.world) {
      outlined(g, net.world.town.name.toUpperCase(), S.w / 2, S.h * 0.42, Math.min(72, S.w / 9), '#F4F1E8');
      outlined(g, String(Math.max(1, Math.ceil(SCRAMBLE.intro - m.elapsed / 1000))), S.w / 2, S.h * 0.58, 96, '#FFC22E');
    }
    if (!intro && !between && focus) {
      const targets = [];
      if (playing && w.me.p <= 0) targets.push({ kind: 'depot', x: w.city.depot.x, y: w.city.depot.y });
      else for (const o of open) targets.push({ kind: o.gold ? 'gold' : 'house', x: o.house.dropX, y: o.house.dropY });
      arrowsFor(g, targets, focus, [{ x: S.w - plateW - 20, y: 0, w: plateW + 20, h: (S.scr.platesBottom || cy + r + 260) + 6 }]);
    }
    if (m.data && m.data.lastCall && S.t - S.scr.lastCallAt < 2.5 && !between) outlined(g, 'LAST CALL ×3', S.w / 2, S.h * 0.3, Math.min(60, S.w / 8), '#FFD23F');
    if (!playing && !between) outlined(g, 'WATCHING · NEXT SHIFT', S.w / 2, S.h - bottomInset(false) - 30, 24, '#F4F1E8');
  }

  function drawTrailsScreen(g, trails) {
    if (!trails || !R.toScreen) return;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const tr of trails) {
      g.strokeStyle = tr.color;
      g.globalAlpha = 0.85;
      g.lineWidth = 4;
      g.beginPath();
      tr.pts.forEach((p, i) => {
        const [x, y] = R.toScreen(p[0], p[1]);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
    }
    g.restore();
  }

  function yardSeats() {
    const net = S.net;
    const seats = [];
    const room = net && net.room;
    const players = room ? [...room.players.values()].filter((p) => p.connected !== false) : [];
    const meId = room && room.me ? room.me.id : 'me';
    if (!room) seats.push({ name: 'You', me: true, body: S.profile.body, ready: false, host: true });
    players.slice(0, 6).forEach((p) => {
      const pres = p.presence || {};
      seats.push({ name: String(p.name || 'Player').slice(0, 24), me: p.id === meId, body: p.id === meId ? S.profile.body : Number.isInteger(pres.body) ? clamp(pres.body, 0, 6) : 0, ready: !!p.ready, host: room.host === p.id });
    });
    let b = 0;
    while (seats.length < 6) {
      const bot = BOTS[b++ % BOTS.length];
      seats.push({ name: bot.name, empty: true, body: b % 4, bot: true });
    }
    return seats.map((s, i) => ({ ...s, color: SEATS[i].color, symbol: SEATS[i].symbol }));
  }

  function drawYardScene() {
    const g = R.ctx;
    g.setTransform(R.pr, 0, 0, R.pr, 0, 0);
    const posts = document.querySelector('.yard-top');
    const signs = document.querySelector('.yard-bottom');
    const top = Math.max(topInset(), posts ? posts.getBoundingClientRect().bottom + 10 : 80);
    const bottom = signs ? S.h - signs.getBoundingClientRect().top + 8 : bottomInset(true) + 80;
    drawYard(g, S.w, S.h, yardSeats(), { top, bottom }, S.t);
  }

  function drawResultsScene() {
    const g = R.ctx;
    g.setTransform(R.pr, 0, 0, R.pr, 0, 0);
    const m = S.net.match;
    const res = m.results || m.standings || [];
    const meId = S.net.room.me ? S.net.room.me.id : '';
    const rows = res.map((s) => {
      const i = m.seats.findIndex((x) => x.id === s.id);
      const look = SEATS[Math.max(0, i) % SEATS.length];
      const me = s.id === meId;
      // Players keep the van they chose (from their presence); bots a stock one.
      const pl = S.net.room.players.get(s.id);
      const pb = pl && pl.presence ? pl.presence.body : null;
      const body = me ? S.profile.body : Number.isInteger(pb) && pb >= 0 && pb < VAN_BODIES.length ? pb : Math.max(0, i) % 4;
      return { place: s.place, name: s.name, pts: s.points ?? m.scores[s.id] ?? 0, color: look.color, me, body };
    });
    drawPodium(g, S.w, S.h, rows, S.t, topInset() + 70, bottomInset(false) + 60);
    outlined(g, 'SHIFT SCRAMBLE', S.w / 2, topInset() + 34, Math.min(56, S.w / 9), '#F4F1E8');
    const mine = rows.find((r) => r.me);
    if (mine) outlined(g, `YOU: ${ordinal(mine.place)} · ${mine.pts} PTS`, S.w / 2, S.h - bottomInset(false) - 26, 28, '#FFC22E');
  }

  // ------------------------------------------------------------ the loop

  let last = performance.now();
  function frame() {
    // performance.now(), not the frame's timestamp: the two can disagree when the page's clock is driven (captures).
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    S.t += dt;
    try {
      tick(dt);
      fx.update(dt);
      draw(dt);
      audio.update();
    } catch (err) {
      console.error(err);
    }
    if (!document.body.dataset.ready && S.fontsReady && S.mode) document.body.dataset.ready = '1';
    requestAnimationFrame(frame);
  }

  function tick(dt) {
    const net = S.net;
    if (net && net.match) {
      const m = net.match;
      // A shift under way pulls a seated player in (a solo run ends when they're admitted to the next shift).
      const live = m.phase === 'round' || m.phase === 'roundEnd' || m.phase === 'results';
      if (live && net.playing()) {
        if (S.mode === 'title' || S.mode === 'yard' || S.mode === 'route' || S.mode === 'card' || S.mode === 'daily' || S.mode === 'soloResults') toScramble();
        else if (S.mode === 'solo' && m.phase === 'round') {
          ui.toast('SHIFT SCRAMBLE');
          toScramble();
        }
      }
      if (S.mode === 'yard' && S.t - (S.yardRefresh || 0) > 0.5) {
        S.yardRefresh = S.t;
        const sig = JSON.stringify([net.room.settings, net.room.isHost, m.phase === 'lobby', net.playing()]);
        if (sig !== S.yardSig) {
          S.yardSig = sig;
          renderYardUI();
        }
      }
    }
    switch (S.mode) {
      case 'title':
      case 'yard':
      case 'route':
      case 'card':
      case 'daily':
      case 'soloResults':
        if (net) publish(S.mode === 'yard' ? 'yard' : 'menu');
        break;
      case 'solo':
        updSolo(dt);
        if (net) publish('solo');
        break;
      case 'scramble':
        updScramble(dt);
        break;
      default:
    }
    if (S.mode !== 'solo' && S.mode !== 'scramble') audio.drive(false, 0, false, 0);
  }

  // Start.
  const to = params.get('autoplay-to');
  if (autoplay && params.get('scramble') === '1') {
    audio.unlock();
    toYard();
    const tryReady = () => {
      if (S.net && S.net.room) {
        try {
          S.net.room.setReady(true);
          if (S.net.room.isHost && S.net.room.canStart) S.net.room.startMatch();
        } catch {
          /* not yet */
        }
      }
      if (S.mode === 'yard') setTimeout(tryReady, 500);
    };
    setTimeout(tryReady, 800);
  } else if (autoplay) {
    const id = Number(params.get('town')) || 1;
    startSolo(TOWNS.find((t) => t.id === id) || TOWNS[0]);
  } else if (to === 'lobby') toYard();
  else {
    if (!production && params.get('title') === '1') audio.unlock(); // footage of the title with its music
    toTitle();
  }
  requestAnimationFrame(frame);
}

function defaultProfile() {
  return { v: 1, stars: {}, best: {}, unlocked: 1, body: 0, mats: 0, deliveries: 0, wins: 0, hints: {}, played: false, daily: null };
}

function totalStarsOf(p) {
  return TOWNS.reduce((a, t) => a + (p.stars[t.id] || 0), 0);
}

function ordinal(n) {
  return n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`;
}

