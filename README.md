# AR Haunted House — Starter

Minimal working slice: camera feed → SLAM surface detection → tap-to-place
placeholder prop, using the now-open-source 8th Wall engine + Three.js.

## What this does

- Opens the phone's back camera and draws it full-screen.
- Runs 8th Wall's SLAM to track surfaces/feature points as you move the phone.
- On tap, ray-casts into the tracked scene and drops a placeholder cube
  anchored at that real-world point (stand-in for a rocking chair, etc.).

This is deliberately the smallest useful step from the research doc's
suggested MVP (section 8, steps 1–2) — no atmosphere shader, flashlight
cone, or monsters yet. Wire those in on top of `initScenePipelineModule`
in `src/app.js`.

## Setup

```bash
npm install
npm run serve
