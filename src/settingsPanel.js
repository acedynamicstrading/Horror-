// ---------------------------------------------------------------------------
// Settings panel: brightness, "haunted" intensity, a glitch-effects
// accessibility toggle, and a debug-log visibility toggle. Persisted to
// localStorage — this is a real deployed web page (not a sandboxed Claude
// artifact), so localStorage is the right tool here, not in-memory-only
// state that resets on every reload.
//
// This module only wires up DOM elements that already exist in index.html
// (#settingsBtn, #settingsPanel, the input fields below) — it doesn't
// create any UI itself, same division of responsibility as captureSystem.js
// and its reticle/shutter elements.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ahh_settings_v1'

const DEFAULTS = {
  brightness: 0.55, // 0..1 -> hauntedShader.js's shadow-lift strength
  vignette: 0.4, // 0..1 -> darkness at the screen edges
  desaturation: 0.3, // 0..1 -> how much color gets pulled toward gray
  tint: 0.5, // 0..1 -> strength of the cold/sickly color tint
  grain: 0.3, // 0..1 -> film grain amount
  glitchEnabled: true,
  debugLog: true, // matches the debug panel's original always-on behavior
}

const loadSettings = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch (e) {
    return { ...DEFAULTS } // private browsing / storage disabled — fall back quietly
  }
}

const saveSettings = (settings) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    // Ignore — storage being unavailable shouldn't break the game.
  }
}

// hauntedVision: from hauntedShader.js's createHauntedVision() — needs
// setBrightness/setHauntIntensity/setGlitchEnabled (added alongside this
// panel). Debug-log visibility is applied via window.setDebugLogVisible(),
// defined in app.js right next to debugLog() itself.
export const initSettingsPanel = ({ hauntedVision }) => {
  const settings = loadSettings()

  const btn = document.getElementById('settingsBtn')
  const backdrop = document.getElementById('settingsBackdrop')
  const panel = document.getElementById('settingsPanel')
  const closeBtn = document.getElementById('settingsClose')
  const brightnessInput = document.getElementById('settingBrightness')
  const vignetteInput = document.getElementById('settingVignette')
  const desaturationInput = document.getElementById('settingDesaturation')
  const tintInput = document.getElementById('settingTint')
  const grainInput = document.getElementById('settingGrain')
  const glitchInput = document.getElementById('settingGlitch')
  const debugInput = document.getElementById('settingDebug')

  const apply = () => {
    if (hauntedVision) {
      if (hauntedVision.setBrightness) hauntedVision.setBrightness(settings.brightness)
      if (hauntedVision.setVignette) hauntedVision.setVignette(settings.vignette)
      if (hauntedVision.setDesaturation) hauntedVision.setDesaturation(settings.desaturation)
      if (hauntedVision.setTint) hauntedVision.setTint(settings.tint)
      if (hauntedVision.setGrain) hauntedVision.setGrain(settings.grain)
      if (hauntedVision.setGlitchEnabled) hauntedVision.setGlitchEnabled(settings.glitchEnabled)
    }
    if (window.setDebugLogVisible) window.setDebugLogVisible(settings.debugLog)
  }

  // Seed the inputs from whatever was loaded (or the defaults) before
  // wiring listeners, so the panel shows the actual current state the
  // moment it's opened rather than the raw HTML defaults.
  if (brightnessInput) brightnessInput.value = settings.brightness
  if (vignetteInput) vignetteInput.value = settings.vignette
  if (desaturationInput) desaturationInput.value = settings.desaturation
  if (tintInput) tintInput.value = settings.tint
  if (grainInput) grainInput.value = settings.grain
  if (glitchInput) glitchInput.checked = settings.glitchEnabled
  if (debugInput) debugInput.checked = settings.debugLog

  apply()

  const openPanel = () => {
    if (panel) panel.classList.add('open')
    if (backdrop) backdrop.classList.add('open')
  }
  const closePanel = () => {
    if (panel) panel.classList.remove('open')
    if (backdrop) backdrop.classList.remove('open')
  }

  if (btn) btn.addEventListener('click', openPanel)
  if (closeBtn) closeBtn.addEventListener('click', closePanel)
  if (backdrop) backdrop.addEventListener('click', closePanel)

  // One helper wires a range input to a settings key instead of repeating
  // the same five lines five times.
  const wireRange = (input, key) => {
    if (!input) return
    input.addEventListener('input', (e) => {
      settings[key] = parseFloat(e.target.value)
      saveSettings(settings)
      apply()
    })
  }
  wireRange(brightnessInput, 'brightness')
  wireRange(vignetteInput, 'vignette')
  wireRange(desaturationInput, 'desaturation')
  wireRange(tintInput, 'tint')
  wireRange(grainInput, 'grain')

  if (glitchInput) {
    glitchInput.addEventListener('change', (e) => {
      settings.glitchEnabled = e.target.checked
      saveSettings(settings)
      apply()
    })
  }
  if (debugInput) {
    debugInput.addEventListener('change', (e) => {
      settings.debugLog = e.target.checked
      saveSettings(settings)
      apply()
    })
  }

  // Exposed so the browser console can print the current live values —
  // e.g. after tuning on-device, run `settingsPanel.getSettings()` (see
  // app.js, which stores the return value on window for exactly this) and
  // read off the numbers to report back as the new defaults.
  return { getSettings: () => ({ ...settings }) }
}
