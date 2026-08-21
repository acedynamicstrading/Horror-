import * as THREE from 'three'
import { createHauntedVision } from './hauntedShader'
import { createSurfaceSampler } from './surfaceSampler'
import { createScareScheduler } from './scareSystem'
import { createCrawlGhost } from './ghosts/crawlOutOfWall'
import { createCaptureSystem } from './captureSystem'

// 8th Wall's Threejs pipeline module expects a global window.THREE
// (it assumes script-tag usage), but webpack keeps our import module-scoped.
// Expose it globally so XR8.Threejs.pipelineModule() can find it.
window.THREE = THREE


// ---------------------------------------------------------------------------
// On-screen debug logger. Prints errors directly on the page so they're
// visible on a phone without needing devtools.
// ---------------------------------------------------------------------------
const debugLog = (msg) => {
  const el = document.getElementById('debug')
  if (!el) return
  el.style.display = 'block'
  el.textContent += msg + '\n\n'
}

window.onerror = (message, source, lineno, colno, error) => {
  debugLog(`ERROR: ${message}\nat ${source}:${lineno}:${colno}\n${error && error.stack ? error.stack : ''}`)
}
window.addEventListener('unhandledrejection', (event) => {
  debugLog(`UNHANDLED PROMISE REJECTION: ${event.reason}`)
})

// If window.XR8 never shows up, tell us — means xr.js loaded but never
// initialized (e.g. SLAM chunk failed to load).
setTimeout(() => {
  if (!window.XR8) {
    debugLog('window.XR8 is still undefined 6s after page load. The engine script likely failed to initialize.')
  }
}, 6000)

