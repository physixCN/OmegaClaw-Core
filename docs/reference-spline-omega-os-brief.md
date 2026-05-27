# Embodied OS Spline Scene Brief

This is the authored-scene contract for an embodied spatial operating surface.
Spline owns spatial composition, materials, object motion, and cinematic
interaction. The agent runtime owns cognition, live state, auth, chat, channels,
memory, and routing.

## Design Goal

The user enters a living, fluid, neumorphic spatial interface that feels like
standing inside an embodied operating system. The space should be calm, vast,
soft, and alive: a room-like inner chamber where surfaces can rise, stretch,
and warp into apps, shelves, inboxes, control surfaces, artifact views, and live
runtime traces.

## Spline Pros Review

- **Spline scene artist:** author the room, plinth, walls, material language,
  lighting, particles, and transitions in Spline. Avoid rebuilding authored
  geometry in JavaScript.
- **Spatial UI designer:** keep the default state mostly empty. Let surfaces
  emerge from the room only when the agent or the user needs them.
- **Motion designer:** use staged physical motion: pressure, extrusion,
  reveal, settle. Apps should feel grown from the room, not popped over it.
- **Systems designer:** every major interactive Spline object needs a stable
  name so runtime code can find it, drive variables, and listen to events.
- **Architecture note:** Spline is a device/body surface. It is not the mind.
  It displays and receives action; symbolic cognition remains in
  MeTTa-visible runtime memory and reasoning.

## Required Named Objects

Name these objects exactly in Spline's Develop panel:

- `Agent_Core`
- `Floor_Console`
- `Chat_Surface`
- `Inbox_Surface`
- `Family_Wall`
- `Artifact_Floor`
- `Atomspace_Walls`
- `Memory_Wall`
- `House_Control_Surface`

## Required Variables

Create these Spline variables so the frontend can drive the scene:

- `omega_running` boolean
- `omega_activity` number, 0 to 1
- `thought_speed` number
- `floor_console_open` boolean
- `inbox_attention` number, 0 to 1
- `house_attention` number, 0 to 1
- `memory_pressure` number, 0 to 1
- `active_surface` string

## Runtime Contract

The web frontend loads an exported `.splinecode` scene through
`@splinetool/runtime`. The scene URL can be supplied by:

1. `?spline=https://prod.spline.design/.../scene.splinecode`
2. `localStorage.omegaSplineSceneUrl`
3. `VITE_AGENT_SPLINE_SCENE_URL` at build time

The frontend updates Spline variables from runtime overview state and future
live state. Spline events can open the same web-control surfaces used by the
rest of the UI.

## Current Prototype Scope

The runtime bridge is Spline-first and ready for an authored scene. Until a
Spline export URL exists, a lightweight fallback room keeps the portal usable
without pretending to be the final authored Spline scene.
