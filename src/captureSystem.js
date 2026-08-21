// ---------------------------------------------------------------------------
// Stage 1 (build-roadmap.md) — the capture loop. Owns the reticle UI, the
// capture progress meter, the capture timer, and the shutter button, and
// drives the single "armed" ghost's held/forceCapture()/breakOut() calls.
//
// Deliberately single-target: only one ghost can be "armed" (in the held
// state, being timed/aimed-at) at once. Per build-roadmap.md Stage 1, don't
// generalize to multiple simultaneous capturable entities until this loop
// feels right in hand on a real device.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

// --- Tunables — retune by feel once this is on a real device. ---------------
// NDC (-1..1) radius around screen-center that counts as "framed." Small
// values demand precise aim; this starting point favors readability over
// difficulty until playtesting says otherwise.
const FRAME_RADIUS = 0.16
// Seconds of continuous, centered framing needed to fill the capture
// progress meter from empty to full.
const PROGRESS_FILL_SECONDS = 2.2
// Total seconds the player has, from the capturable reveal, before a
// timeout breakout — regardless of whether they're currently framing it.
const CAPTURE_TIMER_SECONDS = 7.5
// Minimum visual step before a DOM style write, to avoid thrashing layout
// on every single frame for a change too small to see.
const MIN_VISUAL_DELTA = 0.004

const clamp01 = (v) => Math.max(0, Math.min(1, v))

const buildUi = () => {
  const root = document.createElement('div')
  root.id = 'capture-ui'
  root.innerHTML = `
    <div id="reticle">
      <div id="timer-ring"></div>
      <div id="progress-ring"></div>
      <div id="reticle-dot"></div>
    </div>
    <button id="shutter" aria-label="Capture"></button>
  `
  document.body.appendChild(root)

  const style = document.createElement('style')
  style.textContent = `
    #capture-ui { position: absolute; inset: 0; pointer-events: none; }
    #reticle {
      position: absolute; top: 50%; left: 50%; width: 84px; height: 84px;
      transform: translate(-50%, -50%);
      opacity: 0.55; transition: opacity 0.2s ease;
    }
    #reticle.armed { opacity: 1; }
    #timer-ring, #progress-ring {
      position: absolute; inset: 0; border-radius: 50%;
    }
    /* Timer ring: outer, thins (shrinks) as the capture timer runs out. */
    #timer-ring {
      border: 2px solid rgba(230, 240, 240, 0.55);
      transform: scale(1);
      transition: transform 0.1s linear, opacity 0.2s ease;
      opacity: 0;
    }
    #reticle.armed #timer-ring { opacity: 1; }
    /* Progress ring: inner, fills via conic-gradient as focus holds. */
    #progress-ring {
      inset: 10px;
      background: conic-gradient(rgba(210, 235, 235, 0.9) 0deg, rgba(210, 235, 235, 0.9) 0deg, transparent 0deg);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    #reticle.armed #progress-ring { opacity: 1; }
    #reticle-dot {
      position: absolute; top: 50%; left: 50%; width: 4px; height: 4px;
      margin: -2px; border-radius: 50%; background: rgba(230, 240, 240, 0.85);
    }
    #reticle.framed #reticle-dot { background: #fff; }
    #shutter {
      position: absolute; left: 50%; bottom: 36px; transform: translateX(-50%);
      width: 68px; height: 68px; border-radius: 50%;
      background: rgba(20, 24, 24, 0.55); border: 3px solid rgba(230, 240, 240, 0.75);
      pointer-events: auto; opacity: 0.45; transition: opacity 0.2s ease, transform 0.1s ease;
    }
    #shutter.ready { opacity: 1; border-color: #fff; }
    #shutter:active { transform: translateX(-50%) scale(0.92); }
  `
  document.head.appendChild(style)

  return {
    reticle: root.querySelector('#reticle'),
    timerRing: root.querySelector('#timer-ring'),
    progressRing: root.querySelector('#progress-ring'),
    shutter: root.querySelector('#shutter'),
  }
}

