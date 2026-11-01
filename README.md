# Right Turns Only

Your delivery van only turns right. Deliver everything anyway.

One button: hold to curl right, let go to drive straight. Twelve 3D towns to deliver around, a career of flow, tips, ranks
and a garage of paints, toppers, trails and parcel wraps, a challenge medal in every town, a daily shift with three daily
jobs, and Shift Scramble for up to six vans, where a hard hit knocks a parcel off a rival's roof, with drivers filling the
empty seats.

Play: https://onceworlds.com/play/right-turns-only

## Run it

```sh
npm install
npm run dev     # http://127.0.0.1:5305
npm run build   # dist/, what Onceworlds serves
npm test        # every town builds and is reachable in right turns, drivers finish all twelve, scramble shifts with six
                # vans and knock-offs, the career (flow, tips, ranks, wraps, jobs, streak, challenges) and the express
```

The rules (towns, van physics, routing, traffic, the drivers, solo and scramble scoring, the career) are pure modules in
`game/`, so the tests run in Node. The 3D (three.js) is in `game/gfx/`. `DESIGN.md` has every rule and number.

## License

MIT. The font (Barlow Condensed) is under the SIL Open Font License, in `public/fonts`. Models are CC0 (Quaternius): see
CREDITS.md.
