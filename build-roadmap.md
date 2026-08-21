# LENS — Build Roadmap
### Staged development plan + best practices

Cross-references `story-bible.md` (narrative) and `scene-script.md` (full
scene-by-scene spec). This doc is about *order of operations* and *how to
build without breaking things* — read the other two for what to build.

---

## Where things actually stand right now

Already working in the current zip:
- Boot pipeline, on-screen debug logging, SLAM init (`app.js`).
- `hauntedShader.js` — post-process pass exists, currently at whatever
  intensity you last set (was disabled for build visibility).
- `surfaceSampler.js` — continuous surface sampling, wall/floor/furniture
  classification (height heuristic), dedup, `getRandomPointExcluding()`.
- `scareSystem.js` — timer + proximity spawning, non-learnable randomization,
  `registerFledTarget()` for guaranteed re-finds.
- `crawlOutOfWall.js` — two-phase entity: scare-only first reveal, flees,
  becomes `isCapturable()` on re-find.
- Weapons cut entirely (no pistol, no flashlight item).

**Not yet built** (design-complete in the docs, zero code): reticle, focus
meter, capture timer, shutter button — the actual capture loop. Support
items and the hand-tracking pickup/placement pipeline. Notification/call
system. Boss encounter. Everything past Act 1's basic scare loop.

That ordering — scares working before capture exists — is fine and
actually the right order to have landed in. Keep going in this direction:
**prove the scare feels good before you build the systems that depend on it.**

---

## Stage 1 — The Capture Loop (next, and the most important stage)

This is the MVP. Nothing past this stage matters if this doesn't feel good,
so don't let scope creep into Stage 2+ territory before this is solid.

**Build:**
- Reticle UI (screen-space, always visible when `LENS_UP`).
- Focus meter (fills while a capturable entity is centered; pauses, doesn't
  reset, when frame is lost).
- Capture timer (starts on first sighting of a *capturable* — i.e. already-
  fled-once — entity).
- Shutter button (thumb zone, bottom corner) wired to attempt-capture logic.
- Wire into the existing `isCapturable()` flag already on `crawlOutOfWall.js`
  ghosts — a scare-only first reveal should visibly NOT show a reticle/meter
  at all, only a re-find should.

**Best practices for this stage:**
- Build and test against **exactly one entity, one room** before touching
  anything else. Don't scale to multiple simultaneous entities until the
  single-target loop feels right in hand.
- Keep every tunable (meter fill rate, timer duration, reticle radius) as a
  named constant at the top of the file, same pattern `scareSystem.js`
  already uses — you will retune these by feel after playtesting, repeatedly.
- Test on a real device early and often here specifically. Reticle/focus
  timing that feels right on a desktop simulator with a mouse will not feel
  right with an actual hand holding an actual phone — the aiming precision
  is completely different.

---

## Stage 2 — Full Entity State Machine + Hunting Audio

**Build:**
- Wire `HIDDEN → (scare-only reveal) → fled/dormant → FLEEING (on re-find) →
  CAPTURING → captured`, plus `HUNTING` (out of frame / `LENS_DOWN`) and
  `BROKEN_OUT` (timer expired).
- `spatialAudio.js`'s `attachEntityCue()` for the `HUNTING` footstep/whisper
  — this is what makes `LENS_DOWN` a real mechanic instead of just "screen
  off."
- Furniture-aware dodging: `FLEEING` entities use the `furniture` pool from
  `surfaceSampler.js` as duck-behind points, not just walls.

**Best practices:**
- This is where the game either does or doesn't achieve the core tension
  ("do I look or not"). Playtest this stage specifically for that feeling
  before adding more content on top — if `LENS_DOWN` doesn't feel dangerous
  yet, more rooms won't fix it.
- Keep the audio cue volume/panning tunable separately from the visual
  systems — you'll want to balance "can hear it" against "too easy to
  pinpoint" independently of anything visual.

---

## Stage 3 — Support Items + Hand-Tracking Pipeline

**Build:**
- Item pickup cutscene: `XR8.stop()` → `HandController` → grab gesture →
  hand-space-only inspect animation → `HandController` stop → `XrController`
  restart → recalibration prompt → **item equips immediately as a passive
  global buff.** No placement step, no hit-test, no world anchor for items
  at all — this was simplified specifically to remove the riskiest open
  technical question in the plan (reconciling a placed item's position
  across a SLAM coordinate-origin change). Nothing left to reconcile.
