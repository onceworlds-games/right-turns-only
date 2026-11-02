# Right Turns Only: design

## The pitch

**Your delivery van can only turn right. Deliver every parcel anyway.**

**The goal in one look:** a toy town from above, your yellow van rolling forward, a house lit up with a parcel bobbing over it
and a glowing ring painted on the road in front of it. Drive through the ring.

One button: hold it and the van curls right; let go and it drives straight. It never turns left and never stops. A left is three
rights around a block, a U-turn is a lap of a roundabout, and the town is a puzzle you solve at 260 px/s.

## Spec changes (and why)

- **No parcel "condition" stars.** Crashes already cost time (the stall). One fewer number to explain. The cost of crashing is
  time and the No Scratches badge.
- **No double-tap handbrake.** One button, the same everywhere. Depth comes from routing and timing, not a second input.
- **Delivery made visible.** Passing through the ring always delivers (no hidden speed rule). The doormat bonus is the ring's
  painted bullseye, taken while slowed (brake lights on). "Slowly enough or close enough" becomes something you can see.
- **Heading snap** (new, needed). Released near a road's direction, the van eases onto it. A one-button car that can only
  correct to the right would drift into kerbs forever without it. It only acts while the button is up, so it never fights a
  turn the player is making, and it has no visual: it just feels like good steering.
- **Roundabouts and turning bulbs are loop zones.** Holding inside one orbits its centre on the traffic lane, so a U-turn is a
  held button, not a fight with the kerb.
