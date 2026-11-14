/**
 * First-visit guide (Mars sites): what Martian Map is, the four workspaces and a three-step quick
 * start. Shown once per browser (unless the link opens a shared plan or a workspace); reopened from
 * the GUIDE button in the top bar.
 */
import { T, WORKSPACES } from '../ui/theme';
import { SITE } from '../three/terrainGenerator';

const KEY = 'mm-welcome-v1';
export function shouldShowWelcome() {
  const q = new URLSearchParams(window.location.search);
  if (q.has('plan') || q.has('ws') || q.get('guide') === '0') return false;
  try { return window.localStorage.getItem(KEY) !== 'seen'; } catch { return true; }
}
export function markWelcomeSeen() { try { window.localStorage.setItem(KEY, 'seen'); } catch { /* private mode */ } }

export const WORKSPACE_HELP = {
  explore: { does: 'Look at the landing site in 3D and find out what every map layer shows.',
    steps: ['Tick layers in the DATA CATALOG on the left to drape them on the terrain.', 'Click the terrain (or the small site map) to see what is at that point.', 'Press ⓘ next to a layer to see where its data comes from.'] },
  analyze: { does: 'Check the terrain and science data the plan is based on — and what is missing.',
    steps: ['Pick a layer in “Terrain analysis” and compare it with another.', 'Open a dataset in “Scientific data” to see its source and uncertainty.', 'The helmet-camera view shows slopes ahead of the astronaut.'] },
  plan: { does: 'Set up the astronauts and plan a safe walk (EVA) to scientific stops.',
    steps: ['Choose a mission objective and press PLAN SCIENCE EVA.', 'Pick a route mode (SAFE · ECO · FAST · AUTO) and compare the four routes.', 'Open the setup sections (suit, oxygen, payload, dust) to change the crew’s equipment.'] },
  ops: { does: 'Get the GO / NO-GO decision, print the cuff card and run the EVA.',
    steps: ['Read the mission summary and why the decision is GO, CONDITIONAL or NO-GO.', 'Press START EVA to play the walk; ABORT sends the crew home.', 'PRINT CUFF CARD gives the one-page checklist an astronaut carries.'] },
};

export default function WelcomeGuide({ onClose, onGo }) {
  const close = () => { markWelcomeSeen(); onClose(); };
  return (
    <div role="dialog" aria-modal="true" aria-label="Welcome to Martian Map" onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(5,6,8,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(880px, 100%)', maxHeight: '92vh', overflowY: 'auto', background: T.panel, border: `1px solid ${T.ruleStrong}`,
        fontFamily: T.sans, color: T.text, padding: '22px 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: T.accent }}>MARTIAN MAP</span>
          <span style={{ fontSize: 13, color: T.muted }}>{SITE.meta?.label || SITE.name}</span>
          <button type="button" onClick={close} aria-label="Close" style={{ all: 'unset', cursor: 'pointer', marginLeft: 'auto', color: T.muted, fontSize: 18 }}>✕</button>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 650, margin: '10px 0 6px', lineHeight: 1.25 }}>Plan a safe walk for two astronauts on real Mars terrain</h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: '#c3c9d0', margin: 0 }}>
          The 3D surface is built from NASA orbiter elevation data of the rover landing sites. Martian Map finds walking routes to
          scientifically interesting stops, checks each one against slope, time, oxygen and daylight limits, and tells you whether the walk is a
          <b style={{ color: T.go }}> GO</b>, <b style={{ color: T.cond }}>CONDITIONAL</b> or <b style={{ color: T.nogo }}>NO-GO</b> — and why.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 18 }}>
          {WORKSPACES.map(w => (
            <button key={w.id} type="button" onClick={() => { markWelcomeSeen(); onGo(w.id); }}
              style={{ all: 'unset', cursor: 'pointer', border: `1px solid ${T.rule}`, background: T.raised, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: T.mono, color: T.accent, fontSize: 13 }}>{w.n}</span>
              <span style={{ fontWeight: 700, letterSpacing: 1, fontSize: 15 }}>{w.label}</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.45, color: '#c3c9d0' }}>{WORKSPACE_HELP[w.id].does}</span>
              <span style={{ fontSize: 12.5, color: T.info, marginTop: 'auto' }}>Open →</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 18, borderTop: `1px solid ${T.rule}`, paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, color: T.muted }}>QUICK START — THREE CLICKS</div>
          <ol style={{ margin: '8px 0 0', paddingLeft: 22, fontSize: 15, lineHeight: 1.7 }}>
            <li><b>03 PLAN MISSION</b> → choose an objective → <b>PLAN SCIENCE EVA</b></li>
            <li>Read the decision at the top right (GO / CONDITIONAL / NO-GO) and open <i>Why?</i> to see the reasons</li>
            <li><b>04 OPERATIONS</b> → <b>START EVA</b> to watch the walk, or <b>PRINT CUFF CARD</b></li>
          </ol>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => { markWelcomeSeen(); onGo('plan'); }}
            style={{ all: 'unset', cursor: 'pointer', background: T.accent, color: '#1a1006', fontWeight: 700, padding: '10px 16px', fontSize: 14, letterSpacing: 0.5 }}>Start planning a mission</button>
          <button type="button" onClick={() => { markWelcomeSeen(); onGo('explore'); }}
            style={{ all: 'unset', cursor: 'pointer', border: `1px solid ${T.ruleStrong}`, padding: '10px 16px', fontSize: 14 }}>Explore the map first</button>
          <span style={{ fontSize: 12.5, color: T.faint, alignSelf: 'center', marginLeft: 'auto' }}>This guide is always under <b>? GUIDE</b> in the top bar.</span>
        </div>
      </div>
    </div>
  );
}
