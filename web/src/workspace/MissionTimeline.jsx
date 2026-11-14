/**
 * EVA timeline band (Plan Mission / Operations), Playbook-style: one horizontal time axis with the
 * walking legs, stops and walk home of the active route, and marks for the EVA budget, point of no
 * return, sunset and oxygen limits. A cursor shows the EVA clock during playback. All times come from
 * utils/missionTimeline.js (planner output); click a stop or the route to inspect it.
 */
import { useMemo } from 'react';
import { T } from '../ui/theme';
import { missionTimeline } from '../utils/missionTimeline';
import { fmtHM } from '../utils/format';
import { ROUTE_COLORS } from '../utils/constants';

const MARK_C = { budget: T.text, ponr: T.nogo, sunset: T.cond, o2: T.info, o2reserve: T.info };

export default function MissionTimeline({ route, mode, startMs, oxygen, nowS = null, onSelect, style = {} }) {
  const tl = useMemo(() => (route ? missionTimeline(route, { startMs, oxygen }) : null), [route, startMs, oxygen]);
  if (!tl) {
    return (
      <div aria-label="EVA timeline" style={{ ...frame, ...style, color: T.muted, fontSize: 13, display: 'flex', alignItems: 'center' }}>
        EVA TIMELINE — plan a route to see walking legs, stops, the walk home and the time limits here.
      </div>
    );
  }
  const W = tl.endS * 1.02;
  const pct = (t) => `${Math.max(0, Math.min(100, (t / W) * 100))}%`;
  const ticks = [];
  for (let h = 0; h * 3600 <= W; h++) ticks.push(h);
  const color = ROUTE_COLORS[mode] || T.accent;
  const crit = tl.marks.filter(m => m.critical);
  return (
    <div aria-label="EVA timeline" style={{ ...frame, ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5, marginBottom: 5 }}>
        <span style={{ fontWeight: 700, letterSpacing: 1, color: T.muted }}>EVA TIMELINE</span>
        <button type="button" onClick={() => onSelect?.({ type: 'route', mode })} style={{ all: 'unset', cursor: 'pointer', color, fontFamily: T.mono }}>{mode}</button>
        <span style={{ color: T.muted }}>home at <b style={{ color: T.text, fontFamily: T.mono }}>{fmtHM(tl.items[tl.items.length - 1].t1)}</b> · reserve <b style={{ color: tl.reserveS < 0 ? T.nogo : T.text, fontFamily: T.mono }}>{fmtHM(tl.reserveS)}</b> of budget {fmtHM(tl.budgetS)}</span>
        {crit.length > 0 && <span style={{ marginLeft: 'auto', color: T.nogo, fontWeight: 600 }}>■ {crit.map(m => m.label).join(' · ')}</span>}
      </div>
      <div style={{ position: 'relative', height: 40 }}>
        {/* hour grid */}
        {ticks.map(h => (
          <div key={h} style={{ position: 'absolute', left: pct(h * 3600), top: 0, bottom: 0, borderLeft: `1px solid ${T.rule}` }}>
            <span style={{ position: 'absolute', bottom: -1, left: 3, fontSize: 11, color: T.faint, fontFamily: T.mono }}>{h}h</span>
          </div>
        ))}
        {/* activity band */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 3, height: 18 }}>
          {tl.items.map((it, i) => (
            <button key={i} type="button" title={`${it.label} · ${fmtHM(it.t0)} → ${fmtHM(it.t1)}${it.distM ? ` · ${it.distM.toFixed(0)} m` : ''}`}
              onClick={() => onSelect?.(it.kind === 'stop' ? { type: 'stop', n: it.n } : { type: 'route', mode })}
              style={{ all: 'unset', cursor: 'pointer', position: 'absolute', left: pct(it.t0), width: `calc(${pct(it.t1 - it.t0)} - 1px)`, top: it.kind === 'stop' ? 0 : 5, height: it.kind === 'stop' ? 18 : 8,
                background: it.kind === 'stop' ? T.accent : it.kind === 'return' ? `${color}88` : color, boxSizing: 'border-box',
                fontSize: 9.5, color: '#121417', fontWeight: 700, textAlign: 'center', lineHeight: '18px', overflow: 'hidden' }}>
              {it.kind === 'stop' ? `S${it.n}` : ''}
            </button>
          ))}
        </div>
        {/* limits */}
        {tl.marks.map(m => (
          <div key={m.kind} title={`${m.label}: ${fmtHM(m.t)} after start`} style={{ position: 'absolute', left: pct(m.t), top: 0, height: 26,
            borderLeft: `${m.critical ? 2 : 1}px ${m.kind.startsWith('o2') ? 'dashed' : 'solid'} ${MARK_C[m.kind]}` }}>
            <span style={{ position: 'absolute', top: 24, left: 2, fontSize: 11, color: MARK_C[m.kind], whiteSpace: 'nowrap' }}>{SHORT[m.kind]}</span>
          </div>
        ))}
        {Number.isFinite(nowS) && nowS > 0 && (
          <div aria-label="EVA clock" style={{ position: 'absolute', left: pct(nowS), top: -2, bottom: 0, borderLeft: `2px solid ${T.text}` }}>
            <span style={{ position: 'absolute', top: 24, left: 3, fontSize: 9.5, color: T.text, fontFamily: T.mono, background: T.panel, padding: '0 2px', whiteSpace: 'nowrap' }}>now {fmtHM(nowS)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
const SHORT = { budget: 'budget', ponr: 'PONR', sunset: 'sunset', o2: 'O₂', o2reserve: 'O₂ res.' };
const frame = { background: 'rgba(16,18,21,0.92)', border: `1px solid ${T.rule}`, padding: '6px 10px 8px', fontFamily: T.sans, color: T.text, boxSizing: 'border-box' };
