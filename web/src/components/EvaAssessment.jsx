/**
 * Three-part EVA assessment UI — A. Payload & Mass · B. Dust Exposure & Equipment Reliability ·
 * C. Terrain & Mobility. Each part has its own result and explanation; there is no combined score.
 * Also the setup controls for the payload items and the dust protection settings (Mission setup).
 */
import { useState } from 'react';
import { fs } from '../ui/layout';
import { PAYLOAD_CATEGORIES, payloadAssessment, payloadSum } from '../utils/payload';
import { DUST_OPTIONS, DUST_SOURCES, APPLICABILITY, sourceById } from '../config/dust';

const C = { dim: '#7a9a7a', text: '#e8e0c8', body: '#b8c8b0', head: '#cfe8c8', ok: '#88dd99', bad: '#ff6655', warn: '#ffc94d', grey: '#9aa8b8' };
const STATUS_COLOR = {
  'WITHIN LIMIT': C.ok, 'OVER LIMIT': C.bad, 'INSUFFICIENT DATA': '#aab', WARNINGS: C.warn,
  PASS: C.ok, CAUTION: C.warn, FAIL: C.bad,
};
const VULN_COLOR = { high: '#ff8866', moderate: '#ffc94d', low: '#88dd99' };
const Tag = ({ s }) => (
  <span style={{ fontSize: fs(6.5), fontWeight: 'bold', padding: '0 4px', borderRadius: 2, color: '#111', background: STATUS_COLOR[s] || '#aab' }}>{s}</span>
);
const mark = (ok) => (ok === true ? ['✓', C.ok] : ok === false ? ['✕', C.bad] : ['?', C.warn]);
const small = { fontSize: fs(6.5), color: C.dim, lineHeight: 1.45 };

// ---------------------------------------------------------------- setup controls (Mission setup)

/** Payload items: switch from one equipment figure to an itemised list (no item is pre-filled with an invented mass). */
export function PayloadSetup({ mission, setMission }) {
  const a = payloadAssessment(mission);
  const itemised = !!mission.payload;
  const setItem = (k, v) => {
    const payload = { ...mission.payload, [k]: v };
    const sum = payloadSum(payload);
    setMission({ ...mission, payload, ...(sum != null ? { equipmentKg: Math.round(sum * 10) / 10 } : {}) });
  };
  const toggle = () => (itemised
    ? setMission({ ...mission, payload: null })
    : setMission({ ...mission, payload: { instruments: 0, comms: 0, sampling: 0, emergency: 0, other: mission.equipmentKg || 0 } }));
  return (
    <div style={{ margin: '2px 0 5px', fontSize: fs(7), color: C.body }}>
      <button type="button" onClick={toggle} style={{ width: '100%', background: 'transparent', color: '#9fd0ff', border: '1px solid rgba(136,204,255,0.4)',
        borderRadius: 3, padding: '2px 0', fontFamily: 'monospace', fontSize: fs(7), cursor: 'pointer' }}>
        {itemised ? '✓ PAYLOAD ITEMISED — USE ONE FIGURE' : 'ITEMISE THE PAYLOAD'}
      </button>
      {itemised && (
        <div style={{ marginTop: 3 }}>
          {PAYLOAD_CATEGORIES.map(c => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
              <span style={{ flex: 1 }}>{c.label}</span>
              <input type="number" min={0} max={100} step={0.5} value={mission.payload[c.key] ?? ''} aria-label={`${c.label} kg`}
                onChange={e => setItem(c.key, e.target.value === '' ? null : Number(e.target.value))}
                style={{ width: 52, background: '#0a140a', color: C.text, border: '1px solid #345', fontFamily: 'monospace', fontSize: fs(7) }} />
              <span style={{ width: 14 }}>kg</span>
            </label>
          ))}
          <div style={small}>Masses as you enter them — no default values are invented.</div>
        </div>
      )}
      <div style={{ ...small, marginTop: 2 }}>
        In the suit mass, not added again: {a.inSuit.map(i => `${i.label} (${i.note}${i.status === 'assumption' ? ' — assumption' : ''})`).join(' · ')}.
      </div>
    </div>
  );
}

