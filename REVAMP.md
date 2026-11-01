# Right Turns Only: the revamp

The first version works: twelve towns, a scramble for six, bots that drive well, ghosts, a daily. It is also a game you play
once. This is the honest list of why, from a fresh 15 s capture of Midtown and the store art, then the plan that answers it.

## Teardown

### Looks cheap

1. **A map, not a world.** Everything is flat top-down clip art: a house is a coloured rectangle with a darker half for a
   gable, a downtown block is a box with three window rectangles. No height, no light, no shadow except an offset blob.
   It reads as a diagram of a town.
2. **Every street looks the same.** Lots are the same square, gardens are a fill colour, nothing is going on in them:
   nobody on the pavements, no gardens with anything in them, no parked cars, no lamp posts, no bins.
3. **Traffic lights are coloured dots on the asphalt**, cars are rounded rectangles, the bus is a yellow lozenge, people are
   specks. At phone zoom the cars are indistinguishable chips.
4. **The van, the hero, is 30 px of yellow rectangle**: no wheels, no windows that read, no lights that matter. Nothing to love,
   nothing to customise.
5. **Targets are UI pasted on the world**: dashed yellow circles and a parcel icon in a bubble.
6. **Weather is a tint.** Night is a dark overlay with radial glows, snow is a white ground, dusk is a purple wash. None of the
   towns feels like a place.
7. **The yard and the podium** are flat squares on a grid with rectangles for confetti.

### Moves stiffly

8. The van is a sprite that rotates. No body roll in a turn, no suspension, no wheels turning, no drift, no tyre smoke. A crash
   is a squash.
9. The parcel is a sprite on an arc. Nobody is home: no door, no resident, no reaction. The doormat is a ding and a number.
10. Cars slide along their lanes: no wheels, no braking dip, no indicator. People hop as sprites.
11. UI numbers swap instantly; panels just appear.

### Feels floaty or unclear

12. Releasing a turn has no "lock-in" moment: the snap is invisible (good) but nothing tells you that you nailed it.
13. The camera is a flat follow: no lean into turns, no punch-in on a delivery, no slow-motion for the last parcel. The van
    reads tiny.
14. No hit-stop; a crash is a small puff. Near misses with traffic happen all the time and the game doesn't notice.

### Boring after one round

15. Every delivery is the same: drive through a circle, +1. No combos, no streaks, no choice beyond "doormat or not".
16. Solo is scored by the clock only. Driving well (clean turns, threading traffic) is worth nothing unless it saves time.
17. Traffic is only an obstacle. Nothing rewards skill around it.
18. Twelve towns, then three stars each, then nothing. No challenges per town, nothing new per session.

### No reason to come back

19. Progression is stars → seven van colour swaps. No ranks, no currency, no garage, no daily goals, no streak.
20. The daily shift is the only thing that changes from day to day.
21. Multiplayer: vans bump harmlessly and race for addresses. Nothing between players makes a story.

### What the best of its kind do that this doesn't

- **Mini Motorways / Islanders:** a toy world you want to look at: soft real light, height, shadow, tiny lives in it.
- **Crazy Taxi:** every near miss and drift pays into a visible combo; the music and the shouting make speed feel like style.
- **Paperboy:** the throw has a target with a person behind it, and the house reacts.
- **Mario Kart:** a held-turn drift that pays a boost: the same button, a skill to master.
- **Crossy Road / Smashy Road:** a garage of vehicles you want to collect, earned by playing, a reason to open it tomorrow.
- **Trackmania:** the same track forever, because your own ghost and the board pull you back.

## The plan

### Art: a 3D toy town (three.js)

- The whole game moves to three.js (Vite build). The rules stay pure and unchanged in shape; only the drawing changes.
- **A miniature diorama under a warm sun:** procedural houses with real gabled and hipped roofs, eaves, chimneys, windows with
  frames and glass, porches with steps, lit doormats, gardens with paths, hedges, fences, flower beds, mailboxes, bins, garden
  toys, the odd pool and trampoline. Downtown blocks with storeys, ledges, shop fronts with awnings and signs, rooftop AC units
  and water towers. Parks with trees that sway and a fountain. Everything in the town's own palette.
