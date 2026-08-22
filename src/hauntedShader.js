import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

// ---------------------------------------------------------------------------
// "Ghost-sight" post-process shader.
//
// The real room stays normally lit (AR/SLAM tracking needs that). This pass
// is what makes the *screen* look like a haunted dimension regardless of the
// real world's actual brightness: a dark vignette/desaturation/grain
// baseline, with a uFlash uniform that game logic can tween up briefly for
// scripted jump-scare "flash" beats (proximity, timers, item use, monster
// abilities — never real ambient light).
//
// uBrightness / uHauntIntensity are user-adjustable (settingsPanel.js) —
// baseline exposure and vignette/desaturation strength are computed from
// them instead of being fixed constants, so a player who finds the default
// too dark (or not moody enough) can tune it live instead of it being a
// one-size-fits-all guess baked into the shader.
// ---------------------------------------------------------------------------

const hauntedShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    // 0 = fully dark/haunted baseline. 1 = fully bright/revealed (flash peak).
    uFlash: { value: 0 },
    // 0 = normal. 1 = "signal disrupted" glitch state — used when SLAM
    // tracking gets lost/reset (e.g. walking into an unscanned room), so the
    // moment reads as in-fiction interference rather than a broken app.
    uGlitch: { value: 0 },
    // 0..1 user setting -> shadow-lift strength (gamma curve, not a linear
    // multiply — a linear multiply is too weak to rescue a genuinely dark
    // real-world room, which is exactly the case that needs this control).
    uBrightness: { value: 0.5 },
    // 0..1 user setting -> vignette darkness at the screen edges. Was
    // previously coupled to desaturation under one "Haunted Intensity"
    // slider — split out since a player fighting a too-dark screen needs to
    // cut vignette without also having to give up the desaturated look.
    uVignette: { value: 0.5 },
    // 0..1 user setting -> how much color gets pulled toward grayscale.
    uDesaturation: { value: 0.3 },
    // 0..1 user setting -> strength of the cold/sickly color tint.
    uTint: { value: 0.5 },
    // 0..1 user setting -> film grain amount.
    uGrain: { value: 0.3 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uFlash;
    uniform float uGlitch;
    uniform float uBrightness;
    uniform float uVignette;
    uniform float uDesaturation;
    uniform float uTint;
    uniform float uGrain;
    varying vec2 vUv;

    // Cheap pseudo-random for film grain / glitch noise.
    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;

      if (uGlitch > 0.0) {
        // Chunky horizontal row displacement — the classic "signal breaking
        // up" look, not a smooth effect.
        float band = floor(uv.y * 24.0);
        float bandNoise = rand(vec2(band, floor(uTime * 14.0)));
        float shift = (bandNoise - 0.5) * 0.06 * uGlitch;
        uv.x += shift;
      }

      vec4 color = texture2D(tDiffuse, uv);

      if (uGlitch > 0.0) {
        // RGB channel split — sample red/blue from slightly offset UVs.
        float split = 0.006 * uGlitch;
        color.r = texture2D(tDiffuse, uv + vec2(split, 0.0)).r;
        color.b = texture2D(tDiffuse, uv - vec2(split, 0.0)).b;

        // Occasional near-total dropout, like a dropped frame.
        float dropout = step(0.93, rand(vec2(floor(uTime * 20.0), 1.0)));
        color.rgb *= 1.0 - dropout * 0.85 * uGlitch;
      }

      // Desaturate toward baseline, less desaturated during a flash.
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float desatAmount = mix(uDesaturation, uDesaturation * 0.35, uFlash);
      color.rgb = mix(color.rgb, vec3(gray), desatAmount);

      // Cold, slightly sickly tint for the "haunted" baseline — uTint
      // controls how much of it applies (0 = no tint at all).
      vec3 tintColor = vec3(0.8, 0.97, 1.0);
      vec3 tint = mix(vec3(1.0), tintColor, uTint);
      color.rgb *= mix(tint, vec3(1.0), uFlash);

      // Vignette: strong at baseline, pulls back during a flash.
      vec2 centered = vUv - 0.5;
      float vignetteStrength = uVignette * 1.2;
      float vignette = 1.0 - dot(centered, centered) * mix(vignetteStrength, vignetteStrength * 0.3, uFlash);
      vignette = clamp(vignette, 0.0, 1.0);
      color.rgb *= vignette;

      // Shadow lift: a gamma curve, not a linear multiply — a multiply can
      // only ever scale a dark pixel by a fixed factor (weak in a genuinely
      // dark real room), where a gamma curve actively lifts shadows toward
      // midtones without blowing out whatever's already bright. uBrightness
      // 0 = no lift (gamma 1.0), 1 = strong lift (gamma 0.35).
      float gamma = mix(1.0, 0.35, uBrightness);
      color.rgb = pow(max(color.rgb, 0.0001), vec3(gamma));
      // Flash still adds a further brighten on top, same as before.
      color.rgb *= mix(1.0, 1.35, uFlash);

      // Film grain, constant texture regardless of flash state. Amplified
      // during a glitch for extra "static" texture.
      float grainAmount = mix(uGrain * 0.18, uGrain * 0.3, uGlitch);
      float grain = (rand(vUv * uTime) - 0.5) * grainAmount;
      color.rgb += grain;

      gl_FragColor = vec4(color.rgb, color.a);
    }
  `,
}

export const createHauntedVision = ({ renderer, scene, camera, width, height }) => {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const shaderPass = new ShaderPass(hauntedShader)
  shaderPass.renderToScreen = true
  composer.addPass(shaderPass)

  composer.setSize(width, height)

  let flashTarget = 0 // where uFlash is tweening toward
  // When false, setGlitch()/portalOpen()'s glitch burst is suppressed
  // entirely (settingsPanel.js's "Glitch Effects" toggle) — some players
  // find the RGB-split/row-displacement look uncomfortable, so this is a
  // real accessibility switch, not just a visual preference.
  let glitchEnabled = true
  const clock = new THREE.Clock()

  const setSize = (w, h) => composer.setSize(w, h)

  // Call every frame (from onUpdate) instead of renderer.render(scene, camera).
  const render = () => {
    shaderPass.uniforms.uTime.value = clock.getElapsedTime()

    // Ease uFlash toward its target so transitions feel like a beat, not a snap.
    const current = shaderPass.uniforms.uFlash.value
    shaderPass.uniforms.uFlash.value += (flashTarget - current) * 0.15

    composer.render()
  }

  // Trigger a scripted jump-scare flash: quick brighten, hold, snap back to dark.
  // durationMs: how long to stay bright before returning to the haunted baseline.
  const flash = (durationMs = 400) => {
    flashTarget = 1
    setTimeout(() => {
      flashTarget = 0
    }, durationMs)
  }

  // The "portal opening" reveal, once enough of the room has been scanned.
  // Same flash() mechanism for the deliberate hold (a discovery beat, not a
  // jump scare), layered with a brief glitch burst right at the start — the
  // breach tearing open should read as a disruption, not a clean fade-in.
  const portalOpen = (durationMs = 1200) => {
    flash(durationMs)
    setGlitch(true)
    setTimeout(() => setGlitch(false), Math.min(450, durationMs))
  }

  // Toggles the "signal disrupted" glitch look — used when SLAM tracking
  // gets lost/reset (e.g. player walked into an unscanned room) and by
  // portalOpen() above. Instant, not eased — glitches should look abrupt,
  // not smooth. No-ops (forces off) while glitchEnabled is false.
  const setGlitch = (active) => {
    shaderPass.uniforms.uGlitch.value = active && glitchEnabled ? 1 : 0
  }

  // settingsPanel.js hooks — 0..1 inputs, clamped defensively since these
  // come straight off a <input type="range"> value.
  const setBrightness = (v) => {
    shaderPass.uniforms.uBrightness.value = Math.min(1, Math.max(0, v))
  }
  const setVignette = (v) => {
    shaderPass.uniforms.uVignette.value = Math.min(1, Math.max(0, v))
  }
  const setDesaturation = (v) => {
    shaderPass.uniforms.uDesaturation.value = Math.min(1, Math.max(0, v))
  }
  const setTint = (v) => {
    shaderPass.uniforms.uTint.value = Math.min(1, Math.max(0, v))
  }
  const setGrain = (v) => {
    shaderPass.uniforms.uGrain.value = Math.min(1, Math.max(0, v))
  }
  const setGlitchEnabled = (enabled) => {
    glitchEnabled = !!enabled
    if (!glitchEnabled) shaderPass.uniforms.uGlitch.value = 0
  }

  return {
    render,
    setSize,
    flash,
    portalOpen,
    setGlitch,
    setBrightness,
    setVignette,
    setDesaturation,
    setTint,
    setGrain,
    setGlitchEnabled,
  }
}
