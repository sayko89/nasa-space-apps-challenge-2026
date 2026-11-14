/** Workflow strip, mission summary and the GO / CONDITIONAL / NO-GO / INSUFFICIENT DATA badge and detail. */
import { fs } from '../ui/layout';
import { fmtHM, fmtSignedHM } from '../utils/format';
import { radiationIsLocal } from '../utils/radiation';
import { findObjective } from '../config/objectives';
import { getHazardMap } from '../utils/heatmaps';
import { STATUS_STYLE } from '../utils/missionStatus';
import { routeHazards } from '../utils/hazards';
import { param } from '../config/marswalkProfile';
import { SITE } from '../three/terrainGenerator';
import { useSpaceWeather } from '../hooks/useSpaceWeather';
import { evaAssessments, cellIdx } from '../utils/evaAssessments';
import { T } from '../ui/theme';

export function WorkflowStrip({ steps, onStep }) {
  const next = steps.find(s => !s.done);
  return (
    <div aria-label="Mission workflow" style={{ border:`1px solid ${T.rule}`, borderRadius:2, padding:'5px 6px', background:T.sunken }}>
      <div style={{ display:'flex', gap:2 }}>
        {steps.map(st => (
          <button key={st.n} type="button" onClick={() => onStep(st)} title={`${st.n}. ${st.label}${st.done ? ' ✓' : ''}`}
            style={{ flex:1, minWidth:0, padding:'2px 0', borderRadius:2, cursor:'pointer', fontFamily:'monospace', fontSize:fs(7), fontWeight:'bold',
              border:`1px solid ${st === next ? T.accent : st.done ? 'rgba(79,180,119,0.55)' : T.rule}`,
              background: st.done ? 'rgba(79,180,119,0.16)' : st === next ? T.accentSoft : 'transparent',
              color: st.done ? T.go : st === next ? '#f2c6a0' : T.faint }}>{st.done ? '✓' : st.n}</button>
        ))}
      </div>
      <div style={{ fontSize:fs(7.5), color:T.muted, marginTop:4, fontFamily:T.sans }}>
        {next ? <>Next: <b style={{ color:T.text }}>{next.n}. {next.label}</b> — opens the workspace that holds it</> : `All ${steps.length} steps done.`}
      </div>
    </div>
  );
}

