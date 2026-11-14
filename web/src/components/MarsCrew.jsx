/**
 * MarsCrew — the human explorers of the Martian Map (DEM mode, Stage 7).
 *
 * • Two suited astronauts, EV1 (red stripes) and EV2. NASA's lunar surface EVA
 *   concept of operations plans EVAs as a two-person crew (EV1/EV2); the suit
 *   shape here is an original, simplified design.
 * • Motion is driven by the EVA playback controller (utils/evaPlayback.js):
 *   positions come from the planned timeline, so what you see is exactly the
 *   plan the GO/NO-GO decision was made on. EV2 trails EV1 by EV2_LAG_S.
 * • Walk cycle, kneel-and-sample pose at science stops (EV2 documents), boot
 *   prints, a flag at every sampled stop, a pulsing ring at the active stop.
 * • Also: DEM route lines (screen-space width, terrain-following), science
 *   stop badges and the dust-devil hazard visual.
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { getTerrainHeight } from '../three/terrainGenerator';
import { EV2_LAG_S } from '../utils/evaPlayback';

// ---------------------------------------------------------------- materials
function useSuitMaterials() {
  return useMemo(() => ({
    suit:  new THREE.MeshStandardMaterial({ color: '#ecebe6', roughness: 0.82, metalness: 0.02 }),
    plss:  new THREE.MeshStandardMaterial({ color: '#dcdad3', roughness: 0.7, metalness: 0.05 }),
    dark:  new THREE.MeshStandardMaterial({ color: '#3b3d42', roughness: 0.6, metalness: 0.25 }),
    boot:  new THREE.MeshStandardMaterial({ color: '#56514b', roughness: 0.9, metalness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ color: '#b9bcc2', roughness: 0.35, metalness: 0.85 }),
    // gold sun visor: no environment map in the scene, so a fully metallic
    // material would render black — keep it semi-metallic with a faint glow
    visor: new THREE.MeshStandardMaterial({ color: '#d4a03a', roughness: 0.22, metalness: 0.35, emissive: '#4a2e06', emissiveIntensity: 0.6 }),
    red:   new THREE.MeshStandardMaterial({ color: '#c62828', roughness: 0.7 }),
    lamp:  new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6d8', emissiveIntensity: 1.2 }),
    led:   new THREE.MeshStandardMaterial({ color: '#40e0ff', emissive: '#30d0ff', emissiveIntensity: 1.4 }),
    ledG:  new THREE.MeshStandardMaterial({ color: '#7dff7a', emissive: '#5cff58', emissiveIntensity: 1.4 }),
  }), []);
}

// ---------------------------------------------------------------- the suit
// Model faces +Z; origin at the feet. Joints are registered in `J`.
function Astronaut({ J, ev1 }) {
  const m = useSuitMaterials();
  const reg = (k) => (o) => { if (o) J[k] = o; };
  const leg = (side) => (
    <group key={side} ref={reg(side > 0 ? 'hipL' : 'hipR')} position={[0.11 * side, -0.02, 0]}>
      <mesh material={m.suit} castShadow position={[0, -0.23, 0]}>
        <capsuleGeometry args={[0.085, 0.3, 4, 12]} />
      </mesh>
      {ev1 && (
        <mesh material={m.red} position={[0, -0.16, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.06, 16]} />
        </mesh>
      )}
      <group ref={reg(side > 0 ? 'kneeL' : 'kneeR')} position={[0, -0.46, 0]}>
        <mesh material={m.suit} castShadow position={[0, -0.2, 0]}>
          <capsuleGeometry args={[0.075, 0.28, 4, 12]} />
        </mesh>
        <mesh material={m.boot} castShadow position={[0, -0.43, 0.04]}>
          <boxGeometry args={[0.13, 0.09, 0.28]} />
        </mesh>
      </group>
    </group>
  );
  const arm = (side) => (
    <group key={side} ref={reg(side > 0 ? 'shL' : 'shR')} position={[0.25 * side, 0.53, 0]}>
      <mesh material={m.suit} castShadow><sphereGeometry args={[0.088, 14, 10]} /></mesh>
      <mesh material={m.suit} castShadow position={[0, -0.15, 0]}>
        <capsuleGeometry args={[0.062, 0.18, 4, 10]} />
      </mesh>
      {ev1 && (
        <mesh material={m.red} position={[0, -0.12, 0]}>
          <cylinderGeometry args={[0.066, 0.066, 0.05, 14]} />
        </mesh>
      )}
      <group ref={reg(side > 0 ? 'elL' : 'elR')} position={[0, -0.3, 0]}>
        <mesh material={m.suit} castShadow position={[0, -0.13, 0]}>
          <capsuleGeometry args={[0.056, 0.17, 4, 10]} />
        </mesh>
        <mesh material={m.dark} castShadow position={[0, -0.29, 0]}>
          <sphereGeometry args={[0.065, 12, 10]} />
        </mesh>
      </group>
    </group>
  );
  return (
    <group ref={reg('root')}>
      <group ref={reg('body')}>
        <group ref={reg('pelvis')} position={[0, 0.95, 0]}>
          {/* brief / hip bearing */}
          <mesh material={m.suit} castShadow position={[0, 0.02, 0]}>
            <boxGeometry args={[0.36, 0.18, 0.24]} />
          </mesh>
          <group ref={reg('torso')}>
            {/* hard upper torso */}
            <mesh material={m.suit} castShadow position={[0, 0.33, 0]} scale={[1, 1, 0.78]}>
              <cylinderGeometry args={[0.2, 0.17, 0.5, 18]} />
            </mesh>
            {/* life-support backpack */}
            <mesh material={m.plss} castShadow position={[0, 0.37, -0.25]}>
              <boxGeometry args={[0.42, 0.62, 0.2]} />
            </mesh>
            <mesh material={m.dark} castShadow position={[0, 0.7, -0.25]}>
              <boxGeometry args={[0.36, 0.05, 0.16]} />
            </mesh>
            <mesh material={m.metal} position={[0.15, 0.82, -0.3]}>
              <cylinderGeometry args={[0.008, 0.008, 0.22, 6]} />
            </mesh>
            {/* chest display & control module */}
            <mesh material={m.dark} castShadow position={[0, 0.25, 0.17]}>
              <boxGeometry args={[0.26, 0.12, 0.09]} />
            </mesh>
            <mesh material={m.led} position={[-0.07, 0.27, 0.218]}><boxGeometry args={[0.03, 0.02, 0.006]} /></mesh>
            <mesh material={m.ledG} position={[0.0, 0.27, 0.218]}><boxGeometry args={[0.03, 0.02, 0.006]} /></mesh>
            <mesh material={m.led} position={[0.07, 0.27, 0.218]}><boxGeometry args={[0.03, 0.02, 0.006]} /></mesh>
            {/* neck ring */}
            <mesh material={m.metal} position={[0, 0.61, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.13, 0.026, 8, 22]} />
            </mesh>
            {/* helmet */}
            <group ref={reg('head')} position={[0, 0.77, 0.01]}>
              <mesh material={m.suit} castShadow><sphereGeometry args={[0.156, 20, 16]} /></mesh>
              <mesh material={m.visor}>
                <sphereGeometry args={[0.164, 24, 16, 0, Math.PI, 0.42, 1.85]} />
              </mesh>
              <mesh material={m.lamp} position={[0.15, 0.05, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.025, 0.025, 0.05, 10]} />
              </mesh>
              <mesh material={m.lamp} position={[-0.15, 0.05, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.025, 0.025, 0.05, 10]} />
              </mesh>
              {/* helmet floodlight: switched on by MarsCrew when the sun is low */}
              <object3D ref={reg('lampTarget')} position={[0, -1.2, 4]} />
              <spotLight ref={reg('lamp')} position={[0, 0.05, 0.12]} intensity={0} distance={45} decay={1.5}
                angle={0.55} penumbra={0.65} color="#fff3dc" />
            </group>
            {arm(1)}
            {arm(-1)}
          </group>
          {leg(1)}
          {leg(-1)}
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- poses
const JOINTS = ['bob', 'drop', 'lean', 'hipL', 'hipR', 'kneeL', 'kneeR', 'shL', 'shR', 'elL', 'elR', 'head'];