/** Dust protection settings — categories only; "not specified" is reported as missing. */
export function DustSetup({ mission, setMission }) {
  const d = mission.dust || {};
  return (
    <div style={{ margin: '4px 0', fontSize: fs(7), color: C.body }}>
      <div style={{ color: '#8fbf8f', marginBottom: 2 }}>DUST PROTECTION (qualitative)</div>
      {Object.entries(DUST_OPTIONS).map(([k, o]) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span style={{ width: 92 }}>{o.label}</span>
          <select value={d[k] || 'unknown'} onChange={e => setMission({ ...mission, dust: { ...d, [k]: e.target.value } })}
            title={o.options[d[k] || 'unknown']?.note || ''}
            style={{ flex: 1, minWidth: 0, background: '#0a140a', color: C.text, border: '1px solid #345', fontFamily: 'monospace', fontSize: fs(7) }}>
            {Object.entries(o.options).map(([v, opt]) => <option key={v} value={v}>{opt.label}</option>)}
          </select>
        </label>
      ))}
      <div style={small}>No setting is treated as Mars-validated; none changes the route, mass or walking speed.</div>
    </div>
  );
}

// ---------------------------------------------------------------- three-part assessment

function Part({ letter, title, status, summary, children, open, onToggle }) {
  return (
    <div style={{ border: '1px solid rgba(80,120,80,0.35)', borderRadius: 3, padding: '3px 5px', marginTop: 4 }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 4 }}>
        <b style={{ color: C.head, fontSize: fs(7.5) }}>{open ? '▾' : '▸'} {letter}. {title}</b><Tag s={status} />
      </button>
      <div style={{ fontSize: fs(7), color: '#9ab09a', lineHeight: 1.45, marginTop: 1 }}>{summary}</div>
      {open && <div style={{ fontSize: fs(7), color: C.body, lineHeight: 1.5, marginTop: 3 }}>{children}</div>}
    </div>
  );
}

function SourceLink({ id }) {
  const s = sourceById(id);
  if (!s) return null;
  const ap = APPLICABILITY[s.applicability];
  return (
    <span title={`${s.title} — ${ap.label}`} style={{ whiteSpace: 'nowrap' }}>
      <span style={{ color: ap.color }}>●</span>{' '}
      {s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#9fd0ff' }}>{s.author.split(/[,(]/)[0].trim()} {s.date.slice(0, 4)}</a> : `${s.author} ${s.date.slice(0, 4)}`}
    </span>
  );
}

function PayloadPart({ p }) {
  const row = (k, v, c) => <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: C.dim }}>{k}</span><span style={{ color: c || C.text }}>{v}</span></div>;
  return (
    <>
      {row('Suit', `${p.suit.label} · ${p.suit.massKg} kg (incl. life support)`)}
      {p.items ? p.items.map(i => row(i.label, i.kg == null ? 'missing' : `${i.kg} kg`, i.kg == null ? C.warn : undefined))
        : row('Equipment (one figure)', p.equipmentKg == null ? 'missing' : `${p.equipmentKg} kg`)}
      {p.status !== 'INSUFFICIENT DATA' && <>
        {row('Total carried mass', `${p.massKg.toFixed(1)} kg`)}
        {row('Weight on Mars, Earth-equivalent', `${p.earthEqKg.toFixed(1)} kg`)}
        {row('Payload limit', `${p.limitKg} kg Earth-equivalent`)}
        {row('Remaining capacity', p.remainingKg >= 0 ? `${p.remainingKg.toFixed(1)} kg of mass` : `over by ${(-p.remainingKg).toFixed(1)} kg`, p.remainingKg >= 0 ? C.ok : C.bad)}
      </>}
      <div style={{ ...small, marginTop: 2 }}>
        Limit = NIOSH lifting limit 23 kg + 22 kg offset by suit pressure (Ogilvie et al., ICES 2026). An over-limit payload fails the
        existing carry check (NO-GO). Carried mass does not change walking speed: no validated load–speed model at Mars gravity was found.
      </div>
    </>
  );
}

