# Right Turns Only

Your delivery van only turns right. Deliver everything anyway.

One button: hold to curl right, let go to drive straight. Twelve towns to deliver around alone, a daily shift, and Shift
Scramble for up to six vans, with drivers filling the empty seats.

Play: https://onceworlds.com/play/right-turns-only

## Run it

```sh
npm test        # every town builds and is reachable in right turns, drivers finish all twelve, scramble shifts with six vans
```

No installs and no build: the game is plain modules in `game/`. The rules (towns, van physics, routing, traffic, the
drivers, solo and scramble scoring) are pure modules there too, so the tests run in Node. `DESIGN.md` has every rule and
number.

## License

MIT. The font (Barlow Condensed) is under the SIL Open Font License, in `game/fonts`.
