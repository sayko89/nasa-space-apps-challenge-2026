/** Small shared panel components. Mars sites use the workspace design tokens (ui/theme.js); the Moon keeps its terminal look. */
import { useState } from 'react';
import { fs } from '../ui/layout';
import { IS_DEM } from '../three/terrainGenerator';
import { T } from '../ui/theme';

const MOON = { label: '#3a663a', rule: 'rgba(30,70,30,0.2)', v: '#99ff99', btnOn: 'rgba(60,180,60,0.7)', btnOff: 'rgba(35,70,35,0.4)',
  btnBgOn: 'rgba(0,50,0,0.5)', btnBgOff: 'rgba(6,14,6,0.4)', btnTxtOn: '#77ff77', btnTxtOff: '#447744' };
const MARS = { label: T.muted, rule: T.rule, v: T.text, btnOn: T.accent, btnOff: T.ruleStrong,
  btnBgOn: T.accentSoft, btnBgOff: T.raised, btnTxtOn: '#f2c6a0', btnTxtOff: '#b9c0c8' };
const C = IS_DEM ? MARS : MOON;

/**
 * Panel section. `collapsible` sections show `summary` (the key values) in the header while closed,
 * so the panel can be read without opening every section.
 */
export function Sect({ label, children, id, collapsible = false, defaultOpen = true, summary = null, open: openProp, onToggle }) {
  const [openState, setOpen] = useState(defaultOpen);
  const open = openProp ?? openState;
  const toggle = () => { onToggle ? onToggle(!open) : setOpen(o => !o); };
  return (
    <section id={id} style={{ scrollMarginTop: 6 }} aria-label={typeof label === 'string' ? label : undefined}>
      {collapsible ? (
        <button type="button" onClick={toggle} aria-expanded={open}
          style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', alignItems: 'baseline', gap: 6, boxSizing: 'border-box' }}>
          <span style={{ color: C.label, fontSize: fs(7), width: 9, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <Label>{label}</Label>
            {!open && summary && <span style={{ display: 'block', marginTop: 2, fontSize: fs(7.5), color: IS_DEM ? T.text : '#88aa88', fontFamily: IS_DEM ? T.mono : 'monospace',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>}
          </span>
        </button>
      ) : <Label>{label}</Label>}
      {(!collapsible || open) && <div style={{ marginTop: 5 }}>{children}</div>}
      <div style={{ height: 1, background: C.rule, marginTop: 8 }} />
    </section>
  );
}
export function Label({ children }) {
  return <div style={{ color: C.label, fontSize: fs(7), textTransform: 'uppercase', letterSpacing: IS_DEM ? 1 : 1.2,
    fontWeight: IS_DEM ? 600 : 'normal', fontFamily: IS_DEM ? T.sans : undefined }}>{children}</div>;
}
export function Row({ children, style = {} }) {
  return <div style={{ display: 'flex', gap: 3, ...style }}>{children}</div>;
}
export function V({ children, c }) {
  return <span style={{ color: c || C.v, fontFamily: IS_DEM ? T.mono : undefined }}>{children}</span>;
}
export function Btn({ children, active, onClick, disabled, color, title, style = {} }) {
  return (
    <button type="button" title={title} disabled={!!disabled} onClick={disabled ? undefined : onClick} aria-pressed={active ? true : undefined} style={{
      flex: 1, padding: IS_DEM ? '4px 5px' : '4px 4px', fontSize: fs(8), fontWeight: IS_DEM ? 600 : 'bold',
      cursor: disabled ? 'default' : 'pointer', borderRadius: IS_DEM ? 2 : 3,
      border: `1px solid ${active ? (color || C.btnOn) : C.btnOff}`,
      background: active ? C.btnBgOn : C.btnBgOff,
      color: active ? (IS_DEM ? (color ? color : C.btnTxtOn) : (color || C.btnTxtOn)) : C.btnTxtOff,
      opacity: disabled ? 0.4 : 1, transition: 'background 0.12s, border-color 0.12s',
      fontFamily: IS_DEM ? T.sans : 'monospace', letterSpacing: IS_DEM ? 0.3 : 0.4,
      ...style,
    }}>
      {children}
    </button>
  );
}

/**
 * A closed "slot" for long explanations: one line (label + optional badge) that opens on click.
 * Children stay mounted when closed (hidden), so their state and labels survive.
 */
export function More({ label, children, defaultOpen = false, badge = null, badgeColor = null, style = {} }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${IS_DEM ? T.rule : 'rgba(40,80,40,0.4)'}`, borderRadius: 2, margin: '4px 0', background: IS_DEM ? T.sunken : 'rgba(0,12,0,0.4)', ...style }}>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box',
          padding: '5px 8px', fontSize: fs(7.5), color: IS_DEM ? T.text : '#9fcf9f', fontFamily: IS_DEM ? T.sans : 'monospace' }}>
        <span style={{ color: IS_DEM ? T.accent : '#66aa66', width: 10, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
        {badge && <span style={{ fontSize: fs(6.5), fontWeight: 700, padding: '1px 6px', borderRadius: 2, flexShrink: 0,
          background: badgeColor || (IS_DEM ? T.raised : '#133013'), color: badgeColor ? '#0d0f12' : (IS_DEM ? T.muted : '#88aa88') }}>{badge}</span>}
      </button>
      <div style={{ display: open ? 'block' : 'none', padding: '2px 8px 7px' }}>{children}</div>
    </div>
  );
}
