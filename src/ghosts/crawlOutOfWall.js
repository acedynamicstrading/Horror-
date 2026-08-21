// ---------------------------------------------------------------------------
// A "crawling ghost" — placeholder primitives for now (no rigged glTF asset
// yet), animated procedurally: starts hidden inside the surface, lurches
// outward along the surface normal, then either lingers briefly or retreats.
//
// TWO-PHASE ENCOUNTER RULE: an entity's FIRST reveal is always a pure jump
// scare — it is never capturable at that moment, no matter what UI/reticle
// system sits on top of this later. After lingering, instead of retreating
// back into the same spot, it flees toward a different surface point
// (supplied by the caller via fleeToPoint) and goes dormant there. Only on
// a SUBSEQUENT spawnAt() call — i.e. the player finding it again wherever it
// fled to — does it become capturable (isCapturable() returns true). This
// mirrors the story's "you can't fight what you glimpsed, you have to go
// find it" rule rather than making every sighting an immediate fight.
// ---------------------------------------------------------------------------

import * as THREE from "three";

const EMERGE_SECONDS = 1.1;
const LINGER_SECONDS = 0.9;
const RETREAT_SECONDS = 0.6;
const FLEE_SECONDS = 0.5;
const CAPTURE_SECONDS = 0.4; // pull-into-screen animation on a successful capture
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

