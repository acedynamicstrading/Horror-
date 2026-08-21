import * as THREE from 'three'
import { createHauntedVision } from './hauntedShader'
import { createSurfaceSampler } from './surfaceSampler'
import { createScareScheduler } from './scareSystem'
import { loadSkeletonGhostTemplate, createSkeletonGhostInstance } from './ghosts/skeletonGhost'
import { createGameState, GameStates } from './gameState'
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

// Updates the on-screen hint text, doubling as in-fiction narration for the
// scanning/glitch story beats (see gameState.js and CHANGES around it).
const setHintText = (text) => {
  const el = document.getElementById('hint')
  if (el) el.textContent = text
}

let hintFadeTimeout = null
const onGameStateChange = (state, gameStateApi) => {
  if (hintFadeTimeout) clearTimeout(hintFadeTimeout)

  if (state === GameStates.SCANNING) {
    setHintText('Searching for a breach... move slowly around the room.')
  } else if (state === GameStates.ACTIVE) {
    setHintText('The breach is open.')
    hintFadeTimeout = setTimeout(() => setHintText(''), 2800)
  } else if (state === GameStates.GLITCHING) {
    setHintText("SIGNAL LOST — something doesn't want you to see this. Recalibrating...")
  }
}

// ---------------------------------------------------------------------------
// Custom Three.js pipeline module.
// ---------------------------------------------------------------------------
const initScenePipelineModule = () => {
  let scene, camera, renderer, hauntedVision
  let surfaceSampler, scareScheduler, gameState, captureSystem
  let clock
  let lastTrackingStatus = null
  let hasLoggedTrackingSample = false

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

      // Ghost pool: load the real skeleton model ONCE, then clone it per
      // pool slot (SkeletonUtils.clone — required for skinned meshes, a
      // plain Object3D.clone() does not correctly duplicate bone bindings).
      // Loading is async, so the pool simply isn't ready for the first
      // second or two — fine, since spawning also needs scanned surfaces
      // first anyway.
      loadSkeletonGhostTemplate()
        .then((template) => {
          for (let i = 0; i < GHOST_POOL_SIZE; i++) {
            const ghost = createSkeletonGhostInstance(template, {
              onRevealPeak: () => hauntedVision.flash(450),
            })
            scene.add(ghost.mesh)
            ghostPool.push(ghost)
          }
          debugLog(`Skeleton ghost model loaded — pool of ${GHOST_POOL_SIZE} ready.`)
        })
        .catch((err) => {
          debugLog(`Failed to load skeleton ghost model: ${err.message || err}`)
        })

      surfaceSampler = createSurfaceSampler()
      scareScheduler = createScareScheduler({
        surfaceSampler,
        spawnGhost: spawnGhostAt,
        flash: hauntedVision.flash,
      })
      gameState = createGameState({
        surfaceSampler,
        hauntedVision,
        ghostPool,
        onStateChange: (state) => onGameStateChange(state),
      })
      captureSystem = createCaptureSystem({
        ghostPool,
        camera,
        reticleEl: document.getElementById('reticle'),
        shutterEl: document.getElementById('shutter'),
        onCapture: (ghost) => {
          hauntedVision.flash(300)
          if (ghost.forceDespawn) ghost.forceDespawn()
          debugLog('Capture!')
        },
        onBreakout: (ghost) => {
          hauntedVision.flash(200)
          debugLog('Breakout — capture timer ran out.')
          // Entity still needs its own "rush the player, then re-hide"
          // behavior (see scene script's BROKEN_OUT state) — not wired yet,
          // so it just despawns for now rather than looping forever.
          if (ghost.forceDespawn) ghost.forceDespawn()
        },
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
      gameState.update(delta)
      // Scares only run once the room-scan story beat has completed — no
      // ghosts appear during the initial "searching for a breach" phase or
      // mid-glitch.
      if (gameState.getState() === GameStates.ACTIVE) {
        scareScheduler.update(delta, camera.position)
      }
      ghostPool.forEach((ghost) => ghost.update(delta))
      if (captureSystem) captureSystem.update(delta)
    },

    // Per-frame CPU-side data from XrController, including SLAM tracking
    // status. Used to detect when tracking is lost/reset — the most common
    // real-world trigger being the player walking into a room that hasn't
    // been scanned yet, which the SLAM tracker usually can't relocalize
    // against. We fold that moment into the glitch/"entities" story beat
    // instead of it just silently breaking prop anchoring.
    //
    // NOTE: the exact shape of this payload (whether tracking status lands
    // at processCpuResult.reality.trackingStatus, and what string values it
    // takes — e.g. 'NORMAL'/'LIMITED'/'NOT_TRACKING') is inferred from 8th
    // Wall's docs, not verified against a live payload. The debugLog below
    // prints the first sample it sees — check that on-device and adjust the
    // wasGood/isBad check below if the real values differ.
    onProcessCpu: (processCpuResult) => {
      if (!gameState) return
      const reality = processCpuResult && processCpuResult.reality
      if (!reality || !reality.trackingStatus) return

      const status = reality.trackingStatus
      if (!hasLoggedTrackingSample) {
        hasLoggedTrackingSample = true
        debugLog(`First SLAM tracking status sample: ${JSON.stringify({ status, reason: reality.trackingReason })}`)
      }

      if (status !== lastTrackingStatus) {
        const wasGood = lastTrackingStatus === 'NORMAL' || lastTrackingStatus === 'TRACKING'
        const isBad = status !== 'NORMAL' && status !== 'TRACKING'
        if (wasGood && isBad) {
          gameState.onTrackingDisrupted()
        }
        lastTrackingStatus = status
      }
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
      if (hauntedVision) hauntedVision.render()
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
