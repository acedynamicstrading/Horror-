// ---------------------------------------------------------------------------
// Continuously samples the tracked room for usable surface points, so ghost
// spawn points get chosen automatically as the player scans around — no tap
// required. Replaces the old tap-to-place hit-test flow.
//
// Strategy: each tick, fire a hitTest at a randomized point on the visible
// screen (not a fixed grid — a fixed grid would keep re-hitting the same
// spots the player happens to be facing). Valid hits get classified into
// 'wall' / 'floor' / 'furniture' / 'other' pools, deduplicated so we don't
// fill a pool with near-identical points from the same patch of surface.
//
// CLASSIFICATION — confirmed via on-device debug dump: this engine's
// FEATURE_POINT hits return a degenerate zero quaternion for `rotation`
// (not real orientation data). Applying a zero quaternion leaves a vector
// unchanged under three.js's formula in a way that made every FEATURE_POINT
// hit read as floor-like when classified by normal-dot-up alone — 'wall'
// never filled while 'floor' maxed out fast. ESTIMATED_SURFACE hits DO carry
// usable orientation, so:
//   - ESTIMATED_SURFACE hits: classify by rotation (normal-dot-up), as before.
//   - FEATURE_POINT hits (or any hit with unusable rotation): classify by
//     height above a running floor-height estimate instead. Same proxy the
//     design already specs for furniture ("meaningfully above the lowest
//     floor point = furniture, not floor"), extended upward to also cover
//     walls: clearly-above-furniture-height points become wall-eligible.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

const MAX_POOL_SIZE = 40
const MIN_POINT_SPACING = 0.35 // meters — dedup threshold
const SAMPLES_PER_TICK = 1 // keep cheap; called every onUpdate

// Height bands (meters) relative to the running floor-height estimate, used
// for the FEATURE_POINT fallback classification described above.
//
// FURNITURE_MAX_HEIGHT was 1.3 — too high in practice. 8th Wall's World
// Tracking only ever estimates a single FLOOR plane (confirmed in their own
// docs: "floor based only"), so ESTIMATED_SURFACE hits are NEVER walls —
// wall detection depends entirely on this height fallback. A phone held at
// normal chest/eye height (~1.2-1.6m) sweeping across a wall lands most hits
// well under 1.3m, which meant most real wall points were silently landing
// in the furniture pool (which nothing even consumes yet) instead of the
// wall pool gameState.js requires to leave SCANNING. Lowered to 0.85 — most
// real furniture (chairs, tables, low shelves) tops out under that, while a
// wall spans floor-to-ceiling, so biasing the ambiguous middle band toward
// 'wall' is the safer default given furniture isn't gameplay-critical yet
// and walls are required just to start the game.
const FLOOR_BAND = 0.15 // within this of the floor estimate = floor
const FURNITURE_MAX_HEIGHT = 0.85 // above FLOOR_BAND, up to this height = furniture
// anything higher than FURNITURE_MAX_HEIGHT above the floor estimate = wall

const up = new THREE.Vector3(0, 1, 0)
const tmpNormal = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()

// Classifies a hit result as 'wall', 'floor', 'furniture', or 'other'.
// `lowestY` is the caller's running floor-height estimate (null until the
// first hit has been seen at all — see sampleOnce).
const classifySurface = (hitResult, lowestY) => {
  if (hitResult.type === 'ESTIMATED_SURFACE' && hitResult.rotation) {
    tmpQuat.set(hitResult.rotation.x, hitResult.rotation.y, hitResult.rotation.z, hitResult.rotation.w)
    tmpNormal.set(0, 1, 0).applyQuaternion(tmpQuat)
    const upDot = tmpNormal.dot(up) // ~1 = floor/ceiling, ~0 = wall
    if (upDot > 0.7) return 'floor'
    if (upDot < 0.3) return 'wall'
    return 'other'
  }

  // Height-based fallback — no floor estimate yet means we can't classify
  // by height, so park it as 'other' rather than guessing wrong.
  if (lowestY === null) return 'other'
  const height = hitResult.position.y - lowestY
  if (height <= FLOOR_BAND) return 'floor'
  if (height <= FURNITURE_MAX_HEIGHT) return 'furniture'
  return 'wall'
}

const isFarEnoughFromPool = (pool, position) =>
  pool.every((p) => p.position.distanceTo(position) > MIN_POINT_SPACING)