function walkPose(phi, amp) {
  const s = Math.sin(phi), c = Math.cos(phi);
  return {
    bob: 0.022 * amp * Math.abs(s), drop: -0.01 * amp, lean: 0.03 + 0.07 * amp, head: -0.03 * amp,
    hipL: -0.42 * amp * s, hipR: 0.42 * amp * s,
    kneeL: 0.08 + 0.6 * amp * Math.max(0, c), kneeR: 0.08 + 0.6 * amp * Math.max(0, -c),
    shL: 0.3 * amp * s, shR: -0.3 * amp * s, elL: -0.3, elR: -0.3,
  };
}
// EV1 at a stop: kneel on the right knee and reach down with the right arm (sampling)
const SAMPLE_POSE = { bob: 0, drop: -0.34, lean: 0.5, head: 0.3, hipL: -1.0, hipR: -0.25, kneeL: 1.55, kneeR: 1.75,
  shL: -0.35, shR: -1.25, elL: -0.7, elR: -0.25 };
// EV2 at a stop: stand and document (arms raised in front, holding a camera)
const DOCUMENT_POSE = { bob: 0, drop: 0, lean: 0.06, head: -0.06, hipL: 0, hipR: 0, kneeL: 0.08, kneeR: 0.08,
  shL: -1.1, shR: -1.25, elL: -1.05, elR: -0.95 };

