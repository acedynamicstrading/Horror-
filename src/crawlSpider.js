// ---------------------------------------------------------------------------
// A "crawling spider" — second entity type alongside skeletonGhost.js.
// Primitive-built (no rigged model for this one — the skeleton's the only
// real asset in the project so far), but deliberately mirrors
// skeletonGhost.js's exact API and state machine so captureSystem.js,
// gameState.js, and scareSystem.js can treat it identically to a skeleton
// ghost without any of them knowing entity types exist. Both entity types
// live in the SAME `ghostPool` array in app.js.
//
// STATE MACHINE (matches skeletonGhost.js exactly):
//
//   idle -> emerging -> [ scareLinger -> fleeingIn -> idle ]        (first-ever reveal)
//                     -> [ capturableLinger -> captured -> idle ]   (re-find, player wins)
//                     -> [ capturableLinger -> lunging -> lungeRetreat -> idle ]  (re-find, timeout)
//
// Only a first-ever reveal auto-times out (scareLinger -> fleeingIn). A
// re-find (opts.isRefind) stays revealed with NO internal timer at all —
// only an external captureDespawn() or breakout() call ends capturableLinger.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import { createSpiderSkin } from '../materials/proceduralSkins'

const EMERGE_SECONDS = 0.6 // quicker than the ghost's 1.1s — scuttle, not lurch
const REVEAL_PEAK_PROGRESS = 0.5
const EMERGE_DEPTH = 0.3 // spiders sit shallower in the surface than the ghost

// First-ever reveal: brief scare-only linger, then flees to hide elsewhere.
const SCARE_LINGER_SECONDS = 1.0 // shorter than the ghost's 1.3s — skitters off fast
const FLEE_RETREAT_SECONDS = 0.4

// Re-find, while capturable: same "creeps toward the player, twitches
// harder over time" idea as the ghost, but expressed as a lateral skitter
// (small, frequent repositions across the surface tangent plane) rather
// than a straight-line lean — reads as restless/evasive, matching a
// spider's actual movement instead of a copy of the ghost's behavior.
const SKITTER_INTERVAL_MIN = 0.5
const SKITTER_INTERVAL_MAX = 1.4
const SKITTER_MAX_OFFSET = 0.12 // meters, from the anchor point

// Wall/floor re-finds (not ceiling): actually scuttles toward the player in
// bursts — dart, pause, dart again — rather than only skittering in place
// near its anchor. Ceiling spiders stay anchor-skittering only; closing
// the whole vertical gap by "crawling down the ceiling toward you" reads
// wrong for this creature, so that case keeps the original in-place skitter.
const CRAWL_STOP_DISTANCE = 0.9 // meters from camera it stops closing in at
const CRAWL_BURST_SPEED = 1.1 // meters per second, during a dart
const CRAWL_BURST_DURATION_MIN = 0.18
const CRAWL_BURST_DURATION_MAX = 0.4
const CRAWL_PAUSE_MIN = 0.25
const CRAWL_PAUSE_MAX = 0.7
const CRAWL_LEG_HZ = 32 // leg-jitter rate while actively darting (base rate is 22)

// Breakout — capture timer ran out. Short charge at the camera, then bursts
// back and re-hides, same beat as the ghost's lunge.
const LUNGE_SECONDS = 0.28 // faster than the ghost's 0.32s
const LUNGE_STOP_DISTANCE = 0.35
const LUNGE_RETREAT_SECONDS = 0.28
const LUNGE_SCALE_PEAK = 1.2

const CAPTURED_PULL_SECONDS = 0.2

const LEG_COUNT = 8

