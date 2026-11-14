/** Small shared panel components. */
import { fs } from '../ui/layout';

// ---- Micro components ----
export function Sect({ label, children, id }) {
  return (
    <div id={id} style={{ scrollMarginTop: 6 }}>
      <Label>{label}</Label>
      <div style={{marginTop:4}}>{children}</div>
      <div style={{height:1,background:'rgba(30,70,30,0.2)',marginTop:8}}/>
    </div>
  );
}
export function Label({ children }) {
  return <div style={{color:'#3a663a',fontSize:fs(7),textTransform:'uppercase',letterSpacing:1.2}}>{children}</div>;
}
export function Row({ children, style={} }) {
  return <div style={{display:'flex',gap:3,...style}}>{children}</div>;
}
export function V({ children, c }) {
  return <span style={{color:c||'#99ff99'}}>{children}</span>;
}
export function Btn({ children, active, onClick, disabled, color, title, style={} }) {
  return (
    <button type="button" title={title} disabled={!!disabled} onClick={disabled?undefined:onClick} style={{
      flex:1,padding:'4px 4px',fontSize:fs(8),fontWeight:'bold',
      cursor:disabled?'default':'pointer',borderRadius:3,
      border:`1px solid ${active?(color||'rgba(60,180,60,0.7)'):'rgba(35,70,35,0.4)'}`,
      background:active?'rgba(0,50,0,0.5)':'rgba(6,14,6,0.4)',
      color:active?(color||'#77ff77'):'#447744',
      opacity:disabled?0.4:1,transition:'all 0.12s',
      fontFamily:'monospace',letterSpacing:0.4,
      ...style,
    }}>
      {children}
    </button>
  );
}