- **Left-hand traffic.** Roundabouts then flow clockwise, the same way the van curls: hold and you flow round with the cars.
- **Seaside town:** one-way streets and a bridge, no hills (a top-down camera can't show them).
- **Pedestrians always leap clear.** Never hit; they're comedy, not a penalty.
- **Multiplayer shift defaults to 2:00** (3:00 is a host option). Three 3:00 shifts with intros and results is ~11 minutes,
  long for strangers; 2:00 gives ~7.5.
- **Last call** (new): 20 s before a shift ends, one golden address worth 3 appears for everyone. It makes the end a scramble
  and gives a trailing van a way back.
- **Unlockable vans** (new, cosmetic): star totals unlock six more van bodies. Same size and handling.
- **The daily board** is a shared list in `ow.data.game`, because platform leaderboards keep a best-ever and can't reset daily.
- **A career on top of the clock** (new in the rebuild): flow, tips, ranks, a garage, daily jobs, a streak and a challenge
  per town. The clock and the stars still measure a shift; tips say how well it was driven, so a slow, clean, stylish run
  still pays, and every shift moves something forward.
- **Express parcels** (new): one timed gold parcel per shift from town 3, a reason to break the plan.
- **3D** (new): the town, vans, traffic and people are a miniature in three.js instead of flat sprites. The camera stays
  north-up so routes can still be learned.

## The first minute

A first-time player (no save) who is alone in the room goes from Play straight into town 1. Anyone else goes to the yard.

| Time | Screen | Hint (road paint, then gone) |
|---|---|---|
| 0 s | **Title.** The camera hangs over a wide street with RIGHT TURNS ONLY painted on the asphalt in giant road-marking letters around a painted right-turn arrow. Bot vans curl through the shot, deliver to lit houses, loop a roundabout. One big Play sign. | none |
| ~2 s | Tap Play (or Space). Sound starts. A first-timer alone drops straight into Maple Row: the camera settles on the depot for a 1.3 s intro, then a horn and GO. | none |
| 3 s | The van rolls out of the depot with three parcels on its roof rack. Lit houses with rings on the road; yellow edge arrows point at the ones off screen. The clock sign starts. | `HOLD TO TURN RIGHT` painted on the road ahead |
| ~6 s | The first junction. Holding blinks the right indicator (tick-tock) and the van curls round; let go near the new road and it straightens by itself. Missing it bumps a kerb (a short stall). | |
| ~10 s | First ring: the parcel flies to the porch, thud, +1, the manifest ticks. | |
| ~20 s | Second delivery. The next house is usually behind or to the left. | `THREE RIGHTS MAKE A LEFT` |
| ~30 s | The roof rack is empty; the edge arrow turns blue and points at the depot. | `BACK TO DEPOT` |
| any | A roundabout ahead: holding glides the van round it; letting go exits. | `HOLD TO GO ROUND` |
| 40-60 s | Free deliveries. A slow pass through a ring's centre lands one on the doormat: ding-dong, −2.0 s on the clock. | `SLOW THROUGH THE MIDDLE` after two drops that missed the mat |
| ~60 s | Sixth parcel: a beat of slow motion, `SHIFT DONE` sprayed on the road, then the results: the route drawn over the town, the time, stars stamping in, the tips counting up on the pay slip, the rank bar filling and the first garage unlock. Again / Next town. | |

Each hint shows once ever (flags in `ow.save`), except one that returns for a stuck player (pressed against a wall without
turning: `HOLD TO TURN`). Hints are short stacked words painted on the road, at least 18 px on a phone.

## Controls

| | Keyboard / mouse | Phone / tablet |
|---|---|---|
| Turn right (hold) | Space, →, D, or hold the left mouse button anywhere | Hold anywhere on the screen |
| Pause (solo) | Esc, P | the platform menu pauses |
| Restart shift (solo) | R | Again on the pause card |
| Next town (solo results) | Enter | the NEXT TOWN sign |
| Watching a scramble | click to follow the next van | tap |
| Menus | Enter / Space on the focused sign, Esc back | tap |

No stick, no touch buttons: `ow.controls.set(null)` everywhere, and the whole screen is the button. `touch-action: none`,
`user-select: none`, `-webkit-touch-callout: none`, pointer events with capture, so a long hold never selects or opens a callout.
A key held when a screen changes doesn't count until it's pressed again (`event.repeat` ignored).

## The core loop and where mastery comes from

**Loop:** load at the depot (3 parcels) → pick an order → route there in right turns → pass through each ring → back to the
depot → repeat until the shift's parcels are gone.

**Handling** (all of it, in `physics.js`):
- Always drives forward. Speed eases to 260 px/s straight, 170 px/s while turning.
- Yaw 150°/s while held (ramps in over 60 ms), at any speed: slowed, the van pivots almost on the spot.
- The arc starts wide (radius ~99 px at 260) and tightens (~65 px at 170) as the turn slows you. A tap is a gentle swerve, a
  hold a tight curl.
- Released near a road's direction on a road tile, it eases onto it (at most 170°/s, slower as it closes): within 22° back
  toward the road it just turned onto, 32° ahead after a real held turn (45° or more), 20° either way after a tap. Never while
  held, never in parks or loop zones.
- In a loop zone (a mini-roundabout or a turning bulb), holding orbits the zone's centre at 115 px/s on a 30 px ring, the same
  line the traffic takes; letting go leaves on the heading it has.
- It follows a car ahead (eases off within 46 px) instead of rear-ending it.
- Wall hit at more than 40° and more than 110 px/s into it: bonk, bounce back 18 px, stall 0.7 s (hazards blink, steam).
  Shallower: it scrapes along the wall (sparks, speed ×0.92, heading eases toward the wall's line).

**A beginner** holds too long, overshoots, bumps kerbs, chases the house nearest as the crow flies (often the far side of a
long loop) and drives down the middle of the road, so the parcel lands off the mat.

**An expert:**
- Routes in rights: picks the delivery order by right-turn distance, not straight-line distance.
- Uses roundabouts and cul-de-sac bulbs as free U-turns, and cuts through parks on the diagonal.
- Starts turns early or late to choose the line out of a corner (inside lane for the next right).
- Times crossings with the traffic lights and threads gaps.
- Feathers: two quick taps slow the van to ~210 without changing direction (the snap pulls it straight). Through a bullseye
  that's a doormat on a straight street.
- Reloads on the way past with one parcel left instead of driving back empty.

## Solo

Everything solo is reached from the yard and plays in the same screens.

**The Route: 12 towns**, unlocked in order (finish town n to open n+1). Each is a fixed shift with fixed parcels and traffic:
the same every time, so times compare, ghosts make sense and boards are fair.

| # | Town | Tiles | Parcels | What's new | Cars |
|---|---|---|---|---|---|
| 1 | Maple Row | 14×12 | 6 | Cul-de-sac bulbs, one roundabout, the first-time hints | 2 |
| 2 | Bramble Park | 16×11 | 9 | A big park to cut across (grass ×0.8 speed, trees solid) | 5 |
| 3 | Fiveways | 16×12 | 9 | Five roundabouts: the town of loops | 6 |
| 4 | Midtown | 18×12 | 9 | Tight downtown grid, traffic lights, one-lane alleys, buses | 14 |
| 5 | Gull Harbour | 18×13 | 9 | One-way streets (cars all flow one way), a harbour bridge, piers ending in turning bulbs | 10 |
| 6 | Frostby | 16×12 | 9 | Snow: the van slides wide (grip lag), snowbanks are soft, tracks stay in the snow | 6 |
| 7 | Neon Heights | 18×13 | 12 | Night: only headlights, streetlamps, signs and lit windows; targets glow | 12 |
| 8 | Dustwater | 20×12 | 12 | Desert: dust storms cut sight to ~230 px for 7 s every 25 s | 6 |
| 9 | Rainmoor | 18×13 | 12 | Rain: puddles make you skid straight for 0.45 s (no turning); people on zebra crossings | 10 |
| 10 | Coneyard | 18×13 | 12 | Roadworks: cone lines close different streets after each reload | 10 |
| 11 | Tramline | 20×14 | 12 | A tram loops the central boulevard: long, solid, rings its bell; lights | 14 |
| 12 | Twelve Bridges | 22×15 | 12 | Islands and bridges at dusk; two drawbridges lift for 6 s every 30 s; heavy traffic | 16 |

- **Stars:** ★ finish; ★★ within 30% of par; ★★★ within 6%. Par is computed, not stored: the right-turn route time of the best
  delivery orders (Dijkstra over the town, at the van's speeds) × 1.25. The best bot comes in under par on every town.
- **Score:** the clock runs from GO to the last delivery. Each doormat takes 2.0 s off.
- **Ghost of your best** for that town: a translucent white van with your best line. Shows ±seconds at each delivery.
- **Fast restarts:** R or Again restarts in under a second.
- **Daily shift:** one town (any of the 12, locked or not) and 9 parcels from the date's seed, the same for everyone that day.
  Unlimited tries, your best today with its ghost, and Today's top 10. A time under the town's floor (route estimate × 0.6 less
  every possible doormat) is never posted, and the card drops such rows when it reads the list.
- **How long it lasts:** 12 towns × 3 stars is 2-4 hours for a good player. The daily and the boards keep it going after.

## Multiplayer: Shift Scramble

- **Public game**, `rooms.join({ maxPlayers: 6, minPlayers: 1, lobby: 'bar', settings })`. A lone player readies and plays with
  5 bots. Private servers come from the platform.
- **Settings (host, in the yard):** Towns: Mixed / Easy (1-6) / Hard (7-12), default Mixed. Shift: 2:00 / 3:00, default 2:00.
  A change clears ready flags.
- **Lobby and ready-up:** the yard. The platform's bar draws Ready (public: everyone readies and the room counts down) or Start
  (a private server's host, lit when `room.canStart`). Joining never starts anything.
- **A match** = 3 shifts in 3 different towns (picked by `match.random`). The platform's countdown runs before shift 1. Each
  shift's round is the shift plus a 3 s intro at its start (123 s or 183 s): the whole town from above, the open addresses
  lit, a big 3-2-1 (time to plan), then a horn and GO.
- **Play:** every van starts at the depot with 3 parcels. Open addresses are lit for everyone: 3 for 1-2 vans, 4 for 3-4,
  5 for 5-6. **The first van through a ring takes it**: 1 point, +1 on the mat. A replacement lights up at once, never within
  480 px of any van. Reload at the depot. Vans bump each other harmlessly (a honk and a nudge).
- **Knock-offs:** a van driven hard into yours (doing 150 px/s or more straight at you) knocks a parcel off your roof
  (`KNOCKED OFF!`). It tumbles into the road where you were hit and lies there for 30 s, a white parcel floating low over
  the asphalt (`LOOSE!`), and the first van with room on its roof to drive over it (within 50 px) takes it (`+1 PARCEL`).
  Only the van that was hit loses one: ram someone from behind or the side and you keep yours; meet head on and you both
  lose one. Not at the depot (everyone crowds in to load), at most once every 1.5 s per van, at most 6 loose at once. Bots
  are knocked like anyone and go for a loose parcel on the road within 520 px (keenly with an empty roof), giving up on one
  they drove past. Sims (12 towns × 3 seeds, six bots, 2 minutes): about 9 knock-offs a shift, 85% picked up again, half
  within 3.4 s. Winning the grab for one earns the Finders Keepers badge.
- **Last call:** at 0:20 a golden address worth 3 lights up, a bell rings, and its arrow is gold. The host picks the house
  whose right-turn travel times from all present vans are closest together.
- **Winner:** most points over the 3 shifts; ties share a place. Between shifts: 7 s over the town map with every van's trail.
  After shift 3: 15 s podium, then the yard comes back.
- **Bots** fill to 6 seats (`createBots`, fill 6), players first. Each has a name, a driving style and a skill:
  Rosa (careful, goes for doormats, 0.7), Dex (rusher, 0.55), Mo (veteran, best routes, 0.82),
  Juno (rookie, chases the nearest house as the crow flies, 0.3), Pip (park shortcuts, 0.6), Vik (steady, 0.65).
  A bot's van is its seat colour with a name tag like everyone's. No "bot" labels.
- **Latecomers** watch (the camera follows the leader; tap to switch vans, a `NEXT SHIFT` plate) and join at the next shift in a
  bot's seat (`admit: 'round'`).
- **Leavers** keep their points. A van whose player is away parks with its hazards blinking; it vanishes if they leave.
- **Host change:** `createMatch` carries the match on. The new host takes the bots from the old host's last presence, or from
  the checkpoint in `match.data`.

**Netcode (who simulates what):**
- **Your van:** your page simulates it (fixed 60 Hz). Presence ≤20 Hz:
  `{ st: 'yard'|'route'|'play'|'watch', x, y, h (radians), v, k (holding), p (parcels 0-3), s (stalled), body, tp (topper), wr (parcel wrap), r (round id) }`. Others draw it
  with `room.presenceAt(id, { angles: ['h'], snap: 200 })`. It is never corrected by the network.
- **Bots:** simulated on the host's page with the same physics, published in the host's presence as
  `b: { 'bot:1': { x, y, h, v, k, p } }` (presenceAt interpolates nested fields). Checkpointed into `match.data.bots` every 2 s.
- **Traffic, lights, pedestrians, trams, drawbridges:** a pure function of the town's seed and the shift clock
  (`match.elapsed`), stepped at a fixed 30 Hz on every page. Cars never react to vans, so every page agrees. Each page resolves
  only its own van against them (the host also resolves the bots).
- **Bumps** between vans are local: each page nudges only its own van away from others' drawn positions. A hard hit is
  decided by the page of the van that was hit (from the other van's drawn speed and heading): it takes the parcel off its
  own roof and calls `host.rpc('knock', { x, y })` (rate 2/s); the host checks that the sender and another van were within
  160 px of that spot and puts `{ id, x, y, at }` into `match.data.loose`. Picking one up is a claim,
  `host.claim('grab', { args: { l }, key: l })`: the earliest van within 130 px (the parcel settled for 0.6 s) wins; the
  grabber's page shows the parcel on its roof at once and takes it back if the claim is lost. The host clears parcels older
  than 30 s. Bots knock and grab through `host.callAs` with the same checks.
- **Deliveries** go through a claim: `host.claim('drop', { args: { a: t.string(12), m: t.boolean() }, key: (a) => a.a,
  rate: 4 })`. The host checks that the address is open, the round is playing, the sender has a parcel and its latest position
  is within 150 px of the ring. It applies the earliest valid claim by the room's clock, then writes `match.data`:
  `{ town, addrs: [{ id, house, gold }], seq, pts: {seat: n}, mats: {seat: n}, log: [[seat, house, mat, gold, ms]] (last 12),
  bots, lastCall, loose: [{ id, x, y, at }] }`. Bots call the same claim through `host.callAs`.
- **What you see at once:** the throw plays immediately on your page and your parcel count drops. A lost claim bounces the
  parcel back onto your roof with `TAKEN` and the winner's colour; a won claim was already shown.
- **Scores:** `score(m)` returns `m.data.pts`, and the helper totals them. Only the host writes them.
- **Validation:** every presence field is type- and range-checked (finite numbers inside the town, ints in range, known
  strings). Names are drawn only with `fillText`/`textContent`.

## Progression and reasons to come back

The clock and the stars measure a shift. **Tips** measure how well it was driven, and tips are the career (`career.js`, pure
and node-tested).

- **Flow, x1 to x5** (the meter bottom left). Good driving fills it:

  | Move | Points |
  |---|---|
  | A right turn held to 45° or more | 1 |
  | A *perfect* turn: settled within 5° of a road's direction 0.35 s after letting go, no scrape | 2 |
  | A close call: a car passes within 40 px (52 px crossing your way) while you do over 150 px/s, untouched | 1.5 |
  | A delivery / on the mat | 1 / 2.5 |
  | A roundabout lap | 2 |
  | Three rights in a row (a left the long way) | 3 |
  | An express parcel | 3 |

  Levels at 4, 10, 18 and 28 points (cap 34). After 3 s of nothing it drains 0.6 points/s, never below the level reached. A
  crash empties it, a scrape takes 2 points. Each level adds 1.8% top speed. A level up flashes the meter, punches the camera in,
  plays a chord and lowers the camera a little; from x3 the van leaves its trail.
- **Tips** per delivery: 10, +10 on the mat, up to +9 for a quick drop (under 12 s since the last drop or load), +40 for an
  express, all times the flow level. A shift adds 25 per star, 50 for a first clear, 20 for a new best and 100 for the town's
  challenge. The coin counter top right counts up as they land.
- **Express parcels** (from town 3, not in the daily): with the second load `EXPRESS CALL` is sprayed on the road and a gold
  parcel lights up off the shift's list with a 32 s plate over it. Missed, it just goes; delivered, +40 tips before the flow.
- **Ranks:** thirty titles, Trainee → Parcel Pup → Kerb Hopper → … → Senior Courier (10) → … → Clockwise Legend (30). Rank r to
  r+1 costs 80 + 45·r tips: about 21,900 in all, weeks of shifts. The rank bar fills on the pay slip; a rank up stamps the new
  title with a fanfare.
- **The garage** (from the yard): the van turns on a turntable at the depot and changes as you tap.
  - Vans (stars, same size and handling): Box Van (0), Bread Van (6★), Pickup (12★), Mail Truck (18★), Tuk-tuk (24★),
    Ice-Cream Van (30★), Golden Van (36★).
  - Paints (13): Courier Yellow, then a new one every few ranks (Post Red at 2 … Tangerine at 21), Teal for 10 jobs, Chrome for
    a 7-day streak, Gold for 36 stars.
  - Toppers on the roof (9): a traffic cone (rank 3), a pennant, a rubber duck (3-day streak), a light bar, a parcel tower, a
    satellite dish, a pine tree (6 town challenges), a crown (all 12).
  - Flow trails (7): sparks, confetti, bubbles, rainbow, stars, flames, from x3 flow.
  - Parcel wraps (7), on the roof, in the air, on the mat and over the addresses: brown paper, Priority Blue (rank 4),
    Fragile (8), Gift Wrap (13), Neon (19), Mint Box (40 jobs), Royal Purple (3 medals).
  - Locked items show what opens them. New ones are announced on the pay slip (`NEW IN THE GARAGE`) and the garage sign
    gets a dot until you look. In a scramble your van keeps its body and topper and takes your seat colour.
- **Daily jobs:** three a day from eleven kinds (land n on the mat, n perfect turns, reach flow xn, n close calls, lap a
  roundabout, n clean shifts, an express, n stars, n tips, n shifts, n parcels), the same for everyone that day, 50-80 tips each,
  paid once. On the courier's card in the yard and on the pay slip.
- **The streak:** a shift on consecutive days builds it (the flame chip on the card); a missed day starts again. Chrome
  paint at 7 days, the Stars trail at 14.
- **Town challenges** (a medal each, 100 tips once): Maple Row every parcel on the mat; Bramble Park no crash; Fiveways three
  roundabout laps; Midtown six close calls; Gull Harbour flow x5; Frostby no crash on the ice; Neon Heights three rights twice;
  Dustwater three stars; Rainmoor 12 perfect turns; Coneyard the express; Tramline 8 perfect turns and no crash; Twelve Bridges
  every parcel on the mat. Shown on the town card.
- **Stars, bests and ghosts:** stars per town (max 36), personal bests per town and for today's daily, the ghost of each best.
- **Leaderboards** (`ow.leaderboards`, 15 boards): `town-1`…`town-12` (seconds, lower is better), `wins`, `deliveries`
  (lifetime parcels) and `tips` (lifetime tips: the career).
- **Daily board:** `ow.data.game` list `daily` (`max: 100, bytes: 64`, declared in `onceworlds.json`). A player pushes
  `{ d: dayNumber, t: centiseconds }` when they beat their own best for today, and only when the time is at or above the
  day's floor. The daily card keeps today's entries, drops anything under the floor or malformed, takes each player's best
  and shows the top 10.
- **Saves** (`ow.save`): `profile` (stars, bests, unlocked town, body, tips, garage choices, medals, today's jobs and stats,
  the streak, lifetime mats/deliveries/wins, hint flags), `ghost-<town>` (5 Hz samples, quantised and delta-coded, about 3.4 KB
  for a 100 s run), `daily` (day, best, ghost).
- **Badges** (13):

| id | Name | Earned |
|---|---|---|
| `first-drop` | First Drop | Deliver your first parcel |
| `three-rights` | Three Rights | Three right turns of 60° or more (260° in all) within 6 s, outside loop zones |
| `doormat` | On the Mat | Land 10 parcels on the mat |
| `roundabout-regular` | Round and Round | A full 360° lap of a roundabout in one go |
| `rush-hour` | Rush Hour | First place (ties count) in a scramble shift with 3 or more vans |
| `twelve-towns` | Twelve Towns | Finish all 12 towns |
| `no-scratches` | No Scratches | Finish a 9+ parcel shift without a crash |
| `daily-driver` | Daily Driver | Finish a daily shift |
| `all-stars` | All Stars | Three stars in every town |
| `full-flow` | Full Flow | Reach flow x5 in a shift |
| `express` | Express | Deliver an express parcel in time |
| `senior-courier` | Senior Courier | Reach rank 10 |
| `finders-keepers` | Finders Keepers | Win the grab for a parcel knocked off another van in a scramble |

## Balance and timing

| Thing | Number |
|---|---|
| Tile | 120 px; roads are a full tile wide (two 60 px lanes) |
| Van | 48×28 px; collision = 3 circles r 13 at −15, 0, +15 px along its length |
| Speed | 260 straight, 170 turning; grass ×0.8; Frostby 240 straight |
| Acceleration | 420 px/s² below 170, 150 px/s² from 170 to 260; turning slows at 450 px/s² |
| Yaw | 150°/s, 60 ms ramp; heading snap within 22° back / 32° ahead after a held turn / 20° after a tap, ≤170°/s |
| Crash | >40° and >110 px/s into a wall: stall 0.7 s, bounce 18 px; a car takes >150 px/s: stall 0.5 s, bounce 14 px; hedges and snowbanks are soft (55% of speed kept, no stall) |
| Alleys | 60 px wide, straight, no cars |
| Loop zones | mini-roundabout: the junction tile with a painted dome, zone r 84; turning bulb r 96; held, the van orbits on a 30 px ring at 115 px/s |
| Delivery ring | r 74 round a drop point 24 px into the road from the kerb; thrown at the closest point of the pass |
| Doormat | closest pass ≤ 28 px and speed ≤ 210 px/s; solo −2.0 s, scramble +1 |
| Depot | drive through the load box (112×112 under the gantry): refills to 3 at once |
| Traffic | cars 120-150 px/s, buses 110, gap 58 px; lights 6 s green, 1.5 s amber, 0.5 s all-red (16 s cycle); stop line 66 px from a junction's centre |
| Weather | Frostby grip lag 170°/s; Rainmoor puddle skid 0.45 s; Dustwater storm 7 s every 25 s, sight 230 px; Neon light radius 260, headlight cone 340 px × 50°; drawbridges up 6 s every 30 s (barriers 1.5 s before) |
| Scramble | 6 seats, shift 120 s (or 180) plus a 3 s intro inside the round, round end 7 s, results 15 s; open addresses 3/4/5; respawn ≥ 480 px from every van; last call at 20 s left, worth 3; the host accepts a claim within 150 px of the ring |
| Camera | north-up; leads up to 110 px along the heading; zoom = max(short side / 700, √(w·h) / 820), −8% at full speed (0.4-1.6), so a phone sees ~700 world px across and the next address early |
| Shake | trauma +0.35 crash, +0.2 car, +0.1 scrape; offset = trauma² × 12 px, smooth sines; decays 1.4/s; none with reduced motion |

**Bots** (the same brain drives autoplay at skill 1):
- **Planning:** Dijkstra over (road tile, heading). Moves are straight on, a right turn where the right-hand tile is road (not
  out of an alley), and any arm out of a loop zone (cost by how far round). Park grass costs ×1/0.8. Costs are seconds at the
  van's speeds. The plan becomes a driving line: kept a little left of centre, rights round the inner corner, loops on the orbit.
- **Driving:** pure pursuit with one button: hold while a point a little way along the line is to the right. On straights only
  short taps (each small enough for the snap to straighten). In a loop zone: hold until facing the way out, then let go. Every
  0.1 s it rolls the physics 0.55 s ahead for its current input and, if that hits something, takes whichever of letting go, a
  tap or a hold hurts least. Stuck for 2.5 s: replan. A van follows vans ahead like cars.
- **Going by stopped traffic:** the van stays in the cars' lane, so a stopped car ahead holds it. When one is 20-220 px ahead
  it taps right to the centre line and passes. At a light it does that only if the light will be green its way from 0.3 s
  before it gets there to 1 s after (otherwise it waits like the cars); never at a zebra or a drawbridge. Measured over every
  town at four skills plus scramble sims, against never passing: route times −4%, crashes −15%, time crawling −17%. Always
  passing (red lights too) was slower and crashed twice as often in Midtown. What waiting is left is arriving at a red.
- **Traffic never locks up:** a car stuck 4 s behind others (not at a light) creeps on, stopping only for what touches its
  nose; if it jams again it slips through the cars in its way for 1.2 s. Before, a few towns could gridlock for minutes.
- **Skill 0.3 → 1.0:** "hands" (precision) 0.79 → 1.0, so every bot drives cleanly enough to watch; reaction 0.1 → 0.06 s;
  look-ahead noise; a missed-turn chance (12% → 0; it replans and loops). Choices carry most of the skill: nearest house as
  the crow flies below 0.5 (and the rookie), by route time above, contested addresses discounted from 0.8. Doormat attempts at
  0.7 and up (Rosa always).

**Checked in node tests** (`npm test`, 47 tests):
- Every town builds; every address is reachable in right turns from the depot; fixed shift houses per town.
- Handling: a held turn at a junction comes out a clean 90° when let go near the new road; a tap on a straight swerves and
  comes back; a held van rounds every turning bulb; crashes stall, scrapes and soft hedges don't.
- The best bot finishes every town within twice par with no NaN; a 0.3 bot finishes every town and is slower over the route;
  bots are deterministic for a seed.
- Traffic: over ten minutes no car in any town stands still for 30 s; stepping the clock in any increments gives the same
  traffic.
- Doormat and ring rules at the boundaries, loading, Coneyard's moving cones, stars against par and the daily floor, the pass
  tracker, ghost encoding and junk ghosts.
- Scramble sims (12 towns × 2 seeds × 6 bots, 120 s): 5-15 deliveries per van on average, no runaway, exactly one last call
  per shift; the real line-up all score and the veteran beats the rookie; new addresses never land on an open one or near a
  van; claims (open, closed, no parcels, too far, double); the last call goes to a house the vans are about equally far from.
- Career: flow levels, drain and crashes; perfect turns, sloppy turns, scraped turns and close calls from van and car
  motion; tips and shift bonuses; thirty ranks and their total; every garage item unlockable; daily jobs fixed per day;
  daily stats; the streak across days; every town's challenge passes a perfect shift and fails a poor one; settling a shift
  pays jobs and the medal once and never changes the profile it was given. The express parcel's call, timer and expiry.
- Knock-offs: only the van driven into loses a parcel (rear-end, T-bone, head on, a slow nudge, an empty roof, the
  cooldown, the depot); loose parcels' ids, cap, settling, reach, expiry and claims; a shift of six bots in every town keeps
  every roof at 0-3 parcels and never picks up a parcel that wasn't knocked loose; bots go for loose parcels on the road
  near them (more keenly with an empty roof) and give up on one they drove past. Over 12 towns × 3 seeds that is about 9
  knock-offs per two-minute shift, 85% picked up again, half of them within 3.4 s.
- Wraps: every wrap has its card and tape colours and can be unlocked; a settled shift announces the wraps it unlocks.
- Not covered by node tests: room flow through a fake room. On the local platform (`onceworlds check`): two players join one
  server, the match starts from the platform's lobby, the host reloads and comes back into the same server, the host
  leaves and the other player takes over.

## Every screen

1. **Title.** Full screen: the attract scene, a street of its own (`TITLE_TOWN`) with RIGHT TURNS ONLY painted big on the
   asphalt round a painted curling arrow, bot vans delivering and looping the mini-roundabouts, the camera drifting. The title
   is the road paint itself. Lower centre: the Play sign, a round blue mandatory-direction sign with the white curl and PLAY
   under it (112 px on phones, 136 px on big screens, 96 px on short landscape screens). Nothing else.
2. **The yard (lobby and hub).** The depot's forecourt in 3D, seen from the street.
   - Six numbered bays painted on the concrete under the depot's gantry, in one row (two staggered rows in portrait). Each
     seat's van stands in its bay in its seat colour, with its body and topper; an open seat keeps a dull stock van. Over each
     van: a name pill with the seat symbol (yours yellow), a courier cap on the host's, a green READY chip. A van hops when its
     player readies.
   - The courier's card top left: rank and title with its bar, the streak flame, today's three jobs with their progress.
   - Settings: two green signposts top right, `TOWNS / MIXED` and `SHIFT / 2:00`. Tap to cycle (the host, in the lobby);
     read-only for others.
   - Bottom row: THE ROUTE (stars n/36), DAILY (today's town), GARAGE (a dot when something new is in) and INVITE
     (`ow.ui.showInvite()`). The platform's Ready/Start bar sits under them; nothing of ours under it.
3. **Garage.** The camera drops low down the street to the turntable by the depot, the van turning on it.
   A panel (on the right on wide screens, under the van on phones) with five tabs: VAN, PAINT, TOPPER, TRAIL, WRAP. Swatches and
   names; locked ones are dimmed with what opens them (`RANK 8`, `7-DAY STREAK`, `6 MEDALS`). Picking one spins the
   turntable faster and bounces the van. BACK returns to the yard.
4. **Route board.** The 12 towns as a list of stops: number (or a padlock), name, stars and best. The town itself is drawn
   live behind. Tap a stop for its card: the name on a green sign, your best, the 2★ and 3★ times, the town's challenge (with its
   medal once won), the town's top 5, DRIVE and BACK.
5. **Daily card.** `DAILY · <town>`, 9 parcels, your best today, the 2★/3★ times, today's top 10, DRIVE.
6. **Play HUD (solo).**
   - Top right (below the platform's menu on phones): the clock, a white speed-limit sign with a red ring; the ghost delta
     under it for 3 s after each drop.
   - The manifest, one box per parcel (dashed outline, a parcel with a green tick, or a white tick for a doormat): top centre
     when there's room, else under the menu on the left.
   - Under the clock: the tips counter, a gold coin and the running total, counting up as tips land.
   - Bottom left: the flow meter, a road-sign plate with xN and five rising bars that fill; it flashes and grows on a level up.
   - Over an express house: the EXPRESS plate with its seconds left.
   - In the world: parcels on the van's roof, each address marked by a parcel floating on a pillar of light with a ring on the
     road, edge arrows to off-screen targets (yellow with a parcel; blue with the curl for the depot), road-paint hints, and
     words for the moves (`PERFECT`, `CLOSE!`, `ROUND!`, `THREE RIGHTS`) and the tips (`+30`) rising off the van.
   - HUD laid out from `ow.ui.reserved`, read live.
7. **Play HUD (scramble).**
   - Top right: the countdown clock sign (red in the last 10 s).
   - Under it: standings as stacked green exit-sign plates (place, seat symbol, name, points; top 3 plus yours on phones).
     Yours has a yellow border.
   - Top centre: three traffic cones for the shifts, the current one lit.
   - Name tags over vans. A rival heading for an open address within ~500 px gets a chevron in its colour at that ring's edge
     (at most two per ring), so you can see a race coming.
   - Intro: the town's name and a big 3-2-1 over the whole town. `LAST CALL ×3` when the golden address lights up.
   - Watching: the camera follows the leader, tap for the next van, `WATCHING · NEXT SHIFT` at the bottom.
8. **Between shifts.** The whole town from above with every van's trail in its colour, `SHIFT n DONE`, the plates. 7 s.
9. **Results (scramble).** The podium on the depot forecourt: three plinths (gold, silver, bronze), the top three vans on them
   with their toppers, the winner spinning donuts, confetti bursts, places 4-6 parked behind, a tag with the points over each,
   `SHIFT SCRAMBLE` and your place. The plinths go to the first three in place order, each as tall as the place of the van
   on it: two vans tied for first both stand on gold and spin. 15 s, then the yard.
10. **Results (solo).** The town from above beside or under the numbers, your route drawn over it in yellow and the drops
   marked. The final time huge, the doormat sum or the par under it, stars stamping in, `NEW BEST` painted at the depot. Under
   them the pay slip: the tips count up with a coin tick (DRIVING, STARS, NEW TOWN, NEW BEST, CHALLENGE, JOBS chips), the
   rank bar fills (a rank up stamps the new title), today's jobs tick off, the medal, the streak chip and `NEW IN THE GARAGE`.
   Signs: AGAIN (Space), NEXT TOWN (Enter), YARD (Esc). In landscape the numbers sit in a column on the right.
11. **Pause (solo).** A band across the middle reads PAUSED, with RESUME (Esc), RESTART (R) and YARD.
12. **Room closed.** A band with one line and one sign that reloads the page (removed / connection lost / another tab).

All buttons are real `<button>`s styled as signs: ≥56 px on phones, text ≥18 px, keycaps shown on desktop. Screens are
the 3D world with DOM signs over them.

## Art direction

**The world:** a miniature toy town in 3D, seen from a model-railway angle (a 30° lens tilted 59° down, north-up), built from
painted wood and road paint. It's the courier company Clockwise Couriers' patch, and its logo is a fat arrow curling right.
- Asphalt with grain, crisp white and yellow markings, concrete kerbs and paving, all drawn in the shader on merged geometry
  (one draw call per 4×4-tile chunk).
- Houses generated per lot from a seed: gables, hips and flat roofs with tiles, chimneys with smoke, porches with doormats and
  doors that open, gardens with fences, hedges, mailboxes, bins and dogs. Downtown blocks with shopfronts, awnings and painted
  shop signs; water with quays and drawbridges; parks with trees whose leaves move in the wind.
- People and cars are bought-in CC0 models (Quaternius: eight people, two dogs, seven cars; see CREDITS.md). The vans, buses
  and the tram are modelled in code.
- Light per town: a low warm sun with soft shadows, sky and fog colours, a grade. Night and dusk towns light street lamps,
  windows, headlights and neon in the shader (no light objects). After the scene: a tilt-shift band (sharp through the middle,
  soft above and below, the miniature look), bloom on lamps, neon and gold, the town's grade and a vignette.
- When the van goes behind a building, a round cutaway dissolves what's in front of it, so the van is never lost.
- Weather on the GPU round the camera: rain streaks and splashes (Rainmoor), snow (Frostby), sand storms that close the fog in
  (Dustwater), falling leaves (Maple Row, Bramble Park), fireflies at dusk.

**Palette (the game's own, on every screen):**

| Role | Hex |
|---|---|
| Asphalt (ground of UI and roads) | `#34383F` |
| Road paint white | `#F4F1E8` |
| Courier yellow (brand, targets, you) | `#FFC22E` |
| Sign blue (buttons, mandatory signs) | `#1E5BC6` |
| Lawn green (good) | `#6FAE5B` |
| Brake red (bad, crash, clock's ring) | `#D9573B` |
| Ink (outlines, text stroke) | `#141A22` |

Each town re-tints the ground and roofs (lawn, asphalt, a five-colour roof set, a light tint). Two examples:
- Maple Row: lawn `#7DBA62`, roofs `#E0694A #F2B544 #4FA3A0 #E98FA4 #8C6BD1`.
- Frostby: snow `#EEF3F7`, roofs `#B8442F #2F5D7C #E2B23A #5E8C61 #7A5A8C`.

**Fonts:** Barlow Condensed (OFL, after the condensed highway-sign alphabets), self-hosted woff2 in `game/fonts` with its
licence, latin only. Black 900 for road paint and big words, Bold 700 for names and small text. Canvas text waits for
`document.fonts.load` with a 1.5 s timeout.

**Signature element:** road paint. The title, every hint, `SHIFT DONE`, `NEW BEST`, `ROAD WORKS` and the bay names are
painted on the asphalt in white Barlow Condensed Black, stacked short words the way real lane markings read. Each appears
with a quick spray-on wipe and wears off when it's done. (`TAKEN`, `+1` and town names float as outlined text instead.) The curling-right arrow is the brand mark inside it: on vans, the depot roof, the Play sign and
the icon.

**Camera:** north-up (the map stays still so routes can be learned), leading along the heading. It leans into a held turn,
punches in on deliveries and flow level-ups, and comes a little lower as flow builds. The yard, garage and podium have their
own framings at the depot (the garage drops low down the street to the turntable).

**Vans:** seven bodies modelled in code (box van, bread van, pickup, mail truck, tuk-tuk, ice-cream van, golden van), each
on a sprung rig.
- Body in the van's paint (solo: your garage paint, courier yellow at first; scramble: the seat colour), the curl-arrow logo,
  glass, mirrors, wheels that roll and steer.
- Lights: headlights, brake lights that glow below 210 px/s (the doormat cue), the right indicator blinking at 2.5 Hz while you
  hold, hazards in a stall.
- Parcels strapped on the roof rack, the topper on top. Other vans carry a name tag.
- The body rolls out of turns, dips under the brakes, squashes on crashes, bounces on loading.
- Cars lean out of their turns and dip under the brakes, brake lights on as they slow; buses in Midtown, a tram in Tramline.
  Walkers gather at the kerb and cross the zebras (umbrellas in Rainmoor) and jump clear of a van; vans never touch them. At
  every delivery the resident opens the door, comes out to the mat, cheers and carries the parcel in.

**HUD in the world's language:** road signs (the clock is a speed-limit sign, standings are exit-sign plates, the Play button is
a mandatory-direction sign), traffic cones for the rounds, road paint for words. Text over the scene is white with a 4 px ink
outline or sits on a solid sign. Colour always comes with a shape: seat symbols (circle, triangle, square, diamond, star,
hexagon), gold addresses carry ×3.

**Juice:**
- Turning: the indicator ticks, the tyres squeal above 200 px/s and smoke when held at speed, tyre marks (snow tracks in
  Frostby) stay on the road.
- Moves: `PERFECT`, `CLOSE!`, `ROUND!` and `THREE RIGHTS` pop off the van; each feeds the flow meter, which flashes, grows and
  rings a chord on a level up while the camera punches in.
- Flow trails from x3: sparks, confetti, bubbles, rainbow, stars or flames behind the van (the garage's choice).
- Delivery: the parcel arcs from the roof to the mat, the resident comes out and cheers, a ring burst, the tips rise in
  green (gold for an express), the coin counter ticks, the camera punches in (harder for the mat and the express).
- Doormat: ding-dong, a white ring burst, −2.0 rising from the porch.
- Crash: a few frames of hit-stop, bonk, shake, steam, hazards, the flow meter empties.
- Loading: boxes fly onto the roof one by one with thunks.
- Address taken: the ring pops in the winner's colour.
- Last parcel: a beat of slow motion and a big punch in, then `SHIFT DONE` and confetti of tiny parcels.
- The pay slip counts up with coin ticks; a rank up stamps the title with a fanfare.
- `reducedMotion`: no shake, punches or flashes, fewer particles.

## Sound

All synthesised Web Audio, started by the Play tap. The platform owns volume and mute.
- **Engine:** a filtered saw and a little noise whose pitch follows speed, ducked in menus.
- **Indicator:** tick-tock clicks at 2.5 Hz while holding (the signature sound).
- **Tyre squeal:** band-passed noise when turning fast.
- **Throw:** whoosh. **Porch thud:** low thump plus cardboard. **Doormat:** a two-tone ding-dong doorbell.
- **Depot:** three rising thunks and a three-note brand jingle.
- **Crash:** low bonk, metal clank, steam hiss through the stall. **Scrape:** short gritty noise.
- **Car bump:** bonk plus a two-tone horn; cars honk now and then near you. **Hedge or snowbank:** soft rustle.
- **Pedestrian:** a pitched "whoop" blip. **Roundabout lap:** a rising whistle. **Tram:** bell. **Drawbridge:** warning bells.
- **Scramble:** new address ping; rival takes one: low double boop; yours taken: sad descending slide; last call: bell and a
  rising siren.
- **Clock:** ticks in the last 10 s. **Shift end:** whistle. **Stars:** a thump and a rising chime each. **Win:** a brassy
  fanfare. **UI:** a sign click.
- **Music:** a small step sequencer (kick, snare, hat, a funky bassline, chord stabs, a short lead hook). Each town has its own
  groove: Maple Row sunny funk 104 BPM in C; Midtown disco 112; Gull Harbour offbeat 96; Frostby with sleigh-bell hats 100; Neon
  Heights synthwave 118; Dustwater surf twang 92; Rainmoor lo-fi 98; Tramline swing 110; Twelve Bridges big finale 120. The
  yard and menus get a mellow bass-and-hats version, filtered and quieter.

## Store art and the trailer

All drawn by the game's own renderer from `?poster=<name>` (`poster.js`), from seeded simulated play.
- **Cover** (`thumb-1`, 1280×720): the title street from above: RIGHT TURNS ONLY painted on the avenue under a curling arrow,
  the yellow van passing through a ring with its parcel in mid-air to the porch.
- **Action** (`thumb-2`): Neon Heights at night, close: the van curling through a lit ring, the parcel in the air, lamp pools.
- **Win** (`thumb-3`): the scramble podium: three loading docks, the winner's van spinning donuts, confetti, `SHIFT SCRAMBLE`,
  places 4-6 on exit-sign plates.
- **Multi** (`thumb-4`): Fiveways at the last call: six vans on the roads into the gold ×3 address with name tags and rival
  chevrons, the red 0:14 clock and the standings plates. (Staged: vans the sim left out of shot are placed on the roads in.)
- **Icon** (512): the blue mandatory-direction plate with the white curl arrow, the yellow van riding it. No text.
- **Badges** (256, all 13): bold symbols on coloured discs: a parcel, a loop of right turns, a parcel on a doormat, roundabout
  arrows, a stopwatch, a map pin, a gleaming van, a calendar with a curl, three stars, five full rising bars, a parcel with a
  lightning bolt, the courier's cap with a star, and a tilted parcel knocked loose with a yellow bang and speed lines.
- **Trailer** (`store/trailer.mp4`, 23.4 s, 1280×720 30 fps H.264 + AAC, 7.5 MB): real play with the game's own sound, six
  hard cuts. Takes captured in virtual time from `?autoplay=1&town=n&zoom=k` (the bot brain at skill 1 drives the player's van),
  `?autoplay=1&scramble=1&zoom=1.25` (a full scramble shift with five bots) and `?title=1` with the Play sign hidden.

| Time | Shot |
|---|---|
| 0-4.2 s | Maple Row: the yellow van past HOLD TO TURN RIGHT on the road, into a ring (−2.0 off the clock), THREE RIGHTS MAKE A LEFT |
| 4.2-8.2 s | Fiveways: HOLD TO GO ROUND; the van orbits a mini-roundabout, comes out and delivers (+1) |
| 8.2-12.2 s | Frostby: the van slides round a snowy bend past the blue cars |
| 12.2-16.4 s | Neon Heights scramble: LAST CALL ×3 lands at 0:20, the van takes it, TAKEN, the plates reshuffle |
| 16.4-19.4 s | SHIFT 1 DONE: every van's trail over the whole town |
| 19.4-23.4 s | The title street: RIGHT TURNS ONLY painted on the avenue, traffic and vans going by; fade out |

## Originality check

- **What it resembles:** Paperboy (throwing to porches), Crazy Taxi (city delivery against the clock), classic top-down city
  driving, one-button arcade games.
- **What a player notices in the first minute that is different:**
  - You can't turn left. The first house behind you turns the map into a puzzle, and "three rights make a left" lands as a
    laugh, then a plan.
  - Roundabouts become your best friend (hold and you orbit).
  - One button, and still a real driving line: tap, curl, feather.
  - The world talks in road paint: the title, the hints and the results are sprayed on the asphalt.

## Tech

- three.js 0.187 and Vite: `npm run build` writes `dist/` (`"dir": "dist"`). Fixed 60 Hz simulation with an accumulator;
  rendering is a pure function of a view object the game builds each frame. Canvas resolution from the governor below.
- **Join first:** the page's first script (`start.js`, 60 KB) joins the room; the game's code (three.js and the rest) loads
  once the platform's handshake is over, and the town is built only once the platform has answered the join (or after 8 s),
  so a slow machine's reload never misses its seat. A page reloaded into a shift under way goes straight back to it, without
  building the title town first.
- **Shaders built a few at a time:** the shader programs the scene needs that aren't built yet are built in tasks of their
  own (8 ms each), and until they are, the objects that need them sit out the frame; the rest is drawn every frame (a page
  that stops drawing can stop getting frames). With KHR_parallel_shader_compile (most GPUs) a link runs off the page and is
  read back once done; without it (SwiftShader) each program holds the page for a second or more between frames. So nothing
  makes materials per frame: road paint is drawn into a decal once (equal paint handed over again reuses it), people and
  garden dogs out of sight are pooled, not rebuilt.
- **Quality governor:** the player's Graphics choice is the ceiling (`ow.settings.choice`); under it the game times its own
  frames: slower than 40 ms on average over 1.5 s steps down (resolution first at high quality, then quality, then
  resolution to half), faster than 19 ms for 8 s steps back up one level (a level that was too slow waits a minute). Without
  a GPU (SwiftShader, llvmpipe) it stays at low quality, starts at half resolution, draws the screen without multisampling
  and skips the sky's reflections (the store art does none of that).
- **Pure modules** (node-tested, no DOM): `config.js`, `rng.js`, `towns.js` (12 ASCII maps and town data), `city.js` (map →
  geometry, houses, drop points, colliders), `physics.js`, `traffic.js`, `route.js` (right-turn graph), `driver.js` (bot brain),
  `shift.js` (solo rules, the express), `scramble.js` (multiplayer rules), `ghost.js`, `career.js` (flow, moves, tips, ranks,
  the garage lists, jobs, the streak, challenges, settling a shift).
- **Page modules:** `start.js` (join, then load the rest), `main.js`, `net.js` (room, match, host, bots, stub room), `world.js`, `forecourt.js` (the yard, garage
  and podium views at the depot), `fx.js` (effect state), `hud.js` and `draw2d.js` (the canvas HUD over the scene),
  `sprites.js` (2D badges and icons), `ui.js` (DOM signs and panels), `audio.js`, `poster.js` (store art, `?poster=<name>`).
- **`game/gfx/`** (three.js): `renderer.js` (camera, sun, shadows, post), `town.js`, `houses.js`, `build.js` (merged
  geometry), `material.js` (shader patterns, lamps, wind, wet), `style.js` (per-town light and colour), `signs.js`, `van.js`,
  `vans-layer.js`, `traffic-layer.js`, `people-layer.js`, `marks-layer.js`, `fx-layer.js`, `weather-layer.js`, `post.js`,
  `models.js` (glTF loading). Models are baked small with `npm run bake` (meshopt, quantised, only the clips used).
- Quality levels: low drops shadows and post (and thins the weather and particles), medium keeps them with a smaller
  shadow map and no multisampling, high has both at full size.
- **Debug and capture:** `?autoplay=1` (outside production only) drives your van with the skill-1 brain. `?town=n` starts
  that town, `?scramble=1` readies in the yard for a scramble, `?autoplay-to=lobby` opens the yard. For footage, `?zoom=k`
  brings the camera closer and `?hints=0` keeps the road free of hints.
- Paused on `visibilitychange` and `ow.on('pause')` in solo. Every optional API is guarded.

## Risks and how they're handled

- **One-button frustration (kerbs, overshoots).**
  - Heading snap, wide roads (120 px for a 28 px van), scrapes instead of crashes at shallow angles, short stalls.
  - Loop zones that turn a held button into a clean U-turn, hints painted where they apply, and a stuck hint.
  - (Cut: guide chevrons and a dashed preview arc while holding. In play they were clutter; the snap does the job.)
- **Getting lost on a north-up map.** Edge arrows to every target and the depot, a look-ahead camera, and the intro overview in
  scrambles.
- **Small vans on phones.** The camera zoom (see Balance) shows at most ~700 world px across the short side, and a tall phone
  gets the larger √(w·h) zoom, so a van is ≥27 css px on a 390 px phone. Name tags and arrows are sized in screen pixels
  and keep clear of the plates and the platform's menu.
- **Bots that drive badly.** The planner plus pursuit controller (with a crash look-ahead) is tested on every town for
  finishing and time, and in scramble sims for score spread.
- **Netcode surprises.** Only deliveries are authoritative (claims). Traffic is deterministic and bumps are cosmetic. Presence
  is validated. Bots survive a host change through presence plus checkpoints.
- **Scope (12 towns, 7 vans).** Towns are ASCII maps over one generator for houses and decor. Each town's feature is one
  flag on the town (snow, night, dust, rain, cones, tram, bridges).
- **Performance on phones.** One merged mesh per town chunk, instanced cars, shader-lit lamps (no light objects), GPU
  weather, pooled effects, quality tiers under the player's Graphics choice, shaders built ahead of the frame. Under software
  graphics a frame takes ~200 ms: playable to look at, not to race.
- **iOS Safari.** No canvas `filter`, long-press suppression, audio unlocked from the in-game Play tap.
