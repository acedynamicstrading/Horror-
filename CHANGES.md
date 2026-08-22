# Merged onto your newer build — both versions now the same "newest"

You'd moved well past what I'd been building on (real skeleton ghost model,
real capture UI, gameState.js, settingsPanel.js, hauntedResidue.js — none of
that existed in the branch I was working from). This merges the haunting
features from my last few updates (spiders, bleeding walls, furniture decay,
event-tied bleeding, escalation, drip audio) INTO your current codebase,
adapted to fit what's actually there now — not a copy-paste of the old files.

Drop `src/` from this zip over your project. Verified with a real
`npm run build` against your uploaded zip (assets.zip extracted to
`src/assets/` first) — compiles clean.

## Shader — off again

`onRender`'s `hauntedVision.render()` call is commented out again, per your
message. Left a note there for later: it was still dark even after the
retune, and the most likely reason is `settingsPanel.js` persisting to
`localStorage` under a key that never changed version — so an old, darker
saved setting from before the retune is probably still overriding the new
lighter defaults every time the page loads. Worth checking (drag Brightness
up in the in-game Settings panel — if that visibly helps, that's the bug)
before spending more time re-tuning the shader itself.

## What got adapted, and why

Your codebase already has real answers for two things I'd built rougher
versions of before — so those were dropped rather than duplicated:

- **`hauntedResidue.js`** already auto-drops ambient residue decals on any
  scanned surface as you scan. My old `createResidueDecal` did the same
  thing worse. Removed from `proceduralSkins.js`.
- **`skeletonGhost.js`** already has its own real texture-mapped material.
  My old `createGhostSkin` (procedural canvas texture) is gone too —
  `proceduralSkins.js` now only contains what's actually new: the spider
  skin, the furniture/floor decay texture, and the live bleeding-wall
  texture.

## New: `src/ghosts/crawlSpider.js`

Rewritten from scratch against your current `skeletonGhost.js`'s exact
state machine and API (`spawnAt(point, normal, opts)`,
`update(delta, cameraPosition)`, `isActive`, `isCapturable`, `forceDespawn`,
`breakout(cameraPosition)`, `captureDespawn(cameraPosition)`) — not the
older, simpler API my previous spider used. It's primitive-built (8-leg
mesh, no rigged model — skeleton ghost is still the only real asset in the
project), but goes through the same `scareLinger → fleeingIn` /
`capturableLinger → captured` / `capturableLinger → lunging → lungeRetreat`
states, including camera-facing and a charge-the-camera breakout. It's
pushed into the exact same `ghostPool` array as the skeleton ghost in
`app.js`, so `captureSystem.js`/`gameState.js`/`scareSystem.js` need zero
changes to handle it. One behavioral difference from the ghost, on purpose:
instead of leaning straight toward the player while capturable, it skitters
— small, frequent lateral repositions across the surface — which reads more
like an actual spider than a copy of the ghost's behavior.

## New: `src/effects/bleedingWalls.js` + `src/effects/hauntedFurniture.js`

Same as delivered last time, unchanged in substance:
- Bleeding walls: live, growing blood-drip decals anchored to real wall
  points (roofs included — your `surfaceSampler.js`'s classifier already
  lumps ceiling hits into the `wall` pool, so no separate roof handling was
  needed). 50% chance a fresh entity emergence also triggers one nearby.
  Plays a positional `wallDrip` audio cue when a decal starts (see below).
- Haunted furniture: static mold/rot decals on furniture/floor points,
  visually distinct from the blood, sized/rotated randomly, lingers longer
  since it's ambient decay rather than a scare beat.
- Both speed up as `entitiesCaptured` climbs (local counter in `app.js`,
  incremented in `captureSystem`'s `onCapture`, capped at 6 for max
  intensity) — a lightweight stand-in for the full `roomsCleared` tracker
  your `scene-script.md` describes, which is still unbuilt.

## Sound

`spatialAudio.js` existed in your project but nothing instantiated it.
`app.js` now creates the audio manager and requests a `wallDrip` buffer
from `/audio/wall-drip.mp3` — that file doesn't exist yet, so right now
this logs a harmless warning and silently no-ops on playback. Drop a real
file at that path and it starts working automatically, positioned so it
pans as you move.

## Not done (flagging so it's not a silent gap)

- The stale-localStorage diagnosis above is a hypothesis based on reading
  the code, not confirmed on-device — check it before assuming the shader
  itself still needs retuning.
- Furniture decay has no event-tied trigger (bleeding walls does). Same
  `spawnNear`-style hook could be added if you want a specific moment tied
  to it.
- No real audio file yet — the hook is live, the asset isn't.
- `src/ghosts/crawlOutOfWall.js` (the older, simpler ghost) is still in
  your zip and still unused — nothing imports it. Safe to delete whenever.
