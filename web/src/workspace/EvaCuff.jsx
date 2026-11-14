/**
 * MARTIAN EVA CUFF — wrist console (proposed concept, simulated in the browser).
 *
 * A rugged forearm display: five screens on the left bezel keys (F1–F5), a guarded EMERGENCY key that is
 * one press from anywhere, and two action keys (PLAY/PAUSE, ABORT) wired to the existing EVA playback.
 * Every value comes from utils/evaCuff.js (the selected mission + the playback); nothing is telemetry.
 * The last mission copy is kept in this browser with its sync time, so the cuff still shows it offline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CUFF_SCREENS, CUFF_SOURCE } from '../utils/evaCuff';
import { fmtHM, fmtSignedHM, fmtClock } from '../utils/format';

const C = { case: '#2b2f34', caseHi: '#3a3f46', bezel: '#17191c', screen: '#050607', ink: '#eef1f4', dim: '#8d969f', faint: '#4a525b',
  amber: '#ffb547', red: '#ff4d42', green: '#5fd38a', blue: '#7fb2e6' };
const MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const LVL = { block: { c: C.red, g: '■' }, caution: { c: C.amber, g: '▲' }, ok: { c: C.green, g: '●' }, info: { c: C.blue, g: '◆' } };
const DEC = { GO: C.green, CONDITIONAL: C.amber, 'NO-GO': C.red, 'INSUFFICIENT DATA': C.dim };
const KEY = 'mm-eva-cuff-sync-v1';

/** Keep the latest mission copy for offline use; returns { model, syncedAt, offline }. */
function useSyncedCopy(model, siteName) {
  const [copy, setCopy] = useState(() => {
    try { const j = JSON.parse(window.localStorage.getItem(KEY) || 'null'); return j?.site === siteName ? j : null; } catch { return null; }
  });
  const sig = model ? `${model.status.id}|${model.card.totals.roundTripS}|${model.tasks.length}` : null;
  useEffect(() => {
    if (!model) return;
    const rec = { site: siteName, sig, syncedAt: Date.now(), model: { ...model, live: false } };
    setCopy(rec);
    try { window.localStorage.setItem(KEY, JSON.stringify(rec)); } catch { /* storage unavailable: online copy only */ }
  }, [sig, siteName]); // eslint-disable-line react-hooks/exhaustive-deps
  if (model) return { model, syncedAt: copy?.syncedAt ?? Date.now(), offline: false };
  if (copy) return { model: copy.model, syncedAt: copy.syncedAt, offline: true };
  return { model: null, syncedAt: null, offline: false };
}

function Big({ label, value, color = C.ink, sub }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: C.dim, letterSpacing: 1, fontFamily: SANS, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: String(value).length > 9 ? 17 : 22, fontFamily: MONO, color, lineHeight: 1.15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.dim, fontFamily: SANS, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}
const Src = ({ k }) => <span style={{ fontSize: 9, fontFamily: MONO, color: C.dim, border: `1px solid ${C.faint}`, padding: '0 3px', marginLeft: 6, whiteSpace: 'nowrap', alignSelf: 'flex-start', lineHeight: '14px' }}>{CUFF_SOURCE[k] || k}</span>;