function DustPart({ d }) {
  const [showSources, setShowSources] = useState(false);
  return (
    <>
      <div style={{ color: '#8fbf8f' }}>EXPOSURE ({d.level})</div>
      {d.exposure.map(e => (
        <div key={e.key}><span style={{ color: e.present ? C.warn : C.ok }}>{e.present ? '▲' : '·'}</span> {e.label}: <span style={{ color: C.dim }}>{e.detail}</span> <SourceLink id={e.source} /></div>
      ))}
      {d.missing.map(m => <div key={m.key}><span style={{ color: C.warn }}>?</span> {m.label}: <span style={{ color: C.dim }}>{m.detail}</span></div>)}
      <div style={{ color: '#8fbf8f', marginTop: 3 }}>WARNINGS (never reject the route)</div>
      {d.warnings.map((w, i) => <div key={i} style={{ color: w.level === 'info' ? C.grey : w.level === 'high' ? '#ffaa88' : C.warn }}>• {w.text}</div>)}
      <div style={{ color: '#8fbf8f', marginTop: 3 }}>EQUIPMENT ({d.components.length} groups, assessed separately)</div>
      {d.components.map(c => (
        <div key={c.key} style={{ borderTop: '1px solid rgba(80,120,80,0.25)', padding: '2px 0', fontSize: fs(6.5), lineHeight: 1.45 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
            <b style={{ color: C.text }}>{c.name}</b>
            <span style={{ color: VULN_COLOR[c.vulnerability], fontWeight: 'bold', whiteSpace: 'nowrap' }}>{c.vulnerability} vulnerability</span>
          </div>
          <div>{c.mechanism}</div>
          <div>Protection: <span style={{ color: c.protection.state === 'protected' ? C.ok : c.protection.state === 'unprotected' ? '#ffaa88' : C.warn }}>
            {c.protection.label.toLowerCase()} — {c.protection.choice}{c.protection.state === 'protected' ? ' (not validated for Martian dust)' : ''}</span></div>
          <div style={{ color: C.dim }}>Why this class: {c.rationale}</div>
          <div style={{ color: '#a8c8a8' }}>Precautions: {c.precautions.join('; ')}.</div>
          <div style={{ color: C.dim }}>Confidence {c.confidence}: {c.uncertainty}</div>
          <div>{c.evidence.map(id => <span key={id} style={{ marginRight: 6 }}><SourceLink id={id} /></span>)}</div>
        </div>
      ))}
      {d.notes.length > 0 && <div style={{ ...small, marginTop: 2 }}>{d.notes.map(n => n.text).join(' ')}</div>}
      <button type="button" onClick={() => setShowSources(v => !v)} style={{ all: 'unset', cursor: 'pointer', color: '#9fd0ff', fontSize: fs(6.5), marginTop: 3 }}>
        {showSources ? '▾' : '▸'} NASA research sources and how they apply to Mars ({DUST_SOURCES.length})
      </button>
      {showSources && <DustSources />}
    </>
  );
}

/** Every dust source with program, date, context, Mars applicability, relevance and limitations. */
export function DustSources() {
  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ ...small, marginBottom: 2 }}>
        {Object.entries(APPLICABILITY).map(([k, a]) => <span key={k} style={{ marginRight: 8 }}><span style={{ color: a.color }}>●</span> {a.label}</span>)}
      </div>
      {DUST_SOURCES.map(s => {
        const a = APPLICABILITY[s.applicability];
        return (
          <div key={s.id} style={{ borderTop: '1px solid rgba(80,120,80,0.25)', padding: '2px 0', fontSize: fs(6.5), lineHeight: 1.45 }}>
            <div><span style={{ color: a.color, fontWeight: 'bold' }}>{a.label}</span> · {s.url
              ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#9fd0ff' }}>{s.title}</a> : s.title} <span style={{ color: C.dim }}>({s.ref}, {s.date})</span></div>
            <div style={{ color: C.dim }}>{s.program} — {s.context}</div>
            <div>{s.finding}</div>
            <div style={{ color: '#a8c8a8' }}>Relevance: {s.relevance}</div>
            <div style={{ color: '#d0a070' }}>Limitations: {s.limitations}</div>
          </div>
        );
      })}
    </div>
  );
}

function MobilityPart({ m }) {
  return (
    <>
      {m.items.map(it => { const [mk, c] = mark(it.ok); return (
        <div key={it.key}><span style={{ color: c, fontWeight: 'bold' }}>{mk}</span> {it.label} <span style={{ color: C.dim }}>— {it.detail}</span></div>); })}
      <div style={{ ...small, marginTop: 2 }}>Same A* route, Dijkstra walking times and slope–speed model as the planner; the same speeds apply outbound and on the way back.</div>
    </>
  );
}

/** A / B / C, each with its own result. */
export default function EvaAssessment({ a }) {
  const [open, setOpen] = useState(null);
  if (!a) return null;
  const t = (k) => setOpen(o => (o === k ? null : k));
  return (
    <div style={{ marginTop: 4 }} aria-label="EVA assessment">
      <div style={{ color: '#8fbf8f', fontSize: fs(7) }}>EVA ASSESSMENT — three separate results, no combined score</div>
      <Part letter="A" title="Payload & Mass" status={a.payload.status} summary={a.payload.summary} open={open === 'A'} onToggle={() => t('A')}><PayloadPart p={a.payload} /></Part>
      <Part letter="B" title="Dust Exposure & Equipment Reliability" status={a.dust.status} summary={a.dust.summary} open={open === 'B'} onToggle={() => t('B')}><DustPart d={a.dust} /></Part>
      <Part letter="C" title="Terrain & Mobility" status={a.mobility.status} summary={a.mobility.summary} open={open === 'C'} onToggle={() => t('C')}><MobilityPart m={a.mobility} /></Part>
    </div>
  );
}
