# OmegaDots Hive · web UI

A living, mobile-first interface for the OmegaDots Hive: every agent ("dot") is a glowing body
orbiting its swarm's commons core, and live events become visible motion. Built against
[`../API.md`](../API.md).

## Run it

```bash
cd hive/ui
npm install

# Simulator (no backend). Used automatically when VITE_HIVE_URL is unset.
npm run dev                       # http://localhost:5173
# stress mode: 40 extra dots, 4x event rate
open "http://localhost:5173/?sim=1&dots=40&speed=4"

# Live hive/core
VITE_HIVE_URL=https://hive.example.com npm run dev
# force one or the other with ?sim=1 / ?sim=0 (sim=0 without a URL uses the page's own origin)

npm run build && npm run preview  # production build
npm run typecheck && npm run lint && npm test
npm run shots                     # Playwright screenshots + console-error audit (after build)
node scripts/perf.mjs 4           # fps with ~52 dots, 4x CPU throttle (after build)
```

Live mode shows an operator login (`POST /api/auth/login`); the token is kept in
`localStorage` and sent as `Bearer` and as `?token=` on `/api/events`. A 401 or WS close
`4401`/`1008` returns to the login screen. The socket reconnects with jittered backoff and
pings every 25 s.

## Architecture

```
src/
  api/types.ts        API.md types, verbatim, plus the HiveEvent union
  api/client.ts       HiveClient interface, ApiError, createClient() (lazy-imports sim or live)
  api/live.ts         LiveClient: REST + /api/events WebSocket
  api/sim/            SimClient: in-browser hive (seed data, NAL revision/choice, replies)
  store/reducer.ts    pure reduce(state, event): agents, swarms, thinking, messages, beliefs, usage, logs, activity
  store/store.ts      zustand store: hydration, optimistic chat, actions, toasts; hiveBus fan-out
  scene/engine.ts     HiveEngine: imperative 2.5D canvas renderer, camera, gestures, effects
  scene/HiveScene.tsx React bridge: store → engine, hover/tap card, route-driven camera
  shell/              HUD, nav (bottom tabs / left rail), ticker, login, shortcuts
  features/           dot panel, swarm + constellation + provenance, create flow, usage, palette (all lazy)
  ui/                 primitives, Sheet (side panel ⇄ bottom sheet), Page, MeTTa highlighter, icons
```

- **One data surface.** UI code only talks to `HiveClient`. `SimClient` implements the same
  REST surface and event stream: three swarms, 12 dots with personas, sleeping and waking,
  `llm`/`skills` thinking phases, chat replies that quote the commons, belief publication merged by
  real NAL revision (`w = c/(1-c)`), choice on overlapping stamps (`chosen`/`kept`), duplicates,
  quarantines, glitches with recovery, peer messages, 30 days of usage history and log tails.
- **Store.** Every event goes through the pure `reduce()` (unit-tested), then out on `hiveBus`
  to the scene, so the canvas never causes React renders. Chat is optimistic: a pending bubble
  appears at once, reconciles with the server `Message` by id, and failed sends keep a retry.
- **Scene.** The engine owns a single `<canvas>`; React pushes data in via `setData()` and raw
  events via `handleEvent()`. DOM overlays (the dot card) are pinned by the engine writing
  `transform` each frame. Routes drive the camera (`#/dot/:id` flies and follows; panels report
  their size so the dot centres in the visible area).

### What the scene shows

| Signal | Look |
|---|---|
| awake | bright, breathing glow in the dot's `hue` |
| asleep / stopped | dim, slow, loosened orbit / hollow ring |
| created / starting | flickering ignition |
| `agent.thinking` | tilted orbit ring + satellite spark (2 arcs for `llm`, 4 faster arcs in a shifted hue for `skills`) |
| error | red, chromatic split and scan-line tears (steady red under reduced motion) |
| `message` | comet from the viewer edge / open chat to the dot (in) or back (out); dot-to-dot for peer messages |
| `belief.published` | particle (tipped with its frequency colour) arcs from dot into the core |
| revised | soft double ripple; **chosen/kept**: jagged gold/magenta shockwave with fracture spikes (+ a bounced spark for `kept`); adopted: new mote + sparkle; quarantined: dashed amber membrane that contracts |
| new dot | birth burst at the swarm core, the dot springs out to its orbit |

Belief motes orbit inside each core (colour = frequency, brightness = confidence).

## Design decisions

- **2D canvas, not three.js.** The scene is a 2.5D renderer: tilted elliptical orbits give
  depth (scale, brightness, draw order), and every luminous thing is a cached radial-gradient
  sprite composited with `lighter`, which reads as bloom without a post-processing pass. This
  keeps the initial bundle ~150 KB gz smaller than R3F + drei + postprocessing, avoids WebGL
  context loss on iOS, and holds 60 fps on phones with 50+ dots. The trade-off is no free 3D
  camera orbit; pan/zoom/fly cover the use cases.
- **Visual language.** Near-black indigo space, swarm-tinted nebulae, glass panels (blur,
  hairline borders, inner highlight). Space Grotesk for display, Inter for UI, JetBrains Mono for
  MeTTa and logs (bundled via `@fontsource-variable`, latin subsets load on demand). MeTTa is
  coloured by paren depth, copulas (`-->`, `==>`, `×`), variables and heads.
