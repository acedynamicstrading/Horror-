// ---------------------------------------------------------------------------
// Real skinned skeleton mesh, converted from the "Stylized Skeleton" FBX
// asset pack to glTF (FBX2glTF) so it's usable in three.js on the web.
//
// NOTE on animation: this pack's rig uses "CC_Base_*" bone naming
// (Reallusion/AccuRig convention). The separately-sourced "Universal
// Animation Library" clips use a different rig convention (UE Mannequin
// style: spine_01, clavicle_l, etc.) — the two do NOT share bone names, so
// the library's animation clips can't be retargeted onto this skeleton
// without a manual retarget pass in Blender or AccuRig (bone-mapping tool),
// which needs a desktop GUI and isn't something this pipeline can do
// automatically. Retargeting is a real, worthwhile upgrade path (43 clips
// including things like Death01, Hit_Head, Crouch_Fwd_Loop) — just a
// separate one-time manual step, not blocking on this code.
//
// Until then, this uses hand-authored procedural bone rotation (using this
// skeleton's own real CC_Base_* joint names) for a twitchy "crawling" feel,
// same spirit as the original primitive version's whole-object tween, just
// applied per-limb now that we have a real rig to move.
//
// STATE MACHINE (rewritten — see the story bible's "Capture, Don't Kill"
// section and scene-script.md's Entity AI States):
//
//   idle -> emerging -> [ scareLinger -> fleeingIn -> idle ]        (first-ever reveal)
//                     -> [ capturableLinger -> captured -> idle ]   (re-find, player wins)
//                     -> [ capturableLinger -> lunging -> lungeRetreat -> idle ]  (re-find, timer runs out)
//
// The earlier version had ONE fixed-timer emerge/linger/retreat cycle for
// every spawn, regardless of whether it was a first sighting or a re-find —
// so a re-found, "should be capturable" entity vanished on its own ~0.9s
// clock no matter what the reticle/focus-meter loop was doing, and a
// capture was rarely even possible. Now only a first-ever reveal auto-times
// out; a re-find (`opts.isRefind`) stays revealed with no internal timer at
// all until captureDespawn() (player won) or breakout() (capture timer in
// captureSystem.js ran out) is called on it from outside.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import modelUrl from '../assets/models/skeletonGhost.glb'
import albedoUrl from '../assets/textures/skeleton_albedo.png'
import normalUrl from '../assets/textures/skeleton_normal.png'
import roughnessUrl from '../assets/textures/skeleton_roughness.png'
import emissiveUrl from '../assets/textures/skeleton_emissive.png'

const EMERGE_SECONDS = 1.1
const REVEAL_PEAK_PROGRESS = 0.55
const EMERGE_DEPTH = 0.5

// First-ever reveal: brief scare-only linger (never capturable — see the
// story bible), then it flees to hide at a *different* surface point.
const SCARE_LINGER_SECONDS = 1.3
const FLEE_RETREAT_SECONDS = 0.6

// Re-find, while capturable: it creeps forward off its anchor toward the
// player over time (capped) instead of standing dead still, and twitches
// harder the longer it's been staring the player down. No fixed duration —
// see the state machine note above.
const LEAN_MAX = 0.16 // meters it creeps forward off its anchor
const LEAN_SPEED = 0.5 // exponential approach rate toward LEAN_MAX, per second
const TWITCH_BASE = 0.6
const TWITCH_RAMP = 0.15 // per second, capped below
const TWITCH_CAP = 1.4

// Breakout — capture timer ran out. A short, violent charge at the camera
// (the "jump on your face" beat), then it bursts back and re-hides.
const LUNGE_SECONDS = 0.32
const LUNGE_STOP_DISTANCE = 0.4 // meters from the camera it charges to
const LUNGE_RETREAT_SECONDS = 0.3
const LUNGE_SCALE_PEAK = 1.3

// A landed capture: quick "pulled into the lens" snap for impact, instead
// of an instant pop.
const CAPTURED_PULL_SECONDS = 0.22

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
const easeInCubic = (t) => t * t * t

