import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

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
    varying vec2 vUv;

    // Cheap pseudo-random for film grain.
    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Desaturate toward baseline, less desaturated during a flash.
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float desatAmount = mix(0.85, 0.15, uFlash);
      color.rgb = mix(color.rgb, vec3(gray), desatAmount);

      // Cold, slightly sickly tint for the "haunted" baseline.
      vec3 tint = vec3(0.75, 0.95, 1.0);
      color.rgb *= mix(tint, vec3(1.0), uFlash);

      // Vignette: strong at baseline, pulls back during a flash.
      vec2 centered = vUv - 0.5;
      float vignette = 1.0 - dot(centered, centered) * mix(2.2, 0.4, uFlash);
      vignette = clamp(vignette, 0.0, 1.0);
      color.rgb *= vignette;

      // Overall exposure: dark baseline, brightened during a flash.
      float exposure = mix(0.35, 1.15, uFlash);
      color.rgb *= exposure;

      // Film grain, constant texture regardless of flash state.
      float grain = (rand(vUv * uTime) - 0.5) * 0.06;
      color.rgb += grain;

      gl_FragColor = vec4(color.rgb, color.a);
    }
  `,
};

export const createHauntedVision = ({
  renderer,
  scene,
  camera,
  width,
  height,
}) => {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const shaderPass = new ShaderPass(hauntedShader);
  shaderPass.renderToScreen = true;
  composer.addPass(shaderPass);

  composer.setSize(width, height);

  let flashTarget = 0; // where uFlash is tweening toward
  const clock = new THREE.Clock();

  const setSize = (w, h) => composer.setSize(w, h);

  // Call every frame (from onUpdate) instead of renderer.render(scene, camera).
  const render = () => {
    shaderPass.uniforms.uTime.value = clock.getElapsedTime();

    // Ease uFlash toward its target so transitions feel like a beat, not a snap.
    const current = shaderPass.uniforms.uFlash.value;
    shaderPass.uniforms.uFlash.value += (flashTarget - current) * 0.15;

    composer.render();
  };

  // Trigger a scripted jump-scare flash: quick brighten, hold, snap back to dark.
  // durationMs: how long to stay bright before returning to the haunted baseline.
  const flash = (durationMs = 400) => {
    flashTarget = 1;
    setTimeout(() => {
      flashTarget = 0;
    }, durationMs);
  };

  return { render, setSize, flash };
};
