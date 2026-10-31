/**
 * Ground view: the Perseverance Navcam panorama taken closest to a science stop,
 * turned toward the stop — "what the crew will see when they get there".
 * Data: public/sites/<site>/pov.json (pipeline/build_pov.py).
 */
import { useEffect, useRef, useState } from 'react';
import { SITE } from '../three/terrainGenerator';

const FOV = 120;              // degrees of the panorama shown
const MAX_DIST_M = 400;       // farther than this the photo says little about the stop

/** Nearest panorama to (x, z) and the bearing from it to the point (0° = north, clockwise). */
export function nearestPanorama(x, z) {
  const list = SITE.pov?.panoramas;
  if (!list?.length) return null;
  let best = null;
  for (const p of list) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (!best || d < best.dist) best = { pano: p, dist: d };
  }
  if (!best || best.dist > MAX_DIST_M) return null;
  const east = x - best.pano.x, north = -(z - best.pano.z);
  const bearing = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  return { ...best, bearing };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function PovViewer({ stop, label, onClose }) {
  const hit = nearestPanorama(stop.x, stop.z);
  const ref = useRef(null);
  const [img, setImg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!hit) return;
    const im = new Image();
    im.onload = () => setImg(im);
    im.onerror = () => setErr('Could not load the panorama.');
    im.src = `${import.meta.env.BASE_URL}sites/${SITE.name}/${hit.pano.file}`;
  }, [hit?.pano.file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !img || !hit) return;
    const ctx = cv.getContext('2d');
    const [az0, az1] = hit.pano.az;
    const pxPerDeg = img.width / (az1 - az0);
    const w = FOV * pxPerDeg;
    let sx = ((hit.bearing - FOV / 2 - az0) % 360 + 360) % 360 * pxPerDeg;
    cv.width = Math.round(w); cv.height = img.height;
    // draw with wrap-around at 360°
    const first = Math.min(w, img.width - sx);
    ctx.drawImage(img, sx, 0, first, img.height, 0, 0, first, img.height);
    if (first < w) ctx.drawImage(img, 0, 0, w - first, img.height, first, 0, w - first, img.height);
    // marker toward the stop
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = Math.max(2, w / 400);
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, img.height); ctx.stroke();
  }, [img, hit]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1100px, 100%)', background: '#0b0f0b',
        border: '1px solid rgba(255,179,71,0.45)', borderRadius: 6, padding: 12, fontFamily: 'monospace', color: '#d8d0b8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8 }}>
          <b style={{ color: '#ffb347', fontSize: 13 }}>GROUND VIEW — {label}</b>
          <span onClick={onClose} style={{ cursor: 'pointer', color: '#889' }}>✕ close</span>
        </div>
        {!hit ? (
          <div style={{ fontSize: 12, padding: '24px 0', textAlign: 'center' }}>
            No Perseverance panorama within {MAX_DIST_M} m of this stop. This part of the site has only been seen from orbit.
          </div>
        ) : err ? <div style={{ fontSize: 12 }}>{err}</div> : (
          <>
            <canvas ref={ref} style={{ width: '100%', display: 'block', borderRadius: 3, background: '#111' }} />
            <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
              Looking <b>{COMPASS[Math.round(hit.bearing / 45) % 8]}</b> ({hit.bearing.toFixed(0)}°) toward the stop, which is
              <b> {Math.round(hit.dist)} m</b> away (dashed line). Navcam mosaic taken by Perseverance on <b>sol {hit.pano.sol}</b>
              {' '}(site/drive {hit.pano.rmc.replace('_', '/')}), {FOV}° of the 360° view shown.
            </div>
            <div style={{ fontSize: 10, color: '#7a8a7a', marginTop: 2 }}>
              {SITE.pov.credit} · <a href={hit.pano.source} target="_blank" rel="noreferrer" style={{ color: '#ffb080' }}>full-resolution mosaic</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
