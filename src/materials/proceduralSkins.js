// ---------------------------------------------------------------------------
// Procedural "skins" — canvas-generated textures for the spider entity and
// two decal effects (furniture/floor decay, live bleeding-wall drips). Ghost
// skin isn't here — skeletonGhost.js has its own real texture maps — and
// ambient wall/floor residue isn't here either — hauntedResidue.js already
// covers that (auto-dropped as surfaces get scanned). This module is for
// what those two don't cover: a spider material, and decals that grow or
// react to events rather than just fading in once.
//
// Everything here is deterministic-seedable canvas noise, not imported art,
// so it's free to regenerate per-instance (see variant seeds below) without
// an asset budget — same "primitives-for-now" spirit as skeletonGhost.js's
// procedural bone twitch layered on top of its real model.
// ---------------------------------------------------------------------------

import * as THREE from "three";

// --- Tunables — retune by feel, same pattern as scareSystem.js / hauntedShader.js. ---
const TEXTURE_SIZE = 256; // square canvas side, px — cheap enough for a few live materials

// Small seeded PRNG (mulberry32) so each generated skin can be reproducible
// per-instance (e.g. "this spider's chitin speckling") without dragging in a
// dependency — Math.random() alone can't be seeded.
const mulberry32 = (seed) => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const makeCanvas = () => {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  return canvas;
};

// ---------------------------------------------------------------------------
// Spider chitin — dark glossy carapace: near-black base, speckled highlight
// flecks (reads as segmented shell under light), banded leg-joint stripes
// applied via UV since legs share this same map.
// ---------------------------------------------------------------------------
const paintSpiderChitin = (ctx, rand) => {
  ctx.fillStyle = "#141313";
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // Glossy speckle flecks — small bright dots, sparse, uneven brightness.
  for (let i = 0; i < 90; i++) {
    const x = rand() * TEXTURE_SIZE;
    const y = rand() * TEXTURE_SIZE;
    const r = 0.6 + rand() * 1.8;
    const bright = 60 + Math.floor(rand() * 70);
    ctx.fillStyle = `rgba(${bright}, ${bright - 10}, ${bright - 10}, ${
      0.25 + rand() * 0.35
    })`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Segment bands — a few horizontal darker stripes for a jointed-leg read.
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  const bandCount = 5;
  for (let i = 0; i < bandCount; i++) {
    const y = (TEXTURE_SIZE / bandCount) * i + rand() * 6;
    ctx.fillRect(0, y, TEXTURE_SIZE, 3 + rand() * 3);
  }
};

// seed: integer — pass a per-instance seed (e.g. pool index) so each pooled
// spider/decal gets a visibly distinct pattern instead of all sharing one
// identical texture, without needing separate hand-authored art.
export const createSpiderSkin = ({ seed = 1 } = {}) => {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  paintSpiderChitin(ctx, mulberry32(seed));
  const map = new THREE.CanvasTexture(canvas);
  map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    map,
    color: 0x1a1a1a,
    emissive: 0x050505,
    roughness: 0.35, // glossier than skin — chitin, not flesh
    metalness: 0.15,
  });
};

