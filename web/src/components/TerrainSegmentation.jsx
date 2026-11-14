/**
 * Mars AI Terrain Segmentation — inspect the model's image-level predictions for this site's rover images.
 * Original image · overlay (opacity) · mask · confidence; legend, class statistics, confidence summary,
 * source-image metadata, model version and dataset provenance. Predictions come from the pipeline
 * (pipeline/segmentation/), cached per image: nothing is re-computed in the browser.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fs } from '../ui/layout';
import { SITE } from '../three/terrainGenerator';
import { SEG_CLASSES, UNKNOWN, DEFAULT_PALETTE, colorizeMask, colorizeConfidence, maskStats, nearestPrediction } from '../utils/segmentation';

const BASE = () => `${import.meta.env.BASE_URL}`;
const C = { dim: '#7a9a7a', text: '#e8e0c8', body: '#b8c8b0', warn: '#ffc94d' };

function useJson(url) {
  const [state, set] = useState({ loading: true });
  useEffect(() => {
    let on = true; set({ loading: true });
    fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(j => on && set({ data: j })).catch(e => on && set({ error: e.message }));
    return () => { on = false; };
  }, [url]);
  return state;
}

/** Draws the mask (or confidence) PNG of one prediction onto a canvas the size of the photo. */
function MaskCanvas({ src, kind, palette, threshold, onStats }) {
  const ref = useRef(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const cv = ref.current; if (!cv) return;
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height);
      const g = new Uint8ClampedArray(cv.width * cv.height);
      for (let i = 0; i < g.length; i++) g[i] = d.data[i * 4];
      const rgba = kind === 'confidence' ? colorizeConfidence(g, threshold) : colorizeMask(g, palette, 255, 120);
      d.data.set(rgba); ctx.putImageData(d, 0, 0);
      if (kind !== 'confidence' && onStats) onStats(maskStats(g));
    };
    img.src = src;
  }, [src, kind, palette, threshold]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated' }} />;
}