const buildSpiderMesh = (seed) => {
  const group = new THREE.Group()
  const material = createSpiderSkin({ seed })

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), material)
  body.scale.set(1, 0.7, 1.3)
  body.position.y = 0.06

  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), material)
  abdomen.scale.set(1, 0.85, 1.1)
  abdomen.position.set(0, 0.05, -0.1)

  group.add(body, abdomen)

  // Legs: LEG_COUNT total, 4 per side, splayed outward and slightly down —
  // built from thin cylinder pairs (upper/lower segment) for a visible
  // "knee" bend instead of a single rigid rod.
  const legs = []
  for (let i = 0; i < LEG_COUNT; i++) {
    const side = i < LEG_COUNT / 2 ? -1 : 1
    const indexOnSide = i % (LEG_COUNT / 2)
    const spread = (indexOnSide / (LEG_COUNT / 2 - 1) - 0.5) * 0.55

    const legGroup = new THREE.Group()
    legGroup.position.set(side * 0.06, 0.08, -0.05 + indexOnSide * 0.05)

    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.14, 6), material)
    upper.position.set(side * 0.07, 0, 0)
    upper.rotation.z = side * (Math.PI / 3.2)
    upper.rotation.y = spread

    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.12, 6), material)
    lower.position.set(side * 0.14, -0.09, 0)
    lower.rotation.z = side * (Math.PI / 1.7)
    lower.rotation.y = spread

    legGroup.add(upper, lower)
    group.add(legGroup)
    legs.push(legGroup)
  }

  return { group, legs }
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
const easeInCubic = (t) => t * t * t

