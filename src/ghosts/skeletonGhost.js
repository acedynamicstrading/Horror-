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
const LINGER_SECONDS = 0.9
const RETREAT_SECONDS = 0.6
const REVEAL_PEAK_PROGRESS = 0.55
const EMERGE_DEPTH = 0.5

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

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

export const createSkeletonGhostInstance = (template, { onRevealPeak, onDespawn }) => {
  const root = cloneSkinned(template)
  root.visible = false
  // Verified via the converted glTF's bounding box (~1.93 units tall on the
  // Y axis) that this model is already exported in real-world meter scale —
  // no rescaling needed. If it looks off-scale on device, adjust here.
  root.scale.setScalar(1)

  // Grab a few real bones to wiggle procedurally — picked for visible,
  // "wrong" looking motion (spine twist, one arm dragging, head jitter)
  // rather than a full walk cycle, since this is a crawl/lurch, not
  // locomotion.
  const spine = findBone(root, 'CC_Base_Spine02')
  const headBone = findBone(root, 'CC_Base_Head')
  const armL = findBone(root, 'CC_Base_L_Upperarm')
  const armR = findBone(root, 'CC_Base_R_Upperarm')

  let state = 'idle'
  let elapsed = 0
  let revealFired = false
  let normal = new THREE.Vector3(0, 1, 0)
  let surfacePoint = new THREE.Vector3()

  const spawnAt = (point, surfaceNormal) => {
    surfacePoint = point.clone()
    normal = surfaceNormal.clone().normalize()

    const lookTarget = point.clone().add(normal)
    root.position.copy(point)
    root.up.set(0, 1, 0)
    root.lookAt(lookTarget)

    root.visible = true
    state = 'emerging'
    elapsed = 0
    revealFired = false
  }

  const applyTwitch = (intensity) => {
    if (spine) spine.rotation.z = Math.sin(elapsed * 14) * 0.12 * intensity
    if (headBone) headBone.rotation.y = Math.sin(elapsed * 9 + 1) * 0.25 * intensity
    if (armL) armL.rotation.x = -0.4 + Math.sin(elapsed * 11) * 0.3 * intensity
    if (armR) armR.rotation.x = -0.6 + Math.cos(elapsed * 12) * 0.25 * intensity
  }

  const update = (delta) => {
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
        state = 'lingering'
        elapsed = 0
      }
      return
    }

    if (state === 'lingering') {
      applyTwitch(0.6)
      if (elapsed >= LINGER_SECONDS) {
        state = 'retreating'
        elapsed = 0
      }
      return
    }

    if (state === 'retreating') {
      const t = Math.min(elapsed / RETREAT_SECONDS, 1)
      const eased = t * t
      const depth = EMERGE_DEPTH * eased
      root.position.copy(surfacePoint).addScaledVector(normal, -depth)
      applyTwitch(1 - eased)

      if (t >= 1) {
        root.visible = false
        state = 'idle'
        if (onDespawn) onDespawn()
      }
    }
  }

  const isActive = () => state !== 'idle'

  // Instantly clears an active ghost with no retreat animation — used when
  // tracking is disrupted mid-scare, since the surface it was anchored to
  // may no longer be valid.
  const forceDespawn = () => {
    root.visible = false
    state = 'idle'
    elapsed = 0
  }

  return { mesh: root, spawnAt, update, isActive, forceDespawn }
}
