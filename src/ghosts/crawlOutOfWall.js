// ---------------------------------------------------------------------------
// A placeholder "crawling ghost" — built from primitives for now (no rigged
// glTF asset yet), animated procedurally: starts hidden inside the surface,
// lurches outward along the surface normal, then either lingers briefly or
// retreats back in. Good enough to validate the emergence mechanic and the
// scare-trigger timing; swap the primitive group for a real skinned model
// (GLTFLoader + AnimationMixer) once one exists.
// ---------------------------------------------------------------------------

import * as THREE from "three";

const EMERGE_SECONDS = 1.1;
const LINGER_SECONDS = 0.9;
const RETREAT_SECONDS = 0.6;
// How far into the emergence (0-1) the "reveal peak" sits — this is the
// instant the jump-scare flash should fire, timed to the scariest moment
// of the motion rather than the very start or end.
const REVEAL_PEAK_PROGRESS = 0.55;

const buildGhostMesh = () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xc9d6d6,
    emissive: 0x1a2222,
    roughness: 0.85,
  });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), material);
  head.position.y = 0.55;

  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.14, 0.5, 10),
    material
  );
  torso.position.y = 0.25;

  const armGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8);
  const armL = new THREE.Mesh(armGeo, material);
  armL.position.set(-0.16, 0.3, 0);
  armL.rotation.z = Math.PI / 5;
  const armR = new THREE.Mesh(armGeo, material);
  armR.position.set(0.16, 0.3, 0);
  armR.rotation.z = -Math.PI / 5;

  group.add(head, torso, armL, armR);
  return group;
};

// easeOutCubic — sells a "lurching pull" feel better than linear interpolation.
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const createCrawlGhost = ({ onRevealPeak, onDespawn }) => {
  const mesh = buildGhostMesh();
  mesh.visible = false;

  let state = "idle"; // idle -> emerging -> lingering -> retreating -> idle
  let elapsed = 0;
  let revealFired = false;
  let normal = new THREE.Vector3(0, 1, 0);
  let surfacePoint = new THREE.Vector3();

  const EMERGE_DEPTH = 0.45; // how far "inside" the wall the ghost starts

  const spawnAt = (point, surfaceNormal) => {
    surfacePoint = point.clone();
    normal = surfaceNormal.clone().normalize();

    // Orient the ghost so it faces outward along the surface normal.
    const lookTarget = point.clone().add(normal);
    mesh.position.copy(point);
    mesh.up.set(0, 1, 0);
    mesh.lookAt(lookTarget);

    mesh.visible = true;
    mesh.scale.setScalar(0.05);
    state = "emerging";
    elapsed = 0;
    revealFired = false;
  };

  const update = (delta) => {
    if (state === "idle") return;
    elapsed += delta;

    if (state === "emerging") {
      const t = Math.min(elapsed / EMERGE_SECONDS, 1);
      const eased = easeOutCubic(t);

      mesh.scale.setScalar(0.05 + 0.95 * eased);
      // Pull the ghost from inside the surface (pushed back along -normal)
      // out to its resting point on top of the surface.
      const depth = EMERGE_DEPTH * (1 - eased);
      mesh.position.copy(surfacePoint).addScaledVector(normal, -depth);

      // Small jittery lurch, not smooth — reads as "crawling", not floating.
      mesh.rotation.z = Math.sin(elapsed * 18) * 0.05 * (1 - eased);

      if (!revealFired && t >= REVEAL_PEAK_PROGRESS) {
        revealFired = true;
        if (onRevealPeak) onRevealPeak();
      }

      if (t >= 1) {
        state = "lingering";
        elapsed = 0;
      }
      return;
    }

    if (state === "lingering") {
      // Subtle idle tremor while it "looks at" the player.
      mesh.rotation.y = Math.sin(elapsed * 6) * 0.03;
      if (elapsed >= LINGER_SECONDS) {
        state = "retreating";
        elapsed = 0;
      }
      return;
    }

    if (state === "retreating") {
      const t = Math.min(elapsed / RETREAT_SECONDS, 1);
      const eased = t * t; // ease-in — retreat feels like it's being yanked back
      mesh.scale.setScalar(1 - 0.95 * eased);
      const depth = EMERGE_DEPTH * eased;
      mesh.position.copy(surfacePoint).addScaledVector(normal, -depth);

      if (t >= 1) {
        mesh.visible = false;
        state = "idle";
        if (onDespawn) onDespawn();
      }
    }
  };

  const isActive = () => state !== "idle";

  return { mesh, spawnAt, update, isActive };
};
