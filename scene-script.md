# LENS — Full Scene Script
### Build reference: scene-by-scene breakdown for implementation

This maps onto the existing 8th Wall / Three.js starter (`src/app.js`,
`src/hauntedShader.js`), plus two additional modules built for this design:
`weapons.js` (repurposed as **support items**, not weapons — see below) and
`spatialAudio.js` (positional hunting cues, ambient beds, call/notification
audio, one-shot SFX). Rooms are generic (Living Room, Hallway, Kitchen,
Bathroom, Bedroom, Basement/Utility) since the player is scanning their *own*
house — treat each "room" as a state the game enters once SLAM has built
enough surface data in a new area, not a hardcoded map.

**Core loop reminder:** there are no weapons. The lens itself is the only
tool that banishes anything — entities are captured, not killed, by holding
them in a reticle until a stability meter empties, then confirmed with a
thumb-operated shutter button. Support items (candle, holy water, salt,
sigil) never do the banishing themselves — they change the terms of the
chase. See the story bible's "Capture, Don't Kill" section for full rules.

---

## 0. Global Systems (build these first)

**Lens state** — two states the whole game hinges on:
- `LENS_DOWN`: phone lowered / app not actively framing through the camera. Real world, nothing renders, entities are free to hunt.
- `LENS_UP`: phone raised, `hauntedVision` compositing active, reticle visible. Entities try to flee frame; only here can a capture happen.
`[HOOK: window.gameState.lensUp, same as before — every entity behavior and scare check reads this flag.]`

**Reticle + capture system** — the core loop, build this before anything else:
- `reticleTarget`: whichever entity (if any) is currently centered enough in view to count as "framed." Simple screen-space distance-from-center check against each active entity's projected position.
- `captureTimer`: starts counting down the frame an entity is first spotted (not first centered) — visualized as a thinning ring, no numeric readout.
- `focusMeter`: fills only while `reticleTarget` is actively held and centered; does not drain when frame is lost, only pauses.
- On `focusMeter` reaching max: trigger capture sequence (flash, shutter-click, entity pulled into screen, despawn).
- On `captureTimer` reaching zero before capture: trigger breakout sequence (entity rushes player, scare beat, re-hide elsewhere at higher difficulty).
`[HOOK: window.gameState.reticleTarget, window.gameState.captureTimer, window.gameState.focusMeter — drive all entity AI state off these three.]`

**Shutter button ("snap circle")** — thumb-operated on-screen UI element, styled like a real camera app's shutter. Tap = attempt capture if `focusMeter` is full (`audio.playOneShot('shutterClick')` + `audio.playOneShot('captureFlash')`); tap with meter not full = no-op with `audio.playOneShot('shutterWhiff')`, cheap feedback that timing matters.
`[HOOK: single onTouchStart listener bound to a fixed screen-space UI circle, independent of the world-space hit-test touch handling used for item placement.]`

**Progress tracker** — global int `roomsCleared` (0–5) and `entitiesCaptured` (running count). Both notifications and calls key off these, not off timers, so pacing matches the player instead of a clock.
`[HOOK: window.gameState.roomsCleared, window.gameState.entitiesCaptured]`