// onCaptureResult: ({ success: boolean }) => void — fires on both a
// successful capture and a failed/late shutter tap, so app.js can drive
// audio (spatialAudio.js's shutter-click/flash-bang once wired) without
// this module knowing anything about sound.
export const createCaptureSystem = ({ camera, onCaptureResult, onTimeout }) => {
  const ui = buildUi()

  let armedGhost = null
  let progress = 0 // 0..1
  let timeRemaining = 0
  let lastFramed = false
  let lastProgressDrawn = -1
  let lastTimerDrawn = -1

  const _ndcOf = (mesh) => {
    const v = new THREE.Vector3()
    mesh.getWorldPosition(v)
    v.project(camera)
    return v
  }

  const isFramed = (ghost) => {
    if (!ghost || !ghost.isActive()) return false
    const ndc = _ndcOf(ghost.mesh)
    // Behind the camera — never "framed" even if the x/y happen to line up.
    if (ndc.z > 1) return false
    return Math.hypot(ndc.x, ndc.y) <= FRAME_RADIUS
  }

  // Call this from the ghost's onRevealPeak callback when capturable===true
  // — arms the capture system on this specific ghost instance.
  const arm = (ghost) => {
    armedGhost = ghost
    progress = 0
    timeRemaining = CAPTURE_TIMER_SECONDS
    ui.reticle.classList.add('armed')
  }

  const disarm = () => {
    armedGhost = null
    ui.reticle.classList.remove('armed', 'framed')
    ui.shutter.classList.remove('ready')
    lastProgressDrawn = -1
    lastTimerDrawn = -1
  }

  const update = (delta) => {
    if (!armedGhost) return

    // Ghost resolved itself some other way (e.g. despawned externally) —
    // just clear our state, don't force anything.
    if (!armedGhost.isHeld()) {
      disarm()
      return
    }

    const framed = isFramed(armedGhost)
    if (framed !== lastFramed) {
      ui.reticle.classList.toggle('framed', framed)
      lastFramed = framed
    }

    if (framed) {
      progress = clamp01(progress + delta / PROGRESS_FILL_SECONDS)
    }
    // Progress deliberately does NOT decay when frame is lost — only holds.

    timeRemaining -= delta

    if (Math.abs(progress - lastProgressDrawn) > MIN_VISUAL_DELTA) {
      ui.progressRing.style.background =
        `conic-gradient(rgba(210, 235, 235, 0.9) ${progress * 360}deg, transparent ${progress * 360}deg)`
      lastProgressDrawn = progress
    }
    ui.shutter.classList.toggle('ready', progress >= 1)

    const timerFrac = clamp01(timeRemaining / CAPTURE_TIMER_SECONDS)
    if (Math.abs(timerFrac - lastTimerDrawn) > MIN_VISUAL_DELTA) {
      // "Thinning ring" — scales down as time runs out, per story-bible.md's
      // "visible as a thinning ring around the reticle, not a number."
      ui.timerRing.style.transform = `scale(${0.4 + 0.6 * timerFrac})`
      lastTimerDrawn = timerFrac
    }

    if (timeRemaining <= 0) {
      const ghost = armedGhost
      disarm()
      const relocated = ghost.breakOut()
      if (onTimeout) onTimeout({ relocated })
      // If breakOut() couldn't find anywhere to send it (room barely
      // scanned), it just stays held — leave it armed and try again next
      // frame rather than losing track of it entirely.
      if (!relocated) arm(ghost)
    }
  }

  const attemptCapture = () => {
    if (!armedGhost) return
    const framed = isFramed(armedGhost)
    if (progress >= 1 && framed) {
      const ghost = armedGhost
      const camPos = new THREE.Vector3()
      camera.getWorldPosition(camPos)
      const captured = ghost.forceCapture(camPos)
      disarm()
      if (onCaptureResult) onCaptureResult({ success: captured })
    } else {
      // Tapped too early or lost frame right at the moment of the tap —
      // not a timeout, just a whiff. No state change, just feedback.
      if (onCaptureResult) onCaptureResult({ success: false })
    }
  }

  ui.shutter.addEventListener('touchstart', (e) => {
    e.preventDefault()
    attemptCapture()
  })
  ui.shutter.addEventListener('click', attemptCapture)

  return { arm, update, attemptCapture }
}
