// The DOM over the canvas: every button is a real <button> dressed as a road sign. Screens are rebuilt when shown; names and
// other players' text only ever go in through textContent.

import { VAN_BODIES } from './config.js';
import { TOWNS } from './towns.js';
import { fmtTime } from './hud.js';

const CURL_SVG =
  '<svg viewBox="-50 -50 100 100" aria-hidden="true"><path d="M -30 22 A 31 31 0 1 1 31 12" fill="none" stroke="#F4F1E8" stroke-width="15"/><path d="M 14 6 L 48 6 L 31 34 Z" fill="#F4F1E8"/></svg>';
const STAR_SVG = (on) =>
  `<svg class="star${on ? ' on' : ''}" viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0,-11 L3.2,-3.6 L11,-3.4 L4.8,1.6 L7,9.4 L0,5 L-7,9.4 L-4.8,1.6 L-11,-3.4 L-3.2,-3.6 Z" fill="#FFC22E" stroke="#141A22" stroke-width="2" stroke-linejoin="round"/></svg>`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function sign(color, label, onClick, key) {
  const b = el('button', `sign ${color}`);
  b.type = 'button';
  b.append(el('span', '', label));
  if (key) b.append(el('span', 'key', key));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** Put the game's own SVG markup (constants above, never player text) into an element. */
const setSvg = (e, markup) => {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  e.replaceChildren(...doc.body.childNodes);
};

const MINI_STAR = (on) =>
  `<svg class="mini-star${on ? ' on' : ''}" viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0,-11 L3.2,-3.6 L11,-3.4 L4.8,1.6 L7,9.4 L0,5 L-7,9.4 L-4.8,1.6 L-11,-3.4 L-3.2,-3.6 Z"/></svg>`;
const LOCK_SVG =
  '<svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M-6,-2 V-5 A6,6 0 0 1 6,-5 V-2" fill="none" stroke="#141A22" stroke-width="3"/><rect x="-8" y="-2" width="16" height="12" rx="2" fill="#141A22"/></svg>';

/** n of `of` stars as shapes (never a font's glyphs), with an optional label after them. */
export function starsEl(n, of = 3, label = '') {
  const e = el('span', 'mini-stars');
  setSvg(e, Array.from({ length: of }, (_, i) => MINI_STAR(i < n)).join(''));
  if (label) e.append(el('span', '', label));
  e.setAttribute('aria-label', `${n} of ${of} stars`);
  return e;
}

export function createUI(root, h) {
  const ui = { name: '', root };
  let toastTimer = 0;
  const toastEl = el('div', 'toast');

  function screen(name, cls = '') {
    root.replaceChildren();
    ui.name = name;
    const s = el('div', `screen ${cls}`);
    root.append(s, toastEl);
    return s;
  }

  ui.toast = (text) => {
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1800);
  };

  ui.clear = (name = '') => {
    root.replaceChildren(toastEl);
    ui.name = name;
  };

  ui.title = () => {
    const s = screen('title');
    const b = el('button', 'play hit');
    b.type = 'button';
    b.setAttribute('aria-label', 'Play');
    const disc = el('span', 'play-disc');
    setSvg(disc, CURL_SVG);
    const label = el('span', 'play-label', 'PLAY');
    label.append(el('span', 'key', 'Space'));
    b.append(disc, label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      h.play();
    });
    s.append(b);
  };

  /** The yard: settings posts, the Route and Daily signs, your van, invite. */
  ui.yard = (d) => {
    const s = screen('yard');
    const top = el('div', 'yard-top');
    top.style.top = `${d.top}px`;
    for (const post of d.posts) {
      const wrap = el('div', 'post');
      const b = el('button', 'sign green');
      b.type = 'button';
      b.append(el('span', '', post.label));
      b.append(el('b', '', post.value));
      if (!post.onClick) b.disabled = true;
      else
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          post.onClick();
        });
      wrap.append(b);
      top.append(wrap);
    }
    s.append(top);
    const bottom = el('div', 'yard-bottom');
    bottom.style.bottom = `${d.bottom}px`;
    const route = el('button', 'sign green route-sign');
    route.type = 'button';
    const count = el('span', 'mini-stars');
    setSvg(count, MINI_STAR(true));
    count.append(el('span', '', `${d.stars}/36`));
    route.append(el('div', '', 'THE ROUTE'), count);
    route.addEventListener('click', (e) => {
      e.stopPropagation();
      h.route();
    });
    const daily = el('button', 'sign yellow route-sign');
    daily.type = 'button';
    daily.append(el('div', '', 'DAILY'), el('span', '', d.dailyTown));
    daily.querySelector('span').style.color = '#141A22';
    daily.addEventListener('click', (e) => {
      e.stopPropagation();
      h.daily();
    });
    const van = el('button', 'sign white route-sign');
    van.type = 'button';
    van.append(el('div', '', 'GARAGE'), el('span', '', d.body));
    van.querySelector('span').style.color = '#141A22';
    if (d.garageNew) van.append(el('i', 'new-dot'));
    van.addEventListener('click', (e) => {
      e.stopPropagation();
      h.garage();
    });
    bottom.append(route, daily, van);
    if (d.invite) bottom.append(sign('blue', 'INVITE', h.invite));
    s.append(bottom);
    // The courier's card: rank, the streak and today's jobs.
    if (d.career) s.append(careerCard(d.career, d.top));
    if (d.watching) {
      const w = el('div', 'sign blue watching', d.watching);
      w.style.top = `${d.top + 70}px`;
      s.append(w);
    }
  };

  /** Rank, the streak and today's three jobs, top left of the yard. */
  function careerCard(c, top) {
    const card = el('div', 'career');
    card.style.setProperty('--ctop', `${top}px`);
    const head = el('div', 'career-head');
    const badge = el('div', 'rank-badge', String(c.rank));
    const txt = el('div', 'career-title');
    txt.append(el('b', '', c.title.toUpperCase()));
    const bar = el('div', 'rank-bar');
    const fill = el('i', '');
    fill.style.width = `${Math.round(c.k * 100)}%`;
    bar.append(fill);
    txt.append(bar);
    head.append(badge, txt);
    if (c.streak > 0) head.append(el('div', 'streak-chip', `${c.streak}`));
    card.append(head);
    const list = el('ul', 'slip-jobs');
    for (const j of c.jobs) {
      const li = el('li', j.done ? 'done' : '');
      const pb = el('span', 'jp');
      const pf = el('i', '');
      pf.style.width = `${Math.round(j.progress * 100)}%`;
      pb.append(pf);
      li.append(el('span', 'tick', j.done ? '✓' : ''), el('span', 'jt', j.text), j.done ? el('b', '', 'DONE') : pb);
      list.append(li);
    }
    card.append(el('div', 'career-sub', 'TODAY'), list);
    return card;
  }

  /**
   * The garage: tabs for the van, its paint, a roof topper and a flow trail. d: { tab, rank, tabs: { id: { label, items:
   * [{ id, name, swatch, locked, cond, on }] } } }. Picking calls h.pick(tab, id); tabs h.garageTab(tab); back h.back().
   */
  ui.garage = (d) => {
    const s = screen('garage', 'garage-screen');
    const p = el('div', 'panel garage');
    const head = el('div', 'garage-head');
    head.append(el('div', 'board-title', 'GARAGE'), el('div', 'garage-rank', `RANK ${d.rank} · ${d.title.toUpperCase()}`));
    p.append(head);
    const tabs = el('div', 'tabs');
    for (const [id, t] of Object.entries(d.tabs)) {
      const b = el('button', `tab${id === d.tab ? ' on' : ''}`, t.label);
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        h.garageTab(id);
      });
      tabs.append(b);
    }
    p.append(tabs);
    const items = el('div', 'items');
    for (const it of d.tabs[d.tab].items) {
      const b = el('button', `item${it.on ? ' on' : ''}${it.locked ? ' locked' : ''}`);
      b.type = 'button';
      const sw = el('span', 'swatch');
      if (it.swatch) sw.style.background = it.swatch;
      if (it.locked) setSvg(sw, LOCK_SVG);
      b.append(sw, el('span', 'nm', it.name.toUpperCase()), el('span', 'cond', it.locked ? it.cond : it.on ? 'ON' : ''));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.locked) ui.toast(`${it.name.toUpperCase()}: ${it.cond}`);
        else h.pick(d.tab, it.id);
      });
      items.append(b);
    }
    p.append(items);
    const row = el('div', 'row');
    row.append(sign('white', 'BACK', h.back, 'Esc'));
    p.append(row);
    s.append(p);
  };

  ui.route = (d) => {
    const s = screen('route');
    const p = el('div', 'panel');
    p.append(el('div', 'board-title', 'THE ROUTE'));
    const stops = el('div', 'stops');
    TOWNS.forEach((town, i) => {
      const locked = i + 1 > d.unlocked;
      const b = el('button', `stop${locked ? ' locked' : ''}${i + 1 === d.unlocked && !d.best[town.id] ? ' next' : ''}`);
      b.type = 'button';
      const n = el('span', 'n', locked ? undefined : String(town.id));
      if (locked) setSvg(n, LOCK_SVG);
      b.append(n);
      const txt = el('span', '');
      txt.append(el('div', 'nm', town.name.toUpperCase()));
      const best = d.best[town.id];
      const st = el('div', 'st');
      if (locked) st.textContent = 'LOCKED';
      else st.append(starsEl(d.stars[town.id] || 0, 3, best ? fmtTime(best) : ''));
      txt.append(st);
      b.append(txt);
      // The town's challenge medal, once won.
      if (!locked && d.medals && d.medals[town.id]) {
        const m = el('span', 'medal', '★');
        m.title = 'Challenge medal';
        n.append(m);
      }
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (locked) ui.toast(`Finish ${TOWNS[i - 1].name} first`);
        else h.card(town);
      });
      stops.append(b);
    });
    p.append(stops);
    const row = el('div', 'row');
    row.append(sign('white', 'BACK', h.back, 'Esc'));
    p.append(row);
    s.append(p);
  };

  /** A town's card (or the daily's). d: { title, sub, best, two, three, par, top: [{ name, time, me }] | null, daily, challenge: { text, done } } */
  ui.card = (d) => {
    const s = screen('card');
    s.style.justifyContent = 'flex-end';
    const p = el('div', 'panel');
    const head = el('div', 'card-sign');
    head.append(el('div', '', d.title));
    head.append(el('span', '', d.sub));
    p.append(head);
    const facts = el('div', 'facts');
    const fact = (big, small) => {
      const f = el('div', 'fact');
      f.append(el('b', '', big), el('span', '', small));
      return f;
    };
    facts.append(fact(d.best ? fmtTime(d.best) : '--', d.daily ? 'YOUR BEST TODAY' : 'YOUR BEST'));
    const starFact = (time, n) => {
      const f = el('div', 'fact');
      f.append(el('b', '', fmtTime(time)), starsEl(n, n));
      return f;
    };
    facts.append(starFact(d.two, 2));
    facts.append(starFact(d.three, 3));
    p.append(facts);
    if (d.challenge) {
      const c = el('div', d.challenge.done ? 'challenge done' : 'challenge');
      c.append(el('b', '', d.challenge.done ? 'MEDAL ✓' : 'CHALLENGE'), el('span', '', d.challenge.text));
      p.append(c);
    }
    const list = el('ul', 'top5');
    if (!d.top) list.append(el('li', 'empty', 'Times load when you sign in'));
    else if (!d.top.length) list.append(el('li', 'empty', d.daily ? 'Nobody yet today. Be first.' : 'No times yet. Be first.'));
    else
      d.top.forEach((r, i) => {
        const li = el('li', r.me ? 'me' : '');
        li.append(el('span', '', `${i + 1}. ${r.name}`), el('span', '', fmtTime(r.time)));
        list.append(li);
      });
    p.append(list);
    const row = el('div', 'row');
    const go = sign('blue', 'DRIVE', h.drive, 'Space');
    row.append(go, sign('white', 'BACK', h.back, 'Esc'));
    p.append(row);
    s.append(p);
  };

  /** Solo results: d: { time, mats, final, stars, newBest, next } */
  ui.results = (d) => {
    const s = screen('results', 'results');
    s.style.paddingBottom = `${d.bottom}px`;
    const big = el('div', 'bigtime', fmtTime(d.final));
    s.append(big);
    s.append(el('div', 'subline', d.mats ? `${fmtTime(d.time)} − ${d.mats} doormat${d.mats > 1 ? 's' : ''} × 2.0 s` : `${d.parcels} parcels · par ${fmtTime(d.par)}`));
    const stars = el('div', 'stars');
    setSvg(stars, STAR_SVG(false) + STAR_SVG(false) + STAR_SVG(false));
    s.append(stars);
    const slip = d.pay ? paySlip(d.pay) : null;
    if (slip) s.append(slip.el);
    const row = el('div', 'row');
    row.style.display = 'flex';
    row.style.gap = '12px';
    row.style.flexWrap = 'wrap';
    row.style.justifyContent = 'center';
    const again = sign('blue', 'AGAIN', h.again, 'Space');
    row.append(again);
    if (d.next) row.append(sign('green', 'NEXT TOWN', h.next, 'Enter'));
    row.append(sign('white', 'YARD', h.yard, 'Esc'));
    s.append(row);
    return {
      star(i) {
        const st = stars.children[i];
        if (st) st.classList.add('on');
      },
      /** Run the pay slip: the tips count up, the rank bar fills. onTick(kind) for sounds. */
      pay(onTick) {
        if (slip) slip.run(onTick);
      },
    };
  };

  /** The pay slip under the stars: tips counting up, where they came from, the rank bar, today's jobs, the medal, unlocks. */
  function paySlip(r) {
    const box = el('div', 'slip');
    const head = el('div', 'slip-head');
    const coinEl = el('span', 'coin');
    const total = el('b', '', '+0');
    head.append(coinEl, total, el('span', 'slip-tips', 'TIPS'));
    if (r.streak > 1) head.append(el('span', 'chip streak', `${r.streak}-DAY STREAK`));
    box.append(head);
    const parts = el('div', 'slip-parts');
    const add = (label, n) => {
      const c = el('span', 'chip');
      c.append(el('span', '', label), el('b', '', `+${n}`));
      parts.append(c);
    };
    add('DRIVING', r.driven);
    for (const [label, n] of r.bonus) add(label, n);
    if (r.jobBonus) add('JOBS', r.jobBonus);
    box.append(parts);
    // Rank.
    const rank = el('div', 'slip-rank');
    const rl = el('div', 'rank-label');
    const rn = el('b', '', `RANK ${r.before.rank}`);
    const rt = el('span', '', r.before.title.toUpperCase());
    rl.append(rn, rt);
    const bar = el('div', 'rank-bar');
    const fill = el('i', '');
    bar.append(fill);
    const startK = r.before.max ? 1 : r.before.into / r.before.need;
    fill.style.width = `${startK * 100}%`;
    rank.append(rl, bar);
    box.append(rank);
    // Jobs.
    const jobs = el('ul', 'slip-jobs');
    for (const j of r.jobs) {
      const li = el('li', j.done ? 'done' : '');
      const tick = el('span', 'tick', j.done ? '✓' : '');
      const t = el('span', 'jt', j.text);
      const pb = el('span', 'jp');
      const pf = el('i', '');
      pf.style.width = `${Math.round(j.progress * 100)}%`;
      pb.append(pf);
      li.append(tick, t, j.done ? el('b', j.fresh ? 'fresh' : '', j.fresh ? `+${j.tips}` : 'DONE') : pb);
      jobs.append(li);
    }
    box.append(jobs);
    if (r.medal) {
      const m = el('div', 'slip-medal');
      m.append(el('b', '', 'MEDAL'), el('span', '', r.medal));
      box.append(m);
    }
    if (r.unlocks.length) {
      const u = el('div', 'slip-unlocks');
      u.append(el('b', '', 'NEW IN THE GARAGE'), el('span', '', r.unlocks.map((i) => i.name).join(' · ')));
      box.append(u);
    }
    return {
      el: box,
      run(onTick) {
        const t0 = performance.now();
        const dur = Math.min(1600, 500 + r.total * 1.2);
        const ranks = [];
        // The bar's path: from where it was, through any rank-ups, to where it is.
        let rk = r.before.rank;
        let from = startK;
        while (rk < r.after.rank) {
          ranks.push([from, 1, rk]);
          from = 0;
          rk++;
        }
        ranks.push([from, r.after.max ? 1 : r.after.into / r.after.need, rk]);
        let shownRank = r.before.rank;
        let lastTick = 0;
        const step = (now) => {
          if (!box.isConnected) return;
          const k = Math.min(1, (now - t0) / dur);
          const e = 1 - (1 - k) ** 3;
          total.textContent = `+${Math.round(r.total * e)}`;
          if (now - lastTick > 70 && k < 1) {
            lastTick = now;
            if (onTick) onTick('tick');
          }
          // Walk the bar segments in equal shares of the time.
          const seg = Math.min(ranks.length - 1, Math.floor(e * ranks.length));
          const [a, b, rkNow] = ranks[seg];
          const local = e * ranks.length - seg;
          fill.style.width = `${(a + (b - a) * Math.min(1, local)) * 100}%`;
          if (rkNow !== shownRank) {
            shownRank = rkNow;
            rn.textContent = `RANK ${rkNow}`;
            rank.classList.remove('up');
            void rank.offsetWidth;
            rank.classList.add('up');
            if (onTick) onTick('rank');
          }
          if (k < 1) requestAnimationFrame(step);
          else {
            rn.textContent = `RANK ${r.after.rank}`;
            rt.textContent = r.after.title.toUpperCase();
            if (r.after.rank > r.before.rank) rank.classList.add('up');
            if (onTick) onTick('done');
          }
        };
        requestAnimationFrame(step);
      },
    };
  }

  ui.pause = () => {
    const s = screen('pause');
    const band = el('div', 'band');
    const inner = el('div', 'band-inner');
    inner.append(el('h2', '', 'PAUSED'));
    const row = el('div', 'row');
    row.style.display = 'flex';
    row.style.gap = '12px';
    row.style.flexWrap = 'wrap';
    row.style.justifyContent = 'center';
    const resume = sign('blue', 'RESUME', h.resume, 'Esc');
    row.append(resume, sign('white', 'RESTART', h.restart, 'R'), sign('white', 'YARD', h.yard));
    inner.append(row);
    band.append(inner);
    s.append(band);
  };

  ui.closed = (text, label, onClick) => {
    const s = screen('closed');
    const band = el('div', 'band');
    const inner = el('div', 'band-inner');
    inner.append(el('p', '', text));
    inner.append(sign('blue', label, onClick));
    band.append(inner);
    s.append(band);
  };

  ui.bodyName = (i) => VAN_BODIES[i] ? VAN_BODIES[i].name.toUpperCase() : 'BOX VAN';
  return ui;
}