function applyPose(J, P) {
  if (!J.root) return;
  J.body.position.y = P.bob;
  J.pelvis.position.y = 0.95 + P.drop;
  J.torso.rotation.x = P.lean;
  J.head.rotation.x = P.head;
  J.hipL.rotation.x = P.hipL; J.hipR.rotation.x = P.hipR;
  J.kneeL.rotation.x = P.kneeL; J.kneeR.rotation.x = P.kneeR;
  J.shL.rotation.x = P.shL; J.shR.rotation.x = P.shR;
  J.shL.rotation.z = 0.1; J.shR.rotation.z = -0.1;
  J.elL.rotation.x = P.elL; J.elR.rotation.x = P.elR;
}

const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// Visual gait: one walk cycle (two steps) covers STRIDE_M; in time-lapse the
// cadence is capped so the legs read as "walking fast" instead of flickering.
const STRIDE_M = 0.9;
const MAX_CADENCE_HZ = 1.7;
const STEP_M = 0.45;            // boot print spacing (one step)

// ---------------------------------------------------------------- boot prints
const MAX_PRINTS = 3000;
const _HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

function makePrintTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 64, 128);
  g.fillStyle = 'rgba(40,22,14,0.9)';
  g.beginPath(); g.ellipse(32, 34, 22, 30, 0, 0, Math.PI * 2); g.fill();     // toe
  g.beginPath(); g.ellipse(32, 96, 18, 26, 0, 0, Math.PI * 2); g.fill();     // heel
  g.fillRect(16, 40, 32, 56);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 10; y < 122; y += 9) g.fillRect(8, y, 48, 3);                   // tread bars
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function BootPrints({ crewRefs, resetKey }) {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tex = useMemo(() => (typeof document !== 'undefined' ? makePrintTexture() : null), []);
  const state = useRef({ head: 0, members: [] });

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < MAX_PRINTS; i++) mesh.setMatrixAt(i, _HIDE);
    mesh.instanceMatrix.needsUpdate = true;
    state.current = { head: 0, members: crewRefs.map(() => ({ last: null, side: 1 })) };
  }, [resetKey, crewRefs]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    let dirty = false;
    crewRefs.forEach((ref, k) => {
      const o = ref.current;
      const mem = state.current.members[k];
      if (!o || !mem) return;
      const p = o.position;
      if (!mem.last) { mem.last = new THREE.Vector3(p.x, 0, p.z); return; }
      const dx = p.x - mem.last.x, dz = p.z - mem.last.z;
      const d = Math.hypot(dx, dz);
      if (d < STEP_M) return;
      if (d > 60) { mem.last.set(p.x, 0, p.z); return; }           // teleport / seek: no trail
      const fx = dx / d, fz = dz / d, heading = Math.atan2(fx, fz);
      const steps = Math.min(40, Math.floor(d / STEP_M));
      const skip = Math.floor(d / STEP_M) - steps;
      for (let s = skip + 1; s <= skip + steps; s++) {
        const cx = mem.last.x + fx * STEP_M * s, cz = mem.last.z + fz * STEP_M * s;
        mem.side = -mem.side;
        const ox = -fz * 0.1 * mem.side, oz = fx * 0.1 * mem.side;   // left/right of the walk line
        const x = cx + ox, z = cz + oz;
        dummy.position.set(x, getTerrainHeight(x, z) + 0.03, z);
        dummy.rotation.set(-Math.PI / 2, 0, heading + Math.PI);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(state.current.head, dummy.matrix);
        state.current.head = (state.current.head + 1) % MAX_PRINTS;
      }
      mem.last.set(mem.last.x + fx * STEP_M * (skip + steps), 0, mem.last.z + fz * STEP_M * (skip + steps));
      dirty = true;
    });
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, MAX_PRINTS]} frustumCulled={false} renderOrder={2}>
      <planeGeometry args={[0.13, 0.29]} />
      <meshBasicMaterial map={tex} transparent opacity={0.75} depthWrite={false}
        polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------- flags & ring