/** Mission summary for the active route — every figure is one the planner already computed. */
export function MissionSummary({ routes, activeRoute, science, mission, startMs }) {
  const wxState = useSpaceWeather(startMs);
  const r = routes?.[activeRoute], s = r?.stats;
  if (!s || s.walkTimeS === undefined) return null;
  const A = evaAssessments(r, wxState, { mission, startMs });
  const d = A.decision;
  const hz = getHazardMap();
  const hazards = hz && r.path ? routeHazards(r.path, hz.cls, cellIdx).filter(h => h.key !== 'unseen') : [];
  const obj = findObjective(SITE.name, science?.objectiveId);
  const row = (k, v, c) => (
    <div style={{ display:'flex', justifyContent:'space-between', gap:6 }}><span style={{ color:'#7a9a7a' }}>{k}</span><span style={{ color: c || '#e8e0c8', textAlign:'right' }}>{v}</span></div>);
  return (
    <div style={{ marginBottom:6, padding:'4px 6px', border:`1px solid ${STATUS_STYLE[d.status].bg}`, borderRadius:4, fontSize:fs(7.5), lineHeight:1.55 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:2 }}>
        <b style={{ color:'#cfe8c8', letterSpacing:'0.08em' }}>MISSION SUMMARY · {activeRoute}</b><DecisionBadge d={d} />
      </div>
      {row('Objective', obj ? obj.name : 'none (hand-made route)')}
      {row('Site', SITE.meta?.label || SITE.name)}
      {row('Science stops', s.stopCount)}
      {row('Walking distance', `${(s.distance / 1000).toFixed(2)} km`)}
      {row('EVA duration', `${fmtHM(s.roundTripS)} of ${param('evaDurationH')} h`)}
      {row('Tightest walk-back margin', Number.isFinite(s.minMarginS) ? fmtSignedHM(s.minMarginS) : 'no path home', s.checks.budget ? undefined : '#ff6655')}
      {row('Max slope', `${s.maxSlopeDeg.toFixed(1)}° / ${param('maxWalkableSlopeDeg')}°`, s.checks.slope ? undefined : '#ff6655')}
      {row('Major hazards on route', hazards.length ? hazards.slice(0, 3).map(h => `${h.name} ${Math.round(h.lengthM)} m`).join(' · ') : 'none flagged')}
      {row('Radiation', `${s.radiation.doseMSv.toFixed(2)} mSv GCR${radiationIsLocal() ? '' : ' (Gale reference)'}`)}
      {row('Space weather', wxState.wx?.advisory === 'clear' ? 'no SEP ±2 d' : wxState.wx?.advisory === 'postpone' ? 'SEP — postpone' : 'unknown', wxState.wx?.advisory === 'clear' ? undefined : '#ffc94d')}
      {A.payload && row('A. Payload & mass', A.payload.status, A.payload.status === 'WITHIN LIMIT' ? undefined : A.payload.status === 'OVER LIMIT' ? '#ff6655' : '#ffc94d')}
      {A.dust && row('B. Dust & equipment', `${A.dust.level} exposure · ${A.dust.warnings.filter(w => w.level !== 'info').length} warnings`, '#ffc94d')}
      {A.oxygen && row('Oxygen', A.oxygen.valid ? `${A.oxygen.initialKg.toFixed(2)} kg · ${A.oxygen.rateKgH} kg/h · ${A.oxygen.reserveOk ? 'return + reserve covered' : A.oxygen.returnOk ? 'reserve not kept' : 'NOT enough to return'}` : 'insufficient data',
        A.oxygen.valid && A.oxygen.reserveOk ? undefined : A.oxygen.valid && A.oxygen.returnOk ? '#ffc94d' : '#ff6655')}
      {row('C. Terrain & mobility', A.mobility.status, A.mobility.status === 'PASS' ? undefined : A.mobility.status === 'FAIL' ? '#ff6655' : '#ffc94d')}
      <div style={{ color:'#9ab09a', marginTop:2 }}>{d.summary}</div>
    </div>
  );
}

// ---- Marswalk (DEM) stats card body ----
export function DecisionBadge({ d }) {
  const st = STATUS_STYLE[d.status];
  return <span title={d.summary} style={{ fontSize:fs(7.5), fontWeight:'bold', padding:'1px 5px', borderRadius:3, color: st.fg, background: st.bg }}>{d.status}</span>;
}

/** Why the route is GO / CONDITIONAL / NO-GO / INSUFFICIENT DATA (utils/missionStatus.js). */
export function DecisionDetail({ d }) {
  const mark = (ok) => (ok === true ? ['✓', '#88dd99'] : ok === false ? ['✕', '#ff6655'] : ['?', '#ffc94d']);
  const Row = ({ it }) => { const [m, c] = mark(it.ok); return (
    <div><span style={{ color: c, fontWeight: 'bold' }}>{m}</span> {it.label} <span style={{ color: '#7a8a7a' }}>— {it.detail}</span></div>); };
  return (
    <div style={{ marginTop:4, padding:'3px 5px', border:'1px solid rgba(80,120,80,0.35)', borderRadius:3, fontSize:fs(7), lineHeight:1.5, color:'#b8c8b0' }}>
      <div style={{ color: STATUS_STYLE[d.status].bg, fontWeight:'bold' }}>{d.status}: {d.summary}</div>
      <div style={{ color:'#8fbf8f', marginTop:2 }}>HARD CONSTRAINTS</div>
      {d.hard.map(it => <Row key={it.key} it={it} />)}
      {d.missing.map(it => <Row key={it.key} it={{ ...it, ok: null }} />)}
      <div style={{ color:'#8fbf8f', marginTop:2 }}>ENVIRONMENT (warnings — open ones make it CONDITIONAL)</div>
      {d.environment.map(it => <Row key={it.key} it={it} />)}
      {d.notes.length > 0 && <div style={{ color:'#8fbf8f', marginTop:2 }}>NOTES</div>}
      {d.notes.map(it => <div key={it.key} style={{ color:'#9aa89a' }}>· {it.label}: {it.detail}</div>)}
    </div>
  );
}
