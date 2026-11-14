/** 2D mini-map of the site: waypoints, routes, rover, dust devil, zoom / pan (split out of RightPanel). */
import { useRef, useEffect, useCallback, useState } from 'react';
import { TERRAIN_SIZE, CRATERS, IS_DEM } from '../three/terrainGenerator';
import { MAP_S } from '../ui/layout';
import { ROUTE_COLORS } from '../utils/constants';
import { getTerrainCanvas } from '../utils/terrainRenderer';
import { loadOrthoImage } from '../utils/orthoImage';
import { SITE } from '../three/terrainGenerator';
import { HALF, CANVAS_FONT, WP_COLORS_2D } from './panelConstants';

// ---- World ↔ Map coordinate helpers ----
export function w2m(wx, wz, vx, vy, zoom) {
  return { x: ((wx+HALF)/TERRAIN_SIZE*MAP_S - vx)*zoom, y: ((wz+HALF)/TERRAIN_SIZE*MAP_S - vy)*zoom };
}
export function m2w(mx, my, vx, vy, zoom) {
  const cx=mx/zoom+vx, cy=my/zoom+vy;
  return { wx:(cx/MAP_S)*TERRAIN_SIZE-HALF, wz:(cy/MAP_S)*TERRAIN_SIZE-HALF };
}
export function clamp(vx,vy,zoom) {
  const span=MAP_S/zoom;
  return { vx:Math.max(0,Math.min(Math.max(0,MAP_S-span),vx)), vy:Math.max(0,Math.min(Math.max(0,MAP_S-span),vy)) };
}