// ---------------------------------------------------------------- screen-space text labels
// Drawn as sprites (canvas texture), not drei <Html>: an <Html> label creates its own React
// root, and unmounting one while the scene re-renders (a stop badge turning into a flag,
// abort, re-plan) throws "removeChild … not a child of this node" under React 19.
function makeLabelTexture(text, { font, fg, bg, border, radius }) {
  const dpr = 3, padX = 5, h = 16;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 2 * padX;
  c.width = w * dpr; c.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.beginPath(); ctx.roundRect(0.5, 0.5, w - 1, h - 1, radius);
  ctx.fillStyle = bg; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = border; ctx.stroke();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 0.5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return { tex, aspect: w / h };
}

/** Label of constant on-screen size (heightPx) at a world position, always drawn on top. */
export function LabelSprite({ position, text, style, heightPx = 16 }) {
  const { camera, size } = useThree();
  const { tex, aspect } = useMemo(() => makeLabelTexture(text, style),
    [text, style.font, style.fg, style.bg, style.border, style.radius]);
  useEffect(() => () => tex.dispose(), [tex]);
  // With sizeAttenuation off, sprite scale is in view units at distance 1: pixels = scale · P11 / 2 · height.
  const p11 = camera.projectionMatrix.elements[5] || 1;
  const sy = (2 * heightPx) / (p11 * size.height);
  return (
    <sprite position={position} scale={[sy * aspect, sy, 1]} renderOrder={20}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent toneMapped={false} fog={false} />
    </sprite>
  );
}

const FLAG_LABEL = { font: 'bold 10px monospace', fg: '#ffd9b0', bg: 'rgba(60,25,0,0.8)', border: '#ff8a3a', radius: 3 };
const BADGE_LABEL = { font: 'bold 11px monospace', fg: '#1a0d00', bg: '#ffb347', border: '#fff2dd', radius: 8 };

function StopFlag({ x, z, n }) {
  const y = getTerrainHeight(x, z);
  return (
    <group position={[x, y, z]}>
      <mesh castShadow position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 1.6, 6]} />
        <meshStandardMaterial color="#d8d8d0" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0.2, 1.43, 0]}>
        <boxGeometry args={[0.4, 0.26, 0.01]} />
        <meshStandardMaterial color="#ff7a1a" emissive="#ff6a00" emissiveIntensity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <LabelSprite position={[0, 2.1, 0]} text={`✓ S${n}`} style={FLAG_LABEL} heightPx={15} />
    </group>
  );
}

// ---------------------------------------------------------------- crew
/**
 * @param {EvaPlayback} playback
 * @param {{x,z}} idlePos  where the crew stands when no EVA is loaded (habitat / start)
 * @param {React.MutableRefObject} leadRef  EV1 root (camera + sun follow it)
 * @param {(pose)=>void} onPose  throttled (~10 Hz) pose callback for the minimap / telemetry
 * @param {number} trailKey  change it to wipe the boot prints (new plan / restart)
 */