export default function TerrainSegmentation({ crewPos = null }) {
  const site = SITE.name;
  const idx = useJson(`${BASE()}sites/${site}/segmentation/index.json`);
  const card = useJson(`${BASE()}models/mars-terrain-v1.json`);
  const [sel, setSel] = useState(null);
  const [view, setView] = useState('overlay');         // original | overlay | mask | confidence
  const [opacity, setOpacity] = useState(0.55);
  const [stats, setStats] = useState(null);
  const [photoOk, setPhotoOk] = useState(true);
  const items = useMemo(() => idx.data?.items || [], [idx.data]);
  const palette = useMemo(() => {
    const p = card.data?.palette; if (!p) return DEFAULT_PALETTE;
    return Object.fromEntries(Object.entries(p).map(([k, v]) => [Number(k), v]));
  }, [card.data]);
  const it = items.find(x => x.id === sel) || items[0] || null;
  useEffect(() => { setStats(null); setPhotoOk(true); }, [it?.id]);
  const near = crewPos && items.length ? nearestPrediction(items, crewPos.x, crewPos.z) : null;
  const thr = idx.data?.low_confidence_threshold ?? card.data?.low_confidence_threshold ?? 0.5;

  if (idx.loading) return <div style={{ fontSize: fs(7), color: C.dim }}>Loading predictions…</div>;
  if (idx.error || !items.length) {
    return (
      <div style={{ fontSize: fs(7), color: C.warn, lineHeight: 1.5 }}>
        No terrain-segmentation predictions for this site{idx.error ? ` (${idx.error})` : ''}. The Mars model and its predictions are
        produced by <code>pipeline/segmentation</code> (GitHub workflow "Mars terrain segmentation"); until they exist, nothing is shown.
      </div>
    );
  }
  const mask = `${BASE()}sites/${site}/segmentation/${it.id}.png`;
  const conf = `${BASE()}sites/${site}/segmentation/${it.id}.conf.png`;
  const ar = it.mask_size[0] / it.mask_size[1];
  const byStation = items.reduce((m, x) => ((m[x.station] = m[x.station] || []).push(x), m), {});
  const pct = (v) => `${(100 * v).toFixed(1)} %`;
  const btn = (k, l) => (
    <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
      style={{ flex: 1, fontFamily: 'monospace', fontSize: fs(7), padding: '1px 0', cursor: 'pointer', borderRadius: 2,
        background: view === k ? 'rgba(60,120,60,0.45)' : 'transparent', color: view === k ? '#cfffcf' : '#6a8a6a', border: `1px solid ${view === k ? '#7fd07f' : 'rgba(80,120,60,0.4)'}` }}>{l}</button>
  );

  return (
    <div aria-label="Mars AI terrain segmentation" style={{ fontSize: fs(7), color: C.body, lineHeight: 1.45 }}>
      <div style={{ color: C.warn, marginBottom: 3 }}>
        Model prediction on single rover images ({idx.data.model}) — not a NASA measurement, not georeferenced: shown per image, never on the map,
        and it does not change routes or safety rules.
      </div>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span>Image</span>
        <select aria-label="Rover image" value={it.id} onChange={e => setSel(e.target.value)}
          style={{ flex: 1, minWidth: 0, background: '#0a140a', color: C.text, border: '1px solid #345', fontFamily: 'monospace', fontSize: fs(7) }}>
          {Object.entries(byStation).map(([st, xs]) => (
            <optgroup key={st} label={`sol ${xs[0].sol} · position ${st}`}>
              {xs.map(x => <option key={x.id} value={x.id}>{x.camera} az {Math.round(x.azimuth_deg)}° el {Math.round(x.elevation_deg)}° · sand {pct(x.fractions.sand)} · rock {pct(x.fractions.big_rock)}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {near && (
        <button type="button" onClick={() => setSel(near.item.id)} style={{ marginTop: 3, width: '100%', fontFamily: 'monospace', fontSize: fs(7), cursor: 'pointer',
          background: 'transparent', color: '#9fd0ff', border: '1px solid rgba(136,204,255,0.4)', borderRadius: 2 }}>
          NEAREST TO EV1 — rover position {Math.round(near.distanceM)} m away (sol {near.item.sol})
        </button>
      )}
      <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>{btn('original', 'ORIGINAL')}{btn('overlay', 'OVERLAY')}{btn('mask', 'MASK')}{btn('confidence', 'CONFIDENCE')}</div>
      {view === 'overlay' && (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
          <span>Opacity</span>
          <input type="range" aria-label="Overlay opacity" min={0} max={1} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ flex: 1 }} />
          <span style={{ width: 30 }}>{Math.round(opacity * 100)} %</span>
        </label>
      )}
      <div style={{ position: 'relative', width: '100%', aspectRatio: String(ar), marginTop: 4, background: '#111', border: '1px solid rgba(80,120,60,0.3)' }}>
        {view !== 'mask' && view !== 'confidence' && (
          <img src={it.image_url} alt={`${it.mission} ${it.camera} sol ${it.sol}`} onError={() => setPhotoOk(false)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', filter: 'grayscale(1)' }} />
        )}
        {view !== 'original' && (
          <div style={{ position: 'absolute', inset: 0, opacity: view === 'overlay' ? opacity : 1 }}>
            <MaskCanvas src={view === 'confidence' ? conf : mask} kind={view === 'confidence' ? 'confidence' : 'mask'} palette={palette} threshold={thr} onStats={setStats} />
          </div>
        )}
        {!photoOk && view !== 'mask' && view !== 'confidence' && (
          <div style={{ position: 'absolute', left: 4, bottom: 4, color: C.warn, background: 'rgba(0,0,0,0.6)', padding: '1px 4px' }}>photo did not load (it comes from mars.nasa.gov)</div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', marginTop: 3 }} aria-label="Legend">
        {SEG_CLASSES.map(c => <span key={c.key}><span style={{ display: 'inline-block', width: 8, height: 8, background: `rgb(${palette[c.value]})`, marginRight: 3 }} />{c.label}</span>)}
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: `rgb(${palette[UNKNOWN]})`, marginRight: 3 }} />Unknown / low confidence (&lt; {thr})</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 3 }} aria-label="Class statistics">
        <tbody>
          {['soil', 'bedrock', 'sand', 'big_rock', 'unknown'].map(k => (
            <tr key={k}><td style={{ color: C.dim }}>{k === 'big_rock' ? 'big rock' : k}</td>
              <td style={{ textAlign: 'right', color: C.text }}>{pct(it.fractions[k])}</td>
              <td style={{ textAlign: 'right', color: C.dim }}>{stats ? `${stats.counts[k].toLocaleString()} px` : ''}</td></tr>
          ))}
        </tbody>
      </table>
      <div>Processed {stats ? stats.pixels.toLocaleString() : (it.mask_size[0] * it.mask_size[1]).toLocaleString()} pixels ({it.mask_size[0]}×{it.mask_size[1]}) ·
        confidence mean {it.confidence.mean}, median {it.confidence.median}, 10th percentile {it.confidence.p10}</div>
      <div style={{ color: C.dim, marginTop: 2 }}>
        Source: {it.mission}, {it.camera}, sol {it.sol}{it.utc ? `, ${it.utc.slice(0, 16).replace('T', ' ')} UTC` : ''} · image {it.image_size[0]}×{it.image_size[1]} ·
        {' '}<a href={it.source_page || it.image_url} target="_blank" rel="noreferrer" style={{ color: '#9fd0ff' }}>{it.id}</a> · taken from rover position {it.station}
        {' '}({it.rover_lat.toFixed(5)}°, {it.rover_lon.toFixed(5)}°E), looking az {Math.round(it.azimuth_deg)}° (approx.) el {Math.round(it.elevation_deg)}° · {idx.data.credit}
      </div>
      <div style={{ color: C.dim }}>
        Model {idx.data.model}{card.data ? ` (${card.data.selected}, chosen on validation)` : ''} · predicted {idx.data.predicted_utc?.slice(0, 10)} ·
        trained on AI4Mars v0.6 (NASA JPL, doi:10.5281/zenodo.15995036, CC BY 4.0) · labels beyond ~30 m and on the rover itself were masked in training,
        so far-field and rover-hardware pixels are unreliable.
      </div>
    </div>
  );
}