function MapScreen({ m }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const W = cv.width, H = cv.height, g = cv.getContext('2d');
    g.fillStyle = C.screen; g.fillRect(0, 0, W, H);
    const pts = [...m.path, [m.pos.x, m.pos.z], ...(m.returnPath || [])];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const pad = 22, sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, z1 - z0));
    const ox = (W - (x1 - x0) * sc) / 2, oz = (H - (z1 - z0) * sc) / 2;
    const P = (x, z) => [ox + (x - x0) * sc, oz + (z - z0) * sc];
    // grid: 100 m
    g.strokeStyle = '#14181c'; g.lineWidth = 1;
    for (let gx = Math.ceil(x0 / 100) * 100; gx <= x1; gx += 100) { const [a] = P(gx, 0); g.beginPath(); g.moveTo(a, 0); g.lineTo(a, H); g.stroke(); }
    for (let gz = Math.ceil(z0 / 100) * 100; gz <= z1; gz += 100) { const [, b] = P(0, gz); g.beginPath(); g.moveTo(0, b); g.lineTo(W, b); g.stroke(); }
    const line = (arr, col, w, dash = []) => { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash); g.beginPath(); arr.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke(); g.setLineDash([]); };
    line(m.path, '#d9894a', 2.5);
    if (m.returnPath) line(m.returnPath, C.amber, 2, [6, 4]);
    for (const h of m.hazards) { const [a, b] = P(h.x, h.z); g.fillStyle = h.hard ? C.red : C.amber; g.fillRect(a - 2.5, b - 2.5, 5, 5); }
    for (const st of m.stops) {
      const [a, b] = P(st.x, st.z);
      g.beginPath(); g.arc(a, b, 9, 0, Math.PI * 2);
      g.fillStyle = st.state === 'done' ? '#2e3a33' : st.state === 'here' || st.state === 'next' ? C.amber : C.screen; g.fill();
      g.strokeStyle = st.state === 'done' ? C.green : C.amber; g.lineWidth = 2; g.stroke();
      g.fillStyle = st.state === 'here' || st.state === 'next' ? '#111' : C.ink; g.font = `bold 10px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(st.state === 'done' ? '✓' : String(st.n), a, b + 0.5);
    }
    const [hx, hz] = P(m.home.x, m.home.z);
    g.fillStyle = C.ink; g.fillRect(hx - 7, hz - 7, 14, 14); g.fillStyle = '#111'; g.font = `bold 10px ${MONO}`; g.fillText('H', hx, hz + 0.5);
    const [px, pz] = P(m.pos.x, m.pos.z);
    g.beginPath(); g.moveTo(px, pz - 9); g.lineTo(px + 7, pz + 6); g.lineTo(px - 7, pz + 6); g.closePath();
    g.fillStyle = C.blue; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
    // north arrow
    g.fillStyle = C.dim; g.font = `bold 10px ${MONO}`; g.textAlign = 'right'; g.fillText('N ↑', W - 6, 12);
  }, [m]);
  return (
    <div style={{ display: 'flex', gap: 10, height: '100%' }}>
      <canvas ref={ref} width={290} height={196} style={{ width: 290, height: 196, border: `1px solid ${C.faint}`, flexShrink: 0 }} aria-label="Route map" />
      <div style={{ fontFamily: SANS, fontSize: 12, color: C.ink, lineHeight: 1.45, minWidth: 0 }}>
        <div style={{ color: C.blue, fontWeight: 700 }}>▲ {m.pos.label}</div>
        {m.next ? <><div style={{ color: C.dim, fontSize: 10.5, marginTop: 4 }}>NEXT</div>
          <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700 }}>S{m.next.n} · {Math.round(m.next.distM)} m {m.next.bearing}</div>
          <div style={{ color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.next.label}</div></> : <div style={{ marginTop: 4 }}>No stop ahead</div>}
        <div style={{ color: C.dim, fontSize: 10.5, marginTop: 6 }}>HABITAT</div>
        <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700 }}>{Math.round(m.homeDir.distM)} m {m.homeDir.bearing}</div>
        <div style={{ color: C.dim, fontSize: 10.5, marginTop: 6 }}>■ no-go · ▪ amber flagged · ┄ return</div>
        {m.rerouted && <div style={{ color: C.amber, fontWeight: 700, marginTop: 4 }}>ROUTE CHANGED (dust)</div>}
      </div>
    </div>
  );
}

export default function EvaCuff({ model: liveModel, siteName, onClose, onAbort, onToggle, onPrint, evaStatus, compact = false }) {
  const { model: m, syncedAt, offline } = useSyncedCopy(liveModel, siteName);
  const [screen, setScreen] = useState('status');
  const [taskIdx, setTaskIdx] = useState(0);
  const emer = screen === 'emergency';
  const st = m?.status;
  const sync = useMemo(() => (syncedAt ? new Date(syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'), [syncedAt]);
  const W = compact ? 'min(100%, 640px)' : 640;
  // TASKS opens on the stop being worked (or the next one)
  const curTask = m ? Math.max(0, m.tasks.findIndex(t => t.state === 'here' || t.state === 'next')) : 0;
  useEffect(() => { setTaskIdx(curTask); }, [curTask, screen]);

  const keyBtn = (active, label, sub, onClick, color = C.ink, wide = false) => (
    <button type="button" onClick={onClick} aria-pressed={active}
      style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', width: wide ? '100%' : 64, minHeight: 40, padding: '4px 4px', textAlign: 'center',
        background: active ? '#4a5058' : `linear-gradient(${C.caseHi}, #24282c)`, border: `1px solid ${active ? color : '#15171a'}`, borderRadius: 4,
        boxShadow: active ? `inset 0 0 0 1px ${color}` : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 0 #111', color, fontFamily: SANS }}>
      <div style={{ fontSize: 9.5, fontFamily: MONO, opacity: 0.7 }}>{sub}</div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6 }}>{label}</div>
    </button>
  );

  let body;
  if (!m) body = <div style={{ color: C.dim, fontFamily: SANS, fontSize: 14, padding: 10 }}>NO MISSION LOADED — plan a route in 03 PLAN MISSION. The cuff then shows it here and keeps a copy for offline use.</div>;
  else if (emer) body = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', fontFamily: SANS, fontSize: 11, lineHeight: 1.33, overflowY: 'auto', height: '100%' }}>
      {m.emergency.map(e => (
        <div key={e.key} style={{ borderLeft: `3px solid ${e.src === 'nasa' ? C.blue : e.src === 'simulated' ? C.amber : C.red}`, paddingLeft: 6 }}>
          <div style={{ fontWeight: 800, color: C.ink, fontSize: 12 }}>{e.title}<Src k={e.src} /></div>
          {e.lines.map((l, i) => <div key={i} style={{ color: '#cfd5db' }}>{l}</div>)}
        </div>
      ))}
    </div>
  );
  else if (screen === 'status') body = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 12px' }}>
      <Big label="MET" value={fmtClock(st.metS)} sub={st.source} />
      <Big label="EVA LEFT" value={fmtHM(Math.max(0, st.remainingS))} sub={`of ${fmtHM(st.budgetS)}`} color={st.remainingS < 1800 ? C.amber : C.ink} />
      <Big label="STATUS" value={st.decision} color={DEC[st.decision] || C.ink} sub={st.decision === 'GO' ? '● all rules met' : '▲ see RETURN / HAZARDS'} />
      <Big label="O₂ LEFT" value={st.o2 ? `${st.o2.remainingKg.toFixed(2)} kg` : 'N/A'} sub={st.o2 ? `of ${st.o2.initialKg.toFixed(2)} kg · ${st.o2.rateKgH} kg/h` : 'O₂ settings incomplete'} />
      <Big label="O₂ DURATION" value={st.o2 && Number.isFinite(st.o2.enduranceS) ? fmtHM(st.o2.enduranceS) : 'N/A'} sub={st.o2 ? 'model estimate (scenario rate)' : ''} />
      <Big label="WALK-BACK MARGIN" value={Number.isFinite(st.marginS) ? fmtSignedHM(st.marginS) : 'NO PATH'} color={!(st.marginS >= 0) ? C.red : st.marginS < 1800 ? C.amber : C.green}
        sub={m.live ? 'now' : 'tightest on the plan'} />
      <div style={{ gridColumn: '1 / -1', borderTop: `1px solid ${C.faint}`, paddingTop: 6, fontFamily: SANS, fontSize: 13, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span style={{ color: C.dim, fontSize: 10.5, marginRight: 6 }}>WAYPOINT</span>{st.waypoint}
      </div>
    </div>
  );
  else if (screen === 'map') body = <MapScreen m={m.map} />;
  else if (screen === 'tasks') {
    const t = m.tasks[Math.min(taskIdx, m.tasks.length - 1)];
    body = !t ? <div style={{ color: C.dim, fontFamily: SANS }}>No science stops on this route.</div> : (
      <div style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.4, color: C.ink }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: C.amber }}>S{t.n}</span>
          <span style={{ fontWeight: 700, fontSize: 13.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, padding: '1px 6px', border: `1px solid ${t.state === 'done' ? C.green : t.state === 'here' ? C.amber : C.faint}`,
            color: t.state === 'done' ? C.green : t.state === 'here' ? C.amber : C.dim }}>{{ done: '✓ DONE', here: '● HERE', next: '→ NEXT', pending: 'PENDING' }[t.state]}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '6px 0', fontFamily: MONO }}>
          <div><span style={{ color: C.dim, fontSize: 10 }}>STAY</span><br /><b style={{ fontSize: 16 }}>{t.durationMin} min</b></div>
          <div><span style={{ color: C.dim, fontSize: 10 }}>ARRIVE</span><br /><b style={{ fontSize: 16 }}>{fmtHM(t.arriveS)}</b></div>
          <div><span style={{ color: C.dim, fontSize: 10 }}>LEAVE BY</span><br /><b style={{ fontSize: 16, color: C.amber }}>{fmtHM(t.leaveByS)}</b></div>
        </div>
        {t.activity && <div><b style={{ color: C.dim, fontSize: 10.5 }}>DO </b>{t.activity}</div>}
        {t.context && <div><b style={{ color: C.dim, fontSize: 10.5 }}>GEOLOGY </b>{t.context}</div>}
        {t.objective && <div style={{ color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b style={{ fontSize: 10.5 }}>OBJECTIVE </b>{t.objective}</div>}
        {t.equipment.length > 0 && <div style={{ color: C.dim }}><b style={{ fontSize: 10.5 }}>KIT </b>{t.equipment.join(' · ')}</div>}
        {t.risk && <div style={{ color: t.risk.level === 'high' ? C.red : t.risk.level === 'moderate' ? C.amber : C.dim }}><b style={{ fontSize: 10.5 }}>TERRAIN </b>{t.risk.level} — {t.risk.reason}</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {m.tasks.map((x, i) => (
            <button key={x.n} type="button" onClick={() => setTaskIdx(i)} style={{ all: 'unset', cursor: 'pointer', fontFamily: MONO, fontSize: 12, padding: '3px 9px',
              border: `1px solid ${i === taskIdx ? C.amber : C.faint}`, color: x.state === 'done' ? C.green : C.ink }}>{x.state === 'done' ? '✓' : ''}S{x.n}</button>
          ))}
        </div>
      </div>
    );
  } else if (screen === 'hazards') body = (
    <div style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.35, overflowY: 'auto', height: '100%' }}>
      {m.hazards.map(h => (
        <div key={h.key} style={{ display: 'flex', gap: 6, padding: '2px 0', borderBottom: `1px solid #111` }}>
          <span style={{ color: LVL[h.level]?.c, width: 12, flexShrink: 0 }}>{LVL[h.level]?.g}</span>
          <span style={{ color: C.ink, flex: 1 }}>{h.text}</span><Src k={h.src} />
        </div>
      ))}
    </div>
  );
  else if (screen === 'return') {
    const r = m.ret;
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 12px' }}>
        <div style={{ gridColumn: '1 / -1', fontFamily: SANS, fontWeight: 800, fontSize: 18, letterSpacing: 1,
          color: r.warnings.length ? C.red : r.status === 'RETURNING' ? C.amber : C.green }}>
          {r.warnings.length ? '■ ' : '● '}{r.status}{r.warnings.length ? ` — ${r.warnings[0]}` : ''}
        </div>
        <Big label="HABITAT" value={`${Math.round(r.homeDir.distM)} m ${r.homeDir.bearing}`} sub="straight line" />
        <Big label="WALK HOME" value={Number.isFinite(r.etaS) ? fmtHM(r.etaS) : '—'} sub="fastest walk (model)" />
        <Big label="MARGIN" value={Number.isFinite(r.marginS) ? fmtSignedHM(r.marginS) : 'NO PATH'} color={!(r.marginS >= 0) ? C.red : C.green} />
        <Big label="EVA LEFT" value={fmtHM(Math.max(0, r.remainingS))} />
        <Big label="O₂ LEFT" value={r.o2 ? `${r.o2.remainingKg.toFixed(2)} kg` : 'N/A'} sub={r.o2?.needKg != null ? `walk home needs ${r.o2.needKg.toFixed(2)} kg` : ''} />
        <div style={{ fontFamily: SANS, fontSize: 11, color: C.dim, alignSelf: 'end' }}>{r.warnings.slice(1).join(' · ') || 'No return warning'}</div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-label="Martian EVA Cuff" style={{ width: W, fontFamily: SANS, userSelect: 'none' }}>
      {/* strap stubs + casing */}
      <div style={{ position: 'relative', padding: '0 18px' }}>
        <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: '30%', height: '40%', borderRadius: 6,
          background: 'repeating-linear-gradient(90deg, #1b1d20 0 6px, #23262a 6px 12px)', boxShadow: '0 4px 14px rgba(0,0,0,0.6)' }} />
        <div style={{ position: 'relative', background: `linear-gradient(160deg, ${C.caseHi}, ${C.case} 45%, #202327)`, borderRadius: 14, padding: 10,
          boxShadow: '0 10px 30px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)', border: '1px solid #111' }}>
          {/* header strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 6px', color: '#c8ced4', fontSize: 10.5, letterSpacing: 1.2 }}>
            <b>MARTIAN EVA CUFF</b>
            <span style={{ fontFamily: MONO, color: C.dim }}>{st?.id || '—'}</span>
            <span style={{ marginLeft: 'auto', fontFamily: MONO, color: offline ? C.amber : C.dim }} title="Last mission copy kept in this browser">
              {offline ? `OFFLINE COPY ${sync} — may be stale` : `SYNC ${sync}`}</span>
            {onClose && <button type="button" onClick={onClose} aria-label="Close the cuff" style={{ all: 'unset', cursor: 'pointer', color: C.dim, fontSize: 14, paddingLeft: 4 }}>✕</button>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* screen keys */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {CUFF_SCREENS.map(s => keyBtn(screen === s.id, s.label, s.key, () => setScreen(s.id)))}
            </div>
            {/* display */}
            <div style={{ flex: 1, minWidth: 0, background: C.bezel, borderRadius: 6, padding: 6, boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.8)' }}>
              <div style={{ background: emer ? '#160505' : C.screen, border: `1px solid ${emer ? C.red : '#000'}`, borderRadius: 3, height: 236, padding: '7px 9px', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: emer ? C.red : C.dim, letterSpacing: 1, fontWeight: 700, marginBottom: 6 }}>
                  <span>{emer ? '■ EMERGENCY REFERENCE' : CUFF_SCREENS.find(s => s.id === screen)?.label}</span>
                  {st && <span style={{ marginLeft: 'auto', fontFamily: MONO, color: DEC[st.decision] }}>{st.decision}</span>}
                  {st && <span style={{ fontFamily: MONO, color: st.source.startsWith('SIM') ? C.blue : C.dim }}>{st.source}</span>}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{body}</div>
              </div>
            </div>
            {/* action keys */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: 64 }}>
              <div style={{ padding: 2, borderRadius: 6, background: 'repeating-linear-gradient(45deg, #f2c94c 0 5px, #1a1a1a 5px 10px)' }} title="Guarded key: one press from any screen">
                {keyBtn(emer, 'EMER', 'GUARD', () => setScreen(emer ? 'status' : 'emergency'), C.red, true)}
              </div>
              {onToggle && keyBtn(false, evaStatus === 'playing' ? 'PAUSE' : 'PLAY', 'SIM', onToggle, C.blue)}
              {onAbort && keyBtn(false, 'ABORT', 'SIM', onAbort, C.amber)}
              {onPrint && keyBtn(false, 'PRINT', 'BACKUP', onPrint)}
            </div>
          </div>
          <div style={{ padding: '6px 4px 0', fontSize: 9.5, color: C.dim, lineHeight: 1.35 }}>
            Proposed Martian Map concept, simulated in the browser — not a manufactured, tested or flight-qualified device; no hardware link. Position is
            {' '}PLANNED before the EVA and SIMULATED during the playback; O₂ is the selected scenario model, not a sensor.
          </div>
        </div>
      </div>
    </div>
  );
}

