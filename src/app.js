import * as THREE from 'three'
import { createHauntedVision } from './hauntedShader'
import { createSurfaceSampler } from './surfaceSampler'
import { createScareScheduler } from './scareSystem'
import { loadSkeletonGhostTemplate, createSkeletonGhostInstance } from './ghosts/skeletonGhost'
import { createCrawlSpider } from './ghosts/crawlSpider'
import { createGameState, GameStates } from './gameState'
import { createCaptureSystem } from './captureSystem'
import { createResidueField } from './hauntedResidue'
import { createBleedingWalls } from './effects/bleedingWalls'
import { createHauntedFurniture } from './effects/hauntedFurniture'
import { createAudioManager } from './spatialAudio'
import { initSettingsPanel } from './settingsPanel'
import { loadFurnitureDetector, requestFurnitureDetection } from './furnitureDetector'

// 8th Wall's Threejs pipeline module expects a global window.THREE
// (it assumes script-tag usage), but webpack keeps our import module-scoped.
// Expose it globally so XR8.Threejs.pipelineModule() can find it.
window.THREE = THREE


// ---------------------------------------------------------------------------
// On-screen debug logger. Prints errors directly on the page so they're
// visible on a phone without needing devtools. Visibility now goes through
// window.setDebugLogVisible() (wired to the Settings panel's "Debug Log"
// toggle in settingsPanel.js) instead of always forcing itself on — the
// panel is read/applied as soon as it initializes in onStart, so this
// still defaults to visible (matching the old always-on behavior) for the
// brief window before that happens.
// ---------------------------------------------------------------------------
let debugLogVisible = true

const debugLog = (msg) => {
  const el = document.getElementById('debug')
  if (!el) return
  el.textContent += msg + '\n\n'
  if (debugLogVisible) el.style.display = 'block'
}
window.debugLog = debugLog