- Four buffs, repurposed from `weapons.js`'s existing procedural effects:
  candle (lens brightness), salt (slows `HUNTING` approach speed), holy
  water (raises max Composure), sigil (eases capture math). `weapons.js`'s
  visual/animation code is still useful for the pickup cutscene's "look at
  the item" moment even though the items no longer do anything spatial.

**Best practices — still worth isolating, even simplified:**
- The SLAM ↔ HandController swap itself is still the platform-level
  unknown, even with placement removed — **prototype it in isolation first**,
  on at least one real iOS and one real Android device, before wiring it to
  any item logic. What's gone is the *placement* risk, not the *pipeline
  swap* risk.
- Build candle's full pickup → equip → buff-applied path end to end first,
  then copy the pattern for the other three — cheaper to debug one path
  four times than four paths once.
- Composure is a new resource this simplification introduced — keep its
  tuning (how much a breakout costs, how much holy water restores) in the
  same named-constants pattern as everything else, since it'll need
  playtesting-driven adjustment like the capture timer will.

---

## Stage 4 — Notifications & Calls (Elusiv3)

**Build:**
- Progress-event scheduler (`roomsCleared`/`entitiesCaptured` thresholds
  from `scene-script.md`) firing `spatialAudio.js`'s `playCall()` and
  notification text/UI.
- Actual VO recording or TTS placeholder for the call fragments.

**Best practices:**
- This stage is almost pure content once the scheduler exists — the
  scheduler itself is small. Don't over-engineer it; a simple list of
  `{ trigger, notificationText, callAudioKeys }` entries checked against
  game state is enough, no need for a generic event-bus framework.
- Record/placeholder audio early even if it's scratch VO — timing the
  static/fragment pacing against real audio length matters more than the
  final voice quality at this stage.

---

## Stage 5 — Content: Full House, Boss, Ending

**Build:**
- Extend from one room to the full room progression in `scene-script.md`'s
  Act structure.
- Boss encounter as its **own** state machine (explicitly not reusing the
  standard entity AI class, since it deliberately breaks those rules).
- Reveal cutscene, glitch transition, end card.

**Best practices:**
- Difficulty/pacing tuning belongs here, not earlier — don't hand-tune scare
  frequency or capture difficulty until the full loop (Stages 1–2) is proven
  fun in isolation. Tuning a broken loop wastes the tuning work.
- Playtest the full act structure with people who haven't seen the game
  before, specifically for pacing — you already know every beat is coming,
  so you're the worst judge of whether the escalation feels earned.

---

## Stage 6 — Polish Pass

**Build:**
- Turn the haunted shader intensity back up from build-mode and tune it for
  real (`uIntensity` — or whatever you replaced that with — plus the
  always-on simulated-flash brightening from `scene-script.md`).
- Swap primitive meshes for real models (`GLTFLoader`) — pistol's gone, but
  the ghost, and any item meshes, are still primitives-for-now by design.
- Real audio assets in for `spatialAudio.js`'s placeholder buffer names.
- Performance pass: draw calls, particle counts, shader cost on mid-range
  Android specifically (the actual worst-case device most players will use,
  not the phone you're developing on).

**Best practices:**
- Do this last, deliberately. Polishing a system before its gameplay is
  proven is wasted effort if that system changes — everything above this
  stage is allowed to look rough.

---

## Cross-cutting practices for the whole project

- **Ship in vertical slices, not horizontal layers.** One entity, one room,
  fully working end-to-end (spawn → scare → flee → re-find → capture) beats
  five rooms that are each half-implemented. This is already how the
  project has been going — keep doing it.
- **Test on real devices at the end of every stage**, not just at the end
  of the project. 8th Wall/WebAR behavior (tracking quality, camera
  permissions, performance) diverges from desktop simulation in ways that
  only show up on an actual phone.
- **Keep tunable numbers as named constants**, not inline magic numbers —
  every system so far (`scareSystem.js`, `hauntedShader.js`) already follows
  this; stay consistent so playtesting feedback is fast to act on.
- **Snapshot/version working builds before starting a risky stage** —
  especially before Stage 3's pipeline-swap work, since that's the one part
  of the stack touching a platform limitation rather than your own code.
- **Keep `story-bible.md`/`scene-script.md` updated alongside code changes**,
  same as this conversation has been doing — the moment implementation and
  design doc drift apart, one of them becomes wrong, and it's hard to tell
  which.
