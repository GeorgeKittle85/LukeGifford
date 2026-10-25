# Kittle Skies architecture

Kittle Skies is an offline, single-player browser game today. It is built so
that going online later (cloud saves, leaderboards, or full multiplayer) means
**adding** pieces, not rewriting the game.

```
┌──────────────────────────── browser ────────────────────────────┐
│  UI (src/ui)                                                     │
│   map · top bar · tabs · dialogs                                 │
│        │  reads state, sends commands                            │
│        ▼                                                         │
│  Host interface ── LocalHost (src/host/LocalHost.js)             │
│        │  owns the clock, the state and the save store           │
│        ▼                                                         │
│  Engine (src/engine)  ◄── pure JS: no DOM, no real clock,        │
│        │                  no Math.random                         │
│  Save store (src/storage) ── localStorage today                  │
└──────────────────────────────────────────────────────────────────┘
```

## 1. The engine is pure and deterministic

`src/engine/index.js` exposes three functions:

```js
const state = createGame({ seed, startDate, airlineName, hub, difficulty });
const notes = advance(state, toMinute);               // run the simulation forward
const { result, notes } = dispatch(state, command);   // apply one command
```

- **State is plain JSON.** No classes, Maps, Dates or functions, so it can be
  saved, sent over a network or diffed as-is. `JSON.parse(JSON.stringify(s))`
  is a lossless copy (there's a test for this).
- **No hidden inputs.** Randomness comes from a seeded generator whose state
  lives in `state.rng` (`rng.js`). Time only moves when `advance` is called.
  IDs come from a counter in the state. Same seed + same commands at the same
  game times = the same game, byte for byte (tested).
- **Discrete-event simulation.** Departures, arrivals, daily weather, weekly
  settlement and event start/end are entries in a priority queue stored in
  `state.queue` (`eventQueue.js`). `advance` pops everything due and the
  scheduler (`scheduler.js`) plans each plane's next leg.
- **Notifications out.** `advance` and `dispatch` return "notes"
  (`weekReport`, `decision`, `outcome`, `log`, `delivered`) for the host and UI
  to react to. The engine never touches the UI.
- **Runs in Node.** The unit tests and `scripts/balance-sim.mjs` run the exact
  same modules headlessly, which is also exactly what a game server would do.

### Commands: the only way in

Every change goes through `applyCommand` (`commands.js`), validated against the
issuing airline:

| Command | Purpose |
|---|---|
| `OPEN_ROUTE` / `CLOSE_ROUTE` | open or close a city pair (must touch one of your hubs) |
| `SET_FARE` | change a route's ticket price |
| `ASSIGN_PLANE` | put a plane on a route (or unassign it) |
| `LEASE_PLANE` / `BUY_PLANE` / `DISPOSE_PLANE` | fleet changes |
| `OPEN_HUB`, `BUY_LOYALTY`, `START_CAMPAIGN` | upgrades |
| `SET_SETTING` | service level, maintenance policy, overbooking |
| `RESOLVE_DECISION` | answer a random-event decision |
| `CONTINUE_DYNASTY` | keep playing after a win |

The AI rivals (`ai.js`) use these same commands. They have no special access.
That is the property that makes multiplayer possible: a remote human player is
just one more source of commands.

## 2. The host interface

The UI never imports the engine's mutating functions. It talks to a host:

```
host.state            current game state (read-only for the UI)
host.localAirlineId   which airline this player controls
host.subscribe(fn)    events: loaded, changed, notes, frame, speed, saved, error
host.dispatch(cmd)    -> { ok, error?, ... }
host.setSpeed(i) / pause() / resume() / togglePause()
host.newGame(opts) / loadSlot(slot) / saveSlot(slot) / listSaves()
host.exportSave() / importSave(text)
```

`LocalHost` implements it by running the engine in the tab on a
`requestAnimationFrame` clock: 1x = 30 game minutes per real minute, up to
120x. It also checks that commands only target the local airline. A server
would do the same check against the authenticated user.

## 3. Saves

`src/storage/saveFormat.js` wraps the state in a versioned envelope
(`format`, `schemaVersion`, `savedAt`, `meta`, `state`). When the state shape
changes, bump `SCHEMA_VERSION` in `src/engine/state.js` and add a migration
step to `MIGRATIONS`. Older saves upgrade on load.

`src/storage/localStore.js` is one implementation of a four-method store
(`list`, `load`, `save`, `remove`). A cloud store with the same methods can
replace it without touching anything else.

## 4. Going online: what to add

### Cloud saves (smallest step)
Write a `CloudStore` with `list/load/save/remove` that calls your API, and pass
it to `new LocalHost({ store })` in `src/main.js`. Nothing else changes.

### Leaderboards
Because the engine is deterministic, a score can be verified: submit the seed,
start options and the timestamped command log, and the server replays it with
`createGame` + `advance` + `dispatch` to confirm the result.

### Multiplayer (server-authoritative)
1. **Server:** a Node process imports `src/engine/index.js`, holds the state,
   advances it on its own clock, and accepts commands over WebSocket. It sets
   `command.airlineId` from the player's session, never from the client.
2. **Client:** add a `RemoteHost` that implements the host interface above. It
   forwards `dispatch` to the server, and applies state snapshots or diffs that
   the server broadcasts. Speed controls become requests (or are disabled).
3. **Swap hosts** in `src/main.js`. The UI keeps working unchanged.

Single-player assumptions to generalize for multiplayer (all are small and
easy to find):
- `state.humanAirlineId`: decisions, mechanical events and the viral event
  target this airline (`events.js`); win/lose checks run for it
  (`objectives.js`); AI fare reactions look at it (`ai.js`). For multiplayer,
  loop over airlines with `controller === 'human'`.
- `createInitialState` makes one human airline. Add one per player (they
  already share the same shape as the AI airlines).
- `selectors.human()` and the UI's `ctx.me` read `humanAirlineId`. A
  `RemoteHost` would provide `localAirlineId` per client instead.

## 5. Module map

| Path | Responsibility |
|---|---|
| `src/data/` | airports, aircraft, rival airlines, event catalog, world outline map |
| `src/engine/network.js` | city pairs, gravity-model demand, fare ceilings, block times |
| `src/engine/market.js` | passenger demand and market share per route |
| `src/engine/economics.js` | per-flight and weekly costs |
| `src/engine/scheduler.js` | plane movement, delays, cancellations, revenue |
| `src/engine/weekly.js` | weekly settlement ("the turn") |
| `src/engine/events.js` | random events, weather, decisions |
| `src/engine/reputation.js` | reputation drift and per-flight effects |
| `src/engine/ai.js` | rival airline behavior |
| `src/engine/objectives.js` | win / lose |
| `src/engine/selectors.js` | read-only views for the UI (estimates, standings) |
| `src/host/LocalHost.js` | clock, commands, saves, events for the UI |
| `src/storage/` | save format and browser save slots |
| `src/ui/` | map (Leaflet), top bar, tabs, dialogs, charts |
| `scripts/` | local server, offline single-file build, balance simulator |
| `tests/` | engine unit tests (node:test) and browser smoke test (Playwright) |