window.setDebugLogVisible = (visible) => {
  debugLogVisible = !!visible
  const el = document.getElementById('debug')
  if (el) el.style.display = debugLogVisible ? 'block' : 'none'
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
  let surfaceSampler, scareScheduler, gameState, captureSystem, residueField
  let bleedingWalls, hauntedFurniture, audio
  let residueSpawnClock = 0
  let clock
  let lastTrackingStatus = null
  let hasLoggedTrackingSample = false
  let hasLoggedRawProcessCpu = false
  let hasLoggedRealitySample = false
  let hasLoggedPixelArraySample = false
  let hasLoggedPixelArrayError = false

  // Drives how often the room's haunting (bleeding walls, furniture decay)
  // escalates. Local to this module rather than gameState.js, since
  // gameState.js only tracks the scan/glitch technical states, not
  // gameplay progress — this is a lightweight stand-in for the full
  // "roomsCleared" progress tracker scene-script.md describes (still
  // unbuilt), enough to make the room feel increasingly wrong as the
  // player succeeds without building the rest of that system early.
  const INTENSITY_CAPTURE_CAP = 6 // captures needed to reach max intensity
  let entitiesCaptured = 0
  const getIntensity = () => Math.min(entitiesCaptured / INTENSITY_CAPTURE_CAP, 1)

  // Chance that a fresh (first-ever) entity emergence also kicks off a
  // nearby wall bleed — ties the haunting's set-dressing to what the
  // player is actually doing instead of it running on a fully independent
  // schedule. Deliberately not 100%: unpredictable pairing reads as the
  // room reacting; guaranteed reads as a scripted combo.
  const BLEED_ON_EMERGE_CHANCE = 0.5

  // Live lighting estimation — references to the two fixed-intensity lights
  // created in onStart, so onProcessCpu can drive their brightness/warmth
  // from the real room instead of the hardcoded 0.6/0.8 they start at.
  let ambientLight, directionalLight
  let hasLoggedLightingSample = false
  // Smoothed 0..1 target — the raw estimate can be noisy frame to frame
  // (camera auto-exposure hunting, brief occlusion by a hand), and jumping
  // straight to it would read as flickering rather than "matching the room."
  let smoothedLightLevel = 0.6

  // World-point scan feedback — reality.worldPoints is the raw SLAM feature
  // cloud; we don't need per-point data, just a live count to fold into the
  // existing "Searching for a breach..." scan hint alongside the wall/floor
  // pool sizes already shown there.
  let hasLoggedWorldPointsSample = false
  let latestWorldPointCount = 0

  // Small pool of reusable ghost instances rather than creating a new mesh
  // per scare — cheaper, and simple to reason about with only a few ghosts
  // ever active on screen at once. Spiders (createCrawlSpider) share this
  // SAME array — both entity types implement the identical API, so
  // captureSystem.js/gameState.js/scareSystem.js never need to know two
  // entity types exist.
  const GHOST_POOL_SIZE = 3
  const SPIDER_POOL_SIZE = 3
  const ghostPool = []

  // .find() would always return the FIRST idle match in array order — and
  // since spiders are built synchronously (pushed into ghostPool immediately
  // in onStart) while the skeleton loads asynchronously over the network
  // (pushed in a second or two later, appended AFTER the spiders), spiders
  // permanently occupy the front of the array. That meant the skeleton only
  // ever got picked on the rare frame where all 3 spiders happened to be
  // active at once — in practice, "the skeleton never spawns." Picking
  // randomly among whatever's actually idle fixes that regardless of load
  // order or how many entity types get added later.
  const getIdleGhost = () => {
    const idle = ghostPool.filter((g) => !g.isActive())
    if (idle.length === 0) return null
    return idle[Math.floor(Math.random() * idle.length)]
  }

  // `opts.isRefind` comes from scareScheduler: true when this spawn point
  // was drawn from the fledTargets queue (a specific location awaiting
  // re-find), false for a fresh first-ever reveal. Passed straight through
  // to the ghost instance, which is what actually gates isCapturable().
  //
  // Per entity-type spawn zones: spiders ambush from ceiling/high points
  // (a player looking straight ahead at normal eye level genuinely won't
  // see it coming — they have to tilt the phone up), skeletons emerge from
  // wall/furniture points (normal eye-level walls, corners, around
  // furniture). This only re-picks the point for a FRESH spawn — a re-find
  // (opts.isRefind) must reuse the EXACT point it originally fled to, or
  // "go back to where you saw it" stops meaning anything.
  const spawnGhostAt = (point, opts = {}) => {
    const ghost = getIdleGhost()
    if (!ghost) return // all ghosts already active — skip this scare attempt

    let usePoint = point
    if (!opts.isRefind) {
      const zonePool = ghost.kind === 'spider' ? 'ceiling' : 'wall'
      const zonePoint =
        surfaceSampler.getRandomPoint(zonePool) ||
        (ghost.kind !== 'spider' ? surfaceSampler.getRandomPoint('furniture') : null)
      // Fall back to whatever the scheduler originally picked if this
      // entity's preferred zone hasn't been scanned yet — better to spawn
      // somewhere than not spawn at all.
      if (zonePoint) usePoint = zonePoint
    }

    const normal = usePoint.normal || new THREE.Vector3(0, 1, 0)
    ghost.spawnAt(usePoint.position, normal, opts)

    // A fresh (non-refind) emergence is a real "something just appeared"
    // moment — occasionally tie a nearby wall bleed to it so the room
    // reacts to what's happening instead of bleeding on a fully
    // independent schedule.
    if (!opts.isRefind && bleedingWalls && Math.random() < BLEED_ON_EMERGE_CHANCE) {
      bleedingWalls.spawnNear(usePoint)
    }
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

      const ambient = new THREE.AmbientLight(0xffffff, 0.6)
      scene.add(ambient)
      const directional = new THREE.DirectionalLight(0xffffff, 0.8)
      directional.position.set(0, 3, 1)
      scene.add(directional)
      ambientLight = ambient
      directionalLight = directional

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

      // Settings panel — brightness / haunted intensity / glitch toggle /
      // debug log toggle. Wired here (not at module top-level) since it
      // needs hauntedVision to exist first to apply the saved values.
      // Stored on window so the current live-tuned values can be read off
      // the browser console (window.settingsPanel.getSettings()) once
      // they're dialed in on-device — that's the numbers to report back.
      window.settingsPanel = initSettingsPanel({ hauntedVision })

      // "Texture the environment" — procedural residue decals dropped onto
      // surfaces as they're scanned (see hauntedResidue.js). There's no real
      // environment mesh to texture directly (SLAM only gives us hit-test
      // points), so this pins flat, semi-transparent grunge planes to
      // sampled points, the same way ghosts anchor to them.
      residueField = createResidueField({ scene })

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
              // Asked only on a scare-only first reveal, once it's ready to
              // duck away. Excludes the point it's currently at so "flee"
              // actually means somewhere else, not a near-duplicate spot.
              onNeedFleeTarget: (currentPoint) =>
                surfaceSampler.getRandomPointExcluding('any', currentPoint, 0.8),
              // fledTo (present only for the first-reveal flee path, null
              // for a capturable re-find's forceDespawn) gets registered
              // with the scheduler so THAT exact point's next spawn comes
              // back through as isRefind: true.
              onDespawn: ({ fledTo } = {}) => {
                if (fledTo && scareScheduler) scareScheduler.registerFledTarget(fledTo)
              },
            })
            scene.add(ghost.mesh)
            ghost.kind = 'skeleton'
            ghostPool.push(ghost)
          }
          debugLog(`Skeleton ghost model loaded — pool of ${GHOST_POOL_SIZE} ready.`)
        })
        .catch((err) => {
          debugLog(`Failed to load skeleton ghost model: ${err.message || err}`)
        })

      // Loads MediaPipe's Object Detector model in the background — not
      // needed until the first onUpdate tick during SCANNING, so no need to
      // block anything on it. Failures here degrade gracefully: furniture
      // classification just falls back to the height-band guess in
      // surfaceSampler.js, nothing crashes.
      loadFurnitureDetector()
        .then(() => debugLog('Furniture object detector loaded.'))
        .catch((err) => debugLog(`Failed to load furniture detector: ${err.message || err}`))

      surfaceSampler = createSurfaceSampler()

      // spatialAudio.js's manager — wired into app.js for the first time
      // (the module existed but nothing instantiated it before). Only the
      // "wallDrip" one-shot is used so far (see effects/bleedingWalls.js);
      // extend the urlMap below as more of spatialAudio.js gets adopted.
      // Loading is fire-and-forget: if wall-drip.mp3 doesn't exist at this
      // path yet, spatialAudio.js's requireBuffer() just warns and no-ops
      // on playback rather than throwing, so this never blocks scene setup.
      audio = createAudioManager({ camera })
      audio.load({ wallDrip: '/audio/wall-drip.mp3' }).catch((err) => {
        debugLog(`spatialAudio: wallDrip failed to load (expected until a real file is added at /audio/wall-drip.mp3): ${err.message}`)
      })

      // Bleeding walls: real wall points, decal only exists in the
      // composited scene — never touches the actual room. Wall pool
      // already includes ceiling hits (surfaceSampler.js's classifier
      // lumps a downward-facing normal into 'wall' since it doesn't clear
      // the upDot > 0.7 floor check), so this covers roofs too with no
      // separate pool. See effects/bleedingWalls.js for the full rationale.
      bleedingWalls = createBleedingWalls({ surfaceSampler, audio, getIntensity })
      bleedingWalls.addTo(scene)

      // Haunted furniture: same idea, applied to furniture/floor points
      // with a mold/rot decal instead of dripping blood (see
      // effects/hauntedFurniture.js) — so tables, chairs, and the floor
      // itself read as haunted too, not just the walls.
      hauntedFurniture = createHauntedFurniture({ surfaceSampler, getIntensity })
      hauntedFurniture.addTo(scene)

      // Spider pool: primitive-built (no rigged model for this one), but
      // shares the skeleton ghost's exact state machine/API (see
      // ghosts/crawlSpider.js) — pushed into the SAME ghostPool array so
      // captureSystem.js/gameState.js/scareSystem.js see a uniform pool of
      // capturable entities without knowing two types exist. Unlike the
      // skeleton ghost, this doesn't need an async model load, so it's
      // ready immediately rather than a second or two in.
      for (let i = 0; i < SPIDER_POOL_SIZE; i++) {
        const spider = createCrawlSpider({
          seed: i + 1,
          onRevealPeak: () => hauntedVision.flash(450),
          onNeedFleeTarget: (currentPoint) =>
            surfaceSampler.getRandomPointExcluding('any', currentPoint, 0.8),
          onDespawn: ({ fledTo } = {}) => {
            if (fledTo && scareScheduler) scareScheduler.registerFledTarget(fledTo)
          },
        })
        scene.add(spider.mesh)
        spider.kind = 'spider'
        ghostPool.push(spider)
      }
      debugLog(`Spider pool of ${SPIDER_POOL_SIZE} ready.`)

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
          entitiesCaptured += 1
          hauntedVision.flash(300)
          // captureDespawn() plays a quick "pulled into the lens" snap
          // toward the camera instead of an instant pop; forceDespawn is
          // the fallback for any ghost type that doesn't implement it.
          if (ghost.captureDespawn) ghost.captureDespawn(camera.position)
          else if (ghost.forceDespawn) ghost.forceDespawn()
          debugLog('Capture!')
        },
        onBreakout: (ghost) => {
          hauntedVision.flash(260)
          hauntedVision.setGlitch(true)
          setTimeout(() => hauntedVision.setGlitch(false), 260)
          debugLog('Breakout — capture timer ran out.')
          // Entity's "rush the player, then re-hide" behavior (scene
          // script's BROKEN_OUT state): charges the camera, then bursts
          // back and re-registers a new hiding spot as a re-find target.
          if (ghost.breakout) ghost.breakout(camera.position)
          else if (ghost.forceDespawn) ghost.forceDespawn()
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
    //
    // Also where lighting/worldPoints/trackingStatus now actually get read —
    // moved here from onProcessCpu (see the comment on that hook below for
    // why). onUpdate receives { processCpuResult } as one of its arguments;
    // that's where XR8.XrController's `reality` output actually lands.
    onUpdate: ({ processCpuResult }) => {
      if (!surfaceSampler) return
      const delta = clock.getDelta()

      const reality = processCpuResult && processCpuResult.reality
      if (reality) {
        if (!hasLoggedRealitySample) {
          hasLoggedRealitySample = true
          debugLog(`First reality sample (from onUpdate): keys=${JSON.stringify(Object.keys(reality))}`)
        }

        // ---- lighting estimation -> drive the two scene lights live ----
        // Field names still aren't pinned down from public docs — logs the
        // first real lighting sample and tries several plausible names
        // defensively, same caution as before. Simplify once confirmed.
        if (reality.lighting) {
          if (!hasLoggedLightingSample) {
            hasLoggedLightingSample = true
            debugLog(`First lighting sample: ${JSON.stringify(reality.lighting)}`)
          }
          const L = reality.lighting
          let raw = null
          if (typeof L.intensity === 'number') raw = L.intensity
          else if (typeof L.ambientIntensity === 'number') raw = L.ambientIntensity
          else if (typeof L.brightness === 'number') raw = L.brightness
          else if (typeof L.exposure === 'number') raw = 1 / (1 + Math.exp(-(L.exposure - 1)))
          else if (typeof L.ev === 'number') raw = Math.min(1, Math.max(0, (L.ev + 3) / 10))

          if (raw != null) {
            const target = Math.min(1, Math.max(0.08, raw))
            smoothedLightLevel += (target - smoothedLightLevel) * 0.08
            if (ambientLight) ambientLight.intensity = 0.25 + smoothedLightLevel * 0.6
            if (directionalLight) directionalLight.intensity = 0.3 + smoothedLightLevel * 0.9
          }
        }

        // ---- world points -> feed the scan-progress hint text ----
        if (Array.isArray(reality.worldPoints)) {
          if (!hasLoggedWorldPointsSample && reality.worldPoints.length > 0) {
            hasLoggedWorldPointsSample = true
            debugLog(`First worldPoints sample: ${reality.worldPoints.length} points. Example: ${JSON.stringify(reality.worldPoints[0])}`)
          }
          latestWorldPointCount = reality.worldPoints.length
        }

        // ---- tracking status ----
        if (reality.trackingStatus) {
          const status = reality.trackingStatus
          if (!hasLoggedTrackingSample) {
            hasLoggedTrackingSample = true
            debugLog(`First SLAM tracking status sample: ${JSON.stringify({ status, reason: reality.trackingReason })}`)
          }
          if (status !== lastTrackingStatus) {
            const wasGood = lastTrackingStatus === 'NORMAL' || lastTrackingStatus === 'TRACKING'
            const isBad = status !== 'NORMAL' && status !== 'TRACKING'
            if (wasGood && isBad) gameState.onTrackingDisrupted()
            lastTrackingStatus = status
          }
        }
      } else if (!hasLoggedRealitySample) {
        hasLoggedRealitySample = true
        debugLog('onUpdate fired but processCpuResult.reality is still absent — see next message for raw processCpuResult keys.')
        debugLog(`processCpuResult top-level keys: ${JSON.stringify(processCpuResult ? Object.keys(processCpuResult) : null)}`)
      }

      surfaceSampler.update()
      gameState.update(delta)

      // Drip-feed residue decals from whatever's already been scanned —
      // throttled (not every frame) and self-limiting (hauntedResidue.js
      // caps total count + dedups near-duplicate spots), so the room
      // gradually reads as more "marked up" the more of it you scan.
      residueSpawnClock += delta
      if (residueField && residueSpawnClock >= 1.1) {
        residueSpawnClock = 0
        const point = surfaceSampler.getRandomPoint('any')
        if (point) residueField.addAt(point)
      }
      if (residueField) residueField.update(delta)

      if (gameState.getState() === GameStates.SCANNING) {
        const sizes = surfaceSampler.poolSizes()
        const pointsNote = latestWorldPointCount > 0 ? ` · ${latestWorldPointCount} points mapped` : ''
        setHintText(
          `Searching for a breach... (walls ${Math.min(sizes.wall, 3)}/3, floor ${Math.min(sizes.floor, 2)}/2)${pointsNote} — move slowly, angle the phone at walls and the floor.`,
        )
      }

      // Scares only run once the room-scan story beat has completed — no
      // ghosts appear during the initial "searching for a breach" phase or
      // mid-glitch.
      if (gameState.getState() === GameStates.ACTIVE) {
        scareScheduler.update(delta, camera.position)
      }
      ghostPool.forEach((ghost) => ghost.update(delta, camera.position))
      if (captureSystem) captureSystem.update(delta)
      if (bleedingWalls) bleedingWalls.update(delta)
      if (hauntedFurniture) hauntedFurniture.update(delta)
    },

    // Per-frame CPU-side data from XrController, including SLAM tracking
    // status, lighting estimation, and the world-point cloud. IMPORTANT: this
    // data does NOT live on onProcessCpu's own argument — that argument is
    // the INPUT to this pipeline stage (frameStartResult/processGpuResult/
    // cameraTextureReadyResult — confirmed on-device via the diagnostic dump
    // below, which is exactly what it showed). `reality` is the OUTPUT that
    // XR8.XrController's own onProcessCpu produces, and per 8th Wall's docs
    // it only becomes available to other modules at the NEXT stage, onUpdate
    // — via processCpuResult.reality there. So all of this actually lives in
    // onUpdate below now, not here.
    //
    // camerapixelarray is DIFFERENT, though — confirmed on-device it's
    // genuinely absent from onUpdate's processCpuResult. It follows 8th
    // Wall's documented pattern exactly (their own QR-scan example): it's
    // produced by CameraPixelArray's onProcessGpu, and becomes available to
    // THIS stage (onProcessCpu) via the processGpuResult key on this
    // function's own argument — i.e. one stage EARLIER than `reality`, not
    // the same stage. Two different pieces of 8th Wall data landing at two
    // different, non-obvious stages — don't assume they behave the same way.
    onProcessCpu: ({ processGpuResult }) => {
      if (!gameState) return
      if (!hasLoggedRawProcessCpu) {
        hasLoggedRawProcessCpu = true
        const topKeys = processGpuResult ? Object.keys(processGpuResult) : null
        debugLog(`RAW onProcessCpu processGpuResult keys: ${JSON.stringify(topKeys)}`)
      }

      // ---- furniture object detection ----
      // Only during SCANNING (furniture doesn't move once found — no value
      // paying the inference cost through ACTIVE gameplay). Self-throttled
      // internally on top of this gate (see furnitureDetector.js).
      const pixelData = processGpuResult && processGpuResult.camerapixelarray
      if (!hasLoggedPixelArraySample) {
        hasLoggedPixelArraySample = true
        debugLog(
          pixelData
            ? `First camerapixelarray sample (from onProcessCpu): rows=${pixelData.rows} cols=${pixelData.cols} bytes=${pixelData.pixels ? pixelData.pixels.length : 'n/a'}`
            : 'camerapixelarray absent from onProcessCpu\'s processGpuResult too — check the CameraPixelArray module is actually registered before this one in addCameraPipelineModules.',
        )
      }
      if (pixelData && gameState.getState() === GameStates.SCANNING) {
        const detections = requestFurnitureDetection(pixelData)
        for (const det of detections) {
          if (det.error) {
            if (!hasLoggedPixelArrayError) {
              hasLoggedPixelArrayError = true
              debugLog(`Furniture detector: ${det.error}`)
            }
            continue
          }
          const results = window.XR8.XrController.hitTest(
            det.normalizedCenter.x,
            det.normalizedCenter.y,
            ['FEATURE_POINT', 'ESTIMATED_SURFACE'],
          )
          if (results && results.length > 0) {
            const hit = results[0]
            const position = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z)
            const normal = new THREE.Vector3(position.x, 0, position.z)
            if (normal.lengthSq() < 0.0001) normal.set(0, 0, 1)
            normal.normalize()
            surfaceSampler.addDetectedFurniturePoint(position, normal, det.label)
          }
        }
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
      // Intentionally disabled — kept off on purpose (too dark), not a bug.
      // Do not re-enable without being asked.
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
      // Provides camera frames to furnitureDetector.js without opening a
      // second camera stream — 8th Wall's own documented pattern for
      // feeding external CV libraries (their own example is a QR scanner
      // built this exact way). Kept at a modest resolution since this
      // still costs real CPU/GPU time on top of SLAM + rendering.
      window.XR8.CameraPixelArray.pipelineModule({ luminance: false, maxDimension: 320 }),
      initScenePipelineModule(),
    ])

    // Both flags default OFF — without this call, reality.lighting and
    // reality.worldPoints are simply absent from onProcessCpu's payload every
    // frame, no matter what we do downstream. Doesn't touch VPS/hand tracking
    // (not requesting enableVps here — that's excluded from the distributed
    // engine binary anyway and would be a no-op at best).
    debugLog('Calling XR8.XrController.configure({ enableLighting, enableWorldPoints })...')
    window.XR8.XrController.configure({ enableLighting: true, enableWorldPoints: true })

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
