/** Map layers viewer: heatmaps, legends, compare swipe, drape on 3D (split out of RightPanel). */
import { useRef, useEffect, useCallback, useState } from 'react';
import { IS_DEM } from '../three/terrainGenerator';
import { MAP_S, fs } from '../ui/layout';
import { loadOrthoImage } from '../utils/orthoImage';
import { generateHeatmapCanvas, geologyLegend, dataLayerLegend, HAZARD_LAYER, hazardLegend } from '../utils/heatmaps';
import { HAZARD_PARAMS } from '../config/marswalkProfile';
import { param } from '../config/marswalkProfile';
import { SITE } from '../three/terrainGenerator';
import { Label, Btn } from './ui';
import { HEATMAP_OPTIONS, HEATMAP_DEFAULT, HM_COLORS, ORTHO_LAYER, CMP_TAG } from './panelConstants';

// ---- Heatmap ----
export function HeatmapViewer({ sunAngle, sunElevation, learningModel, refreshKey, drape = null, onDrape = null,
  drapeOpacity = 0.6, setDrapeOpacity = () => {}, request = null, onLayerShown = null }) {
  const ref=useRef(null);
  const [sel,setSel]=useState(HEATMAP_DEFAULT);
  // the mission workflow can ask for a layer (e.g. step 5 → Hazards)
  useEffect(() => { if (request?.layer && HEATMAP_OPTIONS.includes(request.layer)) setSel(request.layer); }, [request]);
  useEffect(() => { if (sel !== HEATMAP_DEFAULT || request) onLayerShown?.(sel); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  // keep the 3D drape on the selected layer
  useEffect(() => { if (drape && drape !== sel) onDrape?.(sel); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open,setOpen]=useState(false);
  const [tick,setTick]=useState(0);
  // Compare (swipe): layer A on the left, layer B on the right of a draggable line —
  // the comparison mode of NASA Worldview, here between two layers of the same site.
  const refB=useRef(null);
  const [compare,setCompare]=useState(false);
  const [selB,setSelB]=useState(SITE.ortho ? ORTHO_LAYER : 'Elevation');
  const [split,setSplit]=useState(0.5);
  const dragSplit = useCallback((e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSplit(Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width)));
  }, []);
  useEffect(()=>{
    const cv = refB.current;
    if (!compare || !cv) return undefined;
    let alive = true;
    if (selB === ORTHO_LAYER) {
      loadOrthoImage().then(img => {
        if (!alive || !img) return;
        const ctx = cv.getContext('2d');
        ctx.globalCompositeOperation='source-over';
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        ctx.globalCompositeOperation='multiply'; ctx.fillStyle='#e9b48a'; ctx.fillRect(0,0,cv.width,cv.height);
        ctx.globalCompositeOperation='source-over';
      });
    } else {
      generateHeatmapCanvas(cv, selB, sunAngle, undefined, sunElevation);
    }
    return () => { alive = false; };
  }, [compare, selB, sunAngle, sunElevation, refreshKey]);
  // Experience map is mutated in place (same array reference), so it needs a
  // live poll while visible — other layers are derived from static terrain data.
  useEffect(()=>{
    if (sel !== 'Experience') return;
    const id = setInterval(()=>setTick(t=>t+1), 500);
    return () => clearInterval(id);
  }, [sel]);
  useEffect(()=>{
    if (!ref.current) return;
    const experienceMap = sel === 'Experience' ? learningModel?.getExperienceMap?.() : undefined;
    generateHeatmapCanvas(ref.current,sel,sunAngle,experienceMap,sunElevation);
  }, [sel,sunAngle,sunElevation,tick,learningModel,refreshKey]);
  return (
    <div>
      <Label>{IS_DEM ? 'Map Layers' : 'Parameter Heatmap'}</Label>
      <div style={{position:'relative',marginTop:4,marginBottom:5}}>
        <div onClick={()=>setOpen(o=>!o)} style={{
          background:'rgba(18,36,18,0.7)',border:'1px solid rgba(60,100,60,0.5)',
          borderRadius:3,padding:'3px 7px',cursor:'pointer',fontFamily:'monospace',
          display:'flex',justifyContent:'space-between',fontSize:fs(9),color:HM_COLORS[sel]||'#aaa',
        }}>
          {sel}<span style={{color:'#558855'}}>▼</span>
        </div>
        {open&&(
          <div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:200,
            background:'rgba(6,16,6,0.97)',border:'1px solid rgba(60,100,60,0.5)',borderRadius:3,overflow:'hidden'}}>
            {HEATMAP_OPTIONS.map(o=>(
              <div key={o} onClick={()=>{setSel(o);setOpen(false);}}
                style={{padding:'4px 7px',fontSize:fs(9),cursor:'pointer',fontFamily:'monospace',
                  color:HM_COLORS[o]||'#aaa',background:o===sel?'rgba(40,80,40,0.5)':'transparent'}}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(30,60,30,0.6)'}
                onMouseLeave={e=>e.currentTarget.style.background=o===sel?'rgba(40,80,40,0.5)':'transparent'}
              >{o}</div>
            ))}
          </div>
        )}
      </div>
      <div style={{position:'relative',width:MAP_S,height:MAP_S,touchAction:compare?'none':'auto',cursor:compare?'ew-resize':'default'}}
        onPointerDown={compare ? (e)=>{ e.currentTarget.setPointerCapture(e.pointerId); dragSplit(e); } : undefined}
        onPointerMove={compare ? (e)=>{ if (e.buttons || e.pointerType==='touch') dragSplit(e); } : undefined}>
        <canvas ref={ref} width={MAP_S} height={MAP_S}
          style={{width:MAP_S,height:MAP_S,display:'block',borderRadius:3,border:'1px solid rgba(80,120,60,0.3)',boxSizing:'border-box'}}/>
        {compare && (<>
          <canvas ref={refB} width={MAP_S} height={MAP_S} aria-label={`Layer B: ${selB}`}
            style={{position:'absolute',inset:0,width:MAP_S,height:MAP_S,borderRadius:3,pointerEvents:'none',
              clipPath:`inset(0 0 0 ${(split*100).toFixed(2)}%)`}}/>
          <div style={{position:'absolute',top:0,bottom:0,left:`${split*100}%`,width:2,marginLeft:-1,background:'#fff',boxShadow:'0 0 4px #000',pointerEvents:'none'}}>
            <div style={{position:'absolute',top:'50%',left:-9,marginTop:-9,width:20,height:18,borderRadius:9,background:'#fff',color:'#111',
              font:'bold 10px monospace',textAlign:'center',lineHeight:'18px'}}>◂▸</div>
          </div>
          <span style={{...CMP_TAG,left:4}}>A · {sel}</span>
          <span style={{...CMP_TAG,right:4}}>B · {selB}</span>
        </>)}
      </div>
      {IS_DEM && (
        <div style={{display:'flex',alignItems:'center',gap:5,marginTop:4}}>
          <Btn active={compare} color="#9fd0ff" onClick={()=>setCompare(c=>!c)} style={{flex:'none',padding:'3px 7px'}}
            title="Swipe between two layers of this site — drag the line on the map">
            {compare ? '◧ COMPARING ✓' : '◧ COMPARE LAYERS'}
          </Btn>
          {compare && (
            <select value={selB} onChange={e=>setSelB(e.target.value)} aria-label="Layer B (right side)"
              style={{flex:1,minWidth:0,background:'rgba(18,36,18,0.9)',color:'#cfe6ff',border:'1px solid rgba(100,150,200,0.5)',
                borderRadius:3,fontFamily:'monospace',fontSize:fs(8),padding:'2px 3px'}}>
              {[...(SITE.ortho ? [ORTHO_LAYER] : []), ...HEATMAP_OPTIONS].filter(o=>o!==sel).map(o=><option key={o} value={o}>B: {o}</option>)}
            </select>
          )}
        </div>
      )}
      {sel === HAZARD_LAYER ? (
        <div style={{fontSize:fs(7),color:'#aab8a0',marginTop:3,lineHeight:1.5}}>
          {(hazardLegend() || []).map(e => (
            <div key={e.name} style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{width:7,height:7,background:e.color,display:'inline-block',flexShrink:0}}/>
              <span style={{flex:1,color:e.hard?'#ff9a9a':undefined}}>{e.name}{e.hard ? ' — planner wall' : ''}</span><span>{e.pct.toFixed(1)}%</span>
            </div>
          ))}
          <div style={{color:'#6a7a6a',marginTop:2}}>
            From the HiRISE DTM and the rover's own positions. Slope limit {param('maxWalkableSlopeDeg')}° (NASA ConOps); steep &gt; {(HAZARD_PARAMS.steepFraction.value * param('maxWalkableSlopeDeg')).toFixed(0)}°,
            {' '}rock obstacle &gt; {param('maxRockReliefM')} m, rough &gt; {(HAZARD_PARAMS.roughFraction.value * param('maxRockReliefM')).toFixed(2)} m,
            {' '}buffer {HAZARD_PARAMS.obstacleBufferM.value} m, depression ≥ {HAZARD_PARAMS.depressionM.value} m deep, "known only from orbit" = no rover position within {HAZARD_PARAMS.unseenM.value} m
            {' '}— all but the slope limit are planning assumptions. The 1 m DTM does not show rocks smaller than ~2 m: no cell is "rock-free" for certain.
          </div>
        </div>
      ) : dataLayerLegend(sel) ? (
        <DataLayerLegend lg={dataLayerLegend(sel)} />
      ) : geologyLegend(sel) ? (
        <div style={{fontSize:fs(7),color:'#aab8a0',marginTop:3,lineHeight:1.5}}>
          {geologyLegend(sel).map(e => (
            <div key={e.name} style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{width:7,height:7,background:e.color,display:'inline-block',flexShrink:0}}/>
              <span style={{flex:1}}>{e.name}</span><span>{e.pct.toFixed(1)}%</span>
            </div>
          ))}
          <div style={{color:'#6a7a6a'}}>{SITE.geology?.source?.short || 'Stack et al. 2020 (CC BY 4.0)'}</div>
        </div>
      ) : (
      <div style={{display:'flex',justifyContent:'space-between',fontSize:fs(7),color:'#558855',marginTop:2}}>
        <span>LOW</span><span style={{color:HM_COLORS[sel]}}>{sel.toUpperCase()}</span><span>HIGH</span>
      </div>
      )}
      {IS_DEM && onDrape && (
        <div style={{display:'flex',alignItems:'center',gap:5,marginTop:5}}>
          <Btn active={!!drape} color="#ffbb66" onClick={() => onDrape(drape ? null : sel)}
            style={{flex:'none',padding:'3px 7px'}}>
            {drape ? '⛰ ON 3D TERRAIN ✓' : '⛰ DRAPE ON 3D TERRAIN'}
          </Btn>
          {drape && (
            <input type="range" min={0.2} max={0.95} step={0.05} value={drapeOpacity} title="Layer opacity"
              onChange={e => setDrapeOpacity(Number(e.target.value))} style={{flex:1}} />
          )}
        </div>
      )}
    </div>
  );
}

export function DataLayerLegend({ lg }) {
  return (
    <div style={{fontSize:fs(7),color:'#aab8a0',marginTop:3,lineHeight:1.5}}>
      {lg.kind === 'classes' ? lg.entries.map(e => (
        <div key={e.name} style={{display:'flex',alignItems:'center',gap:4}}>
          <span style={{width:7,height:7,background:e.color,display:'inline-block',flexShrink:0}}/>
          <span style={{flex:1}}>{e.name}</span><span>{e.pct.toFixed(1)}%</span>
        </div>
      )) : (
        <>
          <div style={{height:6,borderRadius:2,background:'linear-gradient(90deg,#0000ff,#00ffff,#00ff00,#ffff00,#ff0000)'}}/>
          <div style={{display:'flex',justifyContent:'space-between'}}>
            <span>{lg.lo}</span><span style={{color:'#7a8a7a'}}>{lg.unit}</span><span>{lg.hi}+</span>
          </div>
        </>
      )}
      {lg.note && <div style={{color:'#7a8a7a'}}>{lg.note}</div>}
      <div style={{color:'#6a7a6a'}}>{lg.source}</div>
    </div>
  );
}