- **Real light:** sun with soft shadows, sky light, tone mapping, a tilt-shift band that makes it a miniature, colour grading per
  town, fog in the distance. AO where the quality allows.
- **Weather as places:** Frostby with snow falling, white roofs and tyre tracks in the snow; Neon Heights at night with
  headlights, lamp pools, lit windows and neon signs with bloom; Rainmoor with rain, puddle splashes and wet reflections;
  Dustwater with dust storms rolling through; Twelve Bridges at dusk with a low orange sun; Gull Harbour with water, boats
  and gulls.
- **The van:** a detailed courier van in the Clockwise Couriers livery (the curl arrow on the roof), wheels that spin and
  steer, body roll and pitch on a spring, indicators that blink while you hold, brake lights, headlights at night, parcels
  strapped on the roof rack.
- **CC0 models where they beat code:** rigged, animated people (Quaternius) and dogs (Quaternius), traffic cars with real
  wheels (Quaternius). Recoloured to each town's palette. Everything else is drawn in code so the style is one.

### Animation and juice

- Van: suspension spring, lean into turns, a drift angle and tyre smoke on a hard turn, skid marks on the road, a squash and
  a bounce on a crash, exhaust puffs at low speed, parcels jiggling on the rack.
- **The delivery moment:** the parcel spins off the roof in an arc, bounces onto the porch; the door opens and the resident
  comes out to pick it up and wave (a doormat: they cheer and clap, the doorbell rings, confetti of packing peanuts).
- Traffic: wheels roll, brake lights glow, cars dip when they brake and honk when cut up. People walk the pavements and leap
  clear; dogs bark and chase the van along their fence; birds scatter from the road.
- Camera: smooth follow with look-ahead, leans into turns, punches in on a delivery, slow motion on the shift's last parcel.
  Hit-stop and directional shake on crashes.
- UI: counts tick, plates slide, stars stamp, coins fly to the counter.

### Depth: mastery and short-term goals

- **Flow** (the combo). Clean turns (a held turn released straight onto the road, no scrape), perfect turns (released right on
  the line), near misses with traffic, doormats, roundabout laps and three-rights all fill a flow meter: x1 to x5. Each level
  adds a little top speed (the van visibly streaks) and multiplies tips. A crash empties it. A beginner sees it fill on
  their own; an expert keeps x5 for a whole shift.
- **Tips** per delivery: base, a quick-drop bonus, the doormat, times the flow. Tips are the currency and the XP.
- **Express parcels** (from town 3): a gold parcel on a timer appears at a house; deliver it in time for big tips. It costs
  clock time, so it's a real choice between stars and tips.

### Mid-term and long-term

- **Courier rank:** tips are XP; 30 ranks with titles, each rank-up unlocks something.
- **The garage:** van bodies (more of them, all the same handling), paint jobs, roof toppers, flow trails and parcel wraps,
  earned by rank, stars, tips, challenges and streaks. Shown on a turntable in the depot.
- **Town challenges:** one per town (land every parcel on the mat in Maple Row, three roundabout laps in Fiveways...). A
  medal on the route board.
- **Daily jobs:** three a day from a seeded pool, with tips; a **daily streak** with milestone rewards; the daily shift and its
  board stay.
- **Multiplayer stories:** a hard bump knocks a parcel off a rival's roof; it lies in the road for anyone to grab. Comebacks,
  revenge and laughs.

### Sound

- A richer synth: engine with load and gears, tyre squeal and gravel, a real doorbell, cardboard thuds, a cheer, dog barks,
  horns; music that adds layers as the flow rises.

### Order of work

1. Vite + three.js, the town in 3D (roads, lots, houses, downtown, parks, water, depot), lighting and camera.
2. The van, traffic, people and dogs, deliveries with residents; particles and effects.
3. HUD, screens (title, yard, route, results, podium, garage) in 3D.
4. Flow, tips, rank, garage, jobs, streak, challenges, express parcels, knock-offs; tests for every rule.
5. Sound and music.
6. Store art, trailer, docs.
