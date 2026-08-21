// ---------------------------------------------------------------------------
// weapons.js — procedural, animated AR weapons for LENS.
//
// No external model files needed — everything here is built from Three.js
// primitives + lights + particles, so there's zero licensing risk and it
// drops straight into the existing 8th Wall / Three.js pipeline.
//
// Each factory function returns:
//   { object3D, update(dt), dispose() }
// `object3D` is what you scene.add(). `update(dt)` runs every frame from
// your onRender/onUpdate loop (dt = seconds since last frame). `dispose()`
// cleans up geometry/materials when the weapon is banished or unloaded.
//
// Usage sketch (inside initScenePipelineModule in app.js):
//
//   import { createCandle, createFlashlight, createHolyWaterThrow,
//            createSaltLine, createWardSigil } from './weapons'
//
//   const candle = createCandle()
//   scene.add(candle.object3D)
//   candle.object3D.position.copy(hitResultPosition)
//   ...
//   // in onRender:
//   candle.update(deltaSeconds)
//
// ---------------------------------------------------------------------------

import * as THREE from 'three'

const clock = new THREE.Clock(false)

// ---------------------------------------------------------------------------
// 1. CANDLE — flickering point light + simple animated flame billboard.
// ---------------------------------------------------------------------------
export const createCandle = ({ color = 0xffb347, baseIntensity = 1.2 } = {}) => {
  const group = new THREE.Group()

  // Wax body
  const bodyGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.12, 12)
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.6 })
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.position.y = 0.06
  group.add(body)

  // Flame — additive-blended sprite-like plane, always faces camera via
  // billboarding handled in update()
  const flameGeo = new THREE.PlaneGeometry(0.03, 0.05)
  const flameMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const flame = new THREE.Mesh(flameGeo, flameMat)
  flame.position.y = 0.135
  group.add(flame)

  // Flickering light — this is what actually lights up dark-patch geometry
  // nearby, per the "candle slows entity approach" mechanic.
  const light = new THREE.PointLight(color, baseIntensity, 1.5, 2)
  light.position.y = 0.14
  group.add(light)

  let t = 0
  const update = (dt) => {
    t += dt
    // layered sine noise = believable flicker without a texture/shader
    const flicker =
      Math.sin(t * 13) * 0.15 +
      Math.sin(t * 27 + 1.3) * 0.08 +
      Math.sin(t * 71 + 4.1) * 0.05
    light.intensity = Math.max(0.15, baseIntensity + flicker)
    flame.scale.setScalar(1 + flicker * 0.4)
    flame.rotation.z = Math.sin(t * 9) * 0.15
  }

  const dispose = () => {
    bodyGeo.dispose(); bodyMat.dispose()
    flameGeo.dispose(); flameMat.dispose()
  }

  return { object3D: group, update, dispose, light }
}

// ---------------------------------------------------------------------------
// 2. FLASHLIGHT — spotlight cone rigged to the camera, with power-flicker
//    and a "suppress" pulse you can trigger when it's actively burning an
//    entity (call .pulse() from your damage-tick logic).
// ---------------------------------------------------------------------------
export const createFlashlight = ({ camera, color = 0xfff4d6, intensity = 3, distance = 6, angle = Math.PI / 9 } = {}) => {
  const spot = new THREE.SpotLight(color, intensity, distance, angle, 0.4, 1.2)
  spot.position.set(0, 0, 0)
  const target = new THREE.Object3D()
  target.position.set(0, 0, -1)

  // Rig to camera so the cone always points where the phone points.
  camera.add(spot)
  camera.add(target)
  spot.target = target

  let flickerTimer = 0
  let pulseTimer = 0
  const baseIntensity = intensity

  const update = (dt) => {
    flickerTimer -= dt
    if (flickerTimer <= 0) {
      // Rare, brief power-dip flicker — reads as "old batteries," useful
      // as a scare beat (kill the light for one frame right before a scare).
      flickerTimer = 2 + Math.random() * 4
      spot.intensity = baseIntensity * 0.3
      setTimeout(() => { spot.intensity = baseIntensity }, 60)
    }
    if (pulseTimer > 0) {
      pulseTimer -= dt
      spot.intensity = baseIntensity * (1.5 + Math.sin(pulseTimer * 40) * 0.5)
    }
  }

  // Call when actively "burning" an entity — brightens + adds a fast pulse
  // for feedback that damage is landing.
  const pulse = (durationSeconds = 0.5) => { pulseTimer = durationSeconds }

  // Full on/off toggle for battery-death or scripted horror beats.
  const setOn = (on) => { spot.intensity = on ? baseIntensity : 0 }

  const dispose = () => {
    camera.remove(spot)
    camera.remove(target)
  }

  return { object3D: spot, update, pulse, setOn, dispose }
}

