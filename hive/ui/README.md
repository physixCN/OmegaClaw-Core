# OmegaDots Hive · web UI

A living, mobile-first interface for the OmegaDots Hive: every agent ("dot") is a glowing body
orbiting its swarm's commons core, and live events become visible motion. Built against
[`../API.md`](../API.md), Phase 1 and Phase 2 (policy gate and approvals, goals, traces, wakeups,
memory, kill switch, goal leases, gateway spend errors).

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
  api/types.ts        API.md types (Phase 1 + 2), plus the HiveEvent union
  api/client.ts       HiveClient interface, ApiError, createClient() (lazy-imports sim or live)
  api/live.ts         LiveClient: REST + /api/events WebSocket
  api/sim/            SimClient: in-browser hive (seed data, NAL revision/choice, replies);
                      phase2.ts holds the policy/approval/goal/trace/wakeup/memory seeds and content
  store/reducer.ts    pure reduce(state, event): agents, swarms, thinking, messages, beliefs, usage, logs,
                      activity, approvals, policy, goals, traces, wakeups
  lib/cron.ts         5-field cron: parse, validate, describe ("Weekdays at 09:00"), next run in an IANA zone
  lib/policy.ts       glob matching + resolvePolicy() (human-only > agent > swarm > hive > defaults)
  lib/goals.ts        goal lease helpers; lib/llmErrors.ts maps last_error to the gateway's 402/429 codes
  store/store.ts      zustand store: hydration, optimistic chat, actions, toasts; hiveBus fan-out
  scene/engine.ts     HiveEngine: imperative 2.5D canvas renderer, camera, gestures, effects
  scene/HiveScene.tsx React bridge: store → engine, hover/tap card, route-driven camera
  shell/              HUD, nav (bottom tabs / left rail), ticker, login, shortcuts
  features/           dot panel (chat, mind, memory, schedule, model), swarm + constellation + provenance,
                      approvals + policy editor, goals board, stop-all, create flow, usage, palette (all lazy)
  ui/                 primitives, Sheet (side panel ⇄ bottom sheet), Page, ConfirmDialog, MeTTa highlighter, icons
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
| goal claimed (`goal.updated`) | a gold diamond comet leaves the swarm core and lands on the claimant; held goals (claimed or waiting) orbit the dot as small gold diamonds on their own flatter orbit (up to 3) |
| goal done / failed | gold sparkle (done) or a small red puff (failed) at the dot |
| pending approval | dashed amber halo that breathes around the asking dot, plus a spark when it is raised |
| `wakeup.fired` | sunrise: two warm rings and short rays swell out of the dot, with a fading warm bloom |

Belief motes orbit inside each core (colour = frequency, brightness = confidence).

## Phase 2 views

- **Approvals inbox** (`#/approvals`, nav "Inbox", HUD shield pill, `g i`). A count badge sits on the
  nav and the HUD; `approval.created` raises a toast with the dot's orb that opens the card. Each card:
  the dot (hue + orb, tap → its Mind), skill, the exact command MeTTa-highlighted with copy, the reason,
  a risk chip and the time. **Approve once**, **Approve & always allow** (`remember: true`) and **Deny**;
  the decision lands as a drawn check or cross over a tint, then the card slides out (right for approve,
  left for deny). Tabs: Pending (with a risk summary on desktop), History (grouped by day, filterable,
  expandable), Rules.
- **Policy rules** (`#/approvals/rules`). Rules grouped by scope (hive, each swarm, each dot) with
  mode chips and glob previews ("matches shell, shell-confirm"); add (scope + target, glob, mode, note)
  and delete with a two-step confirm. "Try it" resolves any dot + skill live with the same precedence
  the hive uses. A compact help section shows the precedence chain and the API.md defaults.
- **Goals board**: a "Goals" tab next to Constellation/Table in the swarm view and its own route
  (`#/goals[/swarm]`, `g g`). Kanban columns Open, Claimed, Done, Failed (cancelled shows struck
  through); on phones the columns are a horizontal snap scroller with a pager. Cards show title,
  priority, the claimant's orb, a **lease countdown** for claimed goals (bar drains, amber under
  10 min, "lease lapsed" when over) and earlier lapses ("2/3 lapsed"). **Waiting** goals (delivered,
  waiting on a person) sit in Claimed in a calm amber with "lease paused" and the delivered result;
  **stalled** goals (3 lapses) lead the Open column as needs-attention cards with an in-place
  **Re-open** (`PATCH {status:"open"}`). Subgoals nest under the parent with a progress ring.
  Quick-add field with priority; cards hop columns with shared-layout animation and flash on arrival.
  Expanded cards: detail, result, done/failed/cancel/reopen, priority, add a subgoal.