// seed: passed straight through to createSpiderSkin so each pooled instance
// gets a visibly distinct chitin pattern — pass e.g. the pool index.
export const createCrawlSpider = ({ onRevealPeak, onNeedFleeTarget, onDespawn, onFootstep, seed = 1 }) => {
  const { group: mesh, legs } = buildSpiderMesh(seed)
  mesh.visible = false

  let state = 'idle'
  let elapsed = 0
  let revealFired = false
  let normal = new THREE.Vector3(0, 1, 0)
  let surfacePoint = new THREE.Vector3()
  let isRefind = false
  let pointType = 'wall'
  let crawlPaused = true
  let crawlTimer = 0
  const crawlDir = new THREE.Vector3()

  // Scratch vectors, reused every frame instead of allocated.
  const faceTarget = new THREE.Vector3()
  const lungeStart = new THREE.Vector3()
  const lungeTarget = new THREE.Vector3()
  const toCamera = new THREE.Vector3()

  // Held-skitter tangent-plane basis, derived from whatever surface normal
  // this spawn used.
  const tangentA = new THREE.Vector3()
  const tangentB = new THREE.Vector3()
  const anchorPoint = new THREE.Vector3()
  let skitterTimer = 0
  let skitterTarget = new THREE.Vector2(0, 0)
  let skitterCurrent = new THREE.Vector2(0, 0)

  const spawnAt = (point, surfaceNormal, opts = {}) => {
    surfacePoint = point.clone()
    normal = surfaceNormal.clone().normalize()
    isRefind = !!opts.isRefind
    pointType = opts.pointType || 'ceiling'

    const lookTarget = point.clone().add(normal)
    mesh.position.copy(point)
    mesh.scale.setScalar(0.05)
    mesh.up.set(0, 1, 0)
    mesh.lookAt(lookTarget)

    // Tangent basis for the capturable-state skitter offsets.
    const seedVec = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    tangentA.crossVectors(normal, seedVec).normalize()
    tangentB.crossVectors(normal, tangentA).normalize()

    mesh.visible = true
    state = 'emerging'
    elapsed = 0
    revealFired = false
    skitterTimer = 0
    skitterCurrent.set(0, 0)
    skitterTarget.set(0, 0)
    crawlPaused = true
    crawlTimer = CRAWL_PAUSE_MIN + Math.random() * (CRAWL_PAUSE_MAX - CRAWL_PAUSE_MIN)
  }

  // Same camera-facing behavior as skeletonGhost.js's faceCamera — locked
  // to the vertical axis only, so a camera held low/high turns the body
  // toward the player without tipping the whole model onto its side.
  const faceCamera = (cameraPosition) => {
    faceTarget.set(cameraPosition.x, mesh.position.y, cameraPosition.z)
    if (faceTarget.distanceToSquared(mesh.position) < 0.0001) return
    mesh.up.set(0, 1, 0)
    mesh.lookAt(faceTarget)
  }

  const applyLegJitter = (intensity, rate = 1) => {
    legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(elapsed * 22 * rate + i * 1.3) * 0.3 * intensity
    })
  }

  const update = (delta, cameraPosition) => {
    if (state === 'idle') return
    elapsed += delta

    if (state === 'emerging') {
      const t = Math.min(elapsed / EMERGE_SECONDS, 1)
      const eased = easeOutCubic(t)
      mesh.scale.setScalar(0.05 + 0.95 * eased)
      const depth = EMERGE_DEPTH * (1 - eased)
      mesh.position.copy(surfacePoint).addScaledVector(normal, -depth)
      applyLegJitter(1)

      if (!revealFired && t >= REVEAL_PEAK_PROGRESS) {
        revealFired = true
        if (onRevealPeak) onRevealPeak()
      }
      if (t >= 1) {
        state = isRefind ? 'capturableLinger' : 'scareLinger'
        elapsed = 0
        if (state === 'capturableLinger') anchorPoint.copy(mesh.position)
      }
      return
    }

    // First-ever reveal only: scare beat, then flee. Never capturable here.
    if (state === 'scareLinger') {
      if (cameraPosition) faceCamera(cameraPosition)
      applyLegJitter(0.7)
      if (elapsed >= SCARE_LINGER_SECONDS) {
        state = 'fleeingIn'
        elapsed = 0
      }
      return
    }

    if (state === 'fleeingIn') {
      const t = Math.min(elapsed / FLEE_RETREAT_SECONDS, 1)
      const eased = t * t
      const depth = EMERGE_DEPTH * eased
      mesh.position.copy(surfacePoint).addScaledVector(normal, -depth)
      applyLegJitter(1 - eased)
      if (t >= 1) {
        mesh.visible = false
        state = 'idle'
        const fledTo = onNeedFleeTarget ? onNeedFleeTarget(surfacePoint) : null
        if (onDespawn) onDespawn({ fledTo })
      }
      return
    }

    // Re-find only: stays revealed and capturable, NO internal timer.
    if (state === 'capturableLinger') {
      if (cameraPosition) faceCamera(cameraPosition)

      if (pointType !== 'ceiling' && cameraPosition) {
        // Dart-pause-dart toward the player instead of the anchor-bound
        // skitter — matches how a real spider actually closes distance:
        // quick bursts, not a smooth glide.
        toCamera.copy(cameraPosition).sub(mesh.position)
        toCamera.y = 0
        const dist = toCamera.length()

        crawlTimer -= delta
        if (dist <= CRAWL_STOP_DISTANCE) {
          crawlPaused = true // arrived — hold here and stare, same as skeleton's stop behavior
          applyLegJitter(0.9)
        } else if (crawlPaused) {
          applyLegJitter(0.5) // small idle leg motion while paused between darts
          if (crawlTimer <= 0) {
            crawlPaused = false
            crawlTimer = CRAWL_BURST_DURATION_MIN + Math.random() * (CRAWL_BURST_DURATION_MAX - CRAWL_BURST_DURATION_MIN)
            crawlDir.copy(toCamera).normalize()
            if (onFootstep) onFootstep(mesh.position) // one cue per dart, not per leg
          }
        } else {
          const step = Math.min(CRAWL_BURST_SPEED * delta, dist - CRAWL_STOP_DISTANCE)
          mesh.position.addScaledVector(crawlDir, Math.max(0, step))
          anchorPoint.copy(mesh.position)
          applyLegJitter(1.4, CRAWL_LEG_HZ / 22) // quicker leg cycle while actively darting
          if (crawlTimer <= 0) {
            crawlPaused = true
            crawlTimer = CRAWL_PAUSE_MIN + Math.random() * (CRAWL_PAUSE_MAX - CRAWL_PAUSE_MIN)
          }
        }
        return
      }

      applyLegJitter(0.8)

      // Small, frequent lateral repositions across the surface plane —
      // bounded so it never wanders out of frame on its own. Ceiling
      // spiders only — see the dart/pause branch above for wall/floor.
      skitterTimer -= delta
      if (skitterTimer <= 0) {
        skitterTimer = SKITTER_INTERVAL_MIN + Math.random() * (SKITTER_INTERVAL_MAX - SKITTER_INTERVAL_MIN)
        const angle = Math.random() * Math.PI * 2
        const radius = Math.random() * SKITTER_MAX_OFFSET
        skitterTarget.set(Math.cos(angle) * radius, Math.sin(angle) * radius)
      }
      skitterCurrent.lerp(skitterTarget, Math.min(delta * 6, 1))
      mesh.position
        .copy(anchorPoint)
        .addScaledVector(tangentA, skitterCurrent.x)
        .addScaledVector(tangentB, skitterCurrent.y)
      return
    }

    if (state === 'lunging') {
      const t = Math.min(elapsed / LUNGE_SECONDS, 1)
      const eased = easeOutCubic(t)
      mesh.position.lerpVectors(lungeStart, lungeTarget, eased)
      mesh.scale.setScalar(1 + eased * (LUNGE_SCALE_PEAK - 1))
      if (cameraPosition) faceCamera(cameraPosition)
      applyLegJitter(1.6)
      if (t >= 1) {
        state = 'lungeRetreat'
        elapsed = 0
      }
      return
    }

    if (state === 'lungeRetreat') {
      const t = Math.min(elapsed / LUNGE_RETREAT_SECONDS, 1)
      mesh.position.lerpVectors(lungeTarget, surfacePoint, t)
      mesh.scale.setScalar(LUNGE_SCALE_PEAK - t * (LUNGE_SCALE_PEAK - 1))
      if (t >= 1) {
        mesh.visible = false
        mesh.scale.setScalar(1)
        state = 'idle'
        const fledTo = onNeedFleeTarget ? onNeedFleeTarget(surfacePoint) : null
        if (onDespawn) onDespawn({ fledTo })
      }
      return
    }

    if (state === 'captured') {
      const t = Math.min(elapsed / CAPTURED_PULL_SECONDS, 1)
      mesh.position.lerpVectors(lungeStart, lungeTarget, easeInCubic(t))
      mesh.scale.setScalar(1 - t)
      if (t >= 1) {
        mesh.visible = false
        mesh.scale.setScalar(1)
        state = 'idle'
      }
      return
    }
  }

  const isActive = () => state !== 'idle'
  const isCapturable = () => state === 'capturableLinger'

  const forceDespawn = () => {
    mesh.visible = false
    mesh.scale.setScalar(1)
    state = 'idle'
    elapsed = 0
  }

  const breakout = (cameraPosition) => {
    if (state !== 'capturableLinger') return
    lungeStart.copy(mesh.position)
    if (cameraPosition) {
      toCamera.copy(cameraPosition).sub(mesh.position)
      const dist = toCamera.length()
      if (dist > LUNGE_STOP_DISTANCE) {
        toCamera.normalize()
        lungeTarget.copy(cameraPosition).addScaledVector(toCamera, -LUNGE_STOP_DISTANCE)
      } else {
        lungeTarget.copy(mesh.position)
      }
    } else {
      lungeTarget.copy(mesh.position)
    }
    state = 'lunging'
    elapsed = 0
  }

  const captureDespawn = (cameraPosition) => {
    if (state !== 'capturableLinger' && state !== 'lunging') {
      forceDespawn()
      return
    }
    lungeStart.copy(mesh.position)
    lungeTarget.copy(cameraPosition || mesh.position)
    state = 'captured'
    elapsed = 0
  }

  return { mesh, spawnAt, update, isActive, isCapturable, forceDespawn, breakout, captureDespawn }
}