export function MarsCrew({ playback, idlePos, leadRef, onPose, trailKey = 0, sunElevationDeg }) {
  const J1 = useRef({}).current;
  const J2 = useRef({}).current;
  const ev2Ref = useRef();
  const crewRefs = useMemo(() => [leadRef, ev2Ref], [leadRef]);
  const anim = useRef({
    phase: 0, heading1: 0, heading2: 0, cur1: walkPose(0, 0), cur2: walkPose(0, 0),
    side: new THREE.Vector2(1.3, 0), lastEmit: 0, time: 0,
  });
  const ringRef = useRef();

  useEffect(() => {
    // bind the joint registry's root to the exported lead ref
    if (J1.root) leadRef.current = J1.root;
    if (J2.root) ev2Ref.current = J2.root;
  });

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.1, Math.max(0, dtRaw));
    const A = anim.current;
    A.time += dt;
    if (!J1.root || !J2.root) return;
    leadRef.current = J1.root;
    ev2Ref.current = J2.root;
    playback.tick(dt);

    const loaded = playback.loaded;
    const p1 = loaded ? playback.pose(0) : null;
    const p2 = loaded ? playback.pose(EV2_LAG_S) : null;
    const moving = playback.status === 'playing';

    // ---- EV1
    const x1 = p1 ? p1.x : idlePos.x, z1 = p1 ? p1.z : idlePos.z;
    const walking1 = !!p1 && moving && p1.state === 'walk';
    const vReal = walking1 ? p1.speedMs * playback.speed : 0;
    const cadence = Math.min(MAX_CADENCE_HZ, vReal / STRIDE_M);
    A.phase += 2 * Math.PI * cadence * dt;
    const amp = walking1 ? Math.min(1, 0.55 + 0.45 * Math.min(1, vReal / 1.2)) : 0;
    if (p1) A.heading1 += wrapAngle(p1.heading - A.heading1) * (1 - Math.exp(-dt * 7));
    const sampling1 = !!p1 && p1.state === 'dwell' && !playback.aborted && playback.status !== 'done';
    let target1 = sampling1 ? SAMPLE_POSE : walkPose(A.phase, amp);
    if (!walking1 && !sampling1) target1 = { ...walkPose(0, 0), bob: 0.004 * Math.sin(A.time * 1.6) };
    blendInto(A.cur1, target1, dt);
    J1.root.position.set(x1, getTerrainHeight(x1, z1), z1);
    J1.root.rotation.y = A.heading1;
    applyPose(J1, A.cur1);

    // ---- EV2 (trails EV1; stands to the side at stops)
    let x2b = p2 ? p2.x : idlePos.x, z2b = p2 ? p2.z : idlePos.z;
    if (p2) A.heading2 += wrapAngle(p2.heading - A.heading2) * (1 - Math.exp(-dt * 7));
    const atStop2 = !!p2 && p2.state === 'dwell' && !playback.aborted && playback.status !== 'done';
    // side offset: 1.3 m to EV1's right while walking, 1.8 m right + 0.9 m back while documenting
    const wantSide = atStop2 ? 1.8 : 1.3, wantBack = atStop2 ? 0.9 : 0;
    A.side.x += (wantSide - A.side.x) * (1 - Math.exp(-dt * 4));
    A.side.y += (wantBack - A.side.y) * (1 - Math.exp(-dt * 4));
    const h2 = A.heading2;
    const rx = -Math.cos(h2), rz = Math.sin(h2), fx = Math.sin(h2), fz = Math.cos(h2);
    const x2 = x2b + rx * A.side.x - fx * A.side.y, z2 = z2b + rz * A.side.x - fz * A.side.y;
    const walking2 = !!p2 && moving && p2.state === 'walk';
    let target2 = atStop2 ? DOCUMENT_POSE : walkPose(A.phase + 2.2, walking2 ? amp : 0);
    if (!walking2 && !atStop2) target2 = { ...walkPose(0, 0), bob: 0.004 * Math.sin(A.time * 1.4 + 1) };
    blendInto(A.cur2, target2, dt);
    J2.root.position.set(x2, getTerrainHeight(x2, z2), z2);
    // at a stop EV2 turns to face EV1 (documenting the sample)
    const face = atStop2 ? Math.atan2(x1 - x2, z1 - z2) : h2;
    J2.root.rotation.y += wrapAngle(face - J2.root.rotation.y) * (1 - Math.exp(-dt * 6));
    applyPose(J2, A.cur2);

    // ---- helmet floodlights: on when the (mission-time) sun is low
    if (A.time - (A.lastSun || -1) > 0.5) {
      A.lastSun = A.time;
      const ms = playback.loaded && Number.isFinite(playback.meta?.startMs) ? playback.meta.startMs + playback.t * 1000 : null;
      const el = ms != null && playback.env?.sunAt ? playback.env.sunAt(ms).elevationDeg : (sunElevationDeg ?? 45);
      A.lamp = Math.max(0, Math.min(1, (6 - el) / 10));
    }
    for (const J of [J1, J2]) {
      if (J.lamp) {
        if (J.lampTarget && J.lamp.target !== J.lampTarget) J.lamp.target = J.lampTarget;
        J.lamp.intensity = 40 * (A.lamp || 0);
        J.lamp.visible = (A.lamp || 0) > 0.01;
      }
    }

    // ---- pulsing ring at the stop being sampled
    if (ringRef.current) {
      ringRef.current.visible = sampling1;
      if (sampling1) {
        const s = 1 + 0.15 * Math.sin(A.time * 4);
        ringRef.current.position.set(x1, getTerrainHeight(x1, z1) + 0.06, z1);
        ringRef.current.scale.set(s, s, s);
      }
    }

    // ---- throttled pose report (minimap arrow, telemetry, dust monitor)
    if (onPose && A.time - A.lastEmit > 0.1) {
      A.lastEmit = A.time;
      onPose({ x: x1, y: getTerrainHeight(x1, z1), z: z1, heading: A.heading1,
        speed: walking1 ? p1.speedMs : 0, autoMode: moving });
    }
  });

  const flags = playback.loaded
    ? playback.nominal.stops.filter(st => st.departS <= playback.t && (!playback.aborted || st.departS <= playback.aborted.t0))
    : [];

  return (
    <>
      <Astronaut J={J1} ev1 />
      <Astronaut J={J2} ev1={false} />
      <BootPrints crewRefs={crewRefs} resetKey={trailKey} />
      {flags.map(st => <StopFlag key={st.n} x={st.x} z={st.z} n={st.n} />)}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={3}>
        <ringGeometry args={[2.2, 2.6, 40]} />
        <meshBasicMaterial color="#ffb347" transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

function blendInto(cur, target, dt) {
  const k = 1 - Math.exp(-dt * 9);
  for (const j of JOINTS) cur[j] += (target[j] - cur[j]) * k;
}

// ---------------------------------------------------------------- route lines (DEM)
/** Densify a route to ≤ stepM spacing and drape it on the terrain (+lift). */
export function drapePath(points, stepM = 2, lift = 0.35) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, , z1] = points[i];
    if (i > 0) {
      const [x0, , z0] = points[i - 1];
      const d = Math.hypot(x1 - x0, z1 - z0);
      const k = Math.max(1, Math.ceil(d / stepM));
      for (let s = 1; s < k; s++) {
        const x = x0 + ((x1 - x0) * s) / k, z = z0 + ((z1 - z0) * s) / k;
        out.push([x, getTerrainHeight(x, z) + lift, z]);
      }
    }
    out.push([x1, getTerrainHeight(x1, z1) + lift, z1]);
  }
  return out;
}

