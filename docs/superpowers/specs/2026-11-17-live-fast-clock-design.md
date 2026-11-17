# Live engine: 33 ms playback clock (short design)

Date: 2026-11-17. Status: approved. The user was offered three approaches,
then said "finish the project", taking the recommended one (approach 1).
Amends design 8 of `2026-11-17-live-engine-design.md`.

## Intent

1x live analysis is capped at 10 analysed frames per second by the clock,
not by inference. The engine analyses the newest frame at or before the
last browser clock, and the browser sends one every 100 ms. So at most 10
new frames become eligible per second, below the 20 /s detection needs.
The lean path now takes about 34 ms per frame, so inference is no longer
the limit.

## Goals

- At 1x on this laptop: at least 20 analysed frames per second, detection
  active and events emitted, measured with `live.realcheck` and in the
  browser. If the measurement falls short, report it and do not claim it.

## Non-goals and anti-goals

- No change to the pacing rule: the engine never analyses a frame later
  than the last clock (design 8), and keeps the latest-frame-wins rule and
  the backward and silent-client rules.
- No clock prediction in the engine. No `requestVideoFrameCallback` clock.
- No change to the event clocks (play, pause, seeking, waiting, playing,
  ended).

## Approaches (the user took 1)

1. **Fixed 33 ms timer (chosen).** Raises the ceiling to about 30 /s at 1x.
   It is one constant in the browser and one in `live.realcheck`, and adds
   about 30 small WebSocket messages per second on localhost.
2. A clock per presented frame (`requestVideoFrameCallback`): more
   precise, but more code, needs a fallback timer, and `live.realcheck`
   cannot reproduce it.
3. Predicting the clock in the engine: breaks the "never past the last
   clock" guarantee, for example while the browser is buffering.

## Design

- Browser: `CLOCK_INTERVAL_MS = 33` in `useLiveSession.ts`.
- `live.realcheck`: sends its playing clock every 0.033 s, so measurements
  match the browser.
- Design 8 now reads "every 33 ms while playing" instead of "every
  100-250 ms". `docs/live-engine.md` records the change.

## Tests

- Hook: while playing, clocks arrive every 33 ms (10 in 330 ms, not 3);
  none arrive while paused (the existing test).
- Real check at 1x and 0.1x: analysed rate, detection active, events,
  matches with offline, identity, GPU memory. Also checked in the browser
  at 1x.
