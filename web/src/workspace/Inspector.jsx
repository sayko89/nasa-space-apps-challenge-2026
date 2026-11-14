/**
 * Global inspector — one consistent view for whatever was selected: a map point, a data layer or
 * dataset, a science stop or a route. Sections appear only when they have content:
 *   Overview · Scientific evidence · Mission relevance · Data source · Technical details
 * Values come from the site files, the provenance table and the planner state; none are estimated here.
 */
import { useMemo, useState } from 'react';
import { T, STATUS_COLOR } from '../ui/theme';
import { SITE, GRID_RES } from '../three/terrainGenerator';
import { CATEGORIES } from '../config/provenance';
import { getHeightMap, getSlopeMap, getHazardMap } from '../utils/heatmaps';
import { HAZARD_CLASSES } from '../utils/hazards';
import { cellIdx } from '../utils/evaAssessments';
import { localToLatLon } from '../terrain/siteData';
import { peekHomeMaps } from '../utils/pathfinder';
import { param } from '../config/marswalkProfile';
import { inspectPoint, pointRelevance } from '../utils/inspect';
import { routeModeExplanation } from '../utils/routeModes';
import { missionTimeline } from '../utils/missionTimeline';
import { fmtHM, fmtSignedHM } from '../utils/format';
import { ROUTE_COLORS } from '../utils/constants';
import { scienceStopCards } from './scienceCards';
import { PovViewer, nearestPanorama } from '../components/PovViewer';
import { ChemistryCard, hasChemistry } from '../components/ChemistryCard';

// How the app uses each data product (what it changes in the mission) — by provenance key
const USE = {
  terrain: 'Every route cost, the slope limit (no-go cells), walk-back times and the 3D surface.',
  rocks: 'Rock obstacles over the relief limit are no-go cells; rough ground is flagged.',
  reliefShading: 'Display only: lights the 3D terrain. Changes no number.',
  orthoImage: 'Display only: the image on the terrain and the map. Changes no number.',
  pov: 'Ground truth near a point; cells far from any rover image are flagged "known only from orbit".',
  roverTrack: 'Display only: the rover’s own traverse for context.',
  geology: 'Science-stop candidates (units and contacts) and the stop cards.',
  minerals: 'Science-stop candidates (CRISM classes).',
  thermal: 'Shown at stops and points as context (surface grain size / rock); no planning rule.',
  chemistry: 'Re-sample candidates where a rover-measured target stands out.',
  air: 'Air temperature on the timeline and the cuff card.',
  radiation: 'EVA dose on the route card and the cuff card.',
  spaceWeather: 'A solar particle event on the EVA date is a decision note.',
  sun: 'Daylight rule of the decision (home before sunset) and the scene lighting.',
  walkModel: 'Walking time of every route and the walk-back margin.',
};

const H = ({ children }) => <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: T.muted, margin: '10px 0 4px' }}>{children}</div>;
const KV = ({ k, v, mono = true }) => (v == null || v === '' ? null : (
  <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.45, padding: '1px 0' }}>
    <span style={{ color: T.muted, width: 104, flexShrink: 0 }}>{k}</span>
    <span style={{ color: T.text, fontFamily: mono ? T.mono : T.sans, minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
  </div>
));
const P = ({ children, c }) => <p style={{ margin: '3px 0', fontSize: 12, lineHeight: 1.5, color: c || T.text }}>{children}</p>;
const LEVEL_C = { block: T.nogo, caution: T.cond, info: T.text };

