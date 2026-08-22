// ---------------------------------------------------------------------------
// Bleeding walls — anchors live, dripping blood decals (materials/
// proceduralSkins.js's createBleedingWallTexture) to REAL wall points from
// surfaceSampler.js. This is the concrete version of the game's core rule:
// the plane mesh only exists in the Three.js scene that gets composited
// on-screen through hauntedVision — the actual wall the player is standing
// in front of never changes. Lower the phone, the room is normal. Raise it,
// the lens shows blood running down a wall that, in reality, is just paint.
//
// Same pool + timer-scheduling shape as scareSystem.js/crawlOutOfWall.js —
// a fixed pool of decal instances, spawned onto wall points on a randomized
// timer (never a learnable fixed interval), each one runs its drip growth
// to completion and then either lingers or gets recycled onto a new wall
// point, so the effect keeps roaming the room instead of only ever
// appearing in one spot.
//
// Roofs/ceilings: surfaceSampler.js's classifySurface() only tells floor
// (normal pointing up) apart from everything else — a real ceiling hit
// (normal pointing DOWN) doesn't clear the upDot > 0.7 floor threshold, so
// it already falls into the 'wall' pool today. That means ceiling points
// are already reachable here with zero extra code — a decal placed there
// orients correctly (mesh.lookAt uses the real hit normal, not an assumed
// one) and just happens to hang upside-down off the ceiling. No separate
// "roof" pool was needed.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { createBleedingWallTexture } from "../materials/proceduralSkins";

// --- Tunables — retune by feel, same pattern as scareSystem.js. ---
const POOL_SIZE = 4; // concurrent bleeding-wall decals, max
const SPAWN_INTERVAL_MIN = 6; // seconds between attempts to place a new bleed
const SPAWN_INTERVAL_MAX = 16;
// As getIntensity() climbs toward 1 (see createBleedingWalls), spawn
// intervals shrink by up to this fraction — walls bleed more often as the
// story escalates, never a flat/constant rate throughout the whole game.
const MAX_INTENSITY_SPEEDUP = 0.6;
// How long a fully-grown (isComplete()) decal lingers before this slot is
// freed up to relocate onto a different wall point — keeps the effect
// roaming the room rather than permanently marking the first walls found.
const LINGER_SECONDS_MIN = 20;
const LINGER_SECONDS_MAX = 45;
const FADE_SECONDS = 2.5; // fade-out before a lingering decal is recycled

// Small offset off the real surface so the decal doesn't z-fight with
// whatever XR8 draws for the passthrough/tracked-mesh at that point —
// same trick crawlOutOfWall.js uses for its emerge depth, just much smaller
// since this should look flush against the wall, not floating off it.
const SURFACE_OFFSET = 0.01;

const DECAL_WIDTH = 0.5;
const DECAL_HEIGHT = 0.7;

const randomBetween = (min, max) => min + Math.random() * (max - min);

const buildDecalSlot = (seed, audio) => {
  const { texture, material, update, isComplete } = createBleedingWallTexture({
    seed,
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(DECAL_WIDTH, DECAL_HEIGHT),
    material
  );
  mesh.visible = false;

  let state = "idle"; // idle -> growing -> lingering -> fading -> idle
  let elapsed = 0;
  let lingerDuration = 0;

  const placeAt = (point) => {
    const normal = point.normal || new THREE.Vector3(0, 1, 0);
    mesh.position.copy(point.position).addScaledVector(normal, SURFACE_OFFSET);
    mesh.up.set(0, 1, 0);
    mesh.lookAt(point.position.clone().add(normal));
    mesh.visible = true;
    material.opacity = 1;
    state = "growing";
    elapsed = 0;

    // Wet-dripping cue, positioned at the wall so it pans/attenuates as the
    // player moves relative to it — a no-op (with a console warning) until
    // app.js's audio manager has a "wallDrip" buffer loaded; see CHANGES.md.
    if (audio)
      audio.playPositionalOneShot("wallDrip", point.position, {
        volume: 0.7,
        refDistance: 0.6,
        maxDistance: 5,
      });
  };

  const tick = (delta) => {
    if (state === "idle") return;
    update(delta); // always keep the drip animation advancing while visible

    if (state === "growing") {
      if (isComplete()) {
        state = "lingering";
        elapsed = 0;
        lingerDuration = randomBetween(LINGER_SECONDS_MIN, LINGER_SECONDS_MAX);
      }
      return;
    }

    if (state === "lingering") {
      elapsed += delta;
      if (elapsed >= lingerDuration) {
        state = "fading";
        elapsed = 0;
      }
      return;
    }

    if (state === "fading") {
      elapsed += delta;
      const t = Math.min(elapsed / FADE_SECONDS, 1);
      material.opacity = 1 - t;
      if (t >= 1) {
        mesh.visible = false;
        state = "idle";
      }
    }
  };

  const isIdle = () => state === "idle";

  return { mesh, placeAt, tick, isIdle };
};

// surfaceSampler: the shared createSurfaceSampler() instance from app.js —
// reused rather than re-scanning, so this rides on the same wall data the
// entities already spawn from.
// audio: optional spatialAudio.js manager (createAudioManager()) — if
// provided, each new bleed plays a positional "wallDrip" one-shot.
// getIntensity: optional () => number in [0, 1] — app.js derives this from
// story progress (see app.js's entitiesCaptured tracking). 0 = calmest
// pacing (Act 1 spawn intervals), 1 = most frequent bleeding the tunables
// allow. Omit it to just run at the calm baseline throughout.
export const createBleedingWalls = ({ surfaceSampler, audio, getIntensity, }) => {
  const slots = [];
  for (let i = 0; i < POOL_SIZE; i++)
    slots.push(buildDecalSlot(1000 + i, audio));

  let spawnTimer = randomBetween(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX);

  const scheduleNextSpawn = () => {
    const intensity = getIntensity
      ? Math.max(0, Math.min(1, getIntensity()))
      : 0;
    const speedup = 1 - intensity * MAX_INTENSITY_SPEEDUP;
    spawnTimer = randomBetween(
      SPAWN_INTERVAL_MIN * speedup,
      SPAWN_INTERVAL_MAX * speedup
    );
  };

  const attemptSpawn = () => {
    const slot = slots.find((s) => s.isIdle());
    if (!slot) return; // pool full — try again next timer roll
    const point = surfaceSampler.getRandomPoint("wall");
    if (!point) return; // room not scanned enough yet — try again next roll
    slot.placeAt(point);
  };

  // Force a bleed to start at a SPECIFIC point right now, bypassing the
  // timer — used by app.js to tie a bleed to a game event (e.g. "a nearby
  // wall starts bleeding right as an entity first emerges"), per the
  // story bible's rule that the haunting reacts to the player's actions
  // rather than running on a schedule independent of them. Silently no-ops
  // if the whole pool is already busy — this is a flourish, not something
  // that should ever fight an in-progress bleed for a slot.
  const spawnNear = (point) => {
    const slot = slots.find((s) => s.isIdle());
    if (!slot) return false;
    slot.placeAt(point);
    return true;
  };

  // Call once, after the decal meshes need to be visible in the scene —
  // matches the ghost/spider pool pattern in app.js (`scene.add(...)` per
  // instance at setup time, reused/repositioned afterward).
  const addTo = (scene) => {
    slots.forEach((s) => scene.add(s.mesh));
  };

  const update = (delta) => {
    spawnTimer -= delta;
    if (spawnTimer <= 0) {
      attemptSpawn();
      scheduleNextSpawn();
    }
    slots.forEach((s) => s.tick(delta));
  };

  return { addTo, update, spawnNear };
};
