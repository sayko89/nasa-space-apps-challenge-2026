/**
 * Chemistry card: Curiosity ChemCam compositions measured near a science stop, next to the
 * mean of the stop's stratigraphic level — "what is this rock made of, and is it unusual?".
 * Data: public/sites/<site>/chemistry.json (pipeline/build_chemistry.py).
 */
import { createPortal } from 'react-dom';
import { useEscape, CloseButton } from './PovViewer';
import { SITE } from '../three/terrainGenerator';
import { nearestTargets, levelMean, standouts, OXIDE_ORDER, CHEM_RADIUS_M, STANDOUT_SIGMA } from '../utils/chemistry';

const SUB = { SiO2: 'SiO₂', FeOT: 'FeOᴛ', MgO: 'MgO', CaO: 'CaO', Al2O3: 'Al₂O₃', Na2O: 'Na₂O', K2O: 'K₂O', TiO2: 'TiO₂', MnO: 'MnO' };
const BAR_MAX = 70;   // wt% at full bar width (SiO2 rarely exceeds this)

/** True when a measured target lies near (x, z). */
export function hasChemistry(x, z) {
  return nearestTargets(SITE.chemistry, x, z, CHEM_RADIUS_M, 1).length > 0;
}

function Bar({ value, mean, rmsep }) {
  const w = v => `${Math.min(100, (v / BAR_MAX) * 100)}%`;
  return (
    <div style={{ position: 'relative', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
      {rmsep > 0 && mean != null && (
        <div title={`level mean ± ChemCam accuracy (RMSEP ${rmsep} wt%)`} style={{ position: 'absolute', top: 0, bottom: 0,
          left: w(Math.max(0, mean - rmsep)), width: `${Math.min(100, (2 * rmsep / BAR_MAX) * 100)}%`, background: 'rgba(120,200,255,0.18)' }} />
      )}
      <div style={{ position: 'absolute', top: 2, bottom: 2, left: 0, width: w(value), background: '#ffb347', borderRadius: 2 }} />
      {mean != null && <div style={{ position: 'absolute', top: -1, bottom: -1, left: w(mean), width: 2, background: '#88ccff' }} />}
    </div>
  );
}

export function ChemistryCard({ stop, label, onClose }) {
  useEscape(onClose);
  const chem = SITE.chemistry;
  const near = nearestTargets(chem, stop.x, stop.z);
  const units = SITE.geology?.bedrockUnits || [];
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: '#0b0f0b',
        border: '1px solid rgba(255,179,71,0.45)', borderRadius: 6, padding: 12, fontFamily: 'monospace', color: '#d8d0b8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8 }}>
          <b style={{ color: '#ffb347', fontSize: 13 }}>ROCK CHEMISTRY — {label}</b>
          <CloseButton onClose={onClose} />
        </div>
        {!near.length ? (
          <div style={{ fontSize: 12, padding: '24px 0', textAlign: 'center' }}>
            No ChemCam target within {CHEM_RADIUS_M} m of this stop — the crew's own samples would be the first here.
          </div>
        ) : near.map((t, i) => {
          const lvl = levelMean(chem, t.bedrock);
          const odd = standouts(chem, t, lvl);
          return (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                <b style={{ color: '#ffd6aa' }}>{t.name}</b>
                <span style={{ color: '#8a9a8a' }}> · sol {t.sol} · {t.points} laser point{t.points > 1 ? 's' : ''} · {Math.round(t.dist)} m from the stop
                  {units[t.bedrock] ? ` · ${units[t.bedrock]}` : ''}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 58px', gap: '3px 8px', alignItems: 'center', fontSize: 11 }}>
                {OXIDE_ORDER.filter(o => t.oxides[o] != null).map(o => (
                  <div key={o} style={{ display: 'contents' }}>
                    <span style={{ color: odd.some(s => s.oxide === o) ? '#ffcc66' : '#b8c8b0' }}>{SUB[o]}</span>
                    <Bar value={t.oxides[o]} mean={lvl?.mean?.[o]} rmsep={chem.rmsep?.[o]} />
                    <span style={{ textAlign: 'right' }}>{t.oxides[o].toFixed(1)}<span style={{ color: '#6a7a6a' }}> %</span></span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, marginTop: 5, color: odd.length ? '#ffcc66' : '#8a9a8a' }}>
                {!lvl ? 'No level mean to compare with.'
                  : odd.length
                    ? `Stands out from the ${lvl.name.toLowerCase()} mean (${lvl.targets} targets): ` +
                      odd.map(s => `${SUB[s.oxide]} ${s.diff > 0 ? '+' : ''}${s.diff.toFixed(1)}`).join(', ') + ` wt% — more than ${STANDOUT_SIGMA}× ChemCam accuracy. Worth sampling.`
                    : `Within ${STANDOUT_SIGMA}× ChemCam accuracy of the ${lvl.name.toLowerCase()} mean (${lvl.targets} targets).`}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 10, color: '#7a8a7a', lineHeight: 1.6 }}>
          Orange bar = target · blue line = mean of its stratigraphic level · shaded band = ± ChemCam accuracy (RMSEP).
          Weight % oxide; FeOᴛ = total iron as FeO. Location = rover position + laser pointing and range, to about a metre.
          <br />{chem?.source?.title} · {chem?.source?.publisher} · sols {chem?.stats?.sols?.join('–')}
        </div>
      </div>
    </div>,
    document.body,
  );
}