// ---------------------------------------------------------------------------
// 3. HOLY WATER — thrown projectile (arcs via simple gravity) that bursts
//    into a droplet particle splash on impact. Call createHolyWaterThrow()
//    fresh each time the player throws; it self-completes and calls
//    onComplete(hitPosition) when the splash finishes.
// ---------------------------------------------------------------------------
export const createHolyWaterThrow = ({ from, to, scene, onImpact, onComplete }) => {
  const group = new THREE.Group()
  scene.add(group)

  const dropGeo = new THREE.SphereGeometry(0.015, 8, 8)
  const dropMat = new THREE.MeshStandardMaterial({
    color: 0xbfe8ff, transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.1,
  })
  const drop = new THREE.Mesh(dropGeo, dropMat)
  group.add(drop)
  drop.position.copy(from)

  const start = from.clone()
  const end = to.clone()
  const flightTime = 0.45 // seconds
  const arcHeight = 0.4
  let t = 0
  let phase = 'flight' // 'flight' -> 'splash' -> done

  // Splash particles, built lazily on impact
  let splashPoints = null
  let splashVelocities = []
  let splashT = 0
  const SPLASH_DURATION = 0.5
  const SPLASH_COUNT = 18

  const spawnSplash = (position) => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(SPLASH_COUNT * 3)
    splashVelocities = []
    for (let i = 0; i < SPLASH_COUNT; i++) {
      positions[i * 3 + 0] = position.x
      positions[i * 3 + 1] = position.y
      positions[i * 3 + 2] = position.z
      const theta = Math.random() * Math.PI * 2
      const speed = 0.4 + Math.random() * 0.6
      splashVelocities.push(new THREE.Vector3(
        Math.cos(theta) * speed,
        Math.random() * 0.8,
        Math.sin(theta) * speed,
      ))
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xcdefff, size: 0.02, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    splashPoints = new THREE.Points(geo, mat)
    group.add(splashPoints)
  }

  const update = (dt) => {
    if (phase === 'flight') {
      t += dt / flightTime
      const clamped = Math.min(t, 1)
      drop.position.lerpVectors(start, end, clamped)
      // parabolic arc
      drop.position.y += Math.sin(clamped * Math.PI) * arcHeight
      if (t >= 1) {
        phase = 'splash'
        if (onImpact) onImpact(end.clone())
        spawnSplash(end)
        drop.visible = false
      }
    } else if (phase === 'splash' && splashPoints) {
      splashT += dt
      const positions = splashPoints.geometry.attributes.position.array
      for (let i = 0; i < SPLASH_COUNT; i++) {
        const v = splashVelocities[i]
        v.y -= 1.2 * dt // gravity
        positions[i * 3 + 0] += v.x * dt
        positions[i * 3 + 1] += v.y * dt
        positions[i * 3 + 2] += v.z * dt
      }
      splashPoints.geometry.attributes.position.needsUpdate = true
      splashPoints.material.opacity = Math.max(0, 1 - splashT / SPLASH_DURATION)
      if (splashT >= SPLASH_DURATION) {
        phase = 'done'
        dispose()
        if (onComplete) onComplete(end.clone())
      }
    }
  }

  const dispose = () => {
    scene.remove(group)
    dropGeo.dispose(); dropMat.dispose()
    if (splashPoints) {
      splashPoints.geometry.dispose()
      splashPoints.material.dispose()
    }
  }

  return { object3D: group, update, dispose }
}

