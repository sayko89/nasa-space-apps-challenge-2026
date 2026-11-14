/**
 * Data catalog (Explore / Analyze, left): every layer and dataset the site loaded, by category
 * (config/catalog.js). Map layers: visibility, opacity and order (several can be draped at once).
 * Every row opens the inspector with its description, provenance and metadata.
 */
import { useMemo, useState } from 'react';
import { T } from '../ui/theme';
import { CATEGORIES } from '../config/provenance';
import { filterCatalog } from '../config/catalog';
import { geologyLegend, dataLayerLegend, hazardLegend, HAZARD_LAYER } from '../utils/heatmaps';
import { RELIEF_SCALES } from '../utils/relief';

const row = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 10px', fontSize: 13.5 };
const tiny = { all: 'unset', cursor: 'pointer', fontSize: 11.5, color: T.muted, padding: '1px 5px', border: `1px solid ${T.rule}`, borderRadius: 2, lineHeight: 1.3 };

function Legend({ layer }) {
  const g = geologyLegend(layer);
  const d = dataLayerLegend(layer);
  const h = layer === HAZARD_LAYER ? hazardLegend() : null;
  const entries = g || (d?.kind === 'classes' ? d.entries : null) || h;
  if (entries) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', padding: '2px 0 0' }}>
        {entries.slice(0, 10).map(e => (
          <span key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: T.muted }} title={e.pct != null ? `${e.pct.toFixed(1)} % of the site` : undefined}>
            <span style={{ width: 8, height: 8, background: e.color, display: 'inline-block', flexShrink: 0 }} />{e.name}
          </span>
        ))}
      </div>
    );
  }
  if (d?.kind === 'range') return <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>{d.lo} – {d.hi} {d.unit}</div>;
  return null;
}