// Loads the model + builds the material ONCE. Call this a single time at
// startup, then pass the resolved template into createSkeletonGhostInstance
// for each pool member — cloning (via SkeletonUtils, not Object3D.clone,
// which does not correctly duplicate skinned-mesh bone bindings) is cheap;
// re-parsing the glTF file per instance would not be.
export const loadSkeletonGhostTemplate = () =>
  new Promise((resolve, reject) => {
    const textureLoader = new THREE.TextureLoader()
    const albedo = textureLoader.load(albedoUrl)
    albedo.colorSpace = THREE.SRGBColorSpace
    const normalMap = textureLoader.load(normalUrl)
    const roughnessMap = textureLoader.load(roughnessUrl)
    const emissiveMap = textureLoader.load(emissiveUrl)
    emissiveMap.colorSpace = THREE.SRGBColorSpace

    const material = new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap,
      roughnessMap,
      emissiveMap,
      emissive: new THREE.Color(0x223333),
      emissiveIntensity: 0.6,
      metalness: 0.1,
      roughness: 0.8,
    })

    new GLTFLoader().load(
      modelUrl,
      (gltf) => {
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.material = material
            child.frustumCulled = false // avoid pop-out while mid-emergence
          }
        })
        resolve(gltf.scene)
      },
      undefined,
      (err) => reject(err),
    )
  })

// Finds a bone by name within a cloned skeleton instance.
const findBone = (root, name) => {
  let found = null
  root.traverse((child) => {
    if (!found && child.isBone && child.name === name) found = child
  })
  return found
}

