// ---------------------------------------------------------------------------
// Decides WHEN and WHERE ghosts spawn. Deliberately unpredictable, per the
// design rule: fixed timers or fixed proximity distances let players learn
// the pattern, which kills the scare. Every parameter that could become
// learnable is randomized per-cycle instead of fixed.
//
// Two independent spawn paths:
//   - Timer-based: fresh, first-ever-reveal entities (scare-only — see
//     skeletonGhost.js's state machine and the story bible).
//   - Proximity-based: re-finds. registerFledTarget() is how a ghost that
//     just fled its first reveal (or burst back from a breakout) gets
//     turned into a "walk back near here to find it again" trigger — that
//     re-find is what actually starts the capture loop.
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

// Re-find proximity rolls fire more reliably than a fresh first-reveal spot —
// the player is deliberately hunting this one down, so finding the right
// spot again shouldn't feel like yet another random dice roll on top of that.
const REFIND_FIRE_CHANCE = 0.55

export const createScareScheduler = ({ surfaceSampler, spawnGhost, flash, getCameraPosition }) => {
  let nextTimerScareIn = randomBetween(TIMER_MIN, TIMER_MAX)
  let proximityCheckClock = 0
  const proximityWatchers = [] // { point, normal, radius, usedUp, isRefind }

  const attemptSpawn = (preferredType = 'any') => {
    const point = surfaceSampler.getRandomPoint(preferredType)
    if (!point) return false // haven't scanned enough of the room yet
    spawnGhost(point, { isRefind: false })
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
    const position = point.position || point
    proximityWatchers.push({
      point: position,
      normal: point.normal || null,
      radius: randomBetween(0.6, 1.8),
      usedUp: false,
      isRefind: false,
    })
  }

  // Called when a ghost flees a first reveal (or bursts back from a
  // breakout) — registers wherever it fled TO so walking back near that
  // exact spot is what surfaces it again as a capturable re-find. Wider and
  // more likely to fire than a fresh scare spot, since re-finding it is the
  // whole point rather than a bonus scare.
  const registerFledTarget = (point) => {
    if (!point || !point.position) return
    proximityWatchers.push({
      point: point.position,
      normal: point.normal || null,
      radius: randomBetween(1.0, 2.0),
      usedUp: false,
      isRefind: true,
    })
  }

  const update = (delta, cameraPosition) => {
    // --- Timer-based path (fresh, scare-only reveals) ---
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
          const fireChance = watcher.isRefind ? REFIND_FIRE_CHANCE : PROXIMITY_FIRE_CHANCE
          if (Math.random() < fireChance) {
            watcher.usedUp = true
            spawnGhost(
              { position: watcher.point, normal: watcher.normal, type: watcher.isRefind ? 'refind' : 'wall' },
              { isRefind: watcher.isRefind },
            )
          }
          // Note: if the roll fails, we DON'T mark usedUp — player could
          // still trigger it on a later pass, but never guaranteed.
        }
      }
    }
  }

  return { update, watchProximity, registerFledTarget, attemptSpawn }
}
