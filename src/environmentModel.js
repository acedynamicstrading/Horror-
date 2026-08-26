// ---------------------------------------------------------------------------
// Standalone room-recognition diagnostic. Deliberately independent of
// surfaceSampler.js — not wired into spawning/gameplay (see app.js comment
// at the call site). Purpose: answer "can real wall SEGMENTS (not just
// scattered classified points) be recovered from what the engine gives us,"
// as a sanity check that's actually visible on-device via debugVisualizer's
// wireframe boxes, before anything downstream (spawn placement, furniture
// anchoring, etc.) is trusted to depend on it.
//
// Deliberately narrower input than surfaceSampler.js: only ESTIMATED_SURFACE
// hits with real rotation data are used here, not the FEATURE_POINT +
// height-band fallback surfaceSampler.js needs to fill its wall pool at all.
// That fallback is a heuristic (see surfaceSampler.js's own header comment);
// this module exists to check what the engine's ACTUAL surface estimation
// looks like on its own, unmixed with that guesswork. If this module's wall
// segments end up sparse/empty, that in itself is a useful diagnostic: it
// means surfaceSampler's wall pool is basically all height-band guesses,
// not genuine detected surfaces, on this device/room.
//
// CLUSTERING: points are bucketed into a flat horizontal grid (CELL_SIZE
// meters, XZ only — height is tracked per-cell but not part of the bucket
// key, since a real wall spans a height range, not a single Y). Every
// RECLUSTER_INTERVAL seconds, occupied cells are merged into connected
// segments via 4-directional flood fill. This is a periodic batch pass, not
// per-frame, since re-flood-filling every tick for a debug overlay is wasted
// work — segments only need to look "current," not be instantaneous.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

const CELL_SIZE = 0.4 // meters
const RECLUSTER_INTERVAL = 2 // seconds between flood-fill passes
const MAX_CELLS = 2000 // hard cap so a long session can't grow this unbounded
const MIN_SEGMENT_CELLS = 2 // single isolated cells are noise, not a segment

const up = new THREE.Vector3(0, 1, 0)
const tmpNormal = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()

// Same normal-dot-up wall test surfaceSampler.js uses for ESTIMATED_SURFACE
// hits — kept identical on purpose, since the whole point of this module is
// isolating "what does the engine's real surface data alone give us,"  not
// trying a different classification rule too.
const isWallNormal = (rotation) => {
  tmpQuat.set(rotation.x, rotation.y, rotation.z, rotation.w)
  tmpNormal.set(0, 1, 0).applyQuaternion(tmpQuat)
  return tmpNormal.dot(up) < 0.3
}

const cellKey = (cx, cz) => `${cx},${cz}`

export const createEnvironmentModel = () => {
  // cellKey -> { cx, cz, count, sumX, sumY, sumZ, minY, maxY }
  const cells = new Map()
  let lastReclusterAt = 0 // ms, via Date.now() — see update() below for why
  let segments = [] // last computed connected-component result
  let totalPointsSeen = 0

  const sampleOnce = () => {
    if (!window.XR8 || !window.XR8.XrController) return

    // Same normalized-[0,1]-screen-coordinate requirement as
    // surfaceSampler.js's hitTest call (see that file's header comment for
    // why raw pixel coordinates silently return zero results here).
    const x = Math.random()
    const y = Math.random()
    const results = window.XR8.XrController.hitTest(x, y, ['ESTIMATED_SURFACE'])
    if (!results || results.length === 0) return

    const hit = results[0]
    if (!hit.rotation) return
    if (!isWallNormal(hit.rotation)) return

    totalPointsSeen += 1

    const cx = Math.floor(hit.position.x / CELL_SIZE)
    const cz = Math.floor(hit.position.z / CELL_SIZE)
    const key = cellKey(cx, cz)

    let cell = cells.get(key)
    if (!cell) {
      if (cells.size >= MAX_CELLS) return // capped — stop accumulating new cells
      cell = { cx, cz, count: 0, sumX: 0, sumY: 0, sumZ: 0, minY: hit.position.y, maxY: hit.position.y }
      cells.set(key, cell)
    }
    cell.count += 1
    cell.sumX += hit.position.x
    cell.sumY += hit.position.y
    cell.sumZ += hit.position.z
    cell.minY = Math.min(cell.minY, hit.position.y)
    cell.maxY = Math.max(cell.maxY, hit.position.y)
  }

  // 4-directional flood fill over occupied grid cells -> connected segments.
  const recluster = () => {
    const visited = new Set()
    const result = []

    for (const startKey of cells.keys()) {
      if (visited.has(startKey)) continue
      visited.add(startKey)

      const stack = [cells.get(startKey)]
      const group = []

      while (stack.length > 0) {
        const cell = stack.pop()
        group.push(cell)

        const neighbors = [
          cellKey(cell.cx + 1, cell.cz),
          cellKey(cell.cx - 1, cell.cz),
          cellKey(cell.cx, cell.cz + 1),
          cellKey(cell.cx, cell.cz - 1),
        ]
        for (const nKey of neighbors) {
          if (visited.has(nKey)) continue
          const neighborCell = cells.get(nKey)
          if (!neighborCell) continue
          visited.add(nKey)
          stack.push(neighborCell)
        }
      }

      if (group.length < MIN_SEGMENT_CELLS) continue // isolated cell(s) — treat as noise

      let sumX = 0
      let sumY = 0
      let sumZ = 0
      let pointCount = 0
      let minY = Infinity
      let maxY = -Infinity
      for (const cell of group) {
        sumX += cell.sumX
        sumY += cell.sumY
        sumZ += cell.sumZ
        pointCount += cell.count
        minY = Math.min(minY, cell.minY)
        maxY = Math.max(maxY, cell.maxY)
      }

      result.push({
        cellCount: group.length,
        heightRange: { min: minY, max: maxY },
        center: new THREE.Vector3(sumX / pointCount, sumY / pointCount, sumZ / pointCount),
      })
    }

    // Largest first — mainly so debugSummary()'s "largest" figure and any
    // future consumer that only wants the top N don't need to re-sort.
    result.sort((a, b) => b.cellCount - a.cellCount)
    segments = result
  }

  // update() is called with no arguments from app.js's onUpdate (unlike
  // surfaceSampler.js/gameState.js, which get a real `delta`) — so timing
  // here is wall-clock via Date.now() rather than an accumulated delta.
  const update = () => {
    sampleOnce()

    const now = Date.now()
    if (now - lastReclusterAt >= RECLUSTER_INTERVAL * 1000) {
      lastReclusterAt = now
      recluster()
    }
  }

  const getWallSegments = () => segments

  const debugSummary = () => {
    const largest = segments[0]
    const largestNote = largest ? `${largest.cellCount} cells` : 'none'
    return (
      `EnvironmentModel: ${totalPointsSeen} wall-surface hits · ${cells.size} occupied cells · ` +
      `${segments.length} segments (largest: ${largestNote})`
    )
  }

  return { update, getWallSegments, debugSummary }
}
