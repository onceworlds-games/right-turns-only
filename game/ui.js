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
    van.append(el('div', '', 'YOUR VAN'), el('span', '', d.body));
    van.querySelector('span').style.color = '#141A22';
    van.addEventListener('click', (e) => {
      e.stopPropagation();
      h.body();
    });
    bottom.append(route, daily, van);
    if (d.invite) bottom.append(sign('blue', 'INVITE', h.invite));
    s.append(bottom);
    if (d.watching) {
      const w = el('div', 'sign blue watching', d.watching);
      w.style.top = `${d.top + 70}px`;
      s.append(w);
    }
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

  /** A town's card (or the daily's). d: { title, sub, best, two, three, par, top: [{ name, time, me }] | null, daily } */
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
    };
  };

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
