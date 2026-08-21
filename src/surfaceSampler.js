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
  const pools = { wall: [], floor: [], other: [] }
  let hasLoggedSample = false

  const sampleOnce = () => {
    if (!window.XR8 || !window.XR8.XrController) return

    const x = Math.random() * window.innerWidth
    const y = Math.random() * window.innerHeight

    const results = window.XR8.XrController.hitTest(x, y, ['FEATURE_POINT', 'ESTIMATED_SURFACE'])
    if (!results || results.length === 0) return

    const hit = results[0]

    // One-time diagnostic: dump the actual shape of a real hit result so we
    // can confirm whether `rotation` is present/meaningful, instead of
    // guessing at classifySurface's assumptions. Safe to remove once
    // confirmed.
    if (!hasLoggedSample) {
      hasLoggedSample = true
      if (window.debugLog) {
        window.debugLog(`Sample hit result:\n${JSON.stringify(hit, null, 1)}`)
      }
    }
    const position = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z)
    const type = classifySurface(hit)
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
      pool = [...pools.wall, ...pools.floor, ...pools.other]
    } else {
      pool = pools[type]
    }
    if (!pool || pool.length === 0) return null
    return pool[Math.floor(Math.random() * pool.length)]
  }

  const poolSizes = () => ({
    wall: pools.wall.length,
    floor: pools.floor.length,
    other: pools.other.length,
  })

  // Clears all collected points — called when SLAM tracking appears to have
  // reset (e.g. the player walked into a new, unscanned room), since the old
  // points may no longer correspond to real anchored positions.
  const reset = () => {
    pools.wall.length = 0
    pools.floor.length = 0
    pools.other.length = 0
  }

  return { update, getRandomPoint, poolSizes, reset }
}