- **Mind** tab (dot panel; `#/dot/:id/mind`). The "watch it think" timeline, newest first: a live
  "Thinking… / Running skills" ghost with an elapsed timer, then each iteration with its trigger
  (message, autonomous turn, scheduled wakeup, approval granted), LLM latency (with a bar) and tokens,
  the raw model response (the thought types on for new ones), and each command with its result and
  gate (allow / ask / deny styled apart; ask links to its approval and shows whether it is still
  waiting, approved, used or denied). Filters: All / Skills / Errors. Replay: first, step back, play
  (auto-steps through recent iterations, then rejoins live), step forward, scrubber.
  The old "Mind & model" tab is now **Model** (model, persona, colour, budget, delete).
- **Memory** tab: private spaces as tiles (atoms, bytes, relative bar), debounced search, atoms as
  MeTTa, **Retire** with an inline confirm and a "Queued · next loop" state, and **Reset memory**
  behind a dialog that requires typing the dot's name.
- **Schedule** tab: **auto-sleep when idle** (`idle_sleep_minutes` via `PATCH /api/agents/{id}`,
  presets plus any custom value) and wakeups: human-readable cron ("Weekdays at 09:00"), next run in
  the viewer's local time with the wakeup's zone badge when it differs, last run, enable switch,
  delete. The composer does cron (presets, live validation and preview of the next local run) or a
  one-shot wall-clock time, with an IANA zone (defaults to the browser's) and the text. A fired wakeup
  flashes its card and pulses the dot in the scene.
- **Stop all**: in the command palette ("Stop all dots…") and the HUD overflow (⋯). A dialog lists the
  running dots and arms only when you type `stop all`; it calls `POST /api/hive/stop-all`.
- **Gateway errors**: a dot's `last_error` shows under its header (and on the hover card) with the
  gateway code mapped to plain words: `402 no_budget`, `unpriced_model`, `budget_exhausted`,
  `hive_budget_exhausted` and `429 rate_limited`, with "Fix budget" / "Change model" shortcuts. Budget
  copy now says $0 is unlimited only for local models.

The simulator produces all of it: dots reach for risky skills and the policy gate raises approvals
(capped at 6 pending; pending ones expire after 45 min); an approval is used on the next loop and
traced as `[APPROVED p_x]`; "always allow" adds an agent rule; goals are claimed with a 60-minute
lease, renewed by heartbeat, split into subgoals, finished, delivered as `waiting`, failed, or
lapse back to open and stall on the third lapse; members propose goals; every model call emits
`agent.trace` with gated commands, latency and tokens; wakeups fire on cron or once (Mira every 2 min,
Quench every 10) and wake sleeping dots; memory spaces hold atoms built from the commons and episodes,
and retire/reset are applied a few seconds later; paid models with a $0 cap are refused with
`no_budget`, budget exhaustion and rate limits land in `last_error`.

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
  recenter, stop all, watch a dot think, edit policy), `g h` hive, `g s` swarms, `g i` approvals inbox, `g g` goals, `g u` usage, `n` new dot, `/` search, `Esc` close.

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
| `index` (React, store, scene, shell) | 369.4 KB | **120.2 KB** |
| `index.css` | 74.9 KB | 15.4 KB |
| `motionFeatures` (async) | 60.8 KB | 19.1 KB |
| shared motion runtime for views | 39.9 KB | 14.4 KB |
| `SimClient` (sim only) | 64.0 KB | 21.7 KB |
| `live` (live only) | 5.5 KB | 2.0 KB |
| `DotPanel` (chat, mind, memory, schedule, model) | 59.3 KB | 16.6 KB |
| `SwarmView` / `GoalsBoard` / `UsageView` / `CreateFlow` | 23.5 / 18.5 / 14.8 / 14.5 KB | 8.0 / 6.2 / 5.3 / 5.2 KB |
| `ApprovalsView` / `PolicyEditor` / `cron` / `ConfirmDialog` / `GoalsPage` / `StopAll` | 14.5 / 13.9 / 4.9 / 3.1 / 2.0 / 1.3 KB | 5.0 / 4.7 / 2.3 / 1.6 / 1.1 / 0.8 KB |
| `CommandPalette` / `SwarmsIndex` / `TokenReveal` / `Sheet` / `Page` | 7.3 / 4.3 / 3.6 / 3.6 / 1.4 KB | 3.0 / 1.8 / 1.6 / 1.7 / 0.8 KB |