**Entity AI states** — every entity is always in exactly one of:
- `HIDDEN`: not yet spotted, embedded in a wall/surface patch.
- **First-ever reveal is always scare-only.** When an entity is spotted for the very first time, it plays its emergence, the jump-scare flash fires, then it flees to a *different* surface point and goes dormant — never `FLEEING`/capturable on this sighting. `[HOOK: crawlOutOfWall.js — hasBeenRevealedOnce/isCapturable(), onNeedFleeTarget()/onDespawn({fledTo}) wiring in app.js, registerFledTarget() in scareSystem.js. Already implemented in the current build.]`
- `FLEEING`: spotted **on a re-find** (i.e. wherever it fled to after its first reveal) and currently framed in the reticle — actively dodging toward frame edges, ducking behind real furniture (via SLAM surface data), phasing through walls to break line of sight.
- `HUNTING`: spotted but currently out of frame or `LENS_DOWN` — closing distance on the player in the real world, silent to the eye, but carrying a looping positional footstep/whisper cue via `spatialAudio.js` so the player can tell *where* it is without seeing it. `[HOOK: audio.attachEntityCue(entity.object3D, 'footstep', { loop: true }).setActive(true) on entering this state; setActive(false) on leaving it.]`
- `CAPTURING`: focus meter is draining, entity is visibly resisting (streaked pull-toward-camera particle effect).
- `BROKEN_OUT`: capture timer expired — scripted short-range rush at the player (paired with `audio.playPositionalOneShot('rush', entity.position)` for the jump-scare impact), then flees to re-hide.

**Entity spawn logic** — entities are never player-placed, and (as of this revision) neither are support items — nothing in the game is spatially placed by the player anymore. Entity spawn points are chosen automatically from the room's SLAM surface/feature data, weighted rather than purely random:
- Favor surfaces large enough to visually sell an entity emerging from them (filter out tiny/noisy feature points).
- Deprioritize points currently inside the player's direct view — a first sighting should read as a discovery when the player pans into it, not an ambush that pops in front of them from nothing.
- Exclude the last 1–2 spawn points used in the same room, so encounters don't visibly repeat the same corner.
- Never select a point that would place an entity somewhere spatially implausible for a real room the SLAM mesh doesn't actually support (e.g., mid-air with no detected surface nearby).
- **Furniture-height pool**: 8th Wall's hit-test gives geometry, not object recognition, so there's no true "that's a table" detection. Proxy in use: a horizontal (floor-orientation) surface sitting meaningfully above the lowest floor point sampled so far gets bucketed as `furniture` instead of `floor` — good enough to let entities hide "on/behind something" rather than only inside walls. `[HOOK: surfaceSampler.js — FURNITURE_MIN_HEIGHT heuristic, already implemented.]`
`[HOOK: a spawn-candidate scorer run against XrController's current surface/point-cloud data each time a new entity needs to spawn; reuse this for every act, just widen the eligible surface set as the game escalates.]`

**Simulated flash / ambient lens lighting** — there is no flashlight item. The lens view itself always renders slightly brighter than the raw camera feed, as if a phone's camera flash/torch were assisting it — this is a constant property of `hauntedShader.js`'s compositing, not a toggle or a pickup. Dark patches and residue should read as "barely lit by this" rather than "in pitch darkness," to keep readability without needing a light source object.
`[HOOK: bake this into the same shader pass that currently handles patch-intensity — a flat brightness/gamma lift on the composited lens output, always active while LENS_UP.]`

**Support item persistence — no longer applicable.** Items are never placed in the world at all now (see below), so there's nothing to reconcile across a SLAM restart. This removes the riskiest open technical question in the whole plan.

**Support item inventory** — found and equipped via hand-tracking pickup cutscenes (SLAM pauses → `HandController` takes over for the pickup animation → SLAM resumes). Every item is a passive, global buff, applied the moment the cutscene ends — no placement step, no world anchor, no hit-test needed for items at all:
1. **Candle → More Light.** Raises the lens's simulated-flash brightness a notch — capturable entities and dark residue read from further away, for the rest of the game.
2. **Salt → Slower Hunters.** Reduces every `HUNTING` entity's approach speed while `LENS_DOWN`, globally, from the moment it's equipped.
3. **Holy Water → Composure.** Raises the player's max Composure (see below) — more buffer before things start visibly getting worse.
4. **Ward Sigil → Easier Captures.** Eases the capture math globally — focus meter holds more of its progress through a lost/re-found frame, or the capture timer runs a little less punishingly.