// onNeedFleeTarget: () => {position, normal} | null — called when this ghost
// needs somewhere to flee to after its first reveal. Caller (scareSystem)
// should hand back a different point from the surface pool, excluding the
// point it just emerged from. If null (no other point sampled yet), the
// ghost falls back to the old retreat-into-same-spot behavior for that cycle.
export const createCrawlGhost = ({ onRevealPeak, onDespawn, onNeedFleeTarget }) => {
  const mesh = buildGhostMesh();
  mesh.visible = false;

  // idle -> emerging -> lingering -> (fleeing | retreating) -> idle
  let state = "idle";
  let elapsed = 0;
  let revealFired = false;
  let normal = new THREE.Vector3(0, 1, 0);
  let surfacePoint = new THREE.Vector3();
  let fleeTarget = null; // {position, normal} — set when a flee is in progress
  let hasBeenRevealedOnce = false; // flips true after the first full reveal
  let capturable = false; // true only once this ghost has fled at least once
  let isRefindSpawn = false; // computed at spawnAt() — is THIS spawn a re-find?
  let captureDirection = null; // set by forceCapture() — direction to pull toward on capture

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
    // Whether THIS spawn is a re-find is knowable right away (it's just
    // whether a prior cycle already fled once) — captured here so the
    // lingering-exit branch below doesn't have to re-derive it later.
    isRefindSpawn = hasBeenRevealedOnce;
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
        // Capturable status for this encounter is locked in right at the
        // scare beat: this is only ever true if a PRIOR cycle already fled
        // once (hasBeenRevealedOnce was set true at the end of that cycle).
        capturable = hasBeenRevealedOnce;
        if (onRevealPeak) onRevealPeak({ capturable });
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
        if (isRefindSpawn) {
          // This is a capturable re-find: hand control to the capture
          // system rather than auto-fleeing on a fixed timer. It just
          // waits here (still trembling, still capturable) until an
          // external forceCapture() or breakOut() call resolves it.
          state = "held";
          elapsed = 0;
          return;
        }
        if (!hasBeenRevealedOnce) {
          // First-ever reveal just finished lingering: flee to a new spot
          // instead of retreating into this one. Mark hasBeenRevealedOnce
          // so the NEXT spawnAt() at the flee target is capturable.
          fleeTarget = onNeedFleeTarget ? onNeedFleeTarget() : null;
          if (fleeTarget) {
            state = "fleeing";
            elapsed = 0;
            hasBeenRevealedOnce = true;
            return;
          }
          // No flee target available yet (room barely scanned) — fall back
          // to retreating into the same spot, and DON'T mark
          // hasBeenRevealedOnce, so it still counts as "first reveal" next
          // time and gets another chance to flee once more of the room is
          // known.
        }
        state = "retreating";
        elapsed = 0;
      }
      return;
    }

    if (state === "held") {
      // Waiting on the capture system (captureSystem.js) to resolve this
      // encounter via forceCapture() or breakOut() — see those methods
      // below. Keep a slightly more agitated tremor than plain lingering
      // so it reads as "cornered," not "idle."
      mesh.rotation.y = Math.sin(elapsed * 9) * 0.05;
      mesh.rotation.z = Math.sin(elapsed * 13) * 0.02;
      return;
    }

    if (state === "captured") {
      // Quick pull-toward-camera-and-shrink — reads as "sucked into the
      // lens," distinct from fleeing's "bolts sideways and phases out."
      const t = Math.min(elapsed / CAPTURE_SECONDS, 1);
      const eased = t * t; // ease-in, fast at the end
      mesh.scale.setScalar(1 - eased);
      if (captureDirection) {
        mesh.position.copy(surfacePoint).addScaledVector(captureDirection, eased * 0.35);
      }
      if (t >= 1) {
        mesh.visible = false;
        state = "idle";
        // fledTo is always null here — a captured ghost is gone for good,
        // not a hiding spot to re-register with the scare scheduler.
        if (onDespawn) onDespawn({ fledTo: null, captured: true });
      }
      return;
    }

    if (state === "fleeing") {
      // Quick phase-out at the current spot (unlike the slower retreat) —
      // reads as "bolting", not "giving up and sinking back in".
      const t = Math.min(elapsed / FLEE_SECONDS, 1);
      const eased = t * t * t; // fast ease-in — abrupt, panicked
      mesh.scale.setScalar(1 - eased);
      mesh.position.copy(surfacePoint).addScaledVector(normal, -EMERGE_DEPTH * eased * 0.3);

      if (t >= 1) {
        mesh.visible = false;
        state = "idle";
        // Despawn callback carries the flee target along so scareSystem can
        // register it as this ghost's new, now-capturable hiding spot.
        if (onDespawn) onDespawn({ fledTo: fleeTarget });
        fleeTarget = null;
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
        if (onDespawn) onDespawn({ fledTo: null });
      }
    }
  };

  const isActive = () => state !== "idle";
  // True only while lingering/held/fleeing/retreating on a spawn that was
  // itself a re-find (i.e. hasBeenRevealedOnce was already true when this
  // spawnAt() happened). Whatever UI drives the reticle/capture-meter
  // should gate off this — don't allow a capture attempt to start unless
  // it's true.
  const isCapturable = () => capturable;
  // True only while this ghost is in the "held" state — i.e. actually
  // waiting on the capture system to resolve it. captureSystem.js should
  // only advance its progress meter / attempt a capture / trigger a
  // timeout breakout while this is true; isCapturable() alone isn't
  // enough since it stays true through the emerging/lingering animation
  // too, before the encounter is actually capture-ready.
  const isHeld = () => state === "held";

  // Called by captureSystem.js when the player successfully completes a
  // capture (progress meter full + shutter tap while still framed).
  // cameraPosition is used to pick a pull direction so the "sucked into
  // the lens" animation reads as pulling toward the player, not a fixed
  // world direction.
  const forceCapture = (cameraPosition) => {
    if (state !== "held") return false;
    captureDirection = cameraPosition
      ? cameraPosition.clone().sub(mesh.position).normalize()
      : normal.clone().negate();
    state = "captured";
    elapsed = 0;
    return true;
  };

  // Called by captureSystem.js when the capture timer runs out before the
  // progress meter fills — the "timeout" fail state. Relocates the ghost
  // to a new hiding spot the same way a first-reveal flee does, via the
  // caller-supplied onNeedFleeTarget, and stays capturable there (this
  // isn't a lost encounter, just a meaner, relocated one).
  const breakOut = () => {
    if (state !== "held") return false;
    fleeTarget = onNeedFleeTarget ? onNeedFleeTarget() : null;
    if (!fleeTarget) return false; // nowhere to send it — caller should retry shortly
    state = "fleeing";
    elapsed = 0;
    return true;
  };

  return { mesh, spawnAt, update, isActive, isCapturable, isHeld, forceCapture, breakOut };
};
