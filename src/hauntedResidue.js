// ---------------------------------------------------------------------------
// "Texture the environment" — since 8th Wall's World Tracking here only
// gives us hit-test points (no real environment mesh to UV-map or paint
// on), this fakes environmental texture the same way ghosts get placed:
// flat, semi-transparent decal planes pinned to already-scanned surface
// points, oriented by that point's normal. Reads as dark residue/stains
// creeping across the walls and floor as the player scans more of the
// room — ties into the "dark patches and residue" note in the scene
// script's Simulated Flash section.
//
// Deliberately NOT THREE.Sprite — sprites always billboard toward the
// camera, which would make a "stain on the wall" swivel to face you as you
// move, breaking the illusion that it's actually stuck to the surface.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

const RESIDUE_TEXTURE_SIZE = 256
const MAX_DECALS = 24
const MIN_SPACING = 0.5 // meters — avoid stacking near-duplicate points
const DECAL_MIN_SIZE = 0.3
const DECAL_MAX_SIZE = 0.6
const FADE_IN_SECONDS = 1.4

// Procedurally paints a single grungy "residue" texture once at startup —
// a few overlapping dark blotches plus thin claw-like streaks radiating out,
// so it reads as organic staining/damage rather than a stamped circle.
const buildResidueTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = RESIDUE_TEXTURE_SIZE
  canvas.height = RESIDUE_TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  const c = RESIDUE_TEXTURE_SIZE / 2

  ctx.clearRect(0, 0, RESIDUE_TEXTURE_SIZE, RESIDUE_TEXTURE_SIZE)

  const blotchCount = 5 + Math.floor(Math.random() * 4)
  for (let i = 0; i < blotchCount; i++) {
    const bx = c + (Math.random() - 0.5) * c * 1.1
    const by = c + (Math.random() - 0.5) * c * 1.1
    const r = c * (0.18 + Math.random() * 0.32)
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r)
    grad.addColorStop(0, 'rgba(8,12,12,0.85)')
    grad.addColorStop(0.6, 'rgba(8,12,12,0.35)')
    grad.addColorStop(1, 'rgba(8,12,12,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(bx, by, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const streakCount = 3 + Math.floor(Math.random() * 4)
  ctx.strokeStyle = 'rgba(5,9,9,0.5)'
  for (let i = 0; i < streakCount; i++) {
    const angle = Math.random() * Math.PI * 2
    const len = c * (0.5 + Math.random() * 0.4)
    ctx.lineWidth = 1 + Math.random() * 2
    ctx.beginPath()
    ctx.moveTo(c, c)
    ctx.lineTo(c + Math.cos(angle) * len, c + Math.sin(angle) * len)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export const createResidueField = ({ scene }) => {
  const texture = buildResidueTexture()
  const baseMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    // DoubleSide so the decal is visible regardless of which way the
    // surface normal's lookAt ends up orienting its front face — the
    // texture itself is symmetric-enough grunge that mirroring never reads.
    side: THREE.DoubleSide,
  })

  const decals = [] // { mesh, elapsed, targetOpacity }
  const placedPositions = []
  const up = new THREE.Vector3(0, 1, 0)

  const isFarEnough = (position) => placedPositions.every((p) => p.distanceTo(position) > MIN_SPACING)

  // point: a surface sample ({ position, normal }) from surfaceSampler.js —
  // reuses the same scan data ghost spawns read, so residue only ever shows
  // up on surfaces the player has actually scanned.
  const addAt = (point) => {
    if (decals.length >= MAX_DECALS) return
    if (!point || !point.position) return
    if (!isFarEnough(point.position)) return

    const size = DECAL_MIN_SIZE + Math.random() * (DECAL_MAX_SIZE - DECAL_MIN_SIZE)
    const geometry = new THREE.PlaneGeometry(size, size)
    const mesh = new THREE.Mesh(geometry, baseMaterial.clone())
    mesh.material.opacity = 0

    const normal = (point.normal || up).clone().normalize()
    // Nudge off the surface a hair to avoid z-fighting with whatever real
    // geometry the camera passthrough is showing at that point.
    mesh.position.copy(point.position).addScaledVector(normal, 0.004)
    const lookTarget = mesh.position.clone().add(normal)
    mesh.up.set(0, 1, 0)
    mesh.lookAt(lookTarget)
    mesh.rotateZ(Math.random() * Math.PI * 2) // vary orientation so decals don't look stamped

    scene.add(mesh)
    placedPositions.push(point.position.clone())
    decals.push({ mesh, elapsed: 0, targetOpacity: 0.35 + Math.random() * 0.25 })
  }

  const update = (delta) => {
    decals.forEach((d) => {
      if (d.elapsed >= FADE_IN_SECONDS) return
      d.elapsed += delta
      const t = Math.min(d.elapsed / FADE_IN_SECONDS, 1)
      d.mesh.material.opacity = d.targetOpacity * t
    })
  }

  return { addAt, update, count: () => decals.length }
}