**Composure** — a small resource introduced specifically because removing spatial item interaction meant `BROKEN_OUT` no longer had anything at stake beyond a scare beat. Composure takes a hit each time an entity breaks out and rushes the player. It should never gate a hard game-over (failure stays soft — harder and longer, not a fail state, per the earlier design decision) but a depleted Composure meter should visibly worsen the moment-to-moment feel: reticle drift, tighter capture timers, a shakier lens grip — until it recovers naturally or holy water raises the ceiling back up.

`[HOOK: all four items are simple global multipliers/state flags applied once at pickup — no hit-test, no world anchor, no placement UI needed for any of them.]`

**Notification/Call scheduler** — fires on state transitions (room entered, first capture, boss phase entered), not a hard timer. Calls are played via `audio.playCall('static', [voLineBufferNames...])` from `spatialAudio.js`, which loops a static bed, ducks whatever ambient room tone is currently playing, and steps through the VO fragments with silence gaps between them — the "cut off mid-sentence" pacing is a config value (`lineGapMs`), not something each call has to hand-roll.
`[HOOK: event emitter or inline checks after each capture/breakout resolves; each call site is one audio.playCall() call with that scene's specific VO line names.]`

**hauntedVision.flash()** already exists as a global scripted jump-scare trigger — every scare beat below should call it.

**Technical constraints (why the build is shaped this way):**
- 8th Wall's `HandController` (hand tracking) and `XrController` (SLAM/world tracking) **cannot run at the same time** — this is a hard platform limit, confirmed by 8th Wall directly, not a workaround-able bug.
- Because of that, hand tracking in this game is exclusively used for the short, self-contained pickup/equip cutscenes (Scene 1.6 and its reuses) — never for live combat input. The core loop (aim with the phone, tap the shutter) is deliberately one-handed and thumb-operated so it never needs hand tracking at all.
- Swapping back to `XrController` after a hand-tracking cutscene isn't guaranteed to resume tracking cleanly — the safer pattern is a full `XR8.stop()` → `XR8.run()` restart rather than pause/resume, which means the room mapping likely resets. Design around this rather than fighting it: play the resume as a "Recalibrating..." / portal-reconnecting beat (Scene 1.6), not a hidden loading screen.
- A native app (ARKit + Vision on iOS, or ARCore + MediaPipe on Android) would allow true simultaneous two-hand tracking, but was evaluated and **not adopted** — it would mean leaving 8th Wall/the web entirely, rebuilding per-platform, and losing install-free distribution, for a feature the one-handed control scheme already covers well enough.

---

## ACT 1 — "Just a Filter"

### Scene 1.1 — Calibration (Tutorial)
- **Setting:** wherever the player first opens the app — likely their living room.
- **Real world:** nothing happens; standard SLAM calibration pan.
- **Lens view:** clean camera feed, faint scan-line UI, "MicroLens Calibrating..." text.
- **Beat:** calibration completes → one single dark patch flickers on a wall for ~0.4s and vanishes. `[HOOK: hauntedShader.js, one-shot low-intensity patch pass.]`
- **Notification (fires immediately after):** *"MicroLens: unusual sensor activity detected."*

### Scene 1.2 — First Look
- **Trigger:** player raises phone (`LENS_UP`) for the first sustained time (~3s).
- **Lens view:** dark patches appear more consistently — ambiguous, could still read as a bug.
- **Beat (scripted, one-time):** first jump scare — a humanoid shape peels off a wall patch, visible under a second, gone before the player can frame it. `hauntedVision.flash()` fires. No reticle interaction possible yet — this entity isn't capturable, it's a pure scare.