export const createSurfaceSampler = () => {
  const pools = { wall: [], floor: [], furniture: [], other: [] }
  let hasLoggedSample = false
  // Running floor-height estimate — updated from EVERY hit we see (not just
  // ones already classified as floor), so the height-based fallback can
  // bootstrap itself instead of waiting on a genuinely-classified floor
  // point first. Self-corrects downward as better (lower) points arrive.
  let lowestY = null

  // One-time tally logged once enough hits have come in, so the real
  // FEATURE_POINT height distribution (and how it split across the new 0.85m
  // boundary) is visible on-device instead of just trusting the guess above.
  // Not the same as poolSizes() — this counts every classification attempt,
  // including near-duplicates the dedup spacing check throws away, so it
  // reflects the raw height distribution, not just what made it into a pool.
  let classificationTally = { wall: 0, floor: 0, furniture: 0, other: 0 }
  let totalClassified = 0
  let hasLoggedTally = false
  const TALLY_LOG_AT = 60

  const sampleOnce = () => {
    if (!window.XR8 || !window.XR8.XrController) return

    // hitTest expects NORMALIZED [0,1] screen coordinates, not pixels — see
    // 8th Wall's own docs/example (x = clientX / innerWidth). Passing raw
    // pixel values here meant almost every hitTest() call asked for a point
    // far outside the valid range and silently returned zero results, which
    // is why wall/floor pools filled at all only by rare chance.
    const x = Math.random()
    const y = Math.random()

    const results = window.XR8.XrController.hitTest(x, y, ['FEATURE_POINT', 'ESTIMATED_SURFACE'])
    if (!results || results.length === 0) return

    const hit = results[0]

    if (!hasLoggedSample) {
      hasLoggedSample = true
      if (window.debugLog) {
        window.debugLog(`Sample hit result:\n${JSON.stringify(hit, null, 1)}`)
      }
    }

    if (lowestY === null || hit.position.y < lowestY) {
      lowestY = hit.position.y
    }

    const type = classifySurface(hit, lowestY)

    totalClassified += 1
    if (classificationTally[type] != null) classificationTally[type] += 1
    if (!hasLoggedTally && totalClassified >= TALLY_LOG_AT && window.debugLog) {
      hasLoggedTally = true
      const heightAbove = (hit.position.y - lowestY).toFixed(2)
      window.debugLog(
        `Surface classification tally after ${totalClassified} hits: ${JSON.stringify(classificationTally)}\n` +
        `(floor est. y=${lowestY.toFixed(2)}, most recent hit height above floor=${heightAbove}m, furniture/wall boundary=${FURNITURE_MAX_HEIGHT}m)`
      )
    }

    const pool = pools[type]
    if (!pool) return // 'other' pool exists but is intentionally never used for spawns

    const position = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z)

    if (pool.length >= MAX_POOL_SIZE) return
    if (!isFarEnoughFromPool(pool, position)) return

    // Surface normal for orienting spawned props (e.g. "crawl out along the
    // wall's outward direction"). ESTIMATED_SURFACE hits carry real
    // orientation, so use it. FEATURE_POINT wall/furniture points have no
    // usable rotation at all (see module header) — fall back to a
    // horizontal direction pointing outward from the world origin (SLAM
    // recenter() puts the origin near where the player started), so crawl
    // animations still have SOME outward direction instead of defaulting to
    // straight up, which reads as "floating" rather than "emerging."
    let normal = new THREE.Vector3(0, 1, 0)
    if (hit.rotation && hit.type === 'ESTIMATED_SURFACE') {
      tmpQuat.set(hit.rotation.x, hit.rotation.y, hit.rotation.z, hit.rotation.w)
      normal = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQuat).clone()
    } else if (type === 'wall' || type === 'furniture') {
      normal = new THREE.Vector3(position.x, 0, position.z)
      if (normal.lengthSq() < 0.0001) normal.set(0, 0, 1)
      normal.normalize()
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

  // Same as getRandomPoint, but filters out anything within `minDistance` of
  // `excludePosition` first — used by the ghost flee behavior so a "new"
  // spot is actually a different spot, not a near-duplicate of the one the
  // entity just fled from.
  const getRandomPointExcluding = (type = 'any', excludePosition, minDistance = 0.8) => {
    let pool
    if (type === 'any') {
      pool = [...pools.wall, ...pools.floor, ...pools.furniture, ...pools.other]
    } else {
      pool = pools[type] || []
    }
    if (!excludePosition) return getRandomPoint(type)
    const candidates = pool.filter((p) => p.position.distanceTo(excludePosition) > minDistance)
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  const poolSizes = () => ({
    wall: pools.wall.length,
    floor: pools.floor.length,
    furniture: pools.furniture.length,
    other: pools.other.length,
  })

  // Clears all collected points — called when SLAM tracking appears to have
  // reset (e.g. the player walked into a new, unscanned room), since the old
  // points may no longer correspond to real anchored positions.
  const reset = () => {
    pools.wall.length = 0
    pools.floor.length = 0
    pools.furniture.length = 0
    pools.other.length = 0
    lowestY = null
    classificationTally = { wall: 0, floor: 0, furniture: 0, other: 0 }
    totalClassified = 0
    hasLoggedTally = false
  }

  return { update, getRandomPoint, getRandomPointExcluding, poolSizes, reset }
}
