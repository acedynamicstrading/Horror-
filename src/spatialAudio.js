// ---------------------------------------------------------------------------
// spatialAudio.js — positional + ambient audio for LENS.
//
// Built on Three.js's audio wrapper (THREE.AudioListener / THREE.PositionalAudio
// / THREE.Audio) since the project already runs a Three.js scene graph via
// 8th Wall — this rides the same camera/scene without a second audio context
// or manual PannerNode wiring.
//
// Three roles, matched to three THREE.* audio types:
//   1. Positional entity cues (whispers, footsteps, breakout rush) —
//      THREE.PositionalAudio, attached to an entity's object3D. Pans and
//      attenuates automatically as the entity/camera move relative to each
//      other — this is what makes LENS_DOWN legible: the player can tell
//      *where* a HUNTING entity is without seeing it.
//   2. Ambient beds (room tone, static, drone) — THREE.Audio (non-positional),
//      one at a time via crossfade, since these represent the whole space,
//      not a point in it.
//   3. One-shot UI/feedback SFX (shutter click, capture flash-bang, whiffed
//      shutter) — also THREE.Audio, fire-and-forget, several can overlap.
//
// Usage sketch (inside initScenePipelineModule in app.js, after camera exists):
//
//   import { createAudioManager } from './spatialAudio'
//   const audio = createAudioManager({ camera })
//   await audio.load({
//     whisper: '/audio/entity-whisper.mp3',
//     footstep: '/audio/entity-footstep.mp3',
//     rush: '/audio/breakout-rush.mp3',
//     roomtone: '/audio/roomtone.mp3',
//     static: '/audio/call-static.mp3',
//     shutterClick: '/audio/shutter-click.mp3',
//     captureFlash: '/audio/capture-flash.mp3',
//     shutterWhiff: '/audio/shutter-whiff.mp3',
//   })
//   audio.playAmbient('roomtone')
//   const cue = audio.attachEntityCue(entity.object3D, 'whisper', { loop: true })
//   cue.setVolume(0.6)
//   ...
//   audio.playOneShot('shutterClick')
//
// ---------------------------------------------------------------------------

import * as THREE from 'three'