### Scene 1.3 — Teaching the Reticle
- **Trigger:** a tutorial-weight entity spawns (slow, telegraphed, doesn't actively dodge yet — training wheels).
- **UI introduced:** reticle appears on-screen for the first time, snap-circle shutter button fades in.
- **Mechanic taught, in order:** frame the entity → focus meter visibly starts filling → entity makes its first tentative dodge attempt (teaches "it doesn't want this") → meter fills → shutter button pulses to prompt a tap → capture confirmed (flash + shutter-click + despawn).
- **Deliberately generous capture timer** this one time — this scene is about teaching the loop feels good, not testing the player yet.

### Scene 1.4 — First Real Chase
- **Trigger:** `roomsCleared` reaches 0 still, second entity in the same room.
- **New behavior:** entity actively dodges toward frame edges and can duck behind a real piece of furniture (SLAM-detected surface) to break line of sight — first time the player has to physically move, not just hold the phone still.
- **Capture timer is now a real constraint** — tight enough that a clean, decisive framing beats a slow cautious one.

### Scene 1.5 — First Support Item
- **Trigger:** `roomsCleared` reaches 1, player moves to a new tracked space.
- **Setup:** an item (candle) is visible in the lens embedded in a wall patch, similar to how entities reveal themselves — glowing faintly to mark it as interactive and distinct from a scare.
- **Notification (fires on entering this room):** *"MicroLens: new update available. Do not install."*

### Scene 1.6 — Pickup Cutscene (Hand Tracking)
- **Trigger:** player taps/reaches toward the marked candle.
- **Transition:** glitch flash → SLAM pipeline stops (`XR8.stop()`), `HandController` pipeline starts.
- **Sequence:** camera passthrough stays live (screen-space haunted grade still applied via shader), player's real hand appears with the candle mesh parented purely to a palm/finger landmark — hand space only, no world position is ever created. A simple grab gesture (thumb-index distance crossing a threshold) triggers a short "pick it up, look it over" animation — a few seconds, not player-directed beyond the grab.
- **Transition out:** cutscene ends → `HandController` stops → `XrController` restarts → brief re-scan prompt ("Recalibrating..."), framed in-fiction as the entities actively resisting/sabotaging the connection — they don't want this item leaving where it was. `[HOOK: this reset is a known SLAM limitation — sequential-only pipelines — lean into it as a diegetic beat.]`
- **Result:** item is equipped immediately once recalibration finishes — its global buff (see Global Systems) applies from that point on. No placement step, no hit-test, nothing left in the world to track.

### Scene 1.7 — Close of Act 1
- **Trigger:** `roomsCleared` reaches 2.
- **Beat:** brief lens glitch — for one frame, a room the player hasn't pointed the camera at appears superimposed. No dialogue, no notification — just unease before Act 2.

---

## ACT 2 — "It Knows You're Using It"

### Scene 2.1 — Full Hunting Behavior
- **New behavior (from here on):** entities fully use the `HIDDEN → FLEEING → HUNTING` cycle. `LENS_DOWN` is no longer passive safety — the player starts hearing movement/audio cues while lens is down that aren't there when they check.

### Scene 2.2 — Holy Water + Salt Line
- **Trigger:** `roomsCleared` reaches 3.
- **New pickup cutscenes:** holy water and salt line, same hand-tracking pattern as Scene 1.6.
- **New entity type:** a "phaser" that ducks through walls mid-flee, forcing the player to anticipate an exit point rather than just track current position — this is where holy water's stun becomes worth using deliberately (freeze it before it phases out).

### Scene 2.3 — First Full Phone Call
- **Trigger:** first capture completed using a support item assist (i.e., player has now used holy water or a salt line to land a capture, not just the raw reticle).
- **Beat:** incoming call overlay, unskippable, 10–15s. Static, wrong room tone. Fragmented VO:
  > *"—hello? is someone— MicroLens support, is this— "* [cuts]

### Scene 2.4 — Personal Notifications
- **Trigger:** `roomsCleared` reaches 4.
- **Escalating specificity**, still never confirming the mechanic:
  > *"delete this. delete this right now."*
  > *"why would you install this. why."*
  > *"...the candle won't help in there."* (names something in-room, unexplained)

### Scene 2.5 — Second Call
- **Trigger:** first "phaser" entity captured.
- **Beat:** *"you have to stop— using it, I mean, stop *using*— it follows the— "* [cuts]. More static-degraded than Call 1.

### Scene 2.6 — Ward Sigil + Close of Act 2
- **Trigger:** `roomsCleared` reaches 5.
- **Pickup cutscene:** ward sigil, same pattern.
- **Beat:** notifications stop abruptly for a stretch. Lens view of the final room's entry point shows heavier, more persistent dark residue than anywhere else in the house.

---

## ACT 3 — "The Last Room"

### Scene 3.1 — Entry to the Final Room
- **Environment:** heaviest patch density yet; ambient audio drops out almost entirely.
- **Third call (Call 3):**
  > *"—basement. don't look at the— I already looked, don't—"* [long silence, then a whisper that isn't his voice]

### Scene 3.2 — Escalating Encounters
- Two to three tougher entities combining prior behaviors (phases through walls, exploits real furniture for cover, immediately hunts the instant frame is lost). Capture timers are tightest here — sigil placement becomes close to mandatory to keep a capture viable.

### Scene 3.3 — The Boss Encounter
- **Trigger:** last standard entity in the final room captured.
- **Beat:** the boss doesn't spawn from a wall patch — it's already standing in frame the moment the player raises the phone. It does not flee, does not hide, does not react to `LENS_DOWN`/`LENS_UP` at all — it just stands there and lets the reticle lock, breaking the one rule the whole game has trained the player to trust.
- **Capture sequence:** meter drains unusually slowly (this is the "boss health bar" reskinned as focus difficulty) and support items are noticeably less effective — this is the one capture in the game the player mostly has to just hold.

### Scene 3.4 — The Reveal
- **Trigger:** boss capture completes.
- **Beat (scripted cutscene, no player input):**
  > *"...thank you. For freeing us."*
  [it laughs — layered, more than one voice, doesn't match its earlier silence]
  > *"Now — we go eliminate the creator."*
- Screen glitches hard — lens view and real camera feed briefly desync/tear.
- **Final notification, right after the laugh:**
  > *"no. no no no—"* [cuts to nothing]
- Call attempt shown connecting... then failing outright — no static, no fragments, just a failed call icon.

### Scene 3.5 — Close
- Cut to black. Card: **TO BE CONTINUED**
- No player choice, no ending branch — cliffhanger by design.

---

## Implementation Order (suggested build sequence)

1. Lens-state flag + `hauntedVision` patch-intensity scaling (Scenes 1.1–1.2).
2. **Reticle + focus meter + capture timer + shutter button (Scene 1.3) — this is the MVP loop.** Wire in `spatialAudio.js`'s one-shots (shutterClick, captureFlash, shutterWhiff) as soon as this loop exists — capture feel depends on audio landing in sync with the visual flash, not bolted on later.
3. Entity dodge behavior (frame-edge evasion, furniture-based hiding) (Scene 1.4).
4. Hand-tracking pickup cutscene pipeline (stop/start swap, grab-gesture detection, re-scan transition) — build this once, reuse for every support item (Scene 1.6).
5. Notification scheduler wired to `roomsCleared` events; `spatialAudio.js`'s `playCall()` for the phone-call beats.
6. Full `HIDDEN → FLEEING → HUNTING` cycle (Act 2's core new rule) — this is where `attachEntityCue()`'s positional footstep/whisper audio actually matters, since it's the only signal the player has during `LENS_DOWN` — plus holy water/salt line effects.
7. Ambient room-tone bed per area (`playAmbient()`, crossfaded on room transitions) layered in alongside the call-overlay system.
8. Sigil placement + capture-timer-slow radius (Act 3).
9. Boss encounter as its own scripted state machine (doesn't flee/hide — deliberately breaks entity-AI rules, so don't reuse the standard AI class for it).
10. Cutscene/reveal sequence + glitch transition + end card.

Build steps 1–3 first and get them feeling scary before touching anything downstream — the whole game's tension depends on the reticle/capture loop landing correctly on its own, before any support items or hand-tracking cutscenes are layered on top.
