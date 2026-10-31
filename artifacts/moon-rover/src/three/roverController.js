/**
 * Rover Controller
 * Keyboard + autonomous path-following physics.
 * Hard crater/debris collision guard — rover NEVER enters a crater.
 */

import { useRef, useEffect, useCallback } from 'react';
import { getTerrainHeight, TERRAIN_SIZE, CRATERS } from './terrainGenerator';

const MAX_SPEED    = 8;
const ACCEL        = 6;
const DECEL        = 5;
const TURN_SPD     = 2.2;
const HALF         = TERRAIN_SIZE / 2 - 2;
const AUTO_SPD     = 6.0;
const MIN_AUTO_SPD = 0.3;   // m/s — lets the rover pivot without stalling
// Pure-pursuit parameters (metres / seconds) — independent of path point spacing
const LOOKAHEAD_MIN  = 3.0;  // m
const LOOKAHEAD_TIME = 1.0;  // s of travel at current speed
const ARRIVE_DIST    = 1.5;  // m of path left → arrive
const SEARCH_SEGS    = 40;   // segments searched ahead of the last projection
const ROVER_SCALE  = 1.67;
const ROVER_Y_OFF  = 0.135 * ROVER_SCALE + 0.05;

// ---- Hard crater guard ----
// Returns true if a world position is inside a crater bowl (impassable).
function insideCrater(wx, wz) {
  for (const c of CRATERS) {
    const d = Math.sqrt((wx - c.x) ** 2 + (wz - c.z) ** 2);
    // Treat the inner bowl (t < 0.9) as absolute no-go
    if (d < c.radius * 0.9) return true;
  }
  return false;
}

