/**
 * Oxygen & Mass — setup controls (Mission setup) and the live EVA HUD panel with its charts.
 * Values come from utils/oxygen.js through the EVA playback controller.
 */
import { fs } from '../ui/layout';
import { fmtHM } from '../utils/format';
import { O2_SCENARIOS, O2_RESERVE, O2_SIZING, O2_INITIAL_LIMITS, DEFAULT_O2, BVAD_URL } from '../config/oxygen';
import { oxygenConfig } from '../utils/oxygen';

const small = { fontSize: fs(6.5), color: '#7a9a7a', lineHeight: 1.45 };
const inputStyle = { background: '#0a140a', color: '#e8e0c8', border: '1px solid #345', fontFamily: 'monospace', fontSize: fs(7) };

/** Scenario, initial oxygen (sized or entered) and reserve. */
export function OxygenSetup({ mission, setMission }) {
  const o = { ...DEFAULT_O2, ...(mission.o2 || {}) };
  const cfg = oxygenConfig(mission);
  const set = (k, v) => setMission({ ...mission, o2: { ...o, [k]: v } });
  return (
    <div style={{ margin: '4px 0', fontSize: fs(7), color: '#b8c8b0' }}>
      <div style={{ color: '#8fbf8f', marginBottom: 2 }}>OXYGEN (life-support reference scenario)</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <span style={{ width: 92 }}>Consumption</span>
        <select value={o.scenario} onChange={e => set('scenario', e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }}
          title={O2_SCENARIOS[o.scenario]?.architecture}>
          {Object.entries(O2_SCENARIOS).map(([k, s]) => <option key={k} value={k}>{s.label} · {s.rateKgH} kg/h</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <span style={{ width: 92 }}>Initial O₂</span>
        <input type="number" aria-label="Initial oxygen kg" min={O2_INITIAL_LIMITS.min} max={O2_INITIAL_LIMITS.max} step={0.05}
          placeholder={cfg.sized && cfg.initialKg != null ? cfg.initialKg.toFixed(2) : ''}
          value={o.initialKg ?? ''} onChange={e => set('initialKg', e.target.value === '' ? null : Number(e.target.value))}
          style={{ ...inputStyle, width: 60 }} />
        <span>kg {o.initialKg == null ? '(sized)' : ''}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <span style={{ width: 92 }}>O₂ reserve</span>
        <input type="number" aria-label="Oxygen reserve minutes" min={O2_RESERVE.min} max={O2_RESERVE.max} step={5}
          value={o.reserveMin ?? ''} onChange={e => set('reserveMin', e.target.value === '' ? null : Number(e.target.value))}
          style={{ ...inputStyle, width: 60 }} />
        <span>min</span>
      </label>
      {cfg.invalid.length > 0 && <div style={{ color: '#ffc94d', fontSize: fs(6.5) }}>{cfg.invalid.map(i => i.detail).join('; ')}</div>}
      <div style={small}>
        {O2_SCENARIOS[o.scenario]?.architecture}. Rates: NASA BVAD (<a href={BVAD_URL} target="_blank" rel="noreferrer" style={{ color: '#9fd0ff' }}>NASA/TP-2015-218570 Rev 2</a>, §4.6.2) —
        architecture references, not a Mars-suit specification; constant per scenario (approximation).
        {o.initialKg == null ? ` Initial O₂ sized for ${O2_SIZING.designDurationH} h at this rate (assumption; no Mars-suit tank capacity is published).` : ''}
        {' '}Reserve default {O2_RESERVE.defaultMin} min: Apollo 17 traverse planning. O₂ is inside the suit mass (assumption); it is not added again.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- HUD

function Chart({ series, t, lines, unit, height = 54, yMin = 0, yMax }) {
  const W = 240, H = height, P = 2;
  const T = series.totalS || 1;
  const vals = lines.flatMap(l => series.pts.map(p => p[l.key]).filter(Number.isFinite));
  const hi = yMax ?? Math.max(...vals, 1e-6), lo = yMin ?? Math.min(...vals);
  const x = (v) => P + (W - 2 * P) * v / T;
  const y = (v) => H - P - (H - 2 * P) * (Math.min(hi, Math.max(lo, v)) - lo) / Math.max(1e-9, hi - lo);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={lines.map(l => l.label).join(', ')} style={{ display: 'block' }}>
      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.03)" />
      {lines.map(l => {
        const d = series.pts.filter(p => Number.isFinite(p[l.key])).map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[l.key]).toFixed(1)}`).join('');
        return <path key={l.key} d={d} fill="none" stroke={l.color} strokeWidth={l.width || 1.4} strokeDasharray={l.dash || ''} />;
      })}
      <line x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="#fff" strokeWidth={1} opacity={0.8} />
      <text x={W - 3} y={9} textAnchor="end" fontSize={8} fill="rgba(232,196,168,0.7)">{hi.toFixed(unit === 'kg O₂' ? 2 : 1)} {unit}</text>
      <text x={W - 3} y={H - 3} textAnchor="end" fontSize={8} fill="rgba(232,196,168,0.7)">{lo.toFixed(unit === 'kg O₂' ? 2 : 1)}</text>
    </svg>
  );
}

/** Oxygen & Mass panel inside the EVA HUD. */
export function OxygenHud({ o, series, t, compact = false, onScenario, scenario }) {
  if (!o) return null;
  if (!o.valid) return <div style={{ fontSize: 11, color: '#ffc94d', marginTop: 5 }}>O₂: insufficient data — {o.invalid.map(i => i.detail).join('; ')}</div>;
  const pct = Math.max(0, Math.min(100, o.reservePct));
  const col = !o.returnFeasible || o.empty ? '#ff5a4a' : !o.reserveOk ? '#ffb347' : '#5be37a';
  const cell = (label, v, c) => (
    <div style={{ minWidth: 0 }}><div style={{ fontSize: 9, letterSpacing: 1, color: 'rgba(232,196,168,0.65)' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 'bold', color: c || '#e8e0c8', whiteSpace: 'nowrap' }}>{v}</div></div>);
  return (
    <div aria-label="Oxygen and mass" style={{ marginTop: 6, borderTop: '1px solid rgba(232,168,120,0.25)', paddingTop: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, letterSpacing: 1, color: '#f0d0b0' }}>O₂ & MASS</span>
        <div role="progressbar" aria-label="Oxygen remaining" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
          style={{ flex: 1, height: 9, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: col, transition: 'width 0.1s linear' }} />
        </div>
        <b style={{ fontSize: 12, color: col }}>{pct.toFixed(0)} %</b>
        {onScenario && (
          <select value={scenario} onChange={e => onScenario(e.target.value)} title="Consumption scenario (BVAD reference)"
            style={{ background: 'rgba(30,14,6,0.8)', color: '#e8c4a8', border: '1px solid rgba(232,168,120,0.35)', fontFamily: 'monospace', fontSize: 10 }}>
            {Object.entries(O2_SCENARIOS).map(([k, s]) => <option key={k} value={k}>{s.label} {s.rateKgH} kg/h</option>)}
          </select>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr 1fr' : 'repeat(6, 1fr)', gap: 4, marginTop: 4 }}>
        {cell('INITIAL', `${o.initialKg.toFixed(2)} kg`)}
        {cell('REMAINING', `${o.remainingKg.toFixed(2)} kg`, col)}
        {cell('CONSUMED', `${o.consumedKg.toFixed(2)} kg`)}
        {cell('O₂ LEFT FOR', o.empty ? 'EMPTY' : fmtHM(o.enduranceS), col)}
        {cell('TO WALK HOME', Number.isFinite(o.returnNeedKg) ? `${o.returnNeedKg.toFixed(2)} kg` : 'no path', o.returnFeasible ? undefined : '#ff5a4a')}
        {cell('CARRIED MASS', o.mass ? `${o.mass.totalKg.toFixed(1)} kg` : '—')}
      </div>
      {!compact && <div style={{ fontSize: 10, color: 'rgba(232,196,168,0.7)', marginTop: 2 }}>
        {o.scenarioLabel} · {o.rateKgH} kg/h · reserve {o.reserveKg.toFixed(2)} kg
        {o.mass ? ` · mass = ${o.mass.fixedKg.toFixed(1)} fixed + ${o.mass.o2Kg.toFixed(2)} O₂ + ${o.mass.equipmentKg} equipment` : ''}
      </div>}
      {(!o.returnFeasible || o.empty) && <div style={{ fontSize: 11, fontWeight: 'bold', color: '#ff5a4a' }}>⛔ Oxygen is no longer enough for the walk home</div>}
      {o.returnFeasible && !o.reserveOk && !o.empty && <div style={{ fontSize: 11, fontWeight: 'bold', color: '#ffb347' }}>⚠ Oxygen reserve insufficient for the walk home + reserve</div>}
      {o.reserveOk && o.planOk === false && <div style={{ fontSize: 11, fontWeight: 'bold', color: '#ffb347' }}>⚠ At this rate the oxygen will not last the rest of the plan with its reserve — plan an early return</div>}
      {series && !compact && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
          <div>
            <div style={{ fontSize: 9, color: 'rgba(232,196,168,0.65)' }}>
              O₂ OVER TIME — <span style={{ color: '#5bc8ff' }}>remaining</span> · <span style={{ color: '#ff8a5a' }}>walk home + reserve</span> · <span style={{ color: '#ffd166' }}>rest of plan + reserve</span>
            </div>
            <Chart series={series} t={t} unit="kg O₂" yMax={series.initialKg} lines={[
              { key: 'remainingKg', color: '#5bc8ff', label: 'oxygen remaining', width: 1.8 },
              { key: 'returnNeedKg', color: '#ff8a5a', label: 'oxygen for the walk home plus reserve', dash: '3 2' },
              { key: 'planNeedKg', color: '#ffd166', label: 'oxygen for the rest of the plan plus reserve', dash: '1 2' },
            ]} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'rgba(232,196,168,0.65)' }}>CARRIED MASS OVER TIME (kg, does not change speed)</div>
            <Chart series={series} t={t} unit="kg" yMin={null} lines={[{ key: 'massKg', color: '#c8a0ff', label: 'total carried mass', width: 1.8 }]} />
          </div>
        </div>
      )}
    </div>
  );
}
