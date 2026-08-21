// ---------------------------------------------------------------------------
// Turns two real technical states of the underlying AR tracking into
// in-fiction story beats, per the design decision:
//
//   - Initial surface scanning (SLAM needs to see enough of the room before
//     anything can be placed reliably) becomes "the app is searching for
//     the breach/portal" — not a loading spinner, an in-world action the
//     player is performing.
//   - SLAM tracking loss/reset (a REAL, common occurrence — happens when
//     walking through a doorway into a room that hasn't been scanned yet,
//     since the tracker can't relocalize) becomes "the entities/Elusiv3's
//     signal glitching," asking the player to scan again — not an error
//     message.
//
// States: SCANNING -> ACTIVE -> (tracking disrupted) -> GLITCHING -> SCANNING
// Scares (the scare scheduler) only run while ACTIVE.
// ---------------------------------------------------------------------------

export const GameStates = {
  SCANNING: 'scanning',
  ACTIVE: 'active',
  GLITCHING: 'glitching',
}

const SCAN_WALL_TARGET = 3
const SCAN_FLOOR_TARGET = 2
const GLITCH_DURATION_SECONDS = 2.2

export const createGameState = ({ surfaceSampler, hauntedVision, ghostPool, onStateChange }) => {
  let state = GameStates.SCANNING
  let glitchTimer = 0

  const setState = (next) => {
    if (state === next) return
    state = next
    if (onStateChange) onStateChange(next)
  }

  const scanProgress = () => {
    const sizes = surfaceSampler.poolSizes()
    const wallP = Math.min(sizes.wall / SCAN_WALL_TARGET, 1)
    const floorP = Math.min(sizes.floor / SCAN_FLOOR_TARGET, 1)
    return Math.min(wallP, floorP) // both need to be satisfied, not averaged
  }

  const isScanComplete = () => {
    const sizes = surfaceSampler.poolSizes()
    return sizes.wall >= SCAN_WALL_TARGET && sizes.floor >= SCAN_FLOOR_TARGET
  }

  const update = (delta) => {
    if (state === GameStates.SCANNING) {
      if (isScanComplete()) {
        hauntedVision.portalOpen()
        setState(GameStates.ACTIVE)
      }
      return
    }

    if (state === GameStates.GLITCHING) {
      glitchTimer -= delta
      if (glitchTimer <= 0) {
        hauntedVision.setGlitch(false)
        setState(GameStates.SCANNING)
      }
    }
  }

  // Call when the underlying SLAM tracking appears to have lost lock or
  // reset — see app.js's onProcessCpu for how that's detected. Treated as
  // "moved to a new, unscanned space": old surface points are cleared (they
  // belonged to wherever tracking was before), any active ghost is yanked
  // away instantly (its anchor may no longer be valid), and the glitch
  // narrative beat plays before scanning resumes.
  const onTrackingDisrupted = () => {
    if (state === GameStates.GLITCHING) return // already mid-glitch, don't restart the clock
    surfaceSampler.reset()
    ghostPool.forEach((ghost) => ghost.forceDespawn && ghost.forceDespawn())
    hauntedVision.setGlitch(true)
    glitchTimer = GLITCH_DURATION_SECONDS
    setState(GameStates.GLITCHING)
  }

  return {
    update,
    onTrackingDisrupted,
    getState: () => state,
    getScanProgress: scanProgress,
  }
}
