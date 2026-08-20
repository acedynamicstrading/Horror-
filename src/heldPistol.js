// ---------------------------------------------------------------------------
// A placeholder "held pistol" — built from primitives for now (no glTF asset
// yet), parented directly to the camera rather than placed in world space.
// That's what makes it read as "held in hand": it moves and rotates with
// the phone instead of staying anchored to a real-world point like the
// ghosts do. Swap the primitive group for a real model (GLTFLoader) later;
// everything else (positioning, sway, recoil) keeps working the same way.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

// Local offset from the camera, in camera space (x = right, y = up,
// z = forward/back, negative = in front of the camera). Tuned to sit in
// the lower-right of the screen, like a typical FPS weapon viewmodel.
const REST_POSITION = new THREE.Vector3(0.08, -0.19, -0.32)
const REST_ROTATION = new THREE.Euler(-0.15, -0.15, 0.02)

const buildPistolMesh = () => {
  const group = new THREE.Group()

  const metal = new THREE.MeshStandardMaterial({
    color: 0x2b2b2e,
    roughness: 0.35,
    metalness: 0.6,
  })
  const grip = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.8,
    metalness: 0.1,
  })

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.028, 0.16), metal)
  slide.position.set(0, 0.02, 0)

  const barrelTip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12), metal)
  barrelTip.rotation.x = Math.PI / 2
  barrelTip.position.set(0, 0.02, -0.1)

  const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.045), grip)
  gripMesh.position.set(0, -0.045, 0.045)
  gripMesh.rotation.x = -0.35

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, 0.008), metal)
  trigger.position.set(0, -0.01, 0.02)

  const triggerGuard = new THREE.Mesh(
    new THREE.TorusGeometry(0.018, 0.004, 8, 16, Math.PI),
    metal,
  )
  triggerGuard.rotation.z = Math.PI
  triggerGuard.position.set(0, -0.02, 0.02)

  group.add(slide, barrelTip, gripMesh, trigger, triggerGuard)
  group.scale.setScalar(1.6) // primitives above are real-world-ish meters; bump up for visibility
  return group
}

export const createHeldPistol = ({ camera }) => {
  const mesh = buildPistolMesh()
  mesh.position.copy(REST_POSITION)
  mesh.rotation.copy(REST_ROTATION)

  // Parenting to the camera (not the scene) is what locks it to the view.
  camera.add(mesh)

  const clock = new THREE.Clock()
  let recoilAmount = 0 // 0 = rest, 1 = fully kicked back

  // Subtle idle sway so it doesn't feel like a static screen overlay.
  const update = () => {
    const t = clock.getElapsedTime()
    mesh.position.x = REST_POSITION.x + Math.sin(t * 1.3) * 0.004
    mesh.position.y = REST_POSITION.y + Math.sin(t * 1.7) * 0.003

    if (recoilAmount > 0) {
      recoilAmount = Math.max(0, recoilAmount - 0.08)
      mesh.position.z = REST_POSITION.z + recoilAmount * 0.04
      mesh.rotation.x = REST_ROTATION.x - recoilAmount * 0.18
    } else {
      mesh.position.z = REST_POSITION.z
      mesh.rotation.x = REST_ROTATION.x
    }
  }

  // Call on tap/fire input for a quick kickback animation. Purely visual —
  // wire into scareScheduler or a tap handler if you want it to "do"
  // something (trigger a flash, count ammo, etc).
  const fire = () => {
    recoilAmount = 1
  }

  const setVisible = (visible) => {
    mesh.visible = visible
  }

  return { mesh, update, fire, setVisible }
}
