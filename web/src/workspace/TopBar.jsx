/**
 * Top bar (Mars sites): identity, site switcher, the four workspaces and the mission status that stays
 * visible in every workspace (objective · route · decision · EVA). The decision is the same
 * evaAssessments() result the panel shows — not recomputed or re-scored here.
 */
import SiteSwitcher from '../components/SiteSwitcher';
import { T, TOPBAR_H, WORKSPACES, STATUS_COLOR } from '../ui/theme';
import { SITE } from '../three/terrainGenerator';
import { ROUTE_COLORS } from '../utils/constants';

const ROW_H = 36, TAB_H = 32;
/** Height of the top bar: one row on desktop, two (bar + workspace tabs) on phones. */
export const topbarHeight = (compact) => (compact ? ROW_H + TAB_H + 1 : TOPBAR_H);

const EVA_LABEL = { idle: null, ready: 'EVA LOADED', playing: 'EVA RUNNING', paused: 'EVA PAUSED', done: 'EVA COMPLETE' };

export default function TopBar({ workspace, setWorkspace, compact = false, medium = false, objective = null, activeRoute, decision = null, evaStatus = 'idle', aborted = false, onMenu = null, onGuide = null }) {
  const status = decision?.status;
  const short = compact || medium;   // tablet / phone: short workspace names, no objective text
  const eva = aborted && evaStatus !== 'idle' && evaStatus !== 'done' ? 'EVA ABORTED — RETURNING' : EVA_LABEL[evaStatus];
  const tabs = (
    <nav aria-label="Workspaces" style={{ display: 'flex', height: compact ? TAB_H : '100%', marginLeft: compact ? 0 : 6, overflowX: 'auto', flexShrink: 0 }}>
      {WORKSPACES.map(w => {
        const on = w.id === workspace;
        return (
          <button key={w.id} type="button" onClick={() => setWorkspace(w.id)} title={w.hint} aria-current={on ? 'page' : undefined}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: compact ? '0 8px' : medium ? '0 9px' : '0 13px', height: '100%',
              boxSizing: 'border-box', borderBottom: `2px solid ${on ? T.accent : 'transparent'}`, color: on ? T.text : T.muted,
              fontSize: compact ? 11.5 : 13.5, fontWeight: 600, letterSpacing: 1, whiteSpace: 'nowrap' }}>
            <span style={{ fontFamily: T.mono, fontSize: compact ? 9.5 : 10.5, color: on ? T.accent : T.faint }}>{w.n}</span>
            {short ? w.short : w.label}
          </button>
        );
      })}
    </nav>
  );
  const menuBtn = onMenu && (
    <button type="button" onClick={onMenu} aria-label="Data catalog" title="Data catalog"
      style={{ all: 'unset', cursor: 'pointer', padding: '3px 6px', border: `1px solid ${T.ruleStrong}`, borderRadius: 2, fontSize: 11, color: T.text, whiteSpace: 'nowrap' }}>☰ LAYERS</button>
  );
  const guideBtn = onGuide && (
    <button type="button" onClick={onGuide} title="What is this? The four workspaces and a quick start"
      style={{ all: 'unset', cursor: 'pointer', padding: compact ? '2px 6px' : '3px 8px', border: `1px solid ${T.ruleStrong}`, borderRadius: 2,
        fontSize: compact ? 11 : 12.5, color: T.text, whiteSpace: 'nowrap', fontWeight: 600 }}>? GUIDE</button>
  );
  const statusBox = (
    <div aria-label="Mission status" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 13 }}>
      {!short && objective && <span title="Mission objective" style={{ color: T.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
        {objective.name}</span>}
      {!compact && decision && activeRoute && (
        <span title="Active route" style={{ display: 'flex', alignItems: 'center', gap: 4, color: T.text, fontFamily: T.mono }}>
          <span style={{ width: 8, height: 8, background: ROUTE_COLORS[activeRoute], display: 'inline-block' }} />{activeRoute}
        </span>
      )}
      {status && (
        <span title={decision.summary} style={{ padding: '2px 7px', borderRadius: 2, fontWeight: 700, letterSpacing: 0.5, fontSize: compact ? 10.5 : 11.5,
          background: STATUS_COLOR[status], color: '#0d0f12', whiteSpace: 'nowrap' }}>{status}</span>
      )}
      {eva && <span style={{ padding: '2px 7px', border: `1px solid ${aborted ? T.nogo : T.info}`, color: aborted ? T.nogo : T.info, borderRadius: 2,
        fontSize: compact ? 10 : 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{eva}</span>}
      {!status && !short && <span style={{ color: T.faint }}>No route planned yet</span>}
      {!compact && guideBtn}
    </div>
  );
  return (
    <header role="banner" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: topbarHeight(compact), zIndex: 20,
      background: T.ground, borderBottom: `1px solid ${T.rule}`, fontFamily: T.sans, color: T.text, boxSizing: 'border-box',
      display: 'flex', flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 6 : 14, padding: compact ? '0 6px' : '0 12px', height: compact ? ROW_H : '100%', flexShrink: 0, minWidth: 0, flex: compact ? 'none' : 1 }}>
        {onMenu && !compact && menuBtn}
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, flexShrink: 0 }}>
          <span style={{ fontWeight: 700, letterSpacing: 2, fontSize: compact ? 12 : 14.5 }}>MARTIAN MAP</span>
          {!short && <span style={{ fontSize: 11.5, color: T.muted, letterSpacing: 0.3 }}>{SITE.meta?.label || SITE.name}</span>}
        </div>
        <div style={{ flexShrink: 0 }}><SiteSwitcher current={SITE.name} inline compact={short} /></div>
        {!compact && tabs}
        {statusBox}
      </div>
      {compact && <div style={{ borderTop: `1px solid ${T.rule}`, display: 'flex', alignItems: 'center' }}>{tabs}<span style={{ marginLeft: 'auto', paddingRight: 6, display: 'flex', gap: 5 }}>{guideBtn}{onMenu && menuBtn}</span></div>}
    </header>
  );
}