// ---- Mini-map ----
export function MiniMap({ waypoints, roverPos, routes, activeRoute, pickMode, onPick, dustHazard, dustPickMode, onDustPlace, ponr, orthoOn, showTrack }) {
  const canvasRef   = useRef(null);
  const terrainRef  = useRef(null);
  const zoomRef     = useRef(1);
  const viewRef     = useRef({ x:0, y:0 });
  const dragRef     = useRef(null);

  const demBaseRef  = useRef(null);
  const orthoImgRef = useRef(null);
  const [baseTick, setBaseTick] = useState(0);
  useEffect(() => { demBaseRef.current = getTerrainCanvas(MAP_S*2); terrainRef.current = demBaseRef.current; }, []);
  // HiRISE image as the map base when it is on the terrain (same row/col layout as the DEM canvas)
  useEffect(() => {
    let alive = true;
    if (orthoOn && SITE.ortho) {
      loadOrthoImage().then(img => {
        if (!alive || !img) return;
        orthoImgRef.current = img; terrainRef.current = img; setBaseTick(t => t + 1);
      });
    } else {
      terrainRef.current = demBaseRef.current; setBaseTick(t => t + 1);
    }
    return () => { alive = false; };
  }, [orthoOn]);

  const draw = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const W=cv.width, H=cv.height;
    const zoom=zoomRef.current, {x:vx,y:vy}=viewRef.current;

    ctx.clearRect(0,0,W,H);

    // Terrain base
    if (terrainRef.current) {
      const src=terrainRef.current, ss=src.width;
      const span=MAP_S/zoom;
      ctx.drawImage(src, vx/MAP_S*ss, vy/MAP_S*ss, span/MAP_S*ss, span/MAP_S*ss, 0,0,W,H);
      if (src === orthoImgRef.current) {   // grayscale HiRISE → same Mars tint as the 3D terrain
        ctx.globalCompositeOperation='multiply'; ctx.fillStyle='#e9b48a'; ctx.fillRect(0,0,W,H);
        ctx.globalCompositeOperation='source-over';
      }
    }

    // Craters
    for (const c of CRATERS) {
      const {x:cx,y:cy}=w2m(c.x,c.z,vx,vy,zoom);
      const r=(c.radius/TERRAIN_SIZE)*MAP_S*zoom;
      const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      g.addColorStop(0,'rgba(90,10,0,0.32)'); g.addColorStop(0.7,'rgba(60,20,0,0.10)'); g.addColorStop(1,'transparent');
      ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
      ctx.beginPath();ctx.arc(cx,cy,r*1.05,0,Math.PI*2);ctx.strokeStyle='rgba(210,200,175,0.38)';ctx.lineWidth=0.8;ctx.stroke();
    }

    // ChemCam targets (rock chemistry measured by the rover) — small cyan diamonds
    if (SITE.chemistry?.targets) {
      ctx.fillStyle='rgba(120,210,255,0.85)'; ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=0.6;
      const s=Math.max(1.6, 1.2*Math.sqrt(zoom));
      for (const t of SITE.chemistry.targets) {
        const {x,y}=w2m(t.x,t.z,vx,vy,zoom);
        if (x<-5||y<-5||x>W+5||y>H+5) continue;
        ctx.beginPath(); ctx.moveTo(x,y-s); ctx.lineTo(x+s,y); ctx.lineTo(x,y+s); ctx.lineTo(x-s,y); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    }

    // The rover's own route (pale line) and named places — as on NASA's Curiosity route maps
    if (showTrack && SITE.track) {
      ctx.save();
      ctx.strokeStyle='rgba(230,232,255,0.85)'; ctx.lineWidth=1.1; ctx.lineJoin='round';
      for (const seg of SITE.track.segments) {
        ctx.beginPath();
        seg.forEach(([wx,wz],i)=>{ const {x,y}=w2m(wx,wz,vx,vy,zoom); if(i) ctx.lineTo(x,y); else ctx.moveTo(x,y); });
        ctx.stroke();
      }
      ctx.font=CANVAS_FONT(6.5,true); ctx.textBaseline='middle';
      for (const l of SITE.track.labels) {
        const {x,y}=w2m(l.x,l.z,vx,vy,zoom);
        if (x<0||y<0||x>W||y>H) continue;
        const text = l.kind==='sol' ? l.text : l.text;
        const tw=ctx.measureText(text).width, right = x+6+tw > W-2;
        ctx.fillStyle = l.kind==='region' ? '#e0b040' : '#fff';
        ctx.beginPath(); ctx.arc(x,y,1.8,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(right ? x-6-tw-2 : x+4, y-5, tw+4, 10);
        ctx.fillStyle = l.kind==='region' ? '#ffe9a8' : '#fff';
        ctx.fillText(text, right ? x-6-tw : x+6, y);
      }
      ctx.restore();
    }

    // Routes
    if (routes) {
      for (const [mode,pts] of Object.entries(routes)) {
        if (!pts||pts.length<2) continue;
        const active=mode===activeRoute;
        ctx.beginPath();
        for (let i=0;i<pts.length;i++) {
          const {x,y}=w2m(pts[i][0],pts[i][2],vx,vy,zoom);
          i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        }
        ctx.strokeStyle=ROUTE_COLORS[mode]; ctx.lineWidth=active?3.6:1.35;
        ctx.globalAlpha=active?1:0.35; ctx.stroke(); ctx.globalAlpha=1;
      }
    }

    // Waypoints
    if (waypoints) {
      const total=waypoints.length;
      waypoints.forEach((wp,i) => {
        const {x,y}=w2m(wp.x,wp.z,vx,vy,zoom);
        const isStart=i===0, isEnd=i===total-1;
        const color=isStart?'#22ff55':isEnd?'#ff4422':WP_COLORS_2D[i%WP_COLORS_2D.length];
        const g=ctx.createRadialGradient(x,y,0,x,y,10);
        g.addColorStop(0,color+'99'); g.addColorStop(1,color+'00');
        ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
        ctx.beginPath();ctx.arc(x,y,4.5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
        ctx.strokeStyle='#000';ctx.lineWidth=0.7;ctx.stroke();
        ctx.fillStyle='#fff';ctx.font=CANVAS_FONT(6.5,true);
        const label=isStart?'S':isEnd?'E':`${i}`;
        ctx.fillText(label,x-(label.length>1?4:2.5),y+2.5);
      });
    }

    // Point of no return (active route) — red ⛔ diamond
    if (ponr) {
      const {x,y}=w2m(ponr[0],ponr[2],vx,vy,zoom);
      ctx.save(); ctx.translate(x,y); ctx.rotate(Math.PI/4);
      ctx.fillStyle='#ff2a1a'; ctx.strokeStyle='#fff'; ctx.lineWidth=1;
      ctx.fillRect(-4,-4,8,8); ctx.strokeRect(-4,-4,8,8);
      ctx.restore();
    }

    // Rover arrow / crew marker. World heading h: forward = (sin h, cos h) in (x, z);
    // map y grows with z, so the canvas rotation that turns "up" (0,-1) into it is π − h.
    if (roverPos) {
      const {x,y}=w2m(roverPos.x,roverPos.z,vx,vy,zoom);
      ctx.save(); ctx.translate(x,y); ctx.rotate(Math.PI-(roverPos.heading||0));
      ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4,5.5);ctx.lineTo(0,3.5);ctx.lineTo(-4,5.5);ctx.closePath();
      ctx.fillStyle=IS_DEM?'#ffffff':'#FFD700';ctx.fill();ctx.strokeStyle=IS_DEM?'#c62828':'#806000';ctx.lineWidth=IS_DEM?1.2:0.7;ctx.stroke();
      ctx.restore();
    }

    // Pick hint
    if (pickMode) {
      ctx.fillStyle='rgba(0,0,0,0.40)';ctx.fillRect(0,H-18,W,18);
      ctx.fillStyle='#88ffcc';ctx.font=CANVAS_FONT(7.5);
      ctx.fillText(` CLICK → ADD WAYPOINT ${waypoints?.length||0}+1`,4,H-6);
    }

    // Dust pick hint
    if (dustPickMode) {
      ctx.fillStyle='rgba(40,0,0,0.55)';ctx.fillRect(0,H-18,W,18);
      ctx.fillStyle='#ffcc88';ctx.font=CANVAS_FONT(7.5);
      ctx.fillText(IS_DEM ? ' CLICK → PLACE DUST DEVIL' : ' CLICK → PLACE DUST HAZARD',4,H-6);
    }

    // Dust cloud on minimap — soft multi-ring radial gradient
    if (dustHazard) {
      const {x:dcx,y:dcy}=w2m(dustHazard.x,dustHazard.z,vx,vy,zoom);
      const dr=(dustHazard.radius/TERRAIN_SIZE)*MAP_S*zoom;
      // Outer soft haze
      const g2=ctx.createRadialGradient(dcx,dcy,0,dcx,dcy,dr*1.6);
      g2.addColorStop(0,'rgba(180,180,175,0.55)');
      g2.addColorStop(0.45,'rgba(150,150,145,0.38)');
      g2.addColorStop(0.75,'rgba(120,120,115,0.20)');
      g2.addColorStop(1,'rgba(100,100,95,0)');
      ctx.beginPath();ctx.arc(dcx,dcy,dr*1.6,0,Math.PI*2);
      ctx.fillStyle=g2;ctx.fill();
      // Crisp centre puff
      const g3=ctx.createRadialGradient(dcx,dcy,0,dcx,dcy,dr*0.65);
      g3.addColorStop(0,'rgba(200,200,195,0.50)');
      g3.addColorStop(1,'rgba(170,170,165,0)');
      ctx.beginPath();ctx.arc(dcx,dcy,dr*0.65,0,Math.PI*2);
      ctx.fillStyle=g3;ctx.fill();
      // Dashed outline
      ctx.save();ctx.setLineDash([3,3]);
      ctx.beginPath();ctx.arc(dcx,dcy,dr*1.4,0,Math.PI*2);
      ctx.strokeStyle='rgba(220,160,60,0.7)';ctx.lineWidth=1.0;ctx.stroke();
      ctx.restore();
      // ☁ label
      ctx.fillStyle='rgba(255,200,100,0.85)';ctx.font=CANVAS_FONT(7,true);
      ctx.fillText(IS_DEM ? '☁ DUST DEVIL' : '☁ DUST',dcx+dr*1.4+2,dcy+3);
    }

    // Zoom badge
    ctx.fillStyle='rgba(0,0,0,0.55)';ctx.fillRect(W-36,3,33,15);
    ctx.fillStyle='#88cc88';ctx.font=CANVAS_FONT(7);ctx.fillText(`${zoom.toFixed(1)}x`,W-32,14);
  }, [routes, activeRoute, waypoints, roverPos, pickMode, dustHazard, dustPickMode, ponr, baseTick, showTrack]); // eslint-disable-line react-hooks/exhaustive-deps -- baseTick: redraw when the base image loads

  useEffect(() => { draw(); }, [draw]);

  const onWheel = useCallback(e => {
    e.preventDefault();
    const dz=e.deltaY<0?0.4:-0.4;
    const nz=Math.max(1,Math.min(8,zoomRef.current+dz));
    const rect=canvasRef.current.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(MAP_S/rect.width);
    const my=(e.clientY-rect.top)*(MAP_S/rect.height);
    const wx0=mx/zoomRef.current+viewRef.current.x;
    const wy0=my/zoomRef.current+viewRef.current.y;
    zoomRef.current=nz;
    const {vx,vy}=clamp(wx0-mx/nz,wy0-my/nz,nz);
    viewRef.current={x:vx,y:vy}; draw();
  }, [draw]);

  useEffect(() => {
    const c=canvasRef.current; if(!c) return;
    c.addEventListener('wheel',onWheel,{passive:false});
    return () => c.removeEventListener('wheel',onWheel);
  }, [onWheel]);

  const onMouseDown = useCallback(e => {
    if (pickMode || dustPickMode) return;
    dragRef.current={sx:e.clientX,sy:e.clientY,vx:viewRef.current.x,vy:viewRef.current.y};
  }, [pickMode, dustPickMode]);

  const onMouseMove = useCallback(e => {
    if (!dragRef.current) return;
    const rect=canvasRef.current.getBoundingClientRect();
    const sx=MAP_S/rect.width, sy=MAP_S/rect.height;
    const dx=(e.clientX-dragRef.current.sx)*sx/zoomRef.current;
    const dy=(e.clientY-dragRef.current.sy)*sy/zoomRef.current;
    const {vx,vy}=clamp(dragRef.current.vx-dx,dragRef.current.vy-dy,zoomRef.current);
    viewRef.current={x:vx,y:vy}; draw();
  }, [draw]);

  const onMouseUp = useCallback(() => { dragRef.current=null; }, []);

  const onClick = useCallback(e => {
    if (!pickMode && !dustPickMode) return;
    if (dragRef.current) return;
    const rect=canvasRef.current.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(MAP_S/rect.width);
    const my=(e.clientY-rect.top)*(MAP_S/rect.height);
    const {wx,wz}=m2w(mx,my,viewRef.current.x,viewRef.current.y,zoomRef.current);
    const pos={ x:Math.max(-HALF+2,Math.min(HALF-2,wx)), z:Math.max(-HALF+2,Math.min(HALF-2,wz)) };
    if (dustPickMode) {
      onDustPlace?.(pos);
    } else {
      onPick(pos);
    }
  }, [pickMode,dustPickMode,onPick,onDustPlace]);

  return (
    <canvas ref={canvasRef} width={MAP_S} height={MAP_S}
      style={{ width:MAP_S,height:MAP_S,display:'block',
        cursor:(pickMode||dustPickMode)?'crosshair':'grab',
        border:'1px solid rgba(80,130,60,0.4)', borderRadius:3 }}
      onClick={onClick} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
      onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
    />
  );
}
