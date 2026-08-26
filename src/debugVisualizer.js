// ---------------------------------------------------------------------------
// Visual debug overlay for the environment-understanding systems — draws
// what surfaceSampler.js, environmentModel.js, and furnitureDetector.js
// actually think they're seeing, directly in the AR scene. A text log line
// saying "wall:29" is not verifiable at a glance; a red dot sitting exactly
// on your actual wall (or floating in the middle of the room, if something's
// wrong) is. This is purely visual — nothing here feeds back into gameplay.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

const POINT_RADIUS = 0.025
const MAX_POINT_MARKERS = 250 // FIFO cap — oldest removed first, keeps this cheap indefinitely
const MAX_DETECTION_MARKERS = 30

const POINT_COLORS = {
  wall: 0xff4444,
  floor: 0x44ff66,
  ceiling: 0x4488ff,
  furniture: 0xffdd44,
  other: 0x888888,
}
const DETECTION_COLOR = { furniture: 0xffaa00, person: 0xff44ff }
const SEGMENT_COLOR = 0xffffff

export const createDebugVisualizer = ({ scene }) => {
  const group = new THREE.Group()
  group.name = 'debug-visualizer'
  scene.add(group)

  const pointGeometry = new THREE.SphereGeometry(POINT_RADIUS, 6, 6)
  const pointMaterials = {}
  Object.keys(POINT_COLORS).forEach((type) => {
    pointMaterials[type] = new THREE.MeshBasicMaterial({ color: POINT_COLORS[type] })
  })

  const detectionGeometry = new THREE.OctahedronGeometry(0.06)
  const detectionMaterials = {
    furniture: new THREE.MeshBasicMaterial({ color: DETECTION_COLOR.furniture, wireframe: true }),
    person: new THREE.MeshBasicMaterial({ color: DETECTION_COLOR.person, wireframe: true }),
  }

  const pointMarkers = [] // FIFO queue of meshes
  const detectionMarkers = []
  let wallSegmentMeshes = []

  const addPoint = (position, type) => {
    const material = pointMaterials[type] || pointMaterials.other
    const mesh = new THREE.Mesh(pointGeometry, material)
    mesh.position.copy(position)
    group.add(mesh)
    pointMarkers.push(mesh)
    if (pointMarkers.length > MAX_POINT_MARKERS) {
      const old = pointMarkers.shift()
      group.remove(old)
    }
  }

  const addDetection = (position, kind, label) => {
    const material = detectionMaterials[kind] || detectionMaterials.furniture
    const mesh = new THREE.Mesh(detectionGeometry, material)
    mesh.position.copy(position)
    mesh.userData.label = label
    group.add(mesh)
    detectionMarkers.push(mesh)
    if (detectionMarkers.length > MAX_DETECTION_MARKERS) {
      const old = detectionMarkers.shift()
      group.remove(old)
    }
  }

  // Wall segments come from environmentModel.js's periodic clustering pass,
  // not per-frame — this fully replaces the previous set of segment boxes
  // each time, since segments can grow/merge/shrink as more data comes in.
  const setWallSegments = (segments) => {
    wallSegmentMeshes.forEach((mesh) => {
      group.remove(mesh)
      mesh.geometry.dispose()
    })
    wallSegmentMeshes = segments.map((segment) => {
      const width = Math.max(0.2, Math.sqrt(segment.cellCount) * 0.25)
      const height = Math.max(0.2, segment.heightRange.max - segment.heightRange.min)
      const geometry = new THREE.BoxGeometry(width, height, width)
      const material = new THREE.MeshBasicMaterial({ color: SEGMENT_COLOR, wireframe: true })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.copy(segment.center)
      group.add(mesh)
      return mesh
    })
  }

  const setVisible = (visible) => {
    group.visible = visible
  }

  return { addPoint, addDetection, setWallSegments, setVisible }
}
