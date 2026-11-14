/** Rover camera (Moon) / EV1 helmet camera (Mars) preview (split out of RightPanel). */
import { useRef, useEffect } from 'react';
import { TERRAIN_SIZE, IS_DEM } from '../three/terrainGenerator';
import { MAP_S, fs, UI_SCALE } from '../ui/layout';
import { Label } from './ui';
import { HALF, CANVAS_FONT } from './panelConstants';

// ---- Image Processing Preview (Rover camera 3D / DEM: EV1 helmet camera) ----
export const CAM_H = Math.round(126 * UI_SCALE);
export function ProcessingMapPreview({ slopeMap, craterMask, hMap, roverPos, signalLost, signalQuality }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;

    ctx.fillStyle = 'rgba(8,20,10,1)';
    ctx.fillRect(0, 0, W, H);

    const sizeFrom = arr => {
      const n = arr?.length || 0;
      const s = Math.round(Math.sqrt(n));
      return Number.isFinite(s) && s > 0 && s * s <= n ? s : 0;
    };

    const grid = sizeFrom(hMap) || sizeFrom(slopeMap) || sizeFrom(craterMask);
    if (!grid) {
      ctx.fillStyle = '#557755';
      ctx.font = CANVAS_FONT(8);
      ctx.fillText('camera feed unavailable', 8, 16);
      return;
    }

    const iClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const idx = (r, c) => iClamp(r, 0, grid - 1) * grid + iClamp(c, 0, grid - 1);
    const sample = (arr, wx, wz, fb = 0) => {
      if (!arr || !arr.length) return fb;
      const u = ((wx + HALF) / TERRAIN_SIZE) * (grid - 1);
      const v = ((wz + HALF) / TERRAIN_SIZE) * (grid - 1);
      if (u < 0 || v < 0 || u > grid - 1 || v > grid - 1) return fb;

      const c0 = Math.floor(u), c1 = Math.min(grid - 1, c0 + 1);
      const r0 = Math.floor(v), r1 = Math.min(grid - 1, r0 + 1);
      const fu = u - c0, fv = v - r0;

      const a = arr[idx(r0, c0)] ?? fb;
      const b = arr[idx(r0, c1)] ?? fb;
      const c = arr[idx(r1, c0)] ?? fb;
      const d = arr[idx(r1, c1)] ?? fb;
      return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
    };
    const craterEdge = (wx, wz) => {
      if (!craterMask) return 0;
      const step = TERRAIN_SIZE / Math.max(8, grid - 1);
      const cx = Math.abs(sample(craterMask, wx + step, wz, 0) - sample(craterMask, wx - step, wz, 0));
      const cz = Math.abs(sample(craterMask, wx, wz + step, 0) - sample(craterMask, wx, wz - step, 0));
      return cx + cz;
    };

    // Simple software rendering from rover front camera perspective.
    const heading = roverPos?.heading ?? 0;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);

    // Mount camera slightly toward rover nose so view feels like true front cam
    // (DEM: helmet camera at eye height).
    const camForwardOffset = IS_DEM ? 0.2 : 0.75;
    const camX = (roverPos?.x ?? 0) + fx * camForwardOffset;
    const camZ = (roverPos?.z ?? 0) + fz * camForwardOffset;

    const camGround = sample(hMap, camX, camZ, 0);
    const camY = camGround + (IS_DEM ? 1.7 : 1.28);
    const horizon = Math.round(H * 0.48);
    const fov = 95 * Math.PI / 180;
    const near = 1.2;
    const far = IS_DEM ? 160 : 44;
    const stepD = IS_DEM ? 1.2 : 0.48;

    const yBuffer = new Float32Array(W);
    yBuffer.fill(H);

    for (let d = near; d <= far; d += stepD) {
      const halfLane = Math.tan(fov * 0.5) * d;
      const fog = Math.max(0.24, 1.0 - d / far);

      for (let sx = 0; sx < W; sx++) {
        const nx = sx / (W - 1);
        const lateral = (nx * 2 - 1) * halfLane;

        const wx = camX + fx * d + rx * lateral;
        const wz = camZ + fz * d + rz * lateral;
        if (wx < -HALF || wx > HALF || wz < -HALF || wz > HALF) continue;

        const h = sample(hMap, wx, wz, 0);
        const slope = Math.max(0, Math.min(1, sample(slopeMap, wx, wz, 0) / 0.8));
        const crater = Math.max(0, Math.min(1, sample(craterMask, wx, wz, 0)));
        const edge = craterEdge(wx, wz);

        const sy = horizon - ((h - camY) * 65 * UI_SCALE) / Math.max(1.0, d);
        if (sy >= yBuffer[sx]) continue;

        const hazard = Math.max(crater, slope * 0.66);
        let r = 24 + 180 * hazard;
        let g = 84 + 118 * (1 - hazard);
        let b = 26 + 44 * (1 - hazard);

        // Edge detector output: mark crater rims clearly.
        if (edge > 0.20) {
          r = 255;
          g = 78;
          b = 52;
        }

        const yTop = Math.max(0, sy);
        const yBottom = Math.min(H, yBuffer[sx]);
        if (yBottom <= yTop) continue;

        ctx.strokeStyle = `rgba(${Math.round(r * fog)}, ${Math.round(g * fog)}, ${Math.round(b * fog)}, 0.95)`;
        ctx.beginPath();
        ctx.moveTo(sx + 0.5, yTop);
        ctx.lineTo(sx + 0.5, yBottom);
        ctx.stroke();
        yBuffer[sx] = yTop;
      }
    }

    // HUD overlay
    ctx.strokeStyle = 'rgba(120,220,130,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 10, H / 2); ctx.lineTo(W / 2 + 10, H / 2);
    ctx.moveTo(W / 2, H / 2 - 8);  ctx.lineTo(W / 2, H / 2 + 8);
    ctx.stroke();
    ctx.fillStyle = '#76d476';
    ctx.font = CANVAS_FONT(7);
    ctx.fillText(IS_DEM ? 'SLOPE HAZARD VIEW' : 'EDGE DETECT: CRATER RIMS', 6, fs(10));

    // Subtle scan-lines for a terminal style readout.
    ctx.strokeStyle = 'rgba(120,180,120,0.08)';
    ctx.lineWidth = 1;
    for (let y = 2; y < H; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // Dust interference camera degradation (noisy/glitchy, not full black)
    const noiseLevel = Math.max(0, Math.min(1, 1 - (signalQuality ?? 1)));
    if (noiseLevel > 0.04) {
      const lines = Math.floor(24 + noiseLevel * 180);
      for (let i = 0; i < lines; i++) {
        const y = Math.random() * H;
        ctx.strokeStyle = `rgba(${150 + Math.random() * 90},${150 + Math.random() * 90},${150 + Math.random() * 90},${0.06 + noiseLevel * 0.24})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y + (Math.random() - 0.5) * 3.5);
        ctx.stroke();
      }

      const glitches = Math.floor(1 + noiseLevel * 12);
      for (let i = 0; i < glitches; i++) {
        const gw = 16 + Math.random() * 66;
        const gh = 2 + Math.random() * 15;
        const gx = Math.random() * (W - gw);
        const gy = Math.random() * (H - gh);
        ctx.fillStyle = `rgba(${120 + Math.random() * 120},${120 + Math.random() * 120},${120 + Math.random() * 120},${0.08 + noiseLevel * 0.30})`;
        ctx.fillRect(gx, gy, gw, gh);
      }
    }

    if (signalLost) {
      for (let y = 0; y < H; y += 2) {
        const n = 80 + Math.random() * 145;
        ctx.strokeStyle = `rgba(${n},${n},${n},${0.09 + Math.random() * 0.2})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y + (Math.random() - 0.5) * 2.2);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(10,10,10,0.42)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,90,90,0.68)';
      ctx.strokeRect(1, 1, W - 2, H - 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff7755';
      ctx.font = CANVAS_FONT(11, true);
      ctx.fillText('OPTICAL SENSOR FAILURE', W / 2, H / 2 - 10);
      ctx.fillStyle = '#ffb48a';
      ctx.font = CANVAS_FONT(10, true);
      ctx.fillText('SIGNAL LOST', W / 2, H / 2 + 8);
      ctx.fillStyle = '#ffd8b4';
      ctx.font = CANVAS_FONT(7);
      ctx.fillText('NO SIGNAL - DUST INTERFERENCE', W / 2, H / 2 + 22);
      ctx.textAlign = 'start';
    }
  }, [slopeMap, craterMask, hMap, roverPos?.x, roverPos?.z, roverPos?.heading, signalLost, signalQuality]);

  return (
    <div>
      <Label>{IS_DEM ? 'EV1 Helmet Camera (slope hazard view)' : 'Rover Front Camera (3D)'}</Label>
      <div style={{ marginTop: 4 }}>
        <canvas
          ref={ref}
          width={MAP_S}
          height={CAM_H}
          style={{
            width: MAP_S,
            height: CAM_H,
            display: 'block',
            borderRadius: 3,
            border: '1px solid rgba(80,120,60,0.3)',
            background: 'rgba(7,14,8,0.85)',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize:fs(7), color: '#557755', marginTop: 2 }}>
          <span style={{ color: signalLost ? '#ff7755' : '#66cc66' }}>{signalLost ? 'NO SIGNAL' : 'SAFE'}</span>
          <span style={{ color: signalLost ? '#ff9966' : '#8cd08c' }}>{IS_DEM ? 'HELMET CAM' : 'FRONT CAM + EDGE DETECT'}</span>
          <span style={{ color: '#ff6644' }}>{IS_DEM ? 'STEEP' : 'RIM / HAZARD'}</span>
        </div>
      </div>
    </div>
  );
}
