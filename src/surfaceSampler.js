// ---------------------------------------------------------------------------
// Continuously samples the tracked room for usable surface points, so ghost
// spawn points get chosen automatically as the player scans around — no tap
// required. Replaces the old tap-to-place hit-test flow.
//
// Strategy: each tick, fire a hitTest at a randomized point on the visible
// screen (not a fixed grid — a fixed grid would keep re-hitting the same
// spots the player happens to be facing). Valid hits get classified as
// 'wall' or 'floor' by their surface orientation and pushed into separate
// pools, deduplicated so we don't fill the pool with near-identical points
// from the same patch of wall.
//
// NOTE: classification assumes hitTest results expose a `rotation` quaternion
// (the surface's orientation) alongside `position`, which is the common
// shape for AR hit-test results. If 8th Wall's actual result shape differs,
// log a sample result (console.log(results[0])) on device and adjust
// `classifySurface` below — everything else in this module is unaffected.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

const MAX_POOL_SIZE = 40
const MIN_POINT_SPACING = 0.35 // meters — dedup threshold
const SAMPLES_PER_TICK = 1 // keep cheap; called every onUpdate
// Heuristic-only "furniture" detection: 8th Wall's hit-test gives geometry,
// not object recognition, so there's no real way to know "that's a table."
// Proxy: a horizontal surface (floor-like normal) that sits meaningfully
// ABOVE the lowest floor points sampled so far is probably a tabletop,
// shelf, or seat cushion, not the actual floor. Good enough for "hide
// somewhere off the ground" without needing real semantic understanding —
// tune FURNITURE_MIN_HEIGHT down if it's under-triggering in a real room.
const FURNITURE_MIN_HEIGHT = 0.18 // meters above the lowest known floor point

const up = new THREE.Vector3(0, 1, 0)
const tmpNormal = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()

// Classifies a hit result as 'wall', 'floor', or 'other' based on how its
// surface normal compares to world-up. Falls back to 'other' (still usable,
// just unclassified) if no orientation data is present on the result.
const classifySurface = (hitResult) => {
  if (!hitResult.rotation) return 'other'
  tmpQuat.set(hitResult.rotation.x, hitResult.rotation.y, hitResult.rotation.z, hitResult.rotation.w)
  tmpNormal.set(0, 1, 0).applyQuaternion(tmpQuat)
  const upDot = tmpNormal.dot(up) // ~1 = floor/ceiling, ~0 = wall

  if (upDot > 0.7) return 'floor'
  if (upDot < 0.3) return 'wall'
  return 'other'
}

const isFarEnoughFromPool = (pool, position) =>
  pool.every((p) => p.position.distanceTo(position) > MIN_POINT_SPACING)

export const createSurfaceSampler = () => {
  const pools = { wall: [], floor: [], furniture: [], other: [] }
  let lowestFloorY = null // updated as floor points come in

  const sampleOnce = () => {
    if (!window.XR8 || !window.XR8.XrController) return

    const x = Math.random() * window.innerWidth
    const y = Math.random() * window.innerHeight

    const results = window.XR8.XrController.hitTest(x, y, ['FEATURE_POINT', 'ESTIMATED_SURFACE'])
    if (!results || results.length === 0) return

    const hit = results[0]
    const position = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z)
    let type = classifySurface(hit)

    // Reclassify: a "floor-orientation" point sitting well above the
    // lowest floor point we've seen is more likely a tabletop/shelf/seat
    // than actual floor — bucket it as furniture instead.
    if (type === 'floor') {
      if (lowestFloorY === null || position.y < lowestFloorY) {
        lowestFloorY = position.y
      } else if (position.y - lowestFloorY > FURNITURE_MIN_HEIGHT) {
        type = 'furniture'
      }
    }

    const pool = pools[type]

    if (pool.length >= MAX_POOL_SIZE) return
    if (!isFarEnoughFromPool(pool, position)) return

    // Surface normal for orienting spawned props (e.g. "crawl out along the
    // wall's outward direction"). Defaults to world-up if unavailable.
    let normal = new THREE.Vector3(0, 1, 0)
    if (hit.rotation) {
      tmpQuat.set(hit.rotation.x, hit.rotation.y, hit.rotation.z, hit.rotation.w)
      normal = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQuat).clone()
    }

    pool.push({ position, normal, type })
  }

  const update = () => {
    for (let i = 0; i < SAMPLES_PER_TICK; i++) sampleOnce()
  }

  const getRandomPoint = (type = 'any') => {
    let pool
    if (type === 'any') {
      pool = [...pools.wall, ...pools.floor, ...pools.furniture, ...pools.other]
    } else {
      pool = pools[type]
    }
    if (!pool || pool.length === 0) return null
    return pool[Math.floor(Math.random() * pool.length)]
  }

  // Like getRandomPoint, but excludes any point within excludeRadius of
  // excludePosition — used to pick a flee target that's meaningfully
  // different from where an entity just was, not right next to it.
  const getRandomPointExcluding = (excludePosition, { type = 'any', excludeRadius = 1.0 } = {}) => {
    let pool
    if (type === 'any') {
      pool = [...pools.wall, ...pools.floor, ...pools.furniture, ...pools.other]
    } else {
      pool = pools[type]
    }
    if (!pool || pool.length === 0) return null
    const candidates = pool.filter((p) => p.position.distanceTo(excludePosition) > excludeRadius)
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  const poolSizes = () => ({
    wall: pools.wall.length,
    floor: pools.floor.length,
    furniture: pools.furniture.length,
    other: pools.other.length,
  })

  return { update, getRandomPoint, getRandomPointExcluding, poolSizes }
}