export const createAudioManager = ({ camera }) => {
  const listener = new THREE.AudioListener()
  camera.add(listener)

  const buffers = {} // name -> AudioBuffer
  const loader = new THREE.AudioLoader()

  let currentAmbient = null // { name, sound }
  let ambientFadeRAF = null

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  // Load a map of { name: url }. Resolves once everything's fetched+decoded.
  // Safe to call more than once (e.g. loading Act 2/3 sounds later) — won't
  // re-fetch a name that's already loaded.
  const load = (urlMap) => {
    const names = Object.keys(urlMap).filter((name) => !buffers[name])
    return Promise.all(
      names.map(
        (name) =>
          new Promise((resolve, reject) => {
            loader.load(
              urlMap[name],
              (buffer) => { buffers[name] = buffer; resolve() },
              undefined,
              (err) => reject(new Error(`spatialAudio: failed to load "${name}" (${urlMap[name]}): ${err}`)),
            )
          }),
      ),
    )
  }

  const requireBuffer = (name) => {
    const buffer = buffers[name]
    if (!buffer) {
      console.warn(`spatialAudio: "${name}" not loaded yet — call load({ ${name}: url }) first.`)
      return null
    }
    return buffer
  }

  // -------------------------------------------------------------------------
  // 1. Positional entity cues — the LENS_DOWN "you can hear it, not see it"
  //    system. Attach one per entity per active cue (e.g. a HUNTING entity
  //    gets a looping footstep cue; a FLEEING entity might not need one at
  //    all since it's already on screen).
  // -------------------------------------------------------------------------

  // refDistance/maxDistance control how quickly volume falls off with
  // distance — tuned for a single room's scale (meters), not outdoor scale.
  const attachEntityCue = (object3D, bufferName, { loop = false, volume = 1, refDistance = 1, maxDistance = 8 } = {}) => {
    const buffer = requireBuffer(bufferName)
    const sound = new THREE.PositionalAudio(listener)
    if (buffer) sound.setBuffer(buffer)
    sound.setLoop(loop)
    sound.setVolume(volume)
    sound.setRefDistance(refDistance)
    sound.setMaxDistance(maxDistance)
    sound.setDistanceModel('inverse')
    object3D.add(sound)

    return {
      sound,
      play: () => { if (!sound.isPlaying) sound.play() },
      stop: () => { if (sound.isPlaying) sound.stop() },
      setVolume: (v) => sound.setVolume(v),
      // Call when an entity's AI state changes — e.g. mute the footstep cue
      // the instant it flips from HUNTING back to FLEEING/visible, since the
      // player can now just see it.
      setActive: (active) => {
        if (active && !sound.isPlaying) sound.play()
        if (!active && sound.isPlaying) sound.stop()
      },
      dispose: () => {
        if (sound.isPlaying) sound.stop()
        object3D.remove(sound)
      },
    }
  }

  // One-off positional stinger at a specific world position, not tied to a
  // persistent entity object — e.g. the BROKEN_OUT rush beat, or a one-time
  // "something moved behind you" cue during LENS_DOWN.
  const playPositionalOneShot = (bufferName, position, { volume = 1, refDistance = 1, maxDistance = 8 } = {}) => {
    const buffer = requireBuffer(bufferName)
    if (!buffer) return
    const anchor = new THREE.Object3D()
    anchor.position.copy(position)
    camera.parent ? camera.parent.add(anchor) : listener.add(anchor) // fallback if camera has no parent scene ref
    const sound = new THREE.PositionalAudio(listener)
    sound.setBuffer(buffer)
    sound.setVolume(volume)
    sound.setRefDistance(refDistance)
    sound.setMaxDistance(maxDistance)
    sound.setDistanceModel('inverse')
    anchor.add(sound)
    sound.play()
    sound.onEnded = () => {
      anchor.parent && anchor.parent.remove(anchor)
    }
  }

  // -------------------------------------------------------------------------
  // 2. Ambient beds — room tone, the "wrong hum" under phone calls, etc.
  //    Only one plays at a time; switching crossfades rather than hard-cuts,
  //    since a hard cut reads as a bug, not a scare.
  // -------------------------------------------------------------------------

  const playAmbient = (bufferName, { volume = 0.5, fadeSeconds = 1.5, loop = true } = {}) => {
    const buffer = requireBuffer(bufferName)
    if (!buffer) return
    if (currentAmbient && currentAmbient.name === bufferName) return // already playing

    const incoming = new THREE.Audio(listener)
    incoming.setBuffer(buffer)
    incoming.setLoop(loop)
    incoming.setVolume(0)
    incoming.play()

    const outgoing = currentAmbient
    currentAmbient = { name: bufferName, sound: incoming }

    if (ambientFadeRAF) cancelAnimationFrame(ambientFadeRAF)
    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / (fadeSeconds * 1000))
      incoming.setVolume(t * volume)
      if (outgoing) outgoing.sound.setVolume((1 - t) * (outgoing.sound.getVolume() || volume))
      if (t < 1) {
        ambientFadeRAF = requestAnimationFrame(step)
      } else if (outgoing) {
        outgoing.sound.stop()
      }
    }
    ambientFadeRAF = requestAnimationFrame(step)
  }

  const stopAmbient = ({ fadeSeconds = 1 } = {}) => {
    if (!currentAmbient) return
    const outgoing = currentAmbient
    currentAmbient = null
    const startVol = outgoing.sound.getVolume()
    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / (fadeSeconds * 1000))
      outgoing.sound.setVolume(startVol * (1 - t))
      if (t < 1) requestAnimationFrame(step)
      else outgoing.sound.stop()
    }
    requestAnimationFrame(step)
  }

  // Temporarily duck the ambient bed under a call/notification VO, then
  // restore it — used so Elusiv3's calls always read as cutting through
  // the room, not competing with it.
  const duckAmbient = (targetVolume = 0.15, { fadeSeconds = 0.4 } = {}) => {
    if (!currentAmbient) return () => {}
    const original = currentAmbient.sound.getVolume()
    currentAmbient.sound.setVolume(targetVolume)
    return () => { if (currentAmbient) currentAmbient.sound.setVolume(original) }
  }

  // -------------------------------------------------------------------------
  // 3. One-shot SFX — shutter click, capture flash, whiffed shutter, etc.
  //    Fire-and-forget, several can overlap without stepping on each other.
  // -------------------------------------------------------------------------

  const playOneShot = (bufferName, { volume = 1 } = {}) => {
    const buffer = requireBuffer(bufferName)
    if (!buffer) return
    const sound = new THREE.Audio(listener)
    sound.setBuffer(buffer)
    sound.setVolume(volume)
    sound.play()
    sound.onEnded = () => { sound.disconnect() }
  }

  // -------------------------------------------------------------------------
  // 4. Call/notification overlay audio — static bed + fragmented VO snippets,
  //    ducking the ambient room tone for the duration.
  // -------------------------------------------------------------------------

  // `staticBuffer` loops under the call; `voLines` is an array of buffer
  // names played in sequence with silence gaps between them (the "cut off
  // mid-sentence" pacing from the story bible's call scripts). Returns a
  // stop() to hang up early if the player/game needs to interrupt it.
  const playCall = (staticBufferName, voLines = [], { lineGapMs = 700, staticVolume = 0.4 } = {}) => {
    const restoreAmbient = duckAmbient(0.1)
    const staticBuffer = requireBuffer(staticBufferName)
    let staticSound = null
    if (staticBuffer) {
      staticSound = new THREE.Audio(listener)
      staticSound.setBuffer(staticBuffer)
      staticSound.setLoop(true)
      staticSound.setVolume(staticVolume)
      staticSound.play()
    }

    let cancelled = false
    const timeouts = []

    const playSequence = async () => {
      for (const line of voLines) {
        if (cancelled) return
        playOneShot(line, { volume: 1 })
        // Rough gap between fragments — tune per-line if some clips are longer.
        await new Promise((resolve) => {
          const id = setTimeout(resolve, lineGapMs)
          timeouts.push(id)
        })
      }
    }
    playSequence()

    const stop = () => {
      cancelled = true
      timeouts.forEach(clearTimeout)
      if (staticSound && staticSound.isPlaying) staticSound.stop()
      restoreAmbient()
    }

    return { stop }
  }

  return {
    load,
    attachEntityCue,
    playPositionalOneShot,
    playAmbient,
    stopAmbient,
    duckAmbient,
    playOneShot,
    playCall,
    listener,
  }
}