- **Mobile first.** Bottom tab bar with a raised create button; panels are draggable bottom
  sheets (peek/full, drag or fling to dismiss) that become side panels at ≥768 px. The dot panel
  opens at a peek height on phones so the dot and its message light stay visible above the chat.
  Touch: first tap shows the card, second tap (or "Open") opens the panel. 44 px targets, 16 px
  inputs (no iOS zoom), safe-area insets.
- **Constellation.** Stars sit on rings by confidence (nearer the core = more confident),
  colour = frequency on a red ↔ neutral ↔ blue diverging scale, bright crosses for c > 0.75,
  faint lines join beliefs that share a term, labels are placed only where they do not collide.
  A sortable table view is the accessible twin. Provenance refetches live when the belief changes.
- **Charts** follow the bundled `dataviz` method: one filter row (range, grouping, table toggle),
  a hero spend figure + stat tiles with deltas, stacked columns with 2 px gaps and 4 px rounded
  caps, a crosshair-free per-column tooltip listing every series, a legend, and a table view.
  The 7 categorical slots are the reference palette's dark steps, **validated with
  `validate_palette.js` against this surface (all checks pass)**; slots are assigned by all-time
  spend so colours follow the entity across filters; the tail folds into "Other".
- **Accessibility.** `prefers-reduced-motion` calms the scene (no dust drift, no glitch jitter,
  slower single ripples, short camera moves) and framer-motion honours it app-wide. All controls
  have labels; panels are dialogs with focus moved in and an Esc stack (topmost closes first); a
  hidden "Dots" directory becomes visible on keyboard focus; the palette is a combobox/listbox.
- **Keyboard.** ⌘K / Ctrl+K palette (jump to dot or swarm, create, sleep/wake/start any dot,
  recenter), `g h` hive, `g s` swarms, `g u` usage, `n` new dot, `/` search, `Esc` close.

## Performance

- Rendering pauses when the tab is hidden; under full-screen views the scene is dimmed and
  throttled to 24 fps.
- The backdrop (gradient, far stars, nebulae, vignette) renders into a half-resolution cache
  that is redrawn only when the camera moves.
- DPR is capped at 1.5 on touch devices (2 on desktop) and steps down automatically when the
  median frame time over ~1 s exceeds 21 ms. Particle count is capped (70, or 24 reduced).
- Measured with `scripts/perf.mjs` (390×844 @3x, 52 dots, 4x event rate, headless Chromium with
  **software** rasterization, so pessimistic): **60 fps** at DPR 1.5 unthrottled; **~28 fps** at
  DPR 1 with 4x CPU throttling. JS is <10% of frame time; the rest is rasterization, which a
  phone's GPU-backed canvas does far faster.
- Every view is lazy-loaded with its own Suspense boundary and prefetched on idle; motion
  features load asynchronously via `LazyMotion`.

### Bundle sizes (production build)

| Chunk | min | gzip |
|---|---:|---:|
| `index` (React, store, scene, shell) | 344.8 KB | **113.2 KB** |
| `index.css` | 59.7 KB | 13.1 KB |
| `motionFeatures` (async) | 60.8 KB | 19.1 KB |
| shared motion runtime for views | 39.9 KB | 14.4 KB |
| `SimClient` (sim only) | 30.2 KB | 11.2 KB |
| `live` (live only) | 4.1 KB | 1.6 KB |
| `SwarmView` / `DotPanel` / `UsageView` / `CreateFlow` | 23.1 / 21.1 / 14.8 / 14.3 KB | 7.9 / 6.7 / 5.3 / 5.1 KB |
| `CommandPalette` / `SwarmsIndex` / `TokenReveal` / `Sheet` / `Page` | 6.5 / 4.3 / 3.6 / 3.6 / 1.4 KB | 2.7 / 1.8 / 1.6 / 1.7 / 0.8 KB |

Fonts (latin subsets actually fetched): Inter 48 KB, JetBrains Mono 40 KB, Space Grotesk 22 KB.

## Tests

`npm test` (vitest): NAL revision; simulator seeding, provenance, revision/choice/duplicate
outcomes, the living event stream, chat replies + billing, creation + one-time token, actions;
the reducer (purity, dedupe/order of messages, thinking lifecycle, belief pulses, deletes, log
cap); and the store (hydration, bus fan-out, optimistic send, failure + retry, token never
stored).

## Notes for the backend

- `belief.updated` does not say *why* it changed. The scene correlates it with the preceding
  `belief.published` to tell a revision from a choice; adding `outcome` (or the assertion) to
  `belief.updated` would make that exact, including federation-originated updates.
- Streaming: the UI reveals new `out` messages progressively and shows `agent.thinking`
  as typing. A `message.delta` event (`{message_id, agent_id, text}`) would allow true token streaming.
- Usage is fetched in full for 30 days; a server-side aggregate (`GET /api/usage/summary?bucket=day&group=agent`) would scale better.
- Chat sends omit `conversation_id`, so the server picks the default conversation; please document
  that default. Peer messages are recognised by `sender: "agent:<id>"` on `direction: "in"`.
- Nice to have: `agent.thinking` for `asleep` dots is ignored; a per-agent `last_error` field on
  `Agent` would let the card explain an `error` status.
