// ---------------------------------------------------------------------------
// The reticle/capture loop from the scene script's "Global Systems" section:
// frame an entity, hold it centered, its focus meter drains toward capture;
// run out of captureTimer first and it breaks out instead.
//
// The earlier "every active ghost is capturable" simplification is gone now
// that skeletonGhost.js's state machine actually tracks first-reveal vs.
// re-find (isCapturable()) — pickTarget() below only ever considers a ghost
// currently in its capturableLinger state, so a first-ever scare-only
// reveal can't be framed-and-photographed like a real re-find.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

const CENTER_RADIUS = 0.22 // normalized screen-space distance (0-1) counting as "framed"
const CAPTURE_TIMER_SECONDS = 9
const FOCUS_FILL_PER_SECOND = 0.4 // ~2.5s of continuous centered hold to fill

const projected = new THREE.Vector3()

// How close a world point projects to screen center, as a 0 (dead-center) to
// 1+ (off screen) normalized value. Also returns null if it's behind camera.
const screenDistanceFromCenter = (worldPos, camera) => {
  projected.copy(worldPos).project(camera)
  if (projected.z > 1) return null // behind the camera
  return { dist: Math.hypot(projected.x, projected.y), ndcX: projected.x, ndcY: projected.y }
}

export const createCaptureSystem = ({ ghostPool, camera, reticleEl, shutterEl, onCapture, onBreakout }) => {
  const ringTimer = reticleEl.querySelector('.ring-timer')
  const ringFocus = reticleEl.querySelector('.ring-focus')
  const TIMER_CIRC = 2 * Math.PI * 28
  const FOCUS_CIRC = 2 * Math.PI * 21
  ringTimer.style.strokeDasharray = `${TIMER_CIRC}`
  ringFocus.style.strokeDasharray = `${FOCUS_CIRC}`

  let target = null // the ghost instance currently framed, or null
  let captureTimer = 0
  let focusMeter = 0

  const resetTargetState = () => {
    captureTimer = CAPTURE_TIMER_SECONDS
    focusMeter = 0
  }

  const pickTarget = () => {
    let best = null
    let bestDist = CENTER_RADIUS
    let bestScreen = null

    ghostPool.forEach((ghost) => {
      if (!ghost.isActive()) return
      // Backward-compatible: a ghost type that doesn't implement
      // isCapturable() is treated as always-capturable while active.
      if (ghost.isCapturable && !ghost.isCapturable()) return
      const screen = screenDistanceFromCenter(ghost.mesh.position, camera)
      if (!screen) return
      if (screen.dist < bestDist) {
        best = ghost
        bestDist = screen.dist
        bestScreen = screen
      }
    })

    return best ? { ghost: best, screen: bestScreen } : null
  }

  const update = (delta) => {
    const found = pickTarget()

    if (found && found.ghost !== target) {
      target = found.ghost
      resetTargetState()
    } else if (!found && target) {
      target = null
    }

    if (!target) {
      reticleEl.classList.remove('visible')
      shutterEl.classList.remove('ready')
      return
    }

    // Re-run projection for positioning even when target didn't change this
    // frame (it's moving).
    const screen = screenDistanceFromCenter(target.mesh.position, camera)
    if (!screen) {
      target = null
      reticleEl.classList.remove('visible')
      return
    }

    const px = (screen.ndcX * 0.5 + 0.5) * window.innerWidth
    const py = (-screen.ndcY * 0.5 + 0.5) * window.innerHeight
    reticleEl.style.transform = `translate(${px}px, ${py}px)`
    reticleEl.classList.add('visible')

    captureTimer -= delta
    const timerProgress = Math.max(0, captureTimer / CAPTURE_TIMER_SECONDS) // 1 -> 0
    ringTimer.style.strokeDashoffset = `${TIMER_CIRC * (1 - timerProgress)}`

    if (screen.dist < CENTER_RADIUS * 0.5) {
      // Well-centered: fill focus. Persistence rule from the design doc —
      // losing and re-finding frame pauses the meter, never resets it —
      // falls out naturally here since focusMeter only ever moves while
      // `target` stays the same ghost instance.
      focusMeter = Math.min(1, focusMeter + FOCUS_FILL_PER_SECOND * delta)
    }
    ringFocus.style.strokeDashoffset = `${FOCUS_CIRC * (1 - focusMeter)}`

    shutterEl.classList.toggle('ready', focusMeter >= 1)

    if (captureTimer <= 0) {
      if (onBreakout) onBreakout(target)
      target = null
      reticleEl.classList.remove('visible')
    }
  }

  const attemptCapture = () => {
    if (!target || focusMeter < 1) return false
    if (onCapture) onCapture(target)
    target = null
    reticleEl.classList.remove('visible')
    return true
  }

  shutterEl.addEventListener('touchstart', (e) => {
    e.preventDefault()
    attemptCapture()
  })
  // Fallback for desktop testing.
  shutterEl.addEventListener('click', attemptCapture)

  return { update }
}