/** Physical concept drawing: forearm strap, display module, flip-open backup checklist, guarded keys. */
export function CuffConcept() {
  return (
    <svg viewBox="0 0 340 170" role="img" aria-label="Wearable concept" style={{ width: '100%', maxWidth: 340, display: 'block' }}>
      <defs>
        <pattern id="strap" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#22262a" /><rect width="4" height="8" fill="#2c3035" /></pattern>
      </defs>
      <path d="M10 70 Q170 40 330 70 L330 112 Q170 82 10 112 Z" fill="url(#strap)" stroke="#111" />
      <rect x="92" y="42" width="156" height="86" rx="10" fill="#3a3f46" stroke="#111" />
      <rect x="120" y="52" width="100" height="62" rx="3" fill="#050607" stroke="#000" />
      {[0, 1, 2, 3].map(i => <rect key={i} x="128" y={60 + i * 12} width={i % 2 ? 60 : 84} height="5" fill="#2a3138" />)}
      {[0, 1, 2, 3, 4].map(i => <rect key={i} x="99" y={50 + i * 13} width="15" height="9" rx="2" fill="#4a5058" />)}
      <rect x="226" y="50" width="16" height="20" rx="3" fill="#ff4d42" stroke="#f2c94c" strokeWidth="2" />
      <rect x="226" y="76" width="16" height="12" rx="2" fill="#4a5058" />
      <rect x="226" y="92" width="16" height="12" rx="2" fill="#4a5058" />
      <path d="M92 128 L248 128 L262 160 L78 160 Z" fill="#e9e3d2" stroke="#111" />
      <line x1="92" y1="128" x2="248" y2="128" stroke="#111" strokeWidth="3" strokeDasharray="4 3" />
      {[0, 1, 2].map(i => <line key={i} x1={98 - i * 4} y1={137 + i * 7} x2={242 + i * 4} y2={137 + i * 7} stroke="#777" strokeWidth="1" />)}
      <g fontSize="8.5" fill="#c8ced4" fontFamily="system-ui, sans-serif">
        <text x="6" y="64">forearm strap</text>
        <text x="252" y="46">guarded EMER key</text>
        <text x="266" y="152">flip-open backup</text><text x="266" y="162">checklist (printed)</text>
        <text x="6" y="140">F1–F5 screen keys</text>
      </g>
    </svg>
  );
}