Fonts (latin subsets actually fetched): Inter 48 KB, JetBrains Mono 40 KB, Space Grotesk 22 KB.

## Tests

`npm test` (vitest): NAL revision; simulator seeding, provenance, revision/choice/duplicate
outcomes, the living event stream, chat replies + billing, creation + one-time token, actions;
the reducer (purity, dedupe/order of messages, thinking lifecycle, belief pulses, deletes, log
cap); and the store (hydration, bus fan-out, optimistic send, failure + retry, token never
stored).

Phase 2: cron parsing/description/next run across zones, wall-clock → UTC; policy globs and
precedence (human-only never opens); gateway error mapping and goal leases; the reducer for approvals
(pending count, one activity), policy, goal moves (including waiting/stalled), traces (dedupe, order,
cap), wakeups; the simulator's seeds (rules, approvals, nested goals, traces linking asks to approvals,
wakeups, memory) and behaviour (approvals/goals/traces/wakeups while running, approve + remember,
deny, goal claim → split → done, lease lapse → open → stalled → re-open, wakeup validation/firing,
memory retire/reset, stop-all, `no_budget`); the store (decide, optimistic goal patch with rollback,
wakeup toggle/delete rollback, stop-all).

`npm run shots` also captures the Phase 2 views at 390×844 and 1440×900: `10-approvals`,
`10b-approval-stamp`, `10c-approvals-history`, `11-policy`, `11b-policy-help`, `12-goals-swarm`,
`12b-goals-page`, `13-mind`, `13b-mind-errors`, `14-memory`, `14b-memory-reset`, `15-wakeups`,
`15b-wakeup-composer`, `16-scene-cues`, `17-stop-all`, `18-dot-gateway-error`.

## Notes for the backend

- `belief.updated` does not say *why* it changed. The scene correlates it with the preceding
  `belief.published` to tell a revision from a choice; adding `outcome` (or the assertion) to
  `belief.updated` would make that exact, including federation-originated updates.
- Streaming: the UI reveals new `out` messages progressively and shows `agent.thinking`
  as typing. A `message.delta` event (`{message_id, agent_id, text}`) would allow true token streaming.
- Usage is fetched in full for 30 days; a server-side aggregate (`GET /api/usage/summary?bucket=day&group=agent`) would scale better.
- Chat sends omit `conversation_id`, so the server picks the default conversation; please document
  that default. Peer messages are recognised by `sender: "agent:<id>"` on `direction: "in"`.
- `agent.thinking` for `asleep` dots is ignored.

### Phase 2 questions

- **Unlisted skills.** The default table does not say what a skill matching no rule and no default
  gets. The UI's tester and the simulator assume `ask`; please document it.
- **Ties within a scope.** When two rules in the same scope match (`*` and `metta`), which wins? The
  UI assumes the most literal glob, then the newest rule.
- **`reason: "human-only"`.** Human-only skills are denied to agents, yet an approval's reason can
  be `"human-only"`. Is an approval created for a human-only attempt (and what does approving it do)?
  The simulator only traces a deny.
- **`retire {atom}`**: is `atom` the atom text or its `index`? The UI sends the text.
- **Deletions are silent.** There is no `wakeup.deleted` (or `policy`-style full list for wakeups) or
  `goal.deleted` event, so other open clients keep a deleted wakeup until they refetch.
- **Re-opening a stalled goal**: does `PATCH {status:"open"}` reset `attempts`? Otherwise the next
  lapse stalls it again at once. The simulator resets it to 0.
- **Lease length** is a server setting (`HIVE_GOAL_LEASE_MINUTES`); the countdown bar assumes 60 min
  for its full width. Exposing it in `GET /api/hive` would make the bar exact.
- **`last_error` format** is not specified; the UI finds the gateway codes anywhere in the text.
  A structured `{code, status, message}` would be sturdier. Does a 402/429 put the agent in `error`,
  or does it stay `awake`/`asleep` with `last_error` set?
- **Traces for asleep dots / `agent.trace` volume**: `GET /traces?limit=` has no `before` cursor, so
  replay is limited to what was fetched plus what arrived live (the store keeps 120 per dot).
- **Stop-all and wakeups**: does a stopped dot still fire wakeups (and restart)? The dialog says it
  does not.
