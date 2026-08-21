import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

// ---------------------------------------------------------------------------
// "Ghost-sight" post-process shader.
//
// The real room stays normally lit (AR/SLAM tracking needs that). This pass
// is what makes the *screen* look like a haunted dimension regardless of the
// real world's actual brightness: a constant dark vignette/desaturation/grain
// baseline, with a uFlash uniform that game logic can tween up briefly for
// scripted jump-scare "flash" beats (proximity, timers, item use, monster
// abilities — never real ambient light).
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
      float desatAmount = mix(0.45, 0.15, uFlash);
      color.rgb = mix(color.rgb, vec3(gray), desatAmount);

      // Cold, slightly sickly tint for the "haunted" baseline.
      vec3 tint = vec3(0.75, 0.95, 1.0);
      color.rgb *= mix(tint, vec3(1.0), uFlash);

      // Vignette: strong at baseline, pulls back during a flash.
      vec2 centered = vUv - 0.5;
      float vignette = 1.0 - dot(centered, centered) * mix(1.3, 0.4, uFlash);
      vignette = clamp(vignette, 0.0, 1.0);
      color.rgb *= vignette;

      // Overall exposure: dark baseline, brightened during a flash.
      float exposure = mix(0.75, 1.15, uFlash);
      color.rgb *= exposure;

      // Film grain, constant texture regardless of flash state. Amplified
      // during a glitch for extra "static" texture.
      float grainAmount = mix(0.06, 0.16, uGlitch);
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

  // The "portal opening" reveal, once enough of the room has been scanned —
  // same mechanism as flash(), just a longer, more deliberate hold to read
  // as a discovery beat rather than a jump scare.
  const portalOpen = (durationMs = 1200) => flash(durationMs)

  // Toggles the "signal disrupted" glitch look — used when SLAM tracking
  // gets lost/reset (e.g. player walked into an unscanned room). Instant,
  // not eased — glitches should look abrupt, not smooth.
  const setGlitch = (active) => {
    shaderPass.uniforms.uGlitch.value = active ? 1 : 0
  }

  return { render, setSize, flash, portalOpen, setGlitch }
}