function Tabs({ tabs, tab, setTab }) {
  if (tabs.length < 2) return null;
  return (
    <div role="tablist" style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${T.rule}`, marginTop: 6, overflowX: 'auto' }}>
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
          style={{ all: 'unset', cursor: 'pointer', padding: '5px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            color: tab === id ? T.text : T.muted, borderBottom: `2px solid ${tab === id ? T.accent : 'transparent'}` }}>{label}</button>
      ))}
    </div>
  );
}

function SourceBlock({ rec }) {
  if (!rec) return <P c={T.muted}>No provenance record.</P>;
  const cat = CATEGORIES[rec.category];
  return (
    <>
      {cat && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.text, border: `1px solid ${cat.color}`, padding: '1px 6px', borderRadius: 2 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: cat.color }} />{cat.label}</div>}
      <KV k="Mission" v={rec.mission} mono={false} />
      <KV k="Instrument" v={rec.instrument} mono={false} />
      <KV k="Dataset" v={rec.source?.url ? <a href={rec.source.url} target="_blank" rel="noreferrer" style={{ color: T.info }}>{rec.source.title}</a> : rec.source?.title} mono={false} />
      <KV k="Acquired" v={rec.observed} mono={false} />
      {!rec.available && <P c={T.cond}>Not available for this site: {rec.reason}</P>}
    </>
  );
}
function TechBlock({ rec, extra = [] }) {
  if (!rec) return null;
  return (
    <>
      <KV k="Resolution" v={rec.resolution} mono={false} />
      <KV k="Coverage" v={rec.coverage} mono={false} />
      <KV k="Data type" v={rec.dataType} mono={false} />
      <KV k="Processing" v={rec.processing} mono={false} />
      <KV k="Status" v={rec.status} mono={false} />
      <KV k="Uncertainty" v={rec.uncertainty} mono={false} />
      <KV k="Limitations" v={rec.limitations} mono={false} />
      {extra.map(([k, v]) => <KV key={k} k={k} v={v} mono={false} />)}
    </>
  );
}

function usePointData(sel, ctx) {
  return useMemo(() => {
    if (sel?.type !== 'point') return null;
    const hm = peekHomeMaps();
    return inspectPoint(sel.x, sel.z, {
      site: SITE, n: GRID_RES, idxAt: (x, z) => { const i = cellIdx(x, z); return i >= 0 && i < GRID_RES * GRID_RES ? i : -1; },
      heights: getHeightMap(), slope: getSlopeMap(), hazard: getHazardMap(), hazardClasses: HAZARD_CLASSES,
      latLon: localToLatLon, home: ctx.home, route: ctx.route, stations: SITE.pov?.stations, toHome: hm?.toHome || null,
    });
  }, [sel, ctx.home, ctx.route]);
}

export default function Inspector({ selection, onClose, provByKey = {}, catalogItem = null, routes = null, activeRoute = null, setActiveRoute = null,
  science = null, waypoints = [], startMs = null, decisionFor = null, oxygenFor = null, onAddWaypoint = null, onSelect = null, compact = false }) {
  const [tab, setTab] = useState('overview');
  const [pov, setPov] = useState(null);
  const [chem, setChem] = useState(null);
  const route = activeRoute ? routes?.[activeRoute] : null;
  const home = waypoints?.[0] || null;
  const p = usePointData(selection, { home, route });
  const cards = useMemo(() => scienceStopCards(science), [science]);

  let title = '', kicker = '', tabs = [], body = {};
  const limits = { maxSlopeDeg: param('maxWalkableSlopeDeg'), maxRockReliefM: param('maxRockReliefM') };

  if (selection?.type === 'layer' && catalogItem) {
    const it = catalogItem, rec = provByKey[it.prov];
    kicker = it.kind === 'dataset' ? 'DATASET' : it.kind === 'drape' ? 'MAP LAYER' : it.kind === 'overlay' ? 'OVERLAY' : 'BASE LAYER';
    title = it.name;
    body.overview = <><P>{it.desc}</P>{rec?.name && rec.name !== it.name && <P c={T.muted}>Provenance record: {rec.name}</P>}</>;
    if (USE[it.prov]) body.mission = <P>{USE[it.prov]}</P>;
    if (rec) body.source = <SourceBlock rec={rec} />;
    if (rec) body.tech = <TechBlock rec={rec} extra={it.kind !== 'dataset' && SITE.meta?.projection?.proj4 ? [['CRS', SITE.meta.projection.proj4.replace(/ \+no_defs=True/, '')], ['Grid', `${SITE.meta.grid?.n} × ${SITE.meta.grid?.n} cells, ${SITE.meta.grid?.cell_m} m`]] : []} />;
  } else if (selection?.type === 'point' && p) {
    kicker = 'MAP POINT';
    title = p.latLon ? `${p.latLon.lat.toFixed(5)}°N ${p.latLon.lon.toFixed(5)}°E` : `x ${p.x.toFixed(0)}, z ${p.z.toFixed(0)}`;
    const rel = pointRelevance(p, limits);
    body.overview = (
      <>
        <KV k="From centre" v={`${Math.abs(p.x).toFixed(0)} m ${p.x >= 0 ? 'E' : 'W'}, ${Math.abs(p.z).toFixed(0)} m ${p.z <= 0 ? 'N' : 'S'}`} />
        <KV k="Elevation" v={Number.isFinite(p.elevationM) ? `${p.elevationM.toFixed(1)} m (MOLA datum)` : null} />
        <KV k="Slope" v={Number.isFinite(p.slopeDeg) ? `${p.slopeDeg.toFixed(1)}° (4 m cell; limit ${limits.maxSlopeDeg}°)` : null} />
        <KV k="Hazard" v={p.hazard ? p.hazard.name : 'none flagged'} mono={false} />
        <KV k="From home" v={Number.isFinite(p.homeDistM) ? `${p.homeDistM.toFixed(0)} m straight line` : null} />
        {onAddWaypoint && <button type="button" onClick={() => onAddWaypoint({ x: p.x, z: p.z })} style={{ marginTop: 8, all: 'unset', cursor: 'pointer', fontSize: 11, color: T.text,
          border: `1px solid ${T.ruleStrong}`, padding: '4px 8px', borderRadius: 2 }}>+ Add as waypoint</button>}
      </>
    );
    const ev = [];
    if (p.geology) ev.push(<KV key="g1" k="Bedrock unit" v={p.geology.bedrock} mono={false} />, <KV key="g2" k="Surface unit" v={p.geology.surface} mono={false} />);
    if (p.mineral) ev.push(<KV key="m" k="CRISM class" v={`${p.mineral.name}${p.mineral.confidence != null ? ` (confidence ${p.mineral.confidence === 2 ? 'high' : p.mineral.confidence === 1 ? 'medium' : p.mineral.confidence})` : ''}`} mono={false} />);
    if (p.thermal) ev.push(<KV key="t" k="Thermal inertia" v={`${p.thermal.value.toFixed(0)} ${p.thermal.unit || ''}${p.thermal.cls ? ` — ${p.thermal.cls}` : ''}`} />);
    if (Number.isFinite(p.rockReliefM)) ev.push(<KV key="r" k="Rock relief" v={`${p.rockReliefM.toFixed(2)} m in the 4 m cell (limit ${limits.maxRockReliefM} m)`} />);
    if (p.roverObs) {
      ev.push(<KV key="ro" k="Rover images" v={p.roverObs.map(o => `sol ${o.sol} · ${o.distM.toFixed(0)} m · ${o.frames} frames`).join('; ')} />);
      if (nearestPanorama(p.x, p.z)) ev.push(<button key="gv" type="button" onClick={() => setPov({ stop: { x: p.x, z: p.z }, label: title })}
        style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: T.info, textDecoration: 'underline', marginRight: 10 }}>open ground view</button>);
    }
    if (hasChemistry(p.x, p.z)) ev.push(<button key="ch" type="button" onClick={() => setChem({ stop: { x: p.x, z: p.z }, label: title })}
      style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: T.info, textDecoration: 'underline' }}>ChemCam targets nearby</button>);
    if (ev.length) body.evidence = <>{ev}{SITE.geology?.source?.kind === 'derived' && p.geology && <P c={T.cond}>Units here are this project&apos;s derived interpretation, not a published geological map.</P>}</>;
    body.mission = <>{rel.map((l, i) => <P key={i} c={LEVEL_C[l.level]}>{l.level === 'block' ? '■ ' : l.level === 'caution' ? '▲ ' : '· '}{l.text}</P>)}</>;
    const used = ['terrain', p.geology && 'geology', p.mineral && 'minerals', p.thermal && 'thermal', Number.isFinite(p.rockReliefM) && 'rocks', p.roverObs && 'pov'].filter(Boolean);
    body.source = <>{used.map(k => provByKey[k]).filter(Boolean).map(r => (
      <div key={r.key + r.name} style={{ fontSize: 12, padding: '2px 0', display: 'flex', gap: 6, alignItems: 'baseline' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: CATEGORIES[r.category]?.color, flexShrink: 0 }} />
        <span>{r.name}</span><span style={{ color: T.muted }}>— {r.instrument || r.mission}</span>
      </div>))}</>;
    body.tech = <><KV k="Grid cell" v={`#${p.cell} (${SITE.meta?.grid?.cell_m} m)`} /><KV k="CRS" v={SITE.meta?.projection?.proj4?.replace(/ \+no_defs=True/, '')} mono={false} /></>;
  } else if (selection?.type === 'stop') {
    const card = cards[selection.n - 1];
    const st = science?.stops?.[selection.n - 1];
    if (card && st) {
      kicker = `SCIENCE STOP S${card.n}`;
      title = card.name;
      const tl = route ? missionTimeline(route, { startMs }) : null;
      const row = tl?.rows?.find(r => Math.hypot(r.x - st.x, r.z - st.z) < 6);
      body.overview = (
        <>
          <KV k="Position" v={card.lat != null ? `${card.lat.toFixed(5)}°N ${card.lon.toFixed(5)}°E` : `${card.x.toFixed(0)}, ${card.z.toFixed(0)}`} />
          <KV k="Objective" v={card.objective} mono={false} />
          <KV k="Planned stay" v={`${card.visitMin} min`} />
          {row && <KV k="Arrive / leave" v={`${fmtHM(row.arriveS)} / ${fmtHM(row.departS)} after start`} />}
          {row && <KV k="Walk-back margin" v={fmtSignedHM(row.marginS)} />}
        </>
      );
      body.evidence = <><P><b>Why chosen:</b> {card.why}</P><P><b>Investigate:</b> {card.investigate}</P><P><b>Evidence:</b> {card.evidence.join(' · ') || '—'}</P>
        {card.uncertainty && <P c={T.cond}><b>Uncertainty:</b> {card.uncertainty}</P>}</>;
      body.mission = <><P c={card.risk.level === 'high' ? T.nogo : card.risk.level === 'moderate' ? T.cond : T.text}><b>Terrain risk:</b> {card.risk.level} — {card.risk.reason}</P>
        <P><b>Data confidence:</b> {card.confidence.level} — {card.confidence.reason}</P>
        {onSelect && <button type="button" onClick={() => onSelect({ type: 'point', x: st.x, z: st.z })} style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: T.info, textDecoration: 'underline' }}>inspect the ground at this stop</button>}</>;
      body.source = <>{card.layers.map(k => provByKey[k]).filter(Boolean).map(r => <SourceLine key={r.key + r.name} r={r} />)}</>;
    }
  } else if (selection?.type === 'route' && routes?.[selection.mode]) {
    const r = routes[selection.mode], s = r.stats, ex = routeModeExplanation(selection.mode, param('maxWalkableSlopeDeg'));
    const d = decisionFor?.(r);
    const ox = oxygenFor?.(r);
    const tl = missionTimeline(r, { startMs, oxygen: ox });
    kicker = 'ROUTE';
    title = `${selection.mode} — ${ex.goal}`;
    body.overview = (
      <>
        {d && <div style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 2, fontWeight: 700, fontSize: 11, background: STATUS_COLOR[d.status], color: '#0d0f12' }}>{d.status}</div>}
        {d?.summary && <P>{d.summary}</P>}
        <KV k="Distance" v={`${(s.distance / 1000).toFixed(2)} km`} />
        <KV k="Walking" v={fmtHM(s.walkTimeS)} />
        <KV k="Round trip" v={Number.isFinite(s.roundTripS) ? `${fmtHM(s.roundTripS)} of ${fmtHM(s.budgetS)}` : null} />
        <KV k="Min. margin" v={Number.isFinite(s.minMarginS) ? fmtSignedHM(s.minMarginS) : null} />
        <KV k="Max slope" v={Number.isFinite(s.maxSlopeDeg) ? `${s.maxSlopeDeg.toFixed(1)}°` : null} />
        {setActiveRoute && selection.mode !== activeRoute && <button type="button" onClick={() => setActiveRoute(selection.mode)} style={{ marginTop: 6, all: 'unset', cursor: 'pointer', fontSize: 11,
          border: `1px solid ${ROUTE_COLORS[selection.mode]}`, padding: '3px 8px', borderRadius: 2 }}>Make active</button>}
      </>
    );
    if (tl) body.evidence = (
      <div style={{ fontSize: 11.5 }}>
        {tl.items.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', borderBottom: `1px solid ${T.rule}` }}>
            <span style={{ fontFamily: T.mono, color: T.muted, width: 92, flexShrink: 0 }}>{fmtHM(it.t0)}–{fmtHM(it.t1)}</span>
            <span style={{ color: it.kind === 'stop' ? T.accent : T.text }}>{it.label}{it.distM ? ` · ${it.distM.toFixed(0)} m` : ''}</span>
          </div>
        ))}
      </div>
    );
    body.mission = <>{(d?.hard || []).filter(h => !h.ok).map(h => <P key={h.key} c={T.nogo}>■ {h.label || h.key}: {h.detail}</P>)}
      {(d?.environment || []).filter(e => !e.ok).map(e => <P key={e.key} c={T.cond}>▲ {e.label || e.key}: {e.detail}</P>)}
      {(d?.notes || []).map((n, i) => <P key={i} c={T.muted}>· {n.label || n.key}: {n.detail}</P>)}
      {(d?.missing || []).map((n, i) => <P key={`m${i}`} c={T.insuf}>? {n.label || n.key}: {n.detail}</P>)}
      {!(d?.hard || []).some(h => !h.ok) && !(d?.environment || []).some(e => !e.ok) && <P>Every hard constraint is met and no environmental condition is open.</P>}</>;
    body.tech = <><KV k="Search" v="A* on the 4 m grid, then the walk-back check (Dijkstra from home)" mono={false} /><KV k="Step cost" v={ex.formula} mono={false} /><P c={T.muted}>{ex.effect}</P></>;
  }

  const ALL = [['overview', 'Overview'], ['evidence', selection?.type === 'route' ? 'Segments' : 'Scientific evidence'], ['mission', 'Mission relevance'], ['source', 'Data source'], ['tech', 'Technical']];
  tabs = ALL.filter(([id]) => body[id]);
  const cur = body[tab] ? tab : tabs[0]?.[0];

  return (
    <div aria-label="Inspector" style={{ fontFamily: T.sans, color: T.text }}>
      {pov && <PovViewer stop={pov.stop} label={pov.label} onClose={() => setPov(null)} />}
      {chem && <ChemistryCard stop={chem.stop} label={chem.label} onClose={() => setChem(null)} />}
      {!selection || !tabs.length ? (
        <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>INSPECTOR</div>
          Click the terrain to inspect a point, or ⓘ on any layer in the catalog. Stops and routes open here too.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: T.accent }}>{kicker}</div>
              <div style={{ fontSize: compact ? 13 : 14, fontWeight: 600, lineHeight: 1.3, marginTop: 1 }}>{title}</div>
            </div>
            {onClose && <button type="button" onClick={onClose} aria-label="Close inspector" style={{ all: 'unset', cursor: 'pointer', color: T.muted, fontSize: 14, padding: '0 3px' }}>✕</button>}
          </div>
          <Tabs tabs={tabs} tab={cur} setTab={setTab} />
          <div role="tabpanel" style={{ paddingTop: 6 }}>{body[cur]}</div>
        </>
      )}
    </div>
  );
}

function SourceLine({ r }) {
  return (
    <div style={{ fontSize: 12, padding: '2px 0', display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: CATEGORIES[r.category]?.color, flexShrink: 0 }} />
      <span>{r.name}</span><span style={{ color: T.muted }}>— {r.instrument || r.mission}</span>
    </div>
  );
}

export { H as InspectorHeading };