export default function LayerCatalog({ catalog, provByKey = {}, selectedId = null, onInspect,
  orthoOn, setOrthoOn, wireframe, setWireframe, reliefScale, setReliefScale, showTrack, setShowTrack,
  drapes, setDrapes, focus = null, style = {} }) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState({});
  const cats = useMemo(() => {
    const c = filterCatalog(catalog, q);
    return focus ? [...c.filter(x => focus.includes(x.id)), ...c.filter(x => !focus.includes(x.id))] : c;
  }, [catalog, q, focus]);
  const drapeIdx = (layer) => drapes.findIndex(d => d.layer === layer);
  const toggleDrape = (layer) => setDrapes(ds => (ds.some(d => d.layer === layer) ? ds.filter(d => d.layer !== layer) : [...ds, { layer, opacity: 0.6 }]));
  const setOpacity = (layer, opacity) => setDrapes(ds => ds.map(d => (d.layer === layer ? { ...d, opacity } : d)));
  const move = (layer, dir) => setDrapes(ds => {
    const i = ds.findIndex(d => d.layer === layer), j = i + dir;
    if (i < 0 || j < 0 || j >= ds.length) return ds;
    const out = ds.slice(); [out[i], out[j]] = [out[j], out[i]]; return out;
  });
  const visible = (it) => {
    if (it.kind === 'drape') return drapeIdx(it.layer) >= 0;
    if (it.id === 'base:ortho') return !wireframe && orthoOn;
    if (it.id === 'overlay:track') return showTrack;
    return null;
  };
  const toggle = (it) => {
    if (it.kind === 'drape') toggleDrape(it.layer);
    else if (it.id === 'base:ortho') { setWireframe(false); setOrthoOn(!orthoOn); }
    else if (it.id === 'overlay:track') setShowTrack(v => !v);
  };

  return (
    <aside aria-label="Data catalog" style={{ display: 'flex', flexDirection: 'column', background: T.panel, borderRight: `1px solid ${T.rule}`,
      fontFamily: T.sans, color: T.text, minHeight: 0, ...style }}>
      <div style={{ padding: '10px 10px 8px', borderBottom: `1px solid ${T.rule}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1.2, color: T.text }}>DATA CATALOG</span>
          {drapes.length > 0 && <button type="button" style={tiny} onClick={() => setDrapes([])} title="Hide every draped layer">clear {drapes.length}</button>}
        </div>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search layers and datasets" aria-label="Search the data catalog"
          style={{ marginTop: 7, width: '100%', boxSizing: 'border-box', background: T.sunken, border: `1px solid ${T.ruleStrong}`, color: T.text,
            borderRadius: 2, padding: '6px 8px', fontSize: 13.5, fontFamily: T.sans, outline: 'none' }} />
        <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.4 }}>Tick a layer to show it on the 3D terrain · ⓘ = what it is and where the data comes from</div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {cats.map(c => {
          const isClosed = closed[c.id] && !q;
          return (
            <div key={c.id} style={{ borderBottom: `1px solid ${T.rule}` }}>
              <button type="button" onClick={() => setClosed(s => ({ ...s, [c.id]: !s[c.id] }))} aria-expanded={!isClosed}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', boxSizing: 'border-box', padding: '7px 10px 5px',
                  fontSize: 11.5, fontWeight: 700, letterSpacing: 1, color: T.muted }}>
                <span style={{ width: 12 }}>{isClosed ? '▸' : '▾'}</span>{c.label.toUpperCase()}
                <span style={{ marginLeft: 'auto', fontWeight: 400, fontFamily: T.mono }}>{c.items.length}</span>
              </button>
              {!isClosed && c.items.map(it => {
                const vis = visible(it);
                const di = it.kind === 'drape' ? drapeIdx(it.layer) : -1;
                const pv = provByKey[it.prov];
                const cat = pv ? CATEGORIES[pv.category] : null;
                const sel = selectedId === it.id;
                return (
                  <div key={it.id} style={{ background: sel ? T.raised : 'transparent', borderLeft: `2px solid ${sel ? T.accent : 'transparent'}` }}>
                    <div style={row}>
                      {vis !== null ? (
                        <input type="checkbox" checked={!!vis} onChange={() => toggle(it)} aria-label={`Show ${it.name}`} style={{ margin: 0, accentColor: T.accent }} />
                      ) : <span style={{ width: 13, textAlign: 'center', color: T.faint, fontSize: 10 }} title={it.always ? 'always shown' : 'dataset (not a map layer)'}>{it.always ? '■' : '·'}</span>}
                      <button type="button" onClick={() => onInspect(it)} title="Inspect: description, source, metadata"
                        style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.text }}>
                        {it.name}
                      </button>
                      {cat && <span title={cat.label} style={{ width: 7, height: 7, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />}
                      <button type="button" onClick={() => onInspect(it)} aria-label={`Information on ${it.name}`} style={{ ...tiny, border: 'none', color: T.info }}>ⓘ</button>
                    </div>
                    {it.id === 'base:relief' && setReliefScale && (
                      <div style={{ display: 'flex', gap: 4, padding: '0 10px 6px 31px', alignItems: 'center' }}>
                        {RELIEF_SCALES.map(k => (
                          <button key={k} type="button" onClick={() => setReliefScale(k)} aria-pressed={reliefScale === k}
                            title={k === 1 ? 'True slopes' : `Shading ×${k}: slopes drawn ${k}× steeper (numbers unchanged)`}
                            style={{ ...tiny, color: reliefScale === k ? T.text : T.muted, borderColor: reliefScale === k ? T.accent : T.rule }}>
                            {k === 1 ? 'RELIEF ×1' : `×${k}`}</button>
                        ))}
                        {reliefScale > 1 && <span style={{ fontSize: 10, color: T.cond }}>emphasised</span>}
                      </div>
                    )}
                    {it.id === 'base:dtm' && setWireframe && (
                      <div style={{ display: 'flex', gap: 4, padding: '0 10px 6px 31px' }}>
                        <button type="button" style={{ ...tiny, color: wireframe ? T.text : T.muted, borderColor: wireframe ? T.accent : T.rule }}
                          onClick={() => setWireframe(!wireframe)} aria-pressed={wireframe}>WIREFRAME</button>
                      </div>
                    )}
                    {di >= 0 && (
                      <div style={{ padding: '0 10px 7px 31px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="range" min={0.1} max={1} step={0.05} value={drapes[di].opacity} aria-label={`${it.name} opacity`}
                            onChange={e => setOpacity(it.layer, Number(e.target.value))} style={{ flex: 1, accentColor: T.accent }} />
                          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, width: 30 }}>{Math.round(drapes[di].opacity * 100)}%</span>
                          {drapes.length > 1 && <>
                            <button type="button" style={tiny} onClick={() => move(it.layer, 1)} disabled={di === drapes.length - 1} title="Draw above the next layer">▲</button>
                            <button type="button" style={tiny} onClick={() => move(it.layer, -1)} disabled={di === 0} title="Draw below the previous layer">▼</button>
                          </>}
                        </div>
                        {drapes.length > 1 && <div style={{ fontSize: 10, color: T.faint }}>order {di + 1} of {drapes.length} (higher draws on top)</div>}
                        <Legend layer={it.layer} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {cats.length === 0 && <div style={{ padding: 12, fontSize: 12, color: T.muted }}>Nothing matches “{q}”.</div>}
      </div>
      <div style={{ padding: '6px 10px', borderTop: `1px solid ${T.rule}`, display: 'flex', flexWrap: 'wrap', gap: '2px 9px' }}>
        {Object.entries(CATEGORIES).map(([k, c]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: T.muted }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color }} />{c.label}
          </span>
        ))}
      </div>
    </aside>
  );
}