// ---- Path geometry helpers (route = [[x,y,z], ...]) ----
function projectOnPath(route, fromSeg, px, pz) {
  let best = { d2: Infinity, seg: fromSeg, t: 0 };
  const last = Math.min(route.length - 2, fromSeg + SEARCH_SEGS);
  for (let i = Math.max(0, fromSeg); i <= last; i++) {
    const a = route[i], b = route[i + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const L2 = dx * dx + dz * dz;
    let t = L2 > 1e-9 ? ((px - a[0]) * dx + (pz - a[2]) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a[0] + t * dx - px, qz = a[2] + t * dz - pz;
    const d2 = qx * qx + qz * qz;
    if (d2 < best.d2) best = { d2, seg: i, t };
  }
  return best;
}

function pointAhead(route, seg, t, dist) {
  for (let i = seg; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const t0 = i === seg ? t : 0;
    const avail = len * (1 - t0);
    if (dist <= avail && len > 1e-9) {
      const u = t0 + dist / len;
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
    dist -= avail;
  }
  return route[route.length - 1];
}

function remainingLength(route, seg, t) {
  let sum = 0;
  for (let i = seg; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    sum += i === seg ? len * (1 - t) : len;
  }
  return sum;
}

const keys = { forward: false, backward: false, left: false, right: false };

export function useRoverController(roverRef, setRoverState, pathRef, activeRoute, learningModel) {
  const velRef      = useRef(0);
  const lastTRef    = useRef(null);
  const wpIdxRef    = useRef(0);
  const stuckRef    = useRef({ t: 0, x: 0, z: 0 });

  useEffect(() => {
    const dn = (e) => {
      if (['KeyW','ArrowUp'].includes(e.code))    { keys.forward  = true; e.preventDefault(); }
      if (['KeyS','ArrowDown'].includes(e.code))  { keys.backward = true; e.preventDefault(); }
      if (['KeyA','ArrowLeft'].includes(e.code))  { keys.left     = true; e.preventDefault(); }
      if (['KeyD','ArrowRight'].includes(e.code)) { keys.right    = true; e.preventDefault(); }
    };
    const up = (e) => {
      if (['KeyW','ArrowUp'].includes(e.code))    keys.forward  = false;
      if (['KeyS','ArrowDown'].includes(e.code))  keys.backward = false;
      if (['KeyA','ArrowLeft'].includes(e.code))  keys.left     = false;
      if (['KeyD','ArrowRight'].includes(e.code)) keys.right    = false;
    };
    window.addEventListener('keydown', dn, { passive: false });
    window.addEventListener('keyup',   up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  const update = useCallback((timestamp) => {
    if (!roverRef.current) return;
    const now = timestamp ?? performance.now();
    if (lastTRef.current === null) { lastTRef.current = now; }
    const dt  = Math.min((now - lastTRef.current) / 1000, 0.05);
    lastTRef.current = now;

    const rover = roverRef.current;

    // ---- Teleport to start of route (set once by handleStartRover) ----
    const tp = pathRef.current._teleportTo;
    if (tp) {
      rover.position.set(tp.x, tp.y, tp.z);
      // Face along the route so the start isn't a U-turn
      const r0 = activeRoute && pathRef.current[activeRoute];
      if (r0?.length > 1) {
        const ahead = pointAhead(r0, 0, 0, LOOKAHEAD_MIN);
        if (Math.hypot(ahead[0] - tp.x, ahead[2] - tp.z) > 1e-3) {
          rover.rotation.y = Math.atan2(ahead[0] - tp.x, ahead[2] - tp.z);
        }
      }
      velRef.current = 0;
      pathRef.current._teleportTo = null;
      stuckRef.current = { t: 0, x: tp.x, z: tp.z };
    }

    let vel     = velRef.current;
    let isAuto  = false;

    // ---- Autonomous path following (pure pursuit, scale-independent) ----
    // Rover her karede kendini rota üzerine izdüşürür; hedef, izdüşümün
    // `lookahead` metre ilerisindeki nokta. Nokta aralığından bağımsızdır
    // (eski "noktaya 2 m yaklaş" mantığı seyrek DEM rotalarında takılıp 360°
    // dönmeye yol açıyordu).
    const wpIdx  = pathRef.current._waypointIdx;
    const route  = activeRoute && pathRef.current[activeRoute];
    const doAuto = wpIdx !== undefined && route?.length > 1;

    if (doAuto) {
      isAuto = true;
      const px = rover.position.x, pz = rover.position.z;
      const proj = projectOnPath(route, Math.min(wpIdx, route.length - 2), px, pz);
      pathRef.current._waypointIdx = proj.seg;

      const remaining = remainingLength(route, proj.seg, proj.t);
      if (remaining < ARRIVE_DIST) {
        // Reached final destination — slow down
        vel = Math.max(0, vel - DECEL * dt * 4);
        if (vel < 0.08) {
          pathRef.current._waypointIdx = undefined;
          isAuto = false;
        }
      } else {
        const look = Math.max(LOOKAHEAD_MIN, Math.abs(vel) * LOOKAHEAD_TIME);
        const target = pointAhead(route, proj.seg, proj.t, look);
        const dx = target[0] - px;
        const dz = target[2] - pz;

        // Steer toward target point
        const targetAngle = Math.atan2(dx, dz);
        let diff = targetAngle - rover.rotation.y;
        while (diff >  Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        rover.rotation.y += diff * Math.min(1, TURN_SPD * dt * 3.5);

        // Speed: cos-shaped slowdown; target behind (>~70°) → nearly turn in place
        const turnFactor = Math.max(0, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
        const targetVel  = Math.max(MIN_AUTO_SPD, AUTO_SPD * turnFactor);
        vel += (targetVel - vel) * Math.min(1, ACCEL * dt);
        // Never slow below the remaining distance needs (smooth arrival)
        vel  = Math.min(vel, Math.max(MIN_AUTO_SPD, remaining * 1.2));

        // Stall detection: if rover hasn't moved in 1.5s, advance one segment
        const sx = stuckRef.current.x, sz = stuckRef.current.z;
        if (Math.abs(px - sx) + Math.abs(pz - sz) < 0.05) {
          stuckRef.current.t += dt;
          if (stuckRef.current.t > 1.5) {
            pathRef.current._waypointIdx = Math.min(proj.seg + 1, route.length - 2);
            stuckRef.current.t = 0;
          }
        } else {
          stuckRef.current = { t: 0, x: px, z: pz };
        }
      }
    }

    // ---- Manual override ----
    if (keys.forward) {
      vel = Math.min(vel + ACCEL * dt, MAX_SPEED);
    } else if (keys.backward) {
      vel = Math.max(vel - ACCEL * dt, -MAX_SPEED * 0.5);
    } else if (!isAuto) {
      vel = Math.abs(vel) < 0.06 ? 0 : vel - Math.sign(vel) * DECEL * dt;
    }

    if (!isAuto && Math.abs(vel) > 0.04) {
      if (keys.left)  rover.rotation.y += TURN_SPD * dt * (vel > 0 ? 1 : -1);
      if (keys.right) rover.rotation.y -= TURN_SPD * dt * (vel > 0 ? 1 : -1);
    }

    velRef.current = vel;

    // ---- Move ----
    const angle = rover.rotation.y;
    let nx = rover.position.x + Math.sin(angle) * vel * dt;
    let nz = rover.position.z + Math.cos(angle) * vel * dt;

    // ---- Hard crater collision guard ----
    // If next position is inside a crater bowl, reject the move and push back
    if (insideCrater(nx, nz)) {
      // Slide along perpendicular — try X-only, then Z-only
      const tryX = rover.position.x + Math.sin(angle) * vel * dt;
      const tryZ = rover.position.z;
      if (!insideCrater(tryX, tryZ)) {
        nx = tryX; nz = tryZ;
      } else {
        const tryX2 = rover.position.x;
        const tryZ2 = rover.position.z + Math.cos(angle) * vel * dt;
        if (!insideCrater(tryX2, tryZ2)) {
          nx = tryX2; nz = tryZ2;
        } else {
          // Fully blocked — stay put, brake hard
          nx = rover.position.x;
          nz = rover.position.z;
          velRef.current = 0;
          // Skip forward in path to avoid permanent stall
          if (doAuto && pathRef.current._waypointIdx !== undefined) {
            const cur = pathRef.current._waypointIdx;
            pathRef.current._waypointIdx = Math.min(cur + 10, route.length - 1);
          }
        }
      }
    }

    nx = Math.max(-HALF, Math.min(HALF, nx));
    nz = Math.max(-HALF, Math.min(HALF, nz));
    const ty = getTerrainHeight(nx, nz);
    rover.position.set(nx, ty + ROVER_Y_OFF, nz);

    // ---- Trail ----
    const trail = pathRef.current._roverTrail || [];
    const last  = trail[trail.length - 1];
    if (!last || Math.abs(nx - last[0]) + Math.abs(nz - last[2]) > 0.5) {
      trail.push([nx, ty + ROVER_Y_OFF, nz]);
      if (trail.length > 1000) trail.shift();
      pathRef.current._roverTrail = trail;
    }

    // ---- Learning feedback ----
    if (learningModel && Math.abs(vel) > 0.2) {
      const dh = last ? Math.abs(ty - (last[1] - ROVER_Y_OFF)) : 0;
      const ds = last ? Math.sqrt((nx - last[0]) ** 2 + (nz - last[2]) ** 2) : 1;
      const slope = ds > 0.01 ? dh / ds : 0;
      learningModel.recordTraversal(nx, nz, learningModel.computeDifficulty(slope, 0));
    }

    setRoverState({
      x: nx, y: ty + ROVER_Y_OFF, z: nz,
      speed:   Math.abs(vel),
      heading: rover.rotation.y,
      autoMode: isAuto,
    });
  }, [roverRef, setRoverState, pathRef, activeRoute, learningModel]);

  return { update };
}
