// ---------------------------------------------------------------------------
// Haunted furniture — set-dressing companion to effects/bleedingWalls.js.
// Same "real object unchanged, lens view shows the rot" rule, applied to
// furniture/floor points from surfaceSampler.js instead of walls. Uses the
// mold/decay texture (materials/proceduralSkins.js's createDecayTexture)
// rather than the dripping-blood one — a static texture, since there's no
// gravity-driven "runs downward" read on a horizontal tabletop or the
// floor the way there is on a vertical wall.
//
// Deliberately simpler than bleedingWalls.js: no growth animation, no
// audio hook — this is ambient rot, not an event-reactive scare beat. It
// exists so "everything looks haunted" isn't just walls: furniture and
// floor read as decayed too, filling out the room instead of leaving
// tabletops/floor looking untouched next to bleeding walls.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import { createDecayTexture } from '../materials/proceduralSkins'

// --- Tunables — retune by feel, same pattern as bleedingWalls.js. ---
const POOL_SIZE = 5 // more than bleedingWalls' pool — furniture/floor patches read smaller/subtler, so more can be on screen without cluttering
const SPAWN_INTERVAL_MIN = 8
const SPAWN_INTERVAL_MAX = 20
const MAX_INTENSITY_SPEEDUP = 0.5
const LINGER_SECONDS_MIN = 30 // decay sits longer than a bleed — it's a slow, ambient thing, not a beat
const LINGER_SECONDS_MAX = 60
const FADE_SECONDS = 3
const SURFACE_OFFSET = 0.008
const DECAL_SIZE_MIN = 0.18 // patches vary in size — mold doesn't come in one uniform shape
const DECAL_SIZE_MAX = 0.4

const randomBetween = (min, max) => min + Math.random() * (max - min)

const buildDecalSlot = (seed) => {
  const { material } = createDecayTexture({ seed })
  const size = randomBetween(DECAL_SIZE_MIN, DECAL_SIZE_MAX)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
  mesh.visible = false

  let state = 'idle' // idle -> lingering -> fading -> idle
  let elapsed = 0
  let lingerDuration = 0

  const placeAt = (point) => {
    const normal = point.normal || new THREE.Vector3(0, 1, 0)
    mesh.position.copy(point.position).addScaledVector(normal, SURFACE_OFFSET)
    mesh.up.set(0, 1, 0)
    mesh.lookAt(point.position.clone().add(normal))
    // Random roll around the surface normal so every patch doesn't share
    // the exact same up-facing orientation — mold doesn't grow "upright."
    mesh.rotateOnWorldAxis(normal.clone().normalize(), Math.random() * Math.PI * 2)
    mesh.visible = true
    material.opacity = 1
    state = 'lingering'
    elapsed = 0
    lingerDuration = randomBetween(LINGER_SECONDS_MIN, LINGER_SECONDS_MAX)
  }

  const tick = (delta) => {
    if (state === 'idle' || state === 'lingering') {
      if (state === 'lingering') {
        elapsed += delta
        if (elapsed >= lingerDuration) {
          state = 'fading'
          elapsed = 0
        }
      }
      return
    }

    if (state === 'fading') {
      elapsed += delta
      const t = Math.min(elapsed / FADE_SECONDS, 1)
      material.opacity = 1 - t
      if (t >= 1) {
        mesh.visible = false
        state = 'idle'
      }
    }
  }

  const isIdle = () => state === 'idle'

  return { mesh, placeAt, tick, isIdle }
}

// surfaceSampler: the shared createSurfaceSampler() instance from app.js.
// getIntensity: optional () => number in [0, 1], same contract as
// bleedingWalls.js — pass the same function for both so the whole room's
// haunting escalates together as the story progresses.
export const createHauntedFurniture = ({ surfaceSampler, getIntensity }) => {
  const slots = []
  for (let i = 0; i < POOL_SIZE; i++) slots.push(buildDecalSlot(2000 + i))

  let spawnTimer = randomBetween(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX)

  const scheduleNextSpawn = () => {
    const intensity = getIntensity ? Math.max(0, Math.min(1, getIntensity())) : 0
    const speedup = 1 - intensity * MAX_INTENSITY_SPEEDUP
    spawnTimer = randomBetween(SPAWN_INTERVAL_MIN * speedup, SPAWN_INTERVAL_MAX * speedup)
  }

  const attemptSpawn = () => {
    const slot = slots.find((s) => s.isIdle())
    if (!slot) return
    // Furniture first, floor as a fallback — furniture reads as more
    // deliberately "wrong" (rot on a chair/table you'd normally touch);
    // floor decay is the ambient fill-in when no furniture has been
    // scanned yet.
    const point = surfaceSampler.getRandomPoint('furniture') || surfaceSampler.getRandomPoint('floor')
    if (!point) return
    slot.placeAt(point)
  }

  const addTo = (scene) => {
    slots.forEach((s) => scene.add(s.mesh))
  }

  const update = (delta) => {
    spawnTimer -= delta
    if (spawnTimer <= 0) {
      attemptSpawn()
      scheduleNextSpawn()
    }
    slots.forEach((s) => s.tick(delta))
  }

  return { addTo, update }
}