// ---------------------------------------------------------------------------
// 4. SALT LINE — drag-drawn barrier. Feed it an array of THREE.Vector3
//    points (from your touchmove hit-test sampling) and it builds a glowing
//    tube with a slow shimmer. Call .breach(position) to trigger a
//    "barrier broken" flare if an entity crosses it.
// ---------------------------------------------------------------------------
export const createSaltLine = (points, { color = 0xfff8e0 } = {}) => {
  if (points.length < 2) {
    throw new Error('createSaltLine needs at least 2 points')
  }
  const curve = new THREE.CatmullRomCurve3(points)
  const tubeGeo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 4), 0.008, 6, false)
  const tubeMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const tube = new THREE.Mesh(tubeGeo, tubeMat)

  let t = 0
  let flareT = 0
  const update = (dt) => {
    t += dt
    tube.material.opacity = 0.65 + Math.sin(t * 2) * 0.15
    if (flareT > 0) {
      flareT -= dt
      tube.material.opacity = Math.min(1, tube.material.opacity + flareT * 2)
    }
  }

  // Call when an entity attempts to cross — brief bright flare feedback.
  const breach = () => { flareT = 0.3 }

  const dispose = () => {
    tubeGeo.dispose(); tubeMat.dispose()
  }

  return { object3D: tube, update, breach, dispose }
}

// ---------------------------------------------------------------------------
// 5. WARD SIGIL — placed via hit-test (same pattern as your existing
//    placeholderPropAt). Slowly rotating glyph disc with pulsing glow and
//    a thin rising-particle column, used to "pin" tougher entities in Act 3.
// ---------------------------------------------------------------------------
export const createWardSigil = ({ color = 0x9a5cff, radius = 0.12 } = {}) => {
  const group = new THREE.Group()

  // Glyph ring — a simple ring geometry stands in for a drawn sigil texture;
  // swap in a custom alpha-mapped texture later if you want an actual glyph.
  const ringGeo = new THREE.RingGeometry(radius * 0.7, radius, 32)
  const ringMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.rotation.x = -Math.PI / 2
  group.add(ring)

  const innerGeo = new THREE.CircleGeometry(radius * 0.55, 32)
  const innerMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const inner = new THREE.Mesh(innerGeo, innerMat)
  inner.rotation.x = -Math.PI / 2
  inner.position.y = 0.001
  group.add(inner)

  // Rising particle column — reads as "active/pinning."
  const PARTICLE_COUNT = 24
  const partGeo = new THREE.BufferGeometry()
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const speeds = []
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2
    const r = Math.random() * radius * 0.6
    positions[i * 3 + 0] = Math.cos(angle) * r
    positions[i * 3 + 1] = Math.random() * 0.3
    positions[i * 3 + 2] = Math.sin(angle) * r
    speeds.push(0.15 + Math.random() * 0.2)
  }
  partGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const partMat = new THREE.PointsMaterial({
    color, size: 0.015, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const particles = new THREE.Points(partGeo, partMat)
  group.add(particles)

  let active = true
  let t = 0
  const update = (dt) => {
    t += dt
    ring.rotation.z += dt * 0.6
    const pulse = 0.7 + Math.sin(t * 3) * 0.15
    ringMat.opacity = active ? pulse : 0.25
    innerMat.opacity = active ? pulse * 0.3 : 0.08

    const pos = particles.geometry.attributes.position.array
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i * 3 + 1] += speeds[i] * dt
      if (pos[i * 3 + 1] > 0.35) pos[i * 3 + 1] = 0
    }
    particles.geometry.attributes.position.needsUpdate = true
  }

  // Toggle when the sigil successfully "pins" its target vs sitting idle.
  const setActive = (isActive) => { active = isActive }

  const dispose = () => {
    ringGeo.dispose(); ringMat.dispose()
    innerGeo.dispose(); innerMat.dispose()
    partGeo.dispose(); partMat.dispose()
  }

  return { object3D: group, update, setActive, dispose }
}
