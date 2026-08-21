# LENS — Start Here
### Copy-paste prompt + file list + Scene 1 build checklist for a new chat

---

## Files to attach to the new chat

Attach all of these — the prompt below assumes Claude reads them first:

1. **`Horror--main.zip`** — current codebase (8th Wall + Three.js). This is
   the real source of truth for what's built; treat the docs as the spec,
   the zip as the ground truth for what actually exists right now.
2. **`story-bible.md`** — narrative design: Elusiv3, the capture-not-kill
   mechanic, the hidden transfer/ward-theft truths, the boss reveal.
3. **`scene-script.md`** — full scene-by-scene build spec, Acts 1–3, with
   `[HOOK: ...]` notes tying design to actual code locations.
4. **`build-roadmap.md`** — the staged plan (Stage 1 = capture loop, next).
5. **`weapons.js`** — standalone procedural effects module (candle flicker,
   particle bursts, sigil glow, etc.) — reference for the pickup-cutscene
   visuals even though items are now passive buffs, not placed weapons.
6. **`spatialAudio.js`** — positional audio manager (hunting cues, ambient
   beds, call/notification playback) — not yet wired into `app.js`.

---

## Prompt to paste into the new chat

```
I'm building an AR horror game called LENS, using 8th Wall + Three.js
(webpack, no build-your-own-engine work needed — the pipeline already
exists). I'm attaching the current codebase (Horror--main.zip) plus three
design docs (story-bible.md, scene-script.md, build-roadmap.md) and two
standalone reference modules (weapons.js, spatialAudio.js).

Please read story-bible.md and scene-script.md in full before touching any
code — they're the source of truth for how this is supposed to work, and
I don't want to re-explain decisions that are already written down there.
build-roadmap.md has the staged build order I want to follow.

Current state: the SLAM boot pipeline, haunted-vision shader, surface
sampling (wall/floor/furniture classification), scare scheduler
(timer + proximity spawning), and the two-phase crawl-out ghost (scare-only
first reveal, flees, becomes capturable on re-find) are all built and
working in the zip. Weapons were cut entirely — there is no combat, the
lens itself is the only tool.

What's NOT built yet, and what I want to start on: the actual capture loop
(reticle, focus meter, capture timer, shutter button) — this is Stage 1 in
build-roadmap.md and the single biggest gap. Build it against ONE entity in
ONE room first, per the roadmap's own guidance, before touching anything
downstream (hand tracking, items, notifications, boss). Wire it into the
existing isCapturable() flag already on the crawlOutOfWall.js ghosts.

Ask me before making any story/mechanic decisions that aren't already
settled in the docs — but if it's just an implementation detail (naming,
file structure, exact tuning numbers), use your judgment and keep moving.
```

---

## Scene 1 build checklist (Act 1 — "Just a Filter")

Status reflects what's actually in the current zip, not just the docs.

- [x] **Scene 1.1 — Calibration.** SLAM boot, debug logging, `onStart` flow.
      Built (`app.js`).
- [x] **Scene 1.2 — First Look.** First jump scare via the crawl-out ghost +
      scare scheduler. Built (`crawlOutOfWall.js`, `scareSystem.js`).
- [ ] **Scene 1.3 — Teaching the Reticle.** Reticle UI, focus meter, capture
      timer, shutter button. **Not built — this is the next thing to build,
      full stop.** Everything else in Act 1 depends on this existing first.
- [ ] **Scene 1.4 — First Real Chase.** Entity dodge-to-frame-edge behavior
      and furniture duck-behind. Partially supported (furniture pool exists
      in `surfaceSampler.js`) but the dodge AI itself isn't wired up yet —
      depends on 1.3 existing.
- [ ] **Scene 1.5 — First Support Item.** Item reveal (embedded-in-wall,
      like an entity but marked interactive). Not built.
- [ ] **Scene 1.6 — Pickup Cutscene.** SLAM↔HandController swap, grab
      gesture, equip-as-buff. Not built — and per the roadmap, prototype the
      pipeline swap itself in isolation before wiring it to item logic.
- [ ] **Scene 1.7 — Close of Act 1.** One-frame lens glitch beat. Small,
      build last — it's cosmetic, not load-bearing.

**Build order for this checklist: 1.3 first, alone, tested until it feels
right on a real device — then 1.4 — then 1.5/1.6 together — then 1.7.**
Don't parallelize these; each one either depends on the last or is cheap
enough to leave for the end.
