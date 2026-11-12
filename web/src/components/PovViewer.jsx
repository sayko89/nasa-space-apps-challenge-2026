/**
 * Ground view: what the rover's cameras (Perseverance or Curiosity) saw from the rover position closest to a
 * science stop, looking toward it — "what the crew will see when they get there".
 * Data: public/sites/<site>/pov.json (pipeline/build_pov.py); images load from mars.nasa.gov.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SITE } from '../three/terrainGenerator';

const MAX_DIST_M = 400;       // farther than this the photos say little about the stop
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Nearest rover position to (x, z), the bearing from it to the point and the frames facing it. */
export function nearestPanorama(x, z) {
  const list = SITE.pov?.stations;
  if (!list?.length) return null;
  let best = null;
  for (const st of list) {
    const d = Math.hypot(st.x - x, st.z - z);
    if (!best || d < best.dist) best = { station: st, dist: d };
  }
  if (!best || best.dist > MAX_DIST_M) return null;
  const east = x - best.station.x, north = -(z - best.station.z);
  const bearing = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  const frames = [...best.station.frames].sort((a, b) => angDiff(a.az, bearing) - angDiff(b.az, bearing));
  const facing = frames.slice(0, 3).sort((a, b) => ((a.az - bearing + 540) % 360) - ((b.az - bearing + 540) % 360));
  return { ...best, bearing, facing, offBy: frames.length ? angDiff(frames[0].az, bearing) : null };
}

/** Esc closes a modal card (ground view, chemistry, cuff card). */
export function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export const CloseButton = ({ onClose }) => (
  <button type="button" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)"
    style={{ cursor: 'pointer', color: '#aab', background: 'none', border: '1px solid #445', borderRadius: 3,
      font: '11px monospace', padding: '1px 6px' }}>✕ close</button>
);

/** One rover frame; if it cannot load (offline, mars.nasa.gov down) says so instead of a broken icon. */
function Frame({ f, outlined }) {
  const [failed, setFailed] = useState(false);
  const border = outlined ? '2px solid #ffb347' : 'none';
  if (failed) {
    return (
      <div style={{ aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        background: '#141a14', borderRadius: 3, outline: border, fontSize: 10, color: '#8a9a8a', padding: 8 }}>
        {f.camera} · sol {f.sol}<br />image not reachable — rover frames load from mars.nasa.gov and need an internet connection
      </div>
    );
  }
  return (
    <img src={f.medium} alt={`${f.camera}, sol ${f.sol}, looking ${f.az}°`} loading="lazy" onError={() => setFailed(true)}
      style={{ width: '100%', display: 'block', borderRadius: 3, outline: border }} />
  );
}

export function PovViewer({ stop, label, onClose }) {
  const hit = nearestPanorama(stop.x, stop.z);
  useEscape(onClose);
  // Portal to <body>: the side panel is a transformed container, which would trap position:fixed
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1100px, 100%)', background: '#0b0f0b',
        border: '1px solid rgba(255,179,71,0.45)', borderRadius: 6, padding: 12, fontFamily: 'monospace', color: '#d8d0b8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8 }}>
          <b style={{ color: '#ffb347', fontSize: 13 }}>GROUND VIEW — {label}</b>
          <CloseButton onClose={onClose} />
        </div>
        {!hit ? (
          <div style={{ fontSize: 12, padding: '24px 0', textAlign: 'center' }}>
            {SITE.pov?.rover || 'The rover'} never stopped within {MAX_DIST_M} m of this stop. This part of the site has only been seen from orbit.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 4 }}>
              {hit.facing.map((f, i) => (
                <a key={i} href={f.link} target="_blank" rel="noreferrer" style={{ flex: 1, position: 'relative', display: 'block', color: 'inherit', textDecoration: 'none' }}
                  title={`${f.camera} · sol ${f.sol} · azimuth ${f.az}° · elevation ${f.el.toFixed(0)}°`}>
                  <Frame f={f} outlined={angDiff(f.az, hit.bearing) === hit.offBy} />
                  <span style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 10, background: 'rgba(0,0,0,0.6)', padding: '1px 4px' }}>
                    {COMPASS[Math.round(f.az / 45) % 8]} {Math.round(f.az)}°
                  </span>
                </a>
              ))}
            </div>
            <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
              From the rover position closest to this stop (<b>{Math.round(hit.dist)} m</b> away, sol {hit.station.sol}), looking
              {' '}<b>{COMPASS[Math.round(hit.bearing / 45) % 8]}</b> ({hit.bearing.toFixed(0)}°) toward the stop. The outlined frame points
              {' '}closest to it ({Math.round(hit.offBy)}° off). Click a frame for the original image.
            </div>
            <div style={{ fontSize: 10, color: '#7a8a7a', marginTop: 2 }}>
              {SITE.pov.credit} · pointing ≈ mast azimuth + rover heading; frames load from mars.nasa.gov
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
