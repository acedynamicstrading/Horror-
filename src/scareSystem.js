// ---------------------------------------------------------------------------
// Decides WHEN and WHERE ghosts spawn. Deliberately unpredictable, per the
// design rule: fixed timers or fixed proximity distances let players learn
// the pattern, which kills the scare. Every parameter that could become
// learnable is randomized per-cycle instead of fixed.
// ---------------------------------------------------------------------------

const randomBetween = (min, max) => min + Math.random() * (max - min)

// Base timer range (seconds) between scare attempts. Widened occasionally
// (see scheduleNext) to create "false quiet" — tension that doesn't resolve
// on a learnable countdown.
const TIMER_MIN = 14
const TIMER_MAX = 38
const LONG_DORMANCY_CHANCE = 0.2
const LONG_DORMANCY_MULTIPLIER = 2.2

// Proximity scares: even when the player is "in range," it's a probability
// roll, not a guarantee — so walking near a spot doesn't reliably trigger it.
const PROXIMITY_FIRE_CHANCE = 0.35
const PROXIMITY_CHECK_INTERVAL = 0.4 // seconds between rolls, not every frame

export const createScareScheduler = ({ surfaceSampler, spawnGhost, flash, getCameraPosition }) => {
  let nextTimerScareIn = randomBetween(TIMER_MIN, TIMER_MAX)
  let proximityCheckClock = 0
  const proximityWatchers = [] // { point, radius, lastRollAt }

  const attemptSpawn = (preferredType = 'any') => {
    const point = surfaceSampler.getRandomPoint(preferredType)
    if (!point) return false // haven't scanned enough of the room yet
    spawnGhost(point)
    return true
  }

  const scheduleNextTimerScare = () => {
    let interval = randomBetween(TIMER_MIN, TIMER_MAX)
    if (Math.random() < LONG_DORMANCY_CHANCE) {
      interval *= LONG_DORMANCY_MULTIPLIER
    }
    nextTimerScareIn = interval
  }

  // Registers a point as a proximity trigger with its OWN randomized radius,
  // so different spawn points don't all share one learnable trigger distance.
  const watchProximity = (point) => {
    proximityWatchers.push({
      point,
      radius: randomBetween(0.6, 1.8),
      usedUp: false,
    })
  }

  const update = (delta, cameraPosition) => {
    // --- Timer-based path ---
    nextTimerScareIn -= delta
    if (nextTimerScareIn <= 0) {
      attemptSpawn('any')
      scheduleNextTimerScare()
    }

    // --- Proximity-based path (throttled, probabilistic) ---
    proximityCheckClock += delta
    if (proximityCheckClock >= PROXIMITY_CHECK_INTERVAL) {
      proximityCheckClock = 0
      for (const watcher of proximityWatchers) {
        if (watcher.usedUp) continue
        const dist = cameraPosition.distanceTo(watcher.point)
        if (dist <= watcher.radius) {
          if (Math.random() < PROXIMITY_FIRE_CHANCE) {
            watcher.usedUp = true
            spawnGhost({ position: watcher.point, normal: null, type: 'wall' })
          }
          // Note: if the roll fails, we DON'T mark usedUp — player could
          // still trigger it on a later pass, but never guaranteed.
        }
      }
    }
  }

  return { update, watchProximity, attemptSpawn }
}
