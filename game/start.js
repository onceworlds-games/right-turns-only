// The page's first script, kept small: it joins the platform's room before anything heavy loads. three.js, the town and the
// first frame are seconds of work on a slow machine (no GPU); begun at once they hold the page through the platform's
// handshake, and a reloaded page misses its seat. The game itself (main.js) loads once the room is in hand.

import { connect } from './net.js';

const ow = globalThis.onceworlds || null;
const params = new URLSearchParams(location.search);
// Capture flags only work off onceworlds.com: on the local platform (*.localhost) and the dev server.
const production = !import.meta.env.DEV && !/(^|\.)localhost$|^127\.0\.0\.1$/.test(location.hostname);
const game = () => import('./main.js');

if (params.has('poster')) {
  import('./poster.js').then((m) => m.renderPoster(params.get('poster')));
} else if (ow) {
  const joining = connect(
    ow,
    // Capture only: a one-shift match, straight to the podium.
    { shifts: !production && params.get('shifts') === '1' ? 1 : undefined },
  );
  // The game's code loads once the handshake is over (while the join goes on), and starts with the room in hand (or after 8 s
  // without an answer: the room is taken up when it comes).
  let shaken;
  try {
    shaken = typeof ow.ready === 'function' ? Promise.resolve(ow.ready()) : Promise.resolve();
  } catch {
    shaken = Promise.resolve();
  }
  const loading = shaken.then(game, game);
  Promise.race([joining.then((net) => ({ net })), new Promise((r) => setTimeout(r, 8000))]).then(
    (got) => loading.then((m) => m.boot(joining, got ? got.net : undefined)),
    () => loading.then((m) => m.boot(joining, null)),
  );
} else {
  game().then((m) => m.boot(Promise.resolve(null), null));
}
