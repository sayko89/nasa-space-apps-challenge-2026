/**
 * Elevation profile of the active route (distance walked → elevation), stops numbered.
 * `print` draws it in black on white for the cuff card; otherwise in the panel's colours.
 * Geometry: utils/elevationProfile.js (unit tested).
 */
import { useMemo } from 'react';
import { elevationProfile, profileGeometry } from '../utils/elevationProfile';

export default function ElevationProfile({ path, stats, originM = 0, color = '#3dff6e', print = false, width = 300, height = 62 }) {
  const profile = useMemo(() => elevationProfile(path, stats, originM), [path, stats, originM]);
  if (!profile) return null;
  const W = width, H = height;
  const pad = { l: 34, r: 6, t: 11, b: 12 };
  const g = profileGeometry(profile, W, H, pad);
  const ink = print ? '#111' : 'rgba(190,220,190,0.75)';
  const faint = print ? '#999' : 'rgba(120,160,120,0.35)';
  const stroke = print ? '#111' : color;
  const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
  const txt = { fontFamily: 'monospace', fontSize: 7, fill: ink };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}
      aria-label={`Elevation profile: ${Math.round(profile.minM)} to ${Math.round(profile.maxM)} m over ${km(profile.totalM)}, ${profile.stops.length} stops`}>
      {/* min / max guide lines with absolute elevations */}
      {[profile.maxM, profile.minM].map((e, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={g.Y(e)} y2={g.Y(e)} stroke={faint} strokeWidth={0.5} strokeDasharray="2 2" />
          <text x={pad.l - 3} y={g.Y(e) + 2.5} textAnchor="end" style={txt}>{Math.round(e)}</text>
        </g>
      ))}
      <path d={g.area} fill={print ? '#e6e6e6' : color} fillOpacity={print ? 1 : 0.13} />
      <path d={g.line} fill="none" stroke={stroke} strokeWidth={1.2} strokeLinejoin="round" />
      {/* stops */}
      {profile.stops.map(s => (
        <g key={s.n}>
          <line x1={g.X(s.distM)} x2={g.X(s.distM)} y1={g.Y(s.elevM)} y2={H - pad.b} stroke={faint} strokeWidth={0.5} />
          <circle cx={g.X(s.distM)} cy={g.Y(s.elevM)} r={2.1} fill={print ? '#fff' : '#ffb347'} stroke={print ? '#111' : '#1a0d00'} strokeWidth={0.6} />
          <text x={g.X(s.distM)} y={g.Y(s.elevM) - 3.5} textAnchor="middle" style={{ ...txt, fontWeight: 'bold', fill: print ? '#111' : '#ffcf8a' }}>{s.n}</text>
        </g>
      ))}
      {/* distance axis */}
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke={ink} strokeWidth={0.5} />
      <text x={pad.l} y={H - 2} style={txt}>H · 0</text>
      <text x={(pad.l + W - pad.r) / 2} y={H - 2} textAnchor="middle" style={txt}>distance walked · elevation in m</text>
      <text x={W - pad.r} y={H - 2} textAnchor="end" style={txt}>{km(profile.totalM)} · H</text>
    </svg>
  );
}