// ---------------------------------------------------------------------------
// Decay — creeping mold/rot patch for horizontal or furniture-height
// surfaces (tabletops, seat cushions, floor), where a dripping blood decal
// wouldn't read right (nothing for it to run down). Static like the residue
// texture (no live animation cost), but a distinct sickly green-black
// palette with a soft fuzzy edge instead of residue's hard-edged staining,
// so furniture/floor haunting reads as "growing on it" rather than "the
// same wall stain copy-pasted everywhere."
// ---------------------------------------------------------------------------
const paintDecay = (ctx, rand) => {
  ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  const cx = TEXTURE_SIZE / 2;
  const cy = TEXTURE_SIZE / 2;
  // Base fuzzy patch — irregular, several overlapping blobs like the residue
  // decal, but greener/darker and with a softer falloff (mold spreads
  // gradually, it doesn't have a hard stain edge).
  for (let i = 0; i < 8; i++) {
    const ox = (rand() - 0.5) * TEXTURE_SIZE * 0.4;
    const oy = (rand() - 0.5) * TEXTURE_SIZE * 0.4;
    const r = TEXTURE_SIZE * (0.14 + rand() * 0.18);
    const grad = ctx.createRadialGradient(
      cx + ox,
      cy + oy,
      0,
      cx + ox,
      cy + oy,
      r
    );
    grad.addColorStop(0, "rgba(24, 32, 16, 0.6)");
    grad.addColorStop(0.5, "rgba(20, 28, 14, 0.32)");
    grad.addColorStop(1, "rgba(20, 28, 14, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Speckled spore texture — small dark-green dots scattered across the
  // patch, denser near the center, sparse toward the edge.
  for (let i = 0; i < 70; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = rand() * rand() * TEXTURE_SIZE * 0.35; // squared for center-weighting
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    const shade = 10 + Math.floor(rand() * 25);
    ctx.fillStyle = `rgba(${shade}, ${shade + 18}, ${shade}, ${
      0.3 + rand() * 0.4
    })`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + rand() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
};

// Returns { texture, material } — same shape/usage as createResidueDecal,
// just a different (mold/rot) palette meant for furniture and floor points
// rather than vertical walls.
export const createDecayTexture = ({ seed = 1 } = {}) => {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  paintDecay(ctx, mulberry32(seed));
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  return { texture, material };
};

// ---------------------------------------------------------------------------
// Bleeding wall — a LIVE, growing decal (not a one-shot paint like the
// residue texture above): a few wound-like origin blots that sprout drip
// trails and visibly run downward over real time. Meant to be anchored to a
// real wall point (see effects/bleedingWalls.js) and only ever composited
// into the on-screen lens view — the plane sits a hair off the real wall
// surface, same offset trick the residue decal and entities already use, so
// it reads as "on the wall" without actually touching real-world geometry.
//
// Unlike the other factories here, this one exposes an `update(delta)` you
// must call every frame (from the owning effect's own update loop) — it
// mutates the canvas in place and flips `texture.needsUpdate` only on
// frames where the drips actually changed, to avoid re-uploading a static
// texture to the GPU every tick.
// ---------------------------------------------------------------------------
const BLEED_MAX_DRIPS = 7; // total drip trails this texture will ever grow
const BLEED_ORIGIN_COUNT_MIN = 2;
const BLEED_ORIGIN_COUNT_MAX = 4;
const BLEED_SPAWN_INTERVAL_MIN = 0.4; // seconds between a new drip trail starting
const BLEED_SPAWN_INTERVAL_MAX = 1.6;
const BLEED_SPEED_MIN = 14; // px/sec the drip tip advances downward
const BLEED_SPEED_MAX = 34;
const BLEED_WIDTH_MIN = 2;
const BLEED_WIDTH_MAX = 5;
const BLEED_WOBBLE_AMOUNT = 0.35; // px of horizontal jitter per step, scaled by width

const paintBleedOrigin = (ctx, rand, x, y, r) => {
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, "rgba(90, 6, 8, 0.95)");
  grad.addColorStop(0.55, "rgba(70, 4, 6, 0.75)");
  grad.addColorStop(1, "rgba(50, 2, 4, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

export const createBleedingWallTexture = ({ seed = 1 } = {}) => {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const rand = mulberry32(seed);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });

  // Origins sit in the upper 40% of the texture so drips have room to run.
  const originCount =
    BLEED_ORIGIN_COUNT_MIN +
    Math.floor(rand() * (BLEED_ORIGIN_COUNT_MAX - BLEED_ORIGIN_COUNT_MIN + 1));
  const origins = [];
  for (let i = 0; i < originCount; i++) {
    origins.push({
      x: rand() * TEXTURE_SIZE,
      y: rand() * TEXTURE_SIZE * 0.4,
      r: 5 + rand() * 9,
    });
  }
  origins.forEach((o) => paintBleedOrigin(ctx, rand, o.x, o.y, o.r));
  let dirty = true; // origins just painted — first update() call must upload

  const drips = []; // { x, y, speed, width, alpha }
  let dripsSpawned = 0;
  let spawnTimer =
    BLEED_SPAWN_INTERVAL_MIN +
    rand() * (BLEED_SPAWN_INTERVAL_MAX - BLEED_SPAWN_INTERVAL_MIN);

  const spawnDrip = () => {
    const origin = origins[Math.floor(rand() * origins.length)];
    drips.push({
      x: origin.x + (rand() - 0.5) * origin.r,
      y: origin.y,
      speed: BLEED_SPEED_MIN + rand() * (BLEED_SPEED_MAX - BLEED_SPEED_MIN),
      width: BLEED_WIDTH_MIN + rand() * (BLEED_WIDTH_MAX - BLEED_WIDTH_MIN),
      alpha: 0.55 + rand() * 0.35,
    });
    dripsSpawned++;
  };

  // update: call every frame with delta seconds. Advances active drip tips
  // downward, drawing a short line segment per step (not clearing/redrawing
  // the whole canvas — drips accumulate as a trail, same as real blood
  // running down a surface), and periodically starts new drip trails from a
  // random origin until BLEED_MAX_DRIPS is reached.
  const update = (delta) => {
    if (dripsSpawned < BLEED_MAX_DRIPS) {
      spawnTimer -= delta;
      if (spawnTimer <= 0) {
        spawnDrip();
        spawnTimer =
          BLEED_SPAWN_INTERVAL_MIN +
          rand() * (BLEED_SPAWN_INTERVAL_MAX - BLEED_SPAWN_INTERVAL_MIN);
      }
    }

    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i];
      if (d.y >= TEXTURE_SIZE) {
        drips.splice(i, 1); // reached the bottom edge — done, stop tracking it
        continue;
      }
      const prevX = d.x;
      const prevY = d.y;
      const step = d.speed * delta;
      d.y += step;
      d.x += (rand() - 0.5) * BLEED_WOBBLE_AMOUNT * d.width;

      ctx.strokeStyle = `rgba(120, 8, 10, ${d.alpha})`;
      ctx.lineWidth = d.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();

      // Thin highlight core down the center of the trail — reads as wet/
      // glossy rather than a flat painted stripe.
      ctx.strokeStyle = `rgba(170, 20, 20, ${d.alpha * 0.5})`;
      ctx.lineWidth = Math.max(1, d.width * 0.35);
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();

      dirty = true;
    }

    if (dirty) {
      texture.needsUpdate = true;
      dirty = false;
    }
  };

  // True once every drip has run its full course and no more will spawn —
  // lets the owning effect (effects/bleedingWalls.js) know this instance is
  // done animating and safe to hold static or recycle.
  const isComplete = () =>
    dripsSpawned >= BLEED_MAX_DRIPS && drips.length === 0;

  return { texture, material, update, isComplete };
};