// ---------------------------------------------------------------------------
// Custom Three.js pipeline module.
// ---------------------------------------------------------------------------
const initScenePipelineModule = () => {
  let scene, camera, renderer, hauntedVision
  let surfaceSampler, scareScheduler, captureSystem
  let clock

  // Small pool of reusable ghost instances rather than creating a new mesh
  // per scare — cheaper, and simple to reason about with only a few ghosts
  // ever active on screen at once.
  const GHOST_POOL_SIZE = 3
  const ghostPool = []

  const getIdleGhost = () => ghostPool.find((g) => !g.isActive())

  const spawnGhostAt = (point) => {
    const ghost = getIdleGhost()
    if (!ghost) return // all ghosts already active — skip this scare attempt
    const normal = point.normal || new THREE.Vector3(0, 1, 0)
    ghost.spawnAt(point.position, normal)
  }

  // Spawns a SPECIFIC ghost instance (not a random idle pick) at a point —
  // used for re-finding an entity that fled somewhere after its first
  // reveal, where identity matters (it has to be the same ghost, so its
  // capturable flag carries over correctly).
  const spawnSpecificGhostAt = (ghost, point) => {
    if (ghost.isActive()) return
    const normal = point.normal || new THREE.Vector3(0, 1, 0)
    ghost.spawnAt(point.position, normal)
  }

  const resizeCanvas = (canvas) => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    canvas.style.width = '100%'
    canvas.style.height = '100%'
  }

  return {
    name: 'haunted-house-scene',

    onStart: ({ canvas, canvasWidth, canvasHeight }) => {
      debugLog('onStart fired — scene initializing.')
      const { camera: xrCamera, scene: xrScene, renderer: xrRenderer } =
        window.XR8.Threejs.xrScene()
      scene = xrScene
      camera = xrCamera
      renderer = xrRenderer

      scene.add(new THREE.AmbientLight(0xffffff, 0.6))
      const directional = new THREE.DirectionalLight(0xffffff, 0.8)
      directional.position.set(0, 3, 1)
      scene.add(directional)

      // Resize the canvas to its real on-screen backing-store size FIRST.
      // canvasWidth/canvasHeight (8th Wall's own numbers) can differ from
      // window.innerWidth/innerHeight (device pixel ratio, browser chrome
      // collapsing, etc). Sizing the renderer/composer off the pre-resize
      // numbers and THEN resizing the canvas afterward is what caused the
      // black unrendered rectangle in the corner — the composer's render
      // targets ended up a different size than the actual canvas.
      resizeCanvas(canvas)

      renderer.setSize(canvas.width, canvas.height)
      camera.aspect = canvas.width / canvas.height
      camera.updateProjectionMatrix()

      hauntedVision = createHauntedVision({
        renderer,
        scene,
        camera,
        width: canvas.width,
        height: canvas.height,
      })
      // Expose the flash trigger globally so game logic anywhere (proximity
      // checks, timers, item-use handlers, monster abilities) can call
      // window.hauntedVision.flash() for a scripted jump-scare beat.
      window.hauntedVision = hauntedVision

      captureSystem = createCaptureSystem({
        camera,
        onCaptureResult: ({ success }) => {
          if (success) {
            // Camera flash-bang on a successful capture — longer/brighter
            // than a scare flash. Shutter-click SFX belongs here too once
            // spatialAudio.js is wired in (Stage 3+).
            hauntedVision.flash(600)
          }
          // A failed/late tap (progress not full, or frame lost right as
          // the player tapped) intentionally gets no flash — only a real
          // capture or a timeout breakout should feel like a beat.
        },
        onTimeout: () => {
          // Timeout breakout: "it rushes the player at close range" per
          // story-bible.md — a shorter, sharper flash than a successful
          // capture, then the ghost's own breakOut() relocates it.
          hauntedVision.flash(300)
        },
      })

      // Ghost pool: each is added to the scene once, hidden, reused per spawn.
      for (let i = 0; i < GHOST_POOL_SIZE; i++) {
        const ghost = createCrawlGhost({
          onRevealPeak: ({ capturable }) => {
            hauntedVision.flash(450)
            // Only a re-find (capturable === true) arms the reticle/meter/
            // timer — a first-ever reveal is scare-only, per
            // story-bible.md's two-phase rule, and the UI should visibly
            // show nothing (no reticle fill, no timer) for that case.
            if (capturable) captureSystem.arm(ghost)
          },
          // Called when this ghost needs somewhere to flee to after its
          // first-ever reveal. Excludes the point it just emerged from so
          // it doesn't just "flee" back into the same spot.
          onNeedFleeTarget: () => surfaceSampler.getRandomPointExcluding(ghost.mesh.position, { excludeRadius: 1.0 }),
          onDespawn: ({ fledTo }) => {
            if (fledTo) {
              // This point is now a guaranteed, capturable re-spawn location
              // for this ghost — hand it to the scare scheduler as a
              // priority target instead of letting it re-roll fully random.
              scareScheduler.registerFledTarget(fledTo, ghost)
            }
          },
        })
        scene.add(ghost.mesh)
        ghostPool.push(ghost)
      }

      surfaceSampler = createSurfaceSampler()
      scareScheduler = createScareScheduler({
        surfaceSampler,
        spawnGhost: spawnGhostAt,
        spawnSpecificGhost: spawnSpecificGhostAt,
        flash: hauntedVision.flash,
      })
      clock = new THREE.Clock()

      window.addEventListener('resize', () => {
        resizeCanvas(canvas)
        renderer.setSize(canvas.width, canvas.height)
        camera.aspect = canvas.width / canvas.height
        camera.updateProjectionMatrix()
        hauntedVision.setSize(canvas.width, canvas.height)
      })

      window.XR8.XrController.recenter()
    },

    // Game-logic tick: scan for surfaces, decide/roll scares, advance any
    // active ghost's emergence animation. Kept separate from onRender, which
    // is drawing-only.
    onUpdate: () => {
      if (!surfaceSampler) return
      const delta = clock.getDelta()

      surfaceSampler.update()
      scareScheduler.update(delta, camera.position)
      ghostPool.forEach((ghost) => ghost.update(delta))
      captureSystem.update(delta)
    },

    // 8th Wall's per-frame lifecycle is:
    //   onProcessGpu -> onProcessCpu -> onUpdate -> onRender
    // XR8.Threejs.pipelineModule() does its plain scene draw during ITS OWN
    // onRender, not onUpdate. Since our module is last in the pipeline array,
    // our onRender runs after that plain draw — so compositing here (not in
    // onUpdate) is what makes our post-processed "haunted" image actually be
    // what ends up on screen, instead of getting overwritten by the plain
    // render that happens right after onUpdate.
    onRender: () => {
      // Haunted shader temporarily disabled — was making the feed too dark.
      // if (hauntedVision) hauntedVision.render()
    },
  }
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
const onxrloaded = () => {
  try {
    debugLog('xrloaded fired. window.XR8 is present, wiring up pipeline modules...')

    window.XR8.addCameraPipelineModules([
      window.XR8.GlTextureRenderer.pipelineModule(),
      window.XR8.Threejs.pipelineModule(),
      window.XR8.XrController.pipelineModule(),
      initScenePipelineModule(),
    ])

    const canvas = document.getElementById('camerafeed')
    debugLog('Calling XR8.run()...')
    window.XR8.run({ canvas, allowedDevices: window.XR8.XrConfig.device().ANY })
    debugLog('XR8.run() called without throwing.')
  } catch (err) {
    debugLog(`CAUGHT ERROR in onxrloaded: ${err.message}\n${err.stack}`)
  }
}

debugLog(`Page script started. window.XR8 present at script-run time: ${!!window.XR8}`)

// Register the service worker: caches the heavy 8th Wall SLAM engine binary
// for fast repeat loads, while your own app code stays network-first (see
// src/sw.js for why — this keeps development from ever showing stale code).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      debugLog(`Service worker registration failed: ${err.message}`)
    })
  })
}

window.XR8
  ? onxrloaded()
  : window.addEventListener('xrloaded', onxrloaded)
