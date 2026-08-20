import * as THREE from "three";
import { createHauntedVision } from "./hauntedShader";

// 8th Wall's Threejs pipeline module expects a global window.THREE
// (it assumes script-tag usage), but webpack keeps our import module-scoped.
// Expose it globally so XR8.Threejs.pipelineModule() can find it.
window.THREE = THREE;

// ---------------------------------------------------------------------------
// On-screen debug logger. Prints errors directly on the page so they're
// visible on a phone without needing devtools.
// ---------------------------------------------------------------------------
const debugLog = (msg) => {
  const el = document.getElementById("debug");
  if (!el) return;
  el.style.display = "block";
  el.textContent += msg + "\n\n";
};

window.onerror = (message, source, lineno, colno, error) => {
  debugLog(
    `ERROR: ${message}\nat ${source}:${lineno}:${colno}\n${ error && error.stack ? error.stack : "" }`
  );
};
window.addEventListener("unhandledrejection", (event) => {
  debugLog(`UNHANDLED PROMISE REJECTION: ${event.reason}`);
});

// If window.XR8 never shows up, tell us — means xr.js loaded but never
// initialized (e.g. SLAM chunk failed to load).
setTimeout(() => {
  if (!window.XR8) {
    debugLog(
      "window.XR8 is still undefined 6s after page load. The engine script likely failed to initialize."
    );
  }
}, 6000);

// ---------------------------------------------------------------------------
// Custom Three.js pipeline module.
// ---------------------------------------------------------------------------
const initScenePipelineModule = () => {
  let scene, camera, renderer, hauntedVision;
  const placedProps = [];

  const placeholderPropAt = (position) => {
    const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const material = new THREE.MeshStandardMaterial({ color: 0x8a5a3b });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.copy(position);
    scene.add(cube);
    placedProps.push(cube);
  };

  const onHitTestResult = (hitResult) => {
    if (!hitResult) return;
    const { position } = hitResult;
    placeholderPropAt(new THREE.Vector3(position.x, position.y, position.z));
  };

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const { pageX, pageY } = e.touches[0];
    const results = window.XR8.XrController.hitTest(pageX, pageY, [
      "FEATURE_POINT",
      "ESTIMATED_SURFACE",
    ]);
    if (results.length > 0) {
      onHitTestResult(results[0]);
    }
  };

  const resizeCanvas = (canvas) => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  };

  return {
    name: "haunted-house-scene",

    onStart: ({ canvas, canvasWidth, canvasHeight }) => {
      debugLog("onStart fired — scene initializing.");
      const {
        camera: xrCamera,
        scene: xrScene,
        renderer: xrRenderer,
      } = window.XR8.Threejs.xrScene();
      scene = xrScene;
      camera = xrCamera;
      renderer = xrRenderer;

      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const directional = new THREE.DirectionalLight(0xffffff, 0.8);
      directional.position.set(0, 3, 1);
      scene.add(directional);

      renderer.setSize(canvasWidth, canvasHeight);
      camera.aspect = canvasWidth / canvasHeight;
      camera.updateProjectionMatrix();

      hauntedVision = createHauntedVision({
        renderer,
        scene,
        camera,
        width: canvasWidth,
        height: canvasHeight,
      });
      // Expose the flash trigger globally so game logic anywhere (proximity
      // checks, timers, item-use handlers, monster abilities) can call
      // window.hauntedVision.flash() for a scripted jump-scare beat.
      window.hauntedVision = hauntedVision;

      resizeCanvas(canvas);
      window.addEventListener("resize", () => {
        resizeCanvas(canvas);
        hauntedVision.setSize(window.innerWidth, window.innerHeight);
      });

      canvas.addEventListener("touchstart", onTouchStart, true);

      window.XR8.XrController.recenter();
    },

    // Runs every frame. Drawing here (after 8th Wall's own Threejs pipeline
    // module has already rendered the plain scene) means our post-processed,
    // "haunted" composite is what actually ends up on screen.
    onUpdate: () => {
      if (hauntedVision) hauntedVision.render();
    },
  };
};

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
const onxrloaded = () => {
  try {
    debugLog(
      "xrloaded fired. window.XR8 is present, wiring up pipeline modules..."
    );

    window.XR8.addCameraPipelineModules([
      window.XR8.GlTextureRenderer.pipelineModule(),
      window.XR8.Threejs.pipelineModule(),
      window.XR8.XrController.pipelineModule(),
      initScenePipelineModule(),
    ]);

    const canvas = document.getElementById("camerafeed");
    debugLog("Calling XR8.run()...");
    window.XR8.run({
      canvas,
      allowedDevices: window.XR8.XrConfig.device().ANY,
    });
    debugLog("XR8.run() called without throwing.");
  } catch (err) {
    debugLog(`CAUGHT ERROR in onxrloaded: ${err.message}\n${err.stack}`);
  }
};

debugLog(
  `Page script started. window.XR8 present at script-run time: ${!!window.XR8}`
);

window.XR8 ? onxrloaded() : window.addEventListener("xrloaded", onxrloaded);