export function DemRouteLine({ points, color, active, dashed = false }) {
  const pts = useMemo(() => (points && points.length > 1 ? drapePath(points) : null), [points]);
  if (!pts) return null;
  return (
    <Line points={pts} color={color} lineWidth={active ? 4 : 2} dashed={dashed} dashSize={6} gapSize={4}
      transparent opacity={active ? 1 : 0.5} depthWrite={false}
      polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-8} renderOrder={active ? 5 : 4} />
  );
}

// ---------------------------------------------------------------- rover track + named places
// The rover's own route through the site as a pale line with labels, as on NASA's route maps
// for Curiosity (PIA23179, PIA26042). Data: sites/<site>/track.json (pipeline/build_track.py).
const TRACK_LABELS = {
  sol:    { font: '9px monospace', fg: '#e8e8f0', bg: 'rgba(20,24,40,0.7)', border: 'rgba(200,210,255,0.5)', radius: 3 },
  place:  { font: 'bold 10px monospace', fg: '#ffffff', bg: 'rgba(20,24,40,0.8)', border: '#ffffff', radius: 3 },
  region: { font: 'bold 10px monospace', fg: '#ffe9a8', bg: 'rgba(50,36,0,0.75)', border: '#e0b040', radius: 3 },
};
export const trackLabelText = (l, rover) => (l.kind === 'sol' ? `${rover} · ${l.text}` : l.derived ? `${l.text} (derived)` : l.text);

