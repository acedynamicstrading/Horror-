import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Custom Three.js pipeline module.
// Sets up the scene/camera/lighting and handles tap-to-place hit-testing.
// This is the piece you'll extend: swap the placeholder cube for real props,
// add the atmosphere post-process pass, wire up monster spawning, etc.
// ---------------------------------------------------------------------------
const initScenePipelineModule = () => {
  let scene, camera, renderer
  const placedProps = []

  const placeholderPropAt = (position) => {
    // Stand-in for a real GLTF model (e.g. a rocking chair). Swap this out
    // once you have real assets — same anchoring logic applies.
    const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3)
    const material = new THREE.MeshStandardMaterial({ color: 0x8a5a3b })
    const cube = new THREE.Mesh(geometry, material)
    cube.position.copy(position)
    scene.add(cube)
    placedProps.push(cube)
  }

  const onHitTestResult = (hitResult) => {
    if (!hitResult) return
    const { position } = hitResult
    placeholderPropAt(new THREE.Vector3(position.x, position.y, position.z))
  }

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return
    const { pageX, pageY } = e.touches[0]

    // hitTest ray-casts from a screen point into the world using the SLAM
    // point cloud / estimated surfaces. Returns closest-first results.
    const results = window.XR8.XrController.hitTest(
      pageX,
      pageY,
      ['FEATURE_POINT', 'ESTIMATED_SURFACE'],
    )

    if (results.length > 0) {
      onHitTestResult(results[0])
    }
  }

  // Manually keep the canvas full-window across orientation changes, since
  // we dropped the XRExtras.FullWindowCanvas helper.
  const resizeCanvas = (canvas) => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    canvas.style.width = '100%'
    canvas.style.height = '100%'
  }

  return {
    name: 'haunted-house-scene',

    onStart: ({ canvas, canvasWidth, canvasHeight }) => {
      const { camera: xrCamera, scene: xrScene, renderer: xrRenderer } =
        window.XR8.Threejs.xrScene()
      scene = xrScene
      camera = xrCamera
      renderer = xrRenderer

      // Basic lighting so the placeholder prop is actually visible.
      scene.add(new THREE.AmbientLight(0xffffff, 0.6))
      const directional = new THREE.DirectionalLight(0xffffff, 0.8)
      directional.position.set(0, 3, 1)
      scene.add(directional)

      renderer.setSize(canvasWidth, canvasHeight)
      camera.aspect = canvasWidth / canvasHeight
      camera.updateProjectionMatrix()

      resizeCanvas(canvas)
      window.addEventListener('resize', () => resizeCanvas(canvas))

      canvas.addEventListener('touchstart', onTouchStart, true)

      // Hide the scan hint once tracking is initialized.
      window.XR8.XrController.recenter()
    },

    onUpdate: () => {
      // Per-frame hook. Nothing needed yet — placeholder for jump-scare
      // spawning, flashlight cone updates, monster AI, etc.
    },
  }
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
const onxrloaded = () => {
  window.XR8.addCameraPipelineModules([
    window.XR8.GlTextureRenderer.pipelineModule(),   // Draws the camera feed.
    window.XR8.Threejs.pipelineModule(),             // Creates a Three.js AR scene.
    window.XR8.XrController.pipelineModule(),        // Enables SLAM world tracking.
    initScenePipelineModule(),                        // Our scene + tap-to-place logic.
  ])

  const canvas = document.getElementById('camerafeed')
  window.XR8.run({ canvas, allowedDevices: window.XR8.XrConfig.device().ANY })
}

window.XR8
  ? onxrloaded()
  : window.addEventListener('xrloaded', onxrloaded)
