/**
 * Data provenance — every layer of the loaded site: where it comes from, what kind of
 * knowledge it is (measured / orbital / derived / transferred / modelled / simulated),
 * and what it cannot tell. Records: config/provenance.js (tested against the site files).
 */
import { createPortal } from 'react-dom';
import { provenanceFor, CATEGORIES } from '../config/provenance';
import { SITE } from '../three/terrainGenerator';
import { useEscape, CloseButton } from './PovViewer';

const cell = { padding: '3px 6px', borderBottom: '1px solid rgba(80,110,80,0.25)', verticalAlign: 'top' };

export default function ProvenancePanel({ onClose }) {
  useEscape(onClose);
  const list = provenanceFor(SITE.name, SITE);
  const avail = list.filter(r => r.available), missing = list.filter(r => !r.available);
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div role="dialog" aria-label="Data provenance" onClick={e => e.stopPropagation()}
        style={{ width: 'min(1180px, 100%)', maxHeight: '92vh', overflow: 'auto', background: '#0b120b',
          border: '1px solid #3a6a3a', borderRadius: 6, padding: '10px 12px', fontFamily: 'monospace', color: '#cfe0c8', fontSize: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <b style={{ color: '#9fffa0', letterSpacing: '0.1em' }}>DATA PROVENANCE — {SITE.meta?.label || SITE.name}</b>
          <span style={{ flex: 1 }} />
          <CloseButton onClose={onClose} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6, fontSize: 10 }}>
          {Object.entries(CATEGORIES).map(([k, c]) => (
            <span key={k}><span style={{ color: c.color }}>■</span> {c.label}</span>
          ))}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
            <thead>
              <tr style={{ color: '#8fbf8f', textAlign: 'left' }}>
                {['Layer', 'Kind', 'Mission · instrument', 'Observed', 'Resolution · coverage', 'Processing', 'Uncertainty · limitations'].map(h =>
                  <th key={h} style={{ ...cell, position: 'sticky', top: 0, background: '#0b120b' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {avail.map(r => (
                <tr key={r.key}>
                  <td style={cell}><b>{r.name}</b><br /><span style={{ color: '#7a8a7a' }}>{r.dataType} · {r.status}</span><br />
                    {r.source?.url ? <a href={r.source.url} target="_blank" rel="noopener noreferrer" style={{ color: '#9fc7ff' }}>{r.source.title}</a>
                      : <span style={{ color: '#9ab09a' }}>{r.source?.title}</span>}</td>
                  <td style={{ ...cell, color: CATEGORIES[r.category].color, whiteSpace: 'nowrap' }}>{CATEGORIES[r.category].label}</td>
                  <td style={cell}>{r.mission}<br /><span style={{ color: '#9ab09a' }}>{r.instrument}</span></td>
                  <td style={cell}>{r.observed}</td>
                  <td style={cell}>{r.resolution}<br /><span style={{ color: '#9ab09a' }}>{r.coverage}</span></td>
                  <td style={{ ...cell, color: '#b8c8b0' }}>{r.processing}</td>
                  <td style={cell}><span style={{ color: '#e0c890' }}>{r.uncertainty}</span><br /><span style={{ color: '#e0a070' }}>{r.limitations}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {missing.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <b style={{ color: '#ffb070' }}>NOT AVAILABLE FOR THIS SITE</b>
            {missing.map(r => (
              <div key={r.key} style={{ marginTop: 3 }}>
                <span style={{ color: '#ffb070' }}>✕ {r.name}</span>
                {r.instrument && <span style={{ color: '#9ab09a' }}> ({r.mission} · {r.instrument})</span>} — {r.reason}
              </div>
            ))}
            <div style={{ marginTop: 4, color: '#7a8a7a' }}>The map is not filled in where data is missing: these layers are simply absent.</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