export function RoverTrack({ track, markerScale = 1 }) {
  const lines = useMemo(() => (track?.segments || []).map(seg => drapePath(seg.map(([x, z]) => [x, 0, z]))), [track]);
  if (!track) return null;
  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#e6e8ff" lineWidth={1.6} transparent opacity={0.75} depthWrite={false}
          polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-6} renderOrder={3} />
      ))}
      {track.labels.map((l, i) => (
        <LabelSprite key={i} position={[l.x, getTerrainHeight(l.x, l.z) + (l.kind === 'region' ? 6 : 3.2) * markerScale, l.z]}
          text={trackLabelText(l, track.rover)} style={TRACK_LABELS[l.kind] || TRACK_LABELS.sol} heightPx={l.kind === 'sol' ? 14 : 16} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------- science stop badges
export function StopBadges({ waypoints, markerScale, visited = [] }) {
  const stops = (waypoints || []).map((w, i) => ({ ...w, i })).filter(w => w.dwellS > 0);
  return (
    <>
      {stops.map((w, k) => {
        if (visited.includes(k + 1)) return null;          // the ✓ flag label replaces it
        const y = getTerrainHeight(w.x, w.z);
        return (
          <LabelSprite key={`${w.i}-${w.x}-${w.z}`} position={[w.x, y + 1.9 * markerScale, w.z]}
            text={`S${k + 1}`} style={BADGE_LABEL} />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- dust devil (DEM hazard)
// Funnel = lathe surface (narrow at the ground, wide aloft) with a streaky alpha
// texture whose offset scrolls → reads as a spinning dust column. Size scales
// with the hazard radius (illustrative, not a measured dust-devil size).
function makeStreakTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  // alphaMap reads the GREEN channel → draw grey levels on black
  g.fillStyle = 'rgb(18,18,18)';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256, w = 4 + Math.random() * 18, v = Math.round(40 + Math.random() * 150);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, 256); g.bezierCurveTo(x + 40, 180, x + 70, 90, x + 120, 0);      // slanted swirl streak
    g.stroke();
    g.beginPath();
    g.moveTo(x - 256, 256); g.bezierCurveTo(x - 216, 180, x - 186, 90, x - 136, 0);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

function funnelGeometry(s, inner) {
  const H = 6.2 * s, pts = [];
  for (let k = 0; k <= 24; k++) {
    const f = k / 24;
    const r = s * ((inner ? 0.12 : 0.2) + (inner ? 0.55 : 0.8) * Math.pow(f, 1.55));
    pts.push(new THREE.Vector2(r, f * H));
  }
  return new THREE.LatheGeometry(pts, 48);
}

export function DustDevil({ hazard }) {
  const outer = useRef(), inner = useRef(), base = useRef();
  const texO = useMemo(() => (typeof document !== 'undefined' ? makeStreakTexture() : null), []);
  const texI = useMemo(() => (typeof document !== 'undefined' ? makeStreakTexture() : null), []);
  const { x, z, radius } = hazard;
  const s = radius;
  const geoO = useMemo(() => funnelGeometry(s, false), [s]);
  const geoI = useMemo(() => funnelGeometry(s, true), [s]);
  useFrame((_, dt) => {
    if (texO) texO.offset.x = (texO.offset.x + dt * 0.18) % 1;
    if (texI) texI.offset.x = (texI.offset.x + dt * 0.31) % 1;
    if (outer.current) outer.current.rotation.y += dt * 0.6;
    if (inner.current) inner.current.rotation.y += dt * 1.1;
    if (base.current) base.current.rotation.y -= dt * 0.25;
  });
  const y = getTerrainHeight(x, z);
  return (
    <group position={[x, y, z]}>
      <mesh ref={outer} geometry={geoO} renderOrder={6}>
        <meshBasicMaterial color="#ecd2ae" alphaMap={texO} transparent opacity={0.9}
          depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={inner} geometry={geoI} renderOrder={6}>
        <meshBasicMaterial color="#c99a6c" alphaMap={texI} transparent opacity={0.95}
          depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* dust skirt at the base */}
      <mesh ref={base} position={[0, s * 0.18, 0]} scale={[1, 0.3, 1]} renderOrder={6}>
        <sphereGeometry args={[s * 0.7, 28, 14]} />
        <meshBasicMaterial color="#d6b08a" alphaMap={texO} transparent opacity={0.8}
          depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
