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
  brightness: 0.5, // 0..1 -> hauntedShader.js's baseline exposure lift
  hauntIntensity: 0.6, // 0..1 -> vignette + desaturation strength
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
  const hauntInput = document.getElementById('settingHaunt')
  const glitchInput = document.getElementById('settingGlitch')
  const debugInput = document.getElementById('settingDebug')

  const apply = () => {
    if (hauntedVision) {
      if (hauntedVision.setBrightness) hauntedVision.setBrightness(settings.brightness)
      if (hauntedVision.setHauntIntensity) hauntedVision.setHauntIntensity(settings.hauntIntensity)
      if (hauntedVision.setGlitchEnabled) hauntedVision.setGlitchEnabled(settings.glitchEnabled)
    }
    if (window.setDebugLogVisible) window.setDebugLogVisible(settings.debugLog)
  }

  // Seed the inputs from whatever was loaded (or the defaults) before
  // wiring listeners, so the panel shows the actual current state the
  // moment it's opened rather than the raw HTML defaults.
  if (brightnessInput) brightnessInput.value = settings.brightness
  if (hauntInput) hauntInput.value = settings.hauntIntensity
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

  if (brightnessInput) {
    brightnessInput.addEventListener('input', (e) => {
      settings.brightness = parseFloat(e.target.value)
      saveSettings(settings)
      apply()
    })
  }
  if (hauntInput) {
    hauntInput.addEventListener('input', (e) => {
      settings.hauntIntensity = parseFloat(e.target.value)
      saveSettings(settings)
      apply()
    })
  }
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

  return { getSettings: () => ({ ...settings }) }
}