export const createSkeletonGhostInstance = (template, { onRevealPeak, onNeedFleeTarget, onDespawn }) => {
  const root = cloneSkinned(template)
  root.visible = false
  // Verified via the converted glTF's bounding box (~1.93 units tall on the
  // Y axis) that this model is already exported in real-world meter scale —
  // no rescaling needed. If it looks off-scale on device, adjust here.
  root.scale.setScalar(1)

  // Grab real bones to pose/wiggle procedurally. Picked for a convincing
  // crawl silhouette (bent legs, hunched spine, dragging arms), not just
  // arm/head twitch — a few degrees of oscillation around the rig's default
  // STANDING rest pose reads as "stiff figure standing there jittering,"
  // not "crawling." The fix is a real bent BASE pose (large fixed offsets
  // below), with the twitch oscillation layered on top of that, not in
  // place of it.
  const spine01 = findBone(root, 'CC_Base_Spine01')
  const spine02 = findBone(root, 'CC_Base_Spine02')
  const headBone = findBone(root, 'CC_Base_Head')
  const armL = findBone(root, 'CC_Base_L_Upperarm')
  const armR = findBone(root, 'CC_Base_R_Upperarm')
  const thighL = findBone(root, 'CC_Base_L_Thigh')
  const thighR = findBone(root, 'CC_Base_R_Thigh')
  const calfL = findBone(root, 'CC_Base_L_Calf')
  const calfR = findBone(root, 'CC_Base_R_Calf')

  let state = 'idle'
  let elapsed = 0
  let revealFired = false
  let normal = new THREE.Vector3(0, 1, 0)
  let surfacePoint = new THREE.Vector3()
  let isRefind = false

  // Scratch vectors, reused every frame instead of allocated — update() runs
  // on every active ghost every frame.
  const faceTarget = new THREE.Vector3()
  const lungeStart = new THREE.Vector3()
  const lungeTarget = new THREE.Vector3()
  const toCamera = new THREE.Vector3()

  const spawnAt = (point, surfaceNormal, opts = {}) => {
    surfacePoint = point.clone()
    normal = surfaceNormal.clone().normalize()
    isRefind = !!opts.isRefind

    // Orient outward along the surface normal while still buried in it —
    // camera-facing only kicks in once it's actually revealed (see
    // faceCamera below), so the "crawling out of the wall" beat still
    // reads as coming from the surface itself.
    const lookTarget = point.clone().add(normal)
    root.position.copy(point)
    root.scale.setScalar(1)
    root.up.set(0, 1, 0)
    root.lookAt(lookTarget)

    root.visible = true
    state = 'emerging'
    elapsed = 0
    revealFired = false
  }

  // Turns the root to face the camera, locked to the vertical axis only
  // (camera Y swapped for the ghost's own Y first) — a camera held low or
  // high should turn the body toward the player, not tip the whole model
  // onto its side.
  const faceCamera = (cameraPosition) => {
    faceTarget.set(cameraPosition.x, root.position.y, cameraPosition.z)
    if (faceTarget.distanceToSquared(root.position) < 0.0001) return // camera basically on top of it
    root.up.set(0, 1, 0)
    root.lookAt(faceTarget)
  }

  // BASE crawl pose — fixed offsets from the rig's standing rest pose,
  // applied every frame regardless of twitch intensity, so the silhouette
  // reads as "hunched, bent-limbed, crawling" even at the very first frame
  // of emergence, not just once oscillation has had time to move anything.
  // Twitch (below) adds jitter ON TOP of this, it doesn't replace it.
  const applyCrawlPose = (intensity) => {
    // Spine hunched forward and low.
    if (spine01) spine01.rotation.x = 0.55 * intensity
    if (spine02) spine02.rotation.x = 0.45 * intensity
    if (headBone) headBone.rotation.x = 0.3 * intensity

    // Arms bent forward/down, like dragging the body along the surface.
    if (armL) armL.rotation.x = -1.1 * intensity
    if (armR) armR.rotation.x = -1.1 * intensity
    if (armL) armL.rotation.z = 0.25 * intensity
    if (armR) armR.rotation.z = -0.25 * intensity

    // Legs bent at hip and knee — a standing T/A-pose leg reads as "just
    // standing there"; a bent one reads as "climbing/crawling out."
    if (thighL) thighL.rotation.x = 0.9 * intensity
    if (thighR) thighR.rotation.x = 0.7 * intensity
    if (calfL) calfL.rotation.x = -1.3 * intensity
    if (calfR) calfR.rotation.x = -1.0 * intensity
  }

  const applyTwitch = (intensity) => {
    applyCrawlPose(Math.min(1, intensity + 0.3)) // base pose stays mostly bent even at low twitch intensity
    if (spine02) spine02.rotation.z += Math.sin(elapsed * 14) * 0.14 * intensity
    if (headBone) headBone.rotation.y = Math.sin(elapsed * 9 + 1) * 0.3 * intensity
    if (armL) armL.rotation.x += Math.sin(elapsed * 11) * 0.25 * intensity
    if (armR) armR.rotation.x += Math.cos(elapsed * 12) * 0.22 * intensity
    if (thighL) thighL.rotation.z = Math.sin(elapsed * 7) * 0.15 * intensity
    if (thighR) thighR.rotation.z = Math.cos(elapsed * 7.5) * 0.15 * intensity
  }

  const update = (delta, cameraPosition) => {
    if (state === 'idle') return
    elapsed += delta

    if (state === 'emerging') {
      const t = Math.min(elapsed / EMERGE_SECONDS, 1)
      const eased = easeOutCubic(t)
      const depth = EMERGE_DEPTH * (1 - eased)
      root.position.copy(surfacePoint).addScaledVector(normal, -depth)
      applyTwitch(1 - eased * 0.4)

      if (!revealFired && t >= REVEAL_PEAK_PROGRESS) {
        revealFired = true
        if (onRevealPeak) onRevealPeak()
      }
      if (t >= 1) {
        state = isRefind ? 'capturableLinger' : 'scareLinger'
        elapsed = 0
      }
      return
    }

    // First-ever reveal only: scare beat, then flee. Never capturable here —
    // "first sighting teaches you it exists; you have to go hunt it down."
    if (state === 'scareLinger') {
      if (cameraPosition) faceCamera(cameraPosition)
      applyTwitch(0.7)
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
      root.position.copy(surfacePoint).addScaledVector(normal, -depth)
      applyTwitch(1 - eased)
      if (t >= 1) {
        root.visible = false
        state = 'idle'
        const fledTo = onNeedFleeTarget ? onNeedFleeTarget(surfacePoint) : null
        if (onDespawn) onDespawn({ fledTo })
      }
      return
    }

    // Re-find only: stays revealed and capturable, NO internal timer. Only
    // an external captureDespawn() or breakout() call ends this state.
    if (state === 'capturableLinger') {
      if (cameraPosition) faceCamera(cameraPosition)
      // Creep forward off its anchor toward the player, capped — reads as
      // actively closing in rather than just standing there.
      const leanT = 1 - Math.exp(-LEAN_SPEED * elapsed)
      root.position.copy(surfacePoint).addScaledVector(normal, LEAN_MAX * leanT)
      // Twitch intensifies the longer it's been staring the player down.
      applyTwitch(Math.min(TWITCH_CAP, TWITCH_BASE + elapsed * TWITCH_RAMP))
      return
    }

    if (state === 'lunging') {
      const t = Math.min(elapsed / LUNGE_SECONDS, 1)
      const eased = easeOutCubic(t)
      root.position.lerpVectors(lungeStart, lungeTarget, eased)
      root.scale.setScalar(1 + eased * (LUNGE_SCALE_PEAK - 1))
      if (cameraPosition) faceCamera(cameraPosition)
      applyTwitch(1.6)
      if (t >= 1) {
        state = 'lungeRetreat'
        elapsed = 0
      }
      return
    }

    if (state === 'lungeRetreat') {
      const t = Math.min(elapsed / LUNGE_RETREAT_SECONDS, 1)
      root.position.lerpVectors(lungeTarget, surfacePoint, t)
      root.scale.setScalar(LUNGE_SCALE_PEAK - t * (LUNGE_SCALE_PEAK - 1))
      if (t >= 1) {
        root.visible = false
        root.scale.setScalar(1)
        state = 'idle'
        // "flees to hide somewhere new and harder to reach" — reuse the
        // same flee-target request as a first-reveal flee.
        const fledTo = onNeedFleeTarget ? onNeedFleeTarget(surfacePoint) : null
        if (onDespawn) onDespawn({ fledTo })
      }
      return
    }

    if (state === 'captured') {
      const t = Math.min(elapsed / CAPTURED_PULL_SECONDS, 1)
      root.position.lerpVectors(lungeStart, lungeTarget, easeInCubic(t))
      root.scale.setScalar(1 - t)
      if (t >= 1) {
        root.visible = false
        root.scale.setScalar(1)
        state = 'idle'
      }
      return
    }
  }

  const isActive = () => state !== 'idle'

  // True only while it's actually the "hunt it down" target — gates
  // captureSystem so a first-reveal scare or a mid-lunge charge can't be
  // framed-and-photographed like a real capturable sighting.
  const isCapturable = () => state === 'capturableLinger'

  // Instantly clears an active ghost with no animation — used when tracking
  // is disrupted mid-scare, since the surface it was anchored to may no
  // longer be valid, so animating toward/away from it isn't safe.
  const forceDespawn = () => {
    root.visible = false
    root.scale.setScalar(1)
    state = 'idle'
    elapsed = 0
  }

  // Capture timer ran out (captureSystem.js) — charge the camera, then burst
  // back and re-hide elsewhere.
  const breakout = (cameraPosition) => {
    if (state !== 'capturableLinger') return
    lungeStart.copy(root.position)
    if (cameraPosition) {
      toCamera.copy(cameraPosition).sub(root.position)
      const dist = toCamera.length()
      if (dist > LUNGE_STOP_DISTANCE) {
        toCamera.normalize()
        lungeTarget.copy(cameraPosition).addScaledVector(toCamera, -LUNGE_STOP_DISTANCE)
      } else {
        lungeTarget.copy(root.position)
      }
    } else {
      lungeTarget.copy(root.position)
    }
    state = 'lunging'
    elapsed = 0
  }

  // Player closed the focus meter — pull it into the lens and gone. No flee
  // target needed; this one's actually caught, not dodging.
  const captureDespawn = (cameraPosition) => {
    if (state !== 'capturableLinger' && state !== 'lunging') {
      forceDespawn()
      return
    }
    lungeStart.copy(root.position)
    lungeTarget.copy(cameraPosition || root.position)
    state = 'captured'
    elapsed = 0
  }

  return { mesh: root, spawnAt, update, isActive, isCapturable, forceDespawn, breakout, captureDespawn }
}
