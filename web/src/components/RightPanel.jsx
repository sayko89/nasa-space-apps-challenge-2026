/**
 * RightPanel — Mission Control
 * • Multi-waypoint management, science EVA (DEM)
 * • Route analysis (Marswalk GO/NO-GO in DEM mode; risk/cost on the Moon)
 * • Mars time (DEM) / sun dial (Moon)
 * • 2D mini-map with zoom/pan/waypoints
 * • Heatmap viewer, helmet / rover camera, telemetry, exports
 */

import { buildShareURL } from '../utils/shareLink';
import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { IS_DEM } from '../three/terrainGenerator';
import { fs, UI_SCALE, SHEET_VH, useNarrow } from '../ui/layout';
import { fmtHM, fmtSignedHM, fmtHourMin } from '../utils/format';
import { localToLatLon } from '../terrain/siteData';
import { ROUTE_COLORS } from '../utils/constants';
import { RADIATION, DOSE_COMPARISON, daysEquivalent, radiationIsLocal } from '../utils/radiation';
import { PovViewer, nearestPanorama } from './PovViewer';
import { ChemistryCard, hasChemistry } from './ChemistryCard';
import CuffCard from './CuffCard';
import ElevationProfile from './ElevationProfile';
import { objectivesFor, findObjective } from '../config/objectives';
import { scienceStopCards } from '../workspace/scienceCards';
import { SUITS, DEFAULT_MISSION, carryCheck, roverDrive, ROVER, sciencePlanKey } from '../config/mission';
import { HAZARD_LAYER, getHazardMap } from '../utils/heatmaps';
import { routeHazards } from '../utils/hazards';
import EvaAssessment, { PayloadSetup, DustSetup } from './EvaAssessment';
import { OxygenSetup } from './OxygenPanel';
import { HAZARD_PARAMS } from '../config/marswalkProfile';
import { DUST_STATES } from '../utils/dustHazardModel';
import { param, EVA_PROFILES, MARS_SUIT_COST_RATIO } from '../config/marswalkProfile';
import { msAtLtst, sunriseSunset, ltst as ltstOf, j2000tt } from '../utils/marsTime';
import { airTemp, diurnalCurve, K_TO_C, climateInstrument, climateHeightM } from '../utils/climate';
import { SITE } from '../three/terrainGenerator';
import { Sect, Label, Row, V, Btn, More } from './ui';
import { hasRelief, RELIEF_SCALES } from '../utils/relief';
import { PW, WP_COLORS_2D } from './panelConstants';
import { useSpaceWeather } from '../hooks/useSpaceWeather';
import { evaAssessments, routeDecision, missionExport, cellIdx } from '../utils/evaAssessments';
import { workflowSteps } from '../utils/workflow';
import { WorkflowStrip, MissionSummary, DecisionBadge, DecisionDetail } from './MissionDecision';
import { MiniMap } from './MiniMap';
import { HeatmapViewer } from './HeatmapViewer';
import { ProcessingMapPreview } from './HelmetCamPreview';
import TerrainSegmentation from './TerrainSegmentation';
import { T, WORKSPACES, WORKSPACE_OF_TARGET, STATUS_COLOR } from '../ui/theme';
import { O2_SCENARIOS } from '../config/oxygen';
import { provenanceFor, CATEGORIES } from '../config/provenance';
import { routeModeExplanation } from '../utils/routeModes';
import { DUST_REROUTE } from '../utils/dustReroute';
import { WORKSPACE_HELP } from '../workspace/WelcomeGuide';

const WS_META = Object.fromEntries(WORKSPACES.map(w => [w.id, w]));

/** Plan Mission: what the selected route mode optimises (the planner's own weights) and its route figures. */
function RouteModeNote({ mode, routes, onInspect }) {
  const ex = routeModeExplanation(mode, param('maxWalkableSlopeDeg'));
  const r = routes?.[mode], s = r?.stats;
  return (
    <div style={{ fontSize: fs(7.5), lineHeight: 1.5, color: T.text, margin: '2px 0 6px' }}>
      <div><b>{mode}</b> — {ex.goal}</div>
      {s && Number.isFinite(s.walkTimeS) && (
        <div style={{ marginTop: 3, fontFamily: T.mono, fontSize: fs(7) }}>
          {(s.distance / 1000).toFixed(2)} km · walk {fmtHM(s.walkTimeS)} · round trip {fmtHM(s.roundTripS)} · margin {fmtSignedHM(s.minMarginS)}
        </div>
      )}
      <More label={`How does ${mode} choose its path?`}>
        <div style={{ color: T.muted }}>The planner searches the 4 m terrain grid (A*). Each step costs:</div>
        <div style={{ fontFamily: T.mono, color: T.text, margin: '3px 0' }}>{ex.formula}</div>
        <div style={{ color: T.muted }}>{ex.effect}</div>
        {onInspect && s && <button type="button" onClick={() => onInspect({ type: 'route', mode })}
          style={{ all: 'unset', cursor: 'pointer', color: T.info, textDecoration: 'underline', marginTop: 4, display: 'inline-block' }}>open segments & constraints</button>}
      </More>
    </div>
  );
}

/** Analyze: the science datasets the site has, what is missing and why, and the full provenance table. */
function ScienceData({ catalog, onInspect, onProvenance }) {
  const science = catalog.filter(c => ['geology', 'mineralogy', 'chemistry', 'thermal', 'atmospheric', 'radiation', 'rover', 'ai'].includes(c.id));
  const missing = provenanceFor(SITE.name, SITE).filter(r => !r.available);
  return (
    <Sect label="Scientific data — available and missing">
      {science.map(c => (
        <div key={c.id} style={{ marginBottom: 4 }}>
          <div style={{ fontSize: fs(6.5), color: T.muted, letterSpacing: 0.8 }}>{c.label.toUpperCase()}</div>
          {c.items.map(it => (
            <button key={it.id} type="button" onClick={() => onInspect?.({ type: 'layer', id: it.id })}
              style={{ all: 'unset', cursor: 'pointer', display: 'block', fontSize: fs(7.5), color: T.text, padding: '1px 0' }}>
              {it.name} <span style={{ color: T.info }}>ⓘ</span>
            </button>
          ))}
        </div>
      ))}
      {missing.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: fs(6.5), color: T.muted, letterSpacing: 0.8 }}>NOT AVAILABLE AT THIS SITE</div>
          {missing.map(r => (
            <div key={r.key} style={{ fontSize: fs(7), color: T.cond, lineHeight: 1.45 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: CATEGORIES[r.category]?.color, marginRight: 5 }} />
              {r.name}: <span style={{ color: T.muted }}>{r.reason}</span>
            </div>
          ))}
        </div>
      )}
      {onProvenance && <Btn onClick={onProvenance} style={{ width: '100%', marginTop: 6 }}>FULL PROVENANCE TABLE</Btn>}
    </Sect>
  );
}


// ---- Sun Dial ----
function SunDial({ angle, onChange }) {
  const S=72,cx=36,cy=36,r=26;
  const rad=angle*Math.PI/180;
  const sx=cx+Math.sin(rad)*r, sy=cy-Math.cos(rad)*r;
  const dragging=useRef(false);
  const getA=(e,rect)=>(( Math.atan2(e.clientX-rect.left-cx,-(e.clientY-rect.top-cy))*180/Math.PI)+360)%360;
  return (
    <svg width={S} height={S} style={{cursor:'crosshair',flexShrink:0}}
      onMouseDown={e=>{dragging.current=true;onChange(Math.round(getA(e,e.currentTarget.getBoundingClientRect())))}}
      onMouseMove={e=>{if(!dragging.current)return;onChange(Math.round(getA(e,e.currentTarget.getBoundingClientRect())))}}
      onMouseUp={()=>{dragging.current=false}} onMouseLeave={()=>{dragging.current=false}}
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(80,120,60,0.5)" strokeWidth={1.2}/>
      {[0,45,90,135,180,225,270,315].map(a=>{
        const ar=a*Math.PI/180;
        return <line key={a}
          x1={cx+Math.sin(ar)*(r-4)} y1={cy-Math.cos(ar)*(r-4)}
          x2={cx+Math.sin(ar)*(r+1)} y2={cy-Math.cos(ar)*(r+1)}
          stroke="rgba(100,160,80,0.5)" strokeWidth={a%90===0?1.4:0.6}/>;
      })}
      {['N','E','S','W'].map((l,i)=>{
        const ar=i*Math.PI/2;
        return <text key={l} x={cx+Math.sin(ar)*(r+7)} y={cy-Math.cos(ar)*(r+7)+2.5}
          textAnchor="middle" fontSize={6} fill="rgba(120,180,100,0.65)" fontFamily="monospace">{l}</text>;
      })}
      <line x1={cx} y1={cy} x2={sx} y2={sy} stroke="#FFD700" strokeWidth={1.5} opacity={0.9}/>
      <circle cx={sx} cy={sy} r={5.5} fill="#FFD700" opacity={0.95}/>
      <circle cx={sx} cy={sy} r={9} fill="none" stroke="#FFD700" strokeWidth={0.5} opacity={0.3}/>
      <circle cx={cx} cy={cy} r={2.5} fill="rgba(120,180,100,0.65)"/>
    </svg>
  );
}

// ---- Mars time (DEM): EVA start drives the Mars24 sun ----
const fmtLtst = fmtHourMin;
const SEASONS_N = ['Northern spring', 'Northern summer', 'Northern autumn', 'Northern winter'];
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

// Diurnal air-temperature curve (site climatology median, p10–p90 band) + EVA start marker
function DiurnalTempChart({ bin, ltstH }) {
  const W = 200, H = 54, padL = 22, padB = 10, padT = 4;
  const n = bin.median.length;
  const vals = [...bin.p10, ...bin.p90].filter(v => v != null).map(K_TO_C);
  if (!vals.length) return null;
  const lo = Math.floor(Math.min(...vals) / 10) * 10, hi = Math.ceil(Math.max(...vals) / 10) * 10;
  const x = (i) => padL + (i / n) * (W - padL);
  const y = (k) => padT + (1 - (K_TO_C(k) - lo) / (hi - lo)) * (H - padT - padB);
  const line = (arr) => arr.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ');
  const band = [];
  for (let i = 0; i < n; i++) if (bin.p90[i] != null) band.push(`${x(i).toFixed(1)},${y(bin.p90[i]).toFixed(1)}`);
  for (let i = n - 1; i >= 0; i--) if (bin.p10[i] != null) band.push(`${x(i).toFixed(1)},${y(bin.p10[i]).toFixed(1)}`);
  const mx = padL + (((ltstH % 24) + 24) % 24) / 24 * (W - padL);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', marginTop: 3 }}>
      <polygon points={band.join(' ')} fill="rgba(255,170,80,0.18)" />
      <polyline points={line(bin.median)} fill="none" stroke="#ffaa55" strokeWidth="1.2" />
      <line x1={mx} x2={mx} y1={padT} y2={H - padB} stroke="#FFD700" strokeWidth="1" strokeDasharray="2,2" />
      {[lo, hi].map(v => <text key={v} x={padL - 2} y={v === hi ? padT + 6 : H - padB} textAnchor="end" fontSize="6.5" fill="#7a8a7a">{v}°</text>)}
      {[0, 6, 12, 18].map(h => <text key={h} x={padL + h / 24 * (W - padL)} y={H - 1} fontSize="6" fill="#5a6a5a">{String(h).padStart(2, '0')}</text>)}
    </svg>
  );
}

function MarsTimePanel({ sun, evaStartMs, setEvaStartMs }) {
  const c = SITE.meta?.center;
  if (!c || !sun || evaStartMs == null) return null;
  const lon = c.lon_deg_east;
  const cur = ltstOf(j2000tt(evaStartMs), lon);
  const ss = sunriseSunset(evaStartMs, c.lat_deg, lon);
  const utcDate = new Date(evaStartMs).toISOString().slice(0, 10);
  const setDate = (iso) => {
    if (!iso) return;
    const noonUtc = Date.parse(`${iso}T12:00:00Z`);
    if (Number.isFinite(noonUtc)) setEvaStartMs(msAtLtst(noonUtc, cur, lon));
  };
  const row = { display: 'flex', justifyContent: 'space-between', fontSize:fs(7.5), color: 'rgba(160,200,160,0.8)', lineHeight: 1.6 };
  const v = { color: '#e8e0c8' };
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <input type="date" value={utcDate} onChange={e => setDate(e.target.value)}
          style={{ flex: 1, background: '#0a140a', color: '#aaffaa', border: '1px solid #234423', fontSize:fs(9), fontFamily: 'monospace', padding: '2px 4px' }} />
        <span style={{ color: '#FFD700', fontSize:fs(13), fontWeight: 'bold' }}>{fmtLtst(cur)}</span>
      </div>
      <input type="range" min={0} max={23.75} step={0.25} value={Math.round(cur * 4) / 4}
        onChange={e => setEvaStartMs(msAtLtst(evaStartMs, Number(e.target.value), lon))} style={{ width: '100%' }} />
      <div style={{ color: '#7a6a50', fontSize:fs(7), margin: '1px 0 4px' }}>EVA START — LOCAL TRUE SOLAR TIME (LTST)</div>
      <div style={row}><span>Sol (MSD)</span><span style={v}>{Math.floor(sun.msd)}</span></div>
      <div style={row}><span>Season</span><span style={v}>Ls {sun.ls.toFixed(1)}° · {SEASONS_N[Math.floor(sun.ls / 90) % 4]}</span></div>
      <div style={row}><span>Sun</span><span style={{ color: sun.elevationDeg > 0 ? '#FFD700' : '#8899cc' }}>
        {sun.elevationDeg > 0 ? `${sun.elevationDeg.toFixed(1)}° high` : `${(-sun.elevationDeg).toFixed(1)}° below horizon`}
        {' · '}{COMPASS[Math.round(sun.azimuthDeg / 22.5) % 16]} {sun.azimuthDeg.toFixed(0)}°</span></div>
      {ss && <div style={row}><span>Sunrise / sunset</span><span style={v}>{fmtLtst(ss.riseLtst)} / {fmtLtst(ss.setLtst)} LTST</span></div>}
      <div style={row}><span>UTC</span><span style={v}>{new Date(evaStartMs).toISOString().slice(0, 16).replace('T', ' ')}</span></div>
      {(() => {
        const a = airTemp(SITE.climate, sun.ls, cur);
        const bin = diurnalCurve(SITE.climate, sun.ls);
        if (!a || !bin) return SITE.climate ? null : (
          <div style={{ color: '#4a6a4a', fontSize:fs(6.5), marginTop: 2 }}>Air temperature: no climatology for this site yet (sun and shadow only)</div>
        );
        return (
          <>
            <div style={row}><span>Air ({climateHeightM(SITE.climate)} m)</span><span style={{ color: '#ffcc88' }}>
              {K_TO_C(a.median).toFixed(0)} °C <span style={{ color: '#7a8a7a' }}>({K_TO_C(a.p10).toFixed(0)}…{K_TO_C(a.p90).toFixed(0)})</span></span></div>
            <DiurnalTempChart bin={bin} ltstH={cur} />
            <div style={{ color: '#4a6a4a', fontSize:fs(6.5) }}>{climateInstrument(SITE.climate)}, Ls {bin.ls0}–{bin.ls1}°, {bin.nSols} sols · median, 10–90 %</div>
          </>
        );
      })()}
      <div style={{ color: '#4a6a4a', fontSize:fs(6.5), marginTop: 2 }}>Mars24 (NASA GISS) · Allison &amp; McEwen 2000</div>
      <SpaceWeatherRow startMs={evaStartMs} />
    </div>
  );
}

// ---- Mission setup: suit, equipment load, rover safe haven ----
const missionRow = { display: 'flex', alignItems: 'center', gap: 5, fontSize: fs(7.5), color: '#9ab89a', marginBottom: 4 };
/** Suit, equipment and the carry-weight check (Mission setup → Astronaut & spacesuit). */
function SuitPart({ mission, setMission }) {
  const c = carryCheck(mission);
  const set = (k, v) => setMission({ ...mission, [k]: v });
  return (
    <>
      <div style={missionRow}>
        <span style={{ width: 54 }}>Suit</span>
        {Object.entries(SUITS).map(([k, s]) => (
          <Btn key={k} active={mission.suit === k} color="#88ccff" onClick={() => set('suit', k)}
            style={{ flex: 1, padding: '2px 4px' }}>{s.label} · {s.massKg} kg</Btn>
        ))}
      </div>
      <div style={missionRow}>
        <span style={{ width: 54 }}>Equipment</span>
        <input type="range" min={0} max={40} step={1} value={mission.equipmentKg} disabled={!!mission.payload}
          title={mission.payload ? 'Sum of the itemised payload' : ''}
          onChange={e => set('equipmentKg', Number(e.target.value))} style={{ flex: 1 }} />
        <b style={{ color: '#e8e0c8', width: 40, textAlign: 'right' }}>{mission.equipmentKg} kg</b>
      </div>
      <div style={{ fontSize: fs(7), color: c.ok ? '#88dd99' : '#ff6655', lineHeight: 1.5 }}>
        Carried weight on Mars: {c.earthEqKg.toFixed(1)} kg Earth-equivalent / {c.limitKg} kg limit
        {c.ok ? ` · up to ${c.maxEquipmentKg.toFixed(0)} kg of equipment` : ' · NO-GO: too heavy to walk with'}
      </div>
      <div style={{ fontSize: fs(6.5), color: '#6a7a6a', marginTop: 2 }}>Suit masses, carry limit, walkback: Ogilvie et al., ICES 2026 (NASA)</div>
    </>
  );
}
/** EVA limit set, pressurised rover and obstacle buffer (Mission setup → EVA limits). */
function LimitsPart({ mission, setMission, start }) {
  const set = (k, v) => setMission({ ...mission, [k]: v });
  const drive = mission.rover && start ? roverDrive(start.x, start.z) : null;
  return (
    <>
      <div style={missionRow}>
        <span style={{ width: 54 }}>EVA limits</span>
        {Object.entries(EVA_PROFILES).map(([k, pr]) => (
          <Btn key={k} active={(mission.limits || 'lunar') === k} color={k === 'mars' ? '#99dd99' : '#88ccff'} onClick={() => set('limits', k)}
            title={pr.desc} style={{ flex: 1, padding: '2px 4px' }}>{pr.label}</Btn>
        ))}
      </div>
      <More label="What do these limits mean?">
      <div style={{ fontSize: fs(7), color: '#9aaa9a', lineHeight: 1.45 }}>
        {(mission.limits || 'lunar') === 'mars'
          ? <>Walk {param('levelWalkSpeedKmh')} km/h (suited cost on Mars ×{MARS_SUIT_COST_RATIO.value.toFixed(2)}, Norcross 2009) · budget {param('evaDurationH')} h (Apollo 17 30-min reserve) · ≤{param('maxRadialDistanceKm')} km. Re-plan the science EVA to fit.</>
          : <>NASA lunar EVA values (2 km/h, 8 h, 2 km) — optimistic for Mars gravity.</>}
      </div>
      </More>
      <div style={{ ...missionRow, marginTop: 5 }}>
        <Btn active={mission.rover} color="#ffbb66" onClick={() => set('rover', !mission.rover)} style={{ flex: 1 }}>
          {mission.rover ? '✓ PRESSURIZED ROVER PARKED AT START' : 'PRESSURIZED ROVER AS SAFE HAVEN'}
        </Btn>
      </div>
      {mission.rover && (
        <More label="How the rover safe haven works">
        <div style={{ fontSize: fs(7), color: '#b8c8b0', lineHeight: 1.5 }}>
          The rover drives the crew to the start point and waits there; the crew must stay within a
          {' '}<b>{ROVER.walkbackMin.value}-minute walk</b> of it.
          {drive && <> Drive from the habitat: {drive.km.toFixed(2)} km, ~{Math.round(drive.minutes)} min (straight line, {ROVER.driveSpeedKmh.value} km/h).</>}
        </div>
        </More>
      )}
      <div style={{ ...missionRow, marginTop: 5 }}>
        <Btn active={!!mission.obstacleBuffer} color="#ff9ab0" onClick={() => set('obstacleBuffer', !mission.obstacleBuffer)} style={{ flex: 1 }}
          title="Inflate every slope / rock obstacle by one 4 m cell before routing">
          {mission.obstacleBuffer ? `✓ KEEP ${HAZARD_PARAMS.obstacleBufferM.value} M FROM OBSTACLES` : `KEEP ${HAZARD_PARAMS.obstacleBufferM.value} M FROM OBSTACLES`}
        </Btn>
      </div>
      {mission.obstacleBuffer && (
        <More label="What the obstacle buffer changes">
        <div style={{ fontSize: fs(7), color: '#b8c8b0', lineHeight: 1.5 }}>
          Routes stay at least {HAZARD_PARAMS.obstacleBufferM.value} m from every slope / rock obstacle (assumption: {HAZARD_PARAMS.obstacleBufferM.note}). Longer routes, fewer stops in reach.
        </div>
        </More>
      )}
    </>
  );
}

// ---- Dose rate in four places (log scale): why Mars radiation differs ----
function DoseComparison() {
  const lo = Math.log10(0.003), hi = Math.log10(2);
  const w = (v) => `${Math.max(2, ((Math.log10(v) - lo) / (hi - lo)) * 100)}%`;
  const fmt = (v) => (v < 0.1 ? v.toFixed(4) : v.toFixed(2));
  return (
    <div style={{ margin: '2px 0 3px' }} title="Daily dose equivalent, log scale. Hover a row for why it differs and the source.">
      {DOSE_COMPARISON.map(d => {
        const mars = d.key === 'mars';
        return (
          <div key={d.key} title={`${d.why}\n${d.source}`} style={{ display: 'grid', gridTemplateColumns: '34px 1fr 44px', gap: 4, alignItems: 'center',
            fontSize: fs(6.8), color: mars ? '#ffcc88' : 'rgba(160,200,160,0.75)', lineHeight: 1.5 }}>
            <span>{d.label}</span>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
              <div style={{ width: w(d.mSvPerDay), height: '100%', borderRadius: 2,
                background: mars ? '#ff9f5a' : d.key === 'moon' ? '#b9b9c9' : d.key === 'iss' ? '#7fb2e5' : '#6fbf73' }} />
            </div>
            <span style={{ textAlign: 'right' }}>{fmt(d.mSvPerDay)}</span>
          </div>
        );
      })}
      <div style={{ color: '#4a6a4a', fontSize: fs(6.3), lineHeight: 1.35 }}>
        mSv/day, log scale · Mars: no global magnetic field and a thin atmosphere ≈ {Math.round(daysEquivalent(DOSE_COMPARISON[3].mSvPerDay).earth)} days of Earth background per sol.
        Moon measured at solar minimum (2019), Mars near maximum (2012–13). UNSCEAR · Zhang et al. 2020 · Hassler et al. 2014
      </div>
    </div>
  );
}


function SpaceWeatherRow({ startMs }) {
  const { wx, live } = useSpaceWeather(startMs);
  const row = { display: 'flex', justifyContent: 'space-between', fontSize: fs(7.5), color: 'rgba(160,200,160,0.8)', lineHeight: 1.6 };
  const tag = wx.advisory === 'postpone' ? { t: '⚠ SEP — POSTPONE EVA', c: '#ff6655' }
    : wx.advisory === 'clear' ? { t: 'NO SEP ±' + RADIATION.sepWindowDays.value + ' d', c: '#88dd99' }
    : { t: startMs > Date.now() ? 'future date — no forecast' : 'no DONKI data for this date', c: '#8899aa' };
  return (
    <div style={{ marginTop: 4, borderTop: '1px solid rgba(60,90,60,0.3)', paddingTop: 3 }}>
      <div style={row}><span>Radiation (GCR)</span><span style={{ color: '#e8e0c8' }}>{RADIATION.gcrDoseEquivalentMSvPerDay.value} mSv/day</span></div>
      <div style={{ fontSize: fs(6.5), color: radiationIsLocal() ? '#7a9a7a' : '#e0a050', lineHeight: 1.4 }}>
        Measured: Curiosity RAD in Gale crater, Aug 2012 – Jun 2013 (near solar maximum).
        {radiationIsLocal() ? ' This crater.' : ' Used here as a reference — NOT measured at Jezero (≈ 3,750 km away, ~1.8 km higher: likely a little more dose).'}
        {' '}Cosmic rays only; a solar particle event adds to it and is not modelled.
      </div>
      <DoseComparison />
      <div style={row}><span>Space weather</span><span style={{ color: tag.c, fontWeight: 'bold' }}>{tag.t}</span></div>
      <div style={{ fontSize: fs(6.5), color: '#7a8a9a', lineHeight: 1.4 }}>
        DONKI lists events that happened (solar particle events seen near Earth / Mars, CME arrivals at Mars from model runs) —
        {' '}{wx.coverage ? `archive ${wx.coverage[0]} – ${wx.coverage[1]}` : 'looked up live for past dates'}. It is not a forecast:
        {' '}a future EVA date has no data, which is shown as unknown, never as clear.
      </div>
      {wx.near.slice(0, 3).map((e, i) => (
        <div key={i} style={{ fontSize: fs(6.5), color: e.type === 'SEP' ? '#ff8877' : '#9aa8b8' }}>
          {e.type} · {e.time.slice(0, 16).replace('T', ' ')} UTC{e.class ? ` · ${e.class}` : ''}{e.speedKmS ? ` · ${Math.round(e.speedKmS)} km/s` : ''}{e.type === 'CME' ? ' · arrival at Mars (model)' : ''}
        </div>
      ))}
      <div style={{ color: '#4a6a4a', fontSize: fs(6.5) }}>Curiosity RAD, Hassler et al. 2014 · NASA CCMC DONKI{live ? ' (live)' : ''}</div>
    </div>
  );
}

// ---- Mission workflow (13 steps) and summary ----



// ---- Route Analysis ----
const ROUTE_DESC = {
  SAFE: s => `Low-risk path. Avoids craters + shadows. Avg hazard=${(s.avgHazard||0).toFixed(3)}, slip=${(s.avgSlip||0).toFixed(3)}, slope=${(s.avgSlopeAngle||0).toFixed(1)}°.`,
  ECO:  s => `Energy-efficient. Prefers sunlit + flat terrain. Illum=${(s.avgIllumination||0).toFixed(3)}, traversability=${(s.avgTraversability||0).toFixed(3)}.`,
  FAST: s => `Speed-optimized. Shortest distance=${(s.distance||0).toFixed(1)}m, total cost=${(s.totalCost||0).toFixed(1)}.`,
  AUTO: s => `Balanced route. Hazard=${(s.avgHazard||0).toFixed(3)}, illum=${(s.avgIllumination||0).toFixed(3)}, dist=${(s.distance||0).toFixed(1)}m.`,
};



function MarswalkStats({ mode, s, decision }) {
  const fail = (ok) => ok ? '#88dd99' : '#ff6655';
  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
        <span style={{color:'rgba(160,200,160,0.8)',fontSize:fs(7.5)}}>
          Walk <b style={{color:'#e8e0c8'}}>{fmtHM(s.walkTimeS)}</b>
          {s.returnTimeS > 1 && <>{'  '}+ fastest return <b style={{color:fail(s.checks.budget)}}>{fmtHM(s.returnTimeS)}</b></>}
        </span>
        {decision ? <DecisionBadge d={decision} /> : <span style={{
          fontSize:fs(7.5), fontWeight:'bold', padding:'1px 5px', borderRadius:3,
          color: s.go ? '#0a1a0a' : '#fff', background: s.go ? '#44dd66' : '#cc3322',
        }}>{s.go ? 'GO' : 'NO-GO'}</span>}
      </div>
      <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7),lineHeight:1.55}}>
        Total <span style={{color:fail(s.checks.budget)}}>{fmtHM(s.roundTripS)}</span> = {(s.budgetFrac*100).toFixed(0)}% of the {param('evaDurationH')} h budget
        {s.stopCount > 0 && <> · incl. {fmtHM(s.dwellTotalS)} sampling at {s.stopCount} stops</>}
        <br/>
        Walk-back margin (min): <span style={{color:fail(s.checks.budget)}}>{Number.isFinite(s.minMarginS) ? fmtSignedHM(s.minMarginS) : 'no path home'}</span>
        {s.ponrIdx >= 0 && <span style={{color:'#ff6655'}}> · ⛔ point of no return at {Math.round(s.ponrIdx / Math.max(1, s.marginS.length - 1) * 100)}% of the route</span>}
      </div>
      <More label="Route details — slope, daylight, weight, radiation, ground"
        badge={[s.checks.slope, s.checks.radial, s.checks.carry, s.checks.daylight].every(v => v !== false) ? 'within limits' : 'limit exceeded'}
        badgeColor={[s.checks.slope, s.checks.radial, s.checks.carry, s.checks.daylight].every(v => v !== false) ? null : '#e5534b'}>
      <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7),lineHeight:1.55}}>
        Max slope: <span style={{color:fail(s.checks.slope)}}>{s.maxSlopeDeg.toFixed(1)}°</span> / {param('maxWalkableSlopeDeg')}°
        <br/>
        Steep ground (&gt;{s.steepDeg.toFixed(0)}°): <span style={{color:'#e8c890'}}>{(s.steepFrac*100).toFixed(0)}%</span>
        {' · '}Climb {s.climbM.toFixed(0)} m · Descent {s.descentM.toFixed(0)} m
        {' · '}Max distance from start <span style={{color:fail(s.checks.radial)}}>{(s.maxRadialM/1000).toFixed(2)}</span> / {param('maxRadialDistanceKm')} km
      </div>
      {s.light && (
        <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7),lineHeight:1.55,marginTop:1}}>
          Light (walking): in terrain shadow <span style={{color:'#e8c890'}}>{(s.light.shadowFrac*100).toFixed(0)}%</span>
          {s.light.darkFrac > 0 && <> · <span style={{color:'#8899cc'}}>in darkness {(s.light.darkFrac*100).toFixed(0)}%</span></>}
          {' · '}{s.light.homeBySunset === null ? 'no sunrise/sunset'
            : s.light.homeBySunset ? <span style={{color:'#88dd99'}}>home before sunset</span>
            : <span style={{color:fail(false)}}>✕ not completed in daylight — NO-GO (rule: start after sunrise, home before sunset)</span>}
          {s.light.air && <><br/>Air ({climateHeightM(SITE.climate)} m, during the EVA): <span style={{color:'#ffcc88'}}>
            {K_TO_C(s.light.air.minMedian).toFixed(0)}…{K_TO_C(s.light.air.maxMedian).toFixed(0)} °C</span>
            {s.light.air.minP10 != null && <span style={{color:'#7a8a7a'}}> (extremes {K_TO_C(s.light.air.minP10).toFixed(0)}…{K_TO_C(s.light.air.maxP90).toFixed(0)})</span>}</>}
        </div>
      )}
      {(s.carry || s.rover) && (
        <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7),lineHeight:1.55,marginTop:1}}>
          {s.carry && <>Carried weight: <span style={{color:fail(s.checks.carry)}}>{s.carry.earthEqKg.toFixed(1)} kg</span> / {s.carry.limitKg} kg Earth-eq. ({s.carry.suit.label})</>}
          {s.rover && <><br/>Farthest from the rover: <span style={{color:fail(s.checks.rover)}}>{fmtHM(s.rover.maxReturnS)}</span> walk / {Math.round(s.rover.limitS / 60)} min limit</>}
        </div>
      )}
      {(s.radiation || s.layers) && (
        <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7),lineHeight:1.55,marginTop:1}}>
          {s.radiation && <>Radiation (GCR, Curiosity RAD): <span style={{color:'#e8c890'}}>{s.radiation.doseMSv.toFixed(2)} mSv</span>
            <span style={{color:'#7a8a7a'}}> = {(s.radiation.careerFrac * 100).toFixed(3)}% of the 600 mSv career limit
              {' '}≈ {Math.round(daysEquivalent(s.radiation.doseMSv).earth)} days of Earth background</span></>}
          {s.layers?.thermal && <><br/>Ground (THEMIS TI): <span style={{color:'#e8c890'}}>{Math.round(s.layers.thermal.median)}</span>
            <span style={{color:'#7a8a7a'}}> · {s.layers.thermal.cls}</span></>}
          {s.layers?.rock && <><br/>Largest rock relief on route: <span style={{color: s.layers.rock.maxReliefM > s.layers.rock.limitM ? '#ff6655' : '#e8c890'}}>
            {s.layers.rock.maxReliefM.toFixed(2)} m</span><span style={{color:'#7a8a7a'}}> / {s.layers.rock.limitM} m limit</span></>}
          {s.layers?.minerals?.length > 0 && <><br/>Minerals crossed (CRISM): <span style={{color:'#88ddcc'}}>
            {s.layers.minerals.slice(0, 3).map(m => `${m.name} ${(m.share * 100).toFixed(0)}%`).join(' · ')}</span></>}
        </div>
      )}
      </More>
    </>
  );
}

// ---- Mission objective (config/objectives.js): chosen before the science EVA is planned ----
const OBJ_LINE = { fontSize:fs(7), lineHeight:1.5, color:'#a8b8a0', margin:'2px 0' };
function ObjectivePicker({ objectiveId, setObjectiveId, science }) {
  const list = objectivesFor(SITE.name);
  const sel = findObjective(SITE.name, objectiveId);
  const stale = science && science.objectiveId !== objectiveId;
  return (
    <div style={{marginBottom:6}}>
      <div style={{fontSize:fs(7.5),color:'#ffcf8a',letterSpacing:'0.08em',marginBottom:3}}>① MISSION OBJECTIVE</div>
      <div role="radiogroup" aria-label="Mission objective" style={{display:'flex',flexDirection:'column',gap:2}}>
        {list.map(o => (
          <button key={o.id} type="button" role="radio" aria-checked={o.id === objectiveId}
            onClick={() => setObjectiveId(o.id)}
            style={{textAlign:'left',cursor:'pointer',fontFamily:'monospace',fontSize:fs(7.5),padding:'3px 6px',borderRadius:3,
              border:`1px solid ${o.id === objectiveId ? '#ffb347' : 'rgba(120,100,60,0.4)'}`,
              background: o.id === objectiveId ? 'rgba(90,55,0,0.55)' : 'rgba(20,16,8,0.5)',
              color: o.id === objectiveId ? '#ffd9a0' : '#c8b898'}}>
            {o.id === objectiveId ? '● ' : '○ '}{o.name}
            {o.availability === 'partial' && <span style={{color:'#e0a050'}}> · partial</span>}
          </button>
        ))}
      </div>
      {!sel && <div style={{...OBJ_LINE,color:'#e0a050'}}>Choose an objective: it decides which candidate stops exist and what each is worth.</div>}
      {sel && (
        <div style={{marginTop:4,padding:'4px 6px',border:'1px solid rgba(160,120,60,0.35)',borderRadius:3,background:'rgba(30,20,6,0.45)'}}>
          <div style={OBJ_LINE}><b style={{color:'#e8d8b8'}}>Purpose.</b> {sel.purpose}</div>
          <div style={OBJ_LINE}><b style={{color:'#e8d8b8'}}>Why it matters.</b> {sel.relevance}</div>
          <div style={OBJ_LINE}><b style={{color:'#e8d8b8'}}>Candidates.</b> {sel.candidates}</div>
          <div style={OBJ_LINE}><b style={{color:'#e8d8b8'}}>Selection.</b> {sel.criteria}
            <span style={{color:'#7a8a7a'}}> Weights (design choice): {Object.entries(sel.plan.weights).flatMap(([k, w]) => (typeof w === 'object' ? Object.entries(w) : [[k, w]])).filter(([, w]) => w > 0).map(([k, w]) => `${k} ${w}`).join(', ')}.</span></div>
          <div style={OBJ_LINE}><b style={{color:'#e8d8b8'}}>Data layers.</b> {sel.layers.join(' · ')}</div>
          <div style={{...OBJ_LINE,color:'#d8a868'}}><b>Uncertainty.</b> {sel.uncertainty}</div>
          {sel.availabilityNote && <div style={{...OBJ_LINE,color:'#e0a050'}}>⚠ {sel.availabilityNote}</div>}
          <div style={{...OBJ_LINE,color:'#7a8a7a'}}>Sources: {sel.sources.map((x, i) => (
            <span key={i}>{i ? '; ' : ''}<a href={x.url} target="_blank" rel="noopener noreferrer" style={{color:'#9fc7ff'}}>{x.label}</a></span>))}</div>
        </div>
      )}
      {stale && <div style={{...OBJ_LINE,color:'#e0a050'}}>The current plan was made for another objective — re-planning the stops for this one.</div>}
    </div>
  );
}

// ---- Science stop card (utils/stopCards.js) ----
const RISK_COL = { low: '#6c6', moderate: '#e8c050', high: '#ff6655', unknown: '#aaa' };
function StopCard({ card, onGroundView, onChemistry, onInspect }) {
  const [open, setOpen] = useState(false);
  return (
    <li style={{marginBottom:3}}>
      <div onClick={() => setOpen(v => !v)} style={{cursor:'pointer'}} title="Show why this stop was chosen">
        <b style={{color:'#ffb347'}}>S{card.n}</b> {card.name}
        <span style={{color:RISK_COL[card.risk.level],marginLeft:4}}>● {card.risk.level}</span>
        <span style={{color:'#7a8a7a'}}> · {card.confidence.level} · {card.visitMin} min {open ? '▾' : '▸'}</span>
      </div>
      {onGroundView && <span onClick={onGroundView} style={{marginRight:6,color:'#ffcc88',cursor:'pointer',textDecoration:'underline'}}>ground view</span>}
      {onChemistry && <span onClick={onChemistry} style={{color:'#88ccff',cursor:'pointer',textDecoration:'underline',marginRight:6}}>chemistry</span>}
      {onInspect && <span onClick={onInspect} style={{color:T.info,cursor:'pointer',textDecoration:'underline'}}>inspect</span>}
      {open && (
        <div style={{margin:'3px 0 4px',padding:'3px 5px',borderLeft:'2px solid #ffb347',background:'rgba(30,20,6,0.4)',color:'#c8c0a8',fontSize:fs(7),lineHeight:1.5}}>
          <div><b>Position:</b> {card.lat != null ? `${card.lat.toFixed(5)}°N ${card.lon.toFixed(5)}°E · ` : ''}x {card.x.toFixed(0)} m, z {card.z.toFixed(0)} m from the site centre</div>
          <div><b>Objective:</b> {card.objective}</div>
          <div><b>Why chosen:</b> {card.why}</div>
          <div><b>Investigate:</b> {card.investigate}</div>
          <div><b>Evidence:</b> {card.evidence.join(' · ') || '—'}</div>
          <div><b>Data layers:</b> {card.layers.join(' · ')}</div>
          <div><b>Terrain risk:</b> <span style={{color:RISK_COL[card.risk.level]}}>{card.risk.level}</span> — {card.risk.reason}</div>
          <div><b>Data confidence:</b> {card.confidence.level} — {card.confidence.reason}</div>
          {card.uncertainty && <div style={{color:'#d8a868'}}><b>Uncertainty:</b> {card.uncertainty}</div>}
        </div>
      )}
    </li>
  );
}

// ---- Stage 6: science EVA (geology stops) ----
function SciencePanel({ science, onPlan, busy, dwellMin, setDwellMin, disabled, objectiveId, setObjectiveId, mission, onInspect = null }) {
  const [pov, setPov] = useState(null);
  const [chemStop, setChemStop] = useState(null);
  const objective = findObjective(SITE.name, science?.objectiveId || objectiveId);
  const cards = useMemo(() => scienceStopCards(science), [science]);
  return (
    <>
      {setObjectiveId && <ObjectivePicker objectiveId={objectiveId} setObjectiveId={setObjectiveId} science={science} />}
      <div style={{display:'flex',alignItems:'center',gap:5,fontSize:fs(7.5),color:'#9ab89a',marginBottom:4}}>
        <span>Time per stop</span>
        <input type="range" min={5} max={60} step={5} value={dwellMin}
          onChange={e=>setDwellMin(Number(e.target.value))} style={{flex:1}}/>
        <b style={{color:'#e8e0c8',width:44,textAlign:'right'}}>{dwellMin} min</b>
      </div>
      <div style={{fontSize:fs(6.5),color:'#7a6a4a',marginBottom:4}}>
        Assumption: no sourced time per stop was found. Stop selection: Held–Karp over the objective's candidates,
        most distinct weighted features within the EVA budget — weights are a design choice.
      </div>
      {pov && <PovViewer stop={pov.stop} label={pov.label} onClose={() => setPov(null)} />}
      {chemStop && <ChemistryCard stop={chemStop.stop} label={chemStop.label} onClose={() => setChemStop(null)} />}
      <Btn disabled={busy || disabled || !objectiveId} onClick={onPlan}
        title={objectiveId ? '' : 'Choose a mission objective first'}
        style={{width:'100%',background:'rgba(70,40,0,0.55)',borderColor:'rgba(230,150,60,0.6)',color:'#ffbb66',fontWeight:'bold'}}>
        {busy ? 'SEARCHING…' : objectiveId ? 'PLAN SCIENCE EVA' : 'PLAN SCIENCE EVA — CHOOSE AN OBJECTIVE'}
      </Btn>
      {science && (
        <div style={{marginTop:5,fontSize:fs(7.5),lineHeight:1.5,color:'#b8c8b0'}}>
          <div>
            {objective && <><b style={{color:'#ffd9a0'}}>{objective.name}</b><br/></>}
            {science.stops.length} stops / {science.candidates.length} candidates ·
            {' '}score <b style={{color:'#ffcc66'}}>{science.score}</b>/{science.maxScore}
            {' '}· plan {fmtHM(science.totalS)}
          </div>
          {mission && science.planKey && science.planKey !== sciencePlanKey(mission, dwellMin) && (
            <div style={{color:'#e0a050'}}>⚠ These stops were chosen under other EVA limits / obstacle buffer / rover / stop time.
              The route and the decision below are current; plan the science EVA again to re-choose the stops.</div>
          )}
          <ol style={{margin:'3px 0 0',paddingLeft:14,color:'#e0d0b0',listStyle:'none'}}>
            {cards.map((card, i) => {
              const st = science.stops[i];
              return (
                <StopCard key={i} card={card}
                  onGroundView={nearestPanorama(st.x, st.z) ? () => setPov({ stop: st, label: `S${i + 1} ${st.label}` }) : null}
                  onChemistry={hasChemistry(st.x, st.z) ? () => setChemStop({ stop: st, label: `S${i + 1} ${st.label}` }) : null}
                  onInspect={onInspect ? () => onInspect({ type: 'stop', n: i + 1 }) : null} />
              );
            })}
          </ol>
          {science.candidates.length > science.stops.length && (
            <div style={{color:'#7a8a7a',marginTop:2}}>
              Not chosen: {science.candidates.filter(c => !science.stops.some(st => st.idx === c.idx)).map(c => c.label).join('; ')}
            </div>
          )}
        </div>
      )}
    </>
  );
}



function RouteAnalysis({ routes, activeRoute, onSelect, onCuffCard, startMs, mission, openDecision = false }) {
  const wxState = useSpaceWeather(startMs);
  if (!routes) return (
    <div style={{fontSize:fs(8),color:'#3a5a3a',textAlign:'center',padding:'8px 0'}}>
      Plan a path to see route analysis.
    </div>
  );
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {Object.entries(ROUTE_COLORS)
        .filter(([mode]) => mode !== 'HOME_RETURN')
        .map(([mode,color]) => {
        const r=routes[mode];
        const s=r?.stats;
        const active=mode===activeRoute;
        return (
          <div key={mode} onClick={()=>onSelect(mode)} style={{
            border:`1px solid ${active?color:'rgba(40,70,40,0.35)'}`,
            borderRadius:4, padding:'5px 7px', cursor:'pointer',
            background:active?'rgba(0,0,0,0.5)':'rgba(5,12,5,0.4)',
            boxShadow:active?`0 0 8px ${color}33`:'none',
            transition:'all 0.12s',
          }}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <div style={{width:7,height:7,borderRadius:'50%',background:color,boxShadow:`0 0 4px ${color}`}}/>
                <span style={{color,fontSize:fs(9),fontWeight:'bold',letterSpacing:0.5}}>{mode}</span>
              </div>
              {s && <span style={{color:'rgba(150,200,150,0.7)',fontSize:fs(8)}}>{s.distance.toFixed(1)}m</span>}
            </div>
            {s && s.walkTimeS !== undefined && <MarswalkStats mode={mode} s={s} decision={IS_DEM ? routeDecision(r, wxState, { mission, startMs }) : null} />}
            {IS_DEM && s && s.walkTimeS !== undefined && active && (() => {
              const d = routeDecision(r, wxState, { mission, startMs });
              return (
                <More label={`Why ${d.status}? — every rule and condition`} badge={d.status} badgeColor={STATUS_COLOR[d.status]} defaultOpen={openDecision}>
                  <DecisionDetail d={d} />
                </More>
              );
            })()}
            {IS_DEM && s && s.walkTimeS !== undefined && active && mission && (() => {
              const a = evaAssessments(r, wxState, { mission, startMs });
              const st = [a?.payload?.status, a?.dust?.status, a?.mobility?.status].filter(Boolean);
              return (
                <div onClick={e => e.stopPropagation()}>
                  <More label="Assessments A · B · C (payload, dust, terrain)" badge={st.length ? `${st.length} results` : null}>
                    <EvaAssessment a={a} />
                  </More>
                </div>
              );
            })()}
            {s && s.walkTimeS !== undefined && active && r.path?.length > 1 && (
              <More label="Elevation profile along the route">
                <div title="Elevation along the route (MOLA metres), stops numbered — as Mars Trek plots for a measured path">
                  <ElevationProfile path={r.path} stats={s} originM={SITE.heightOrigin || 0} color={color} />
                </div>
              </More>
            )}
            {s && s.walkTimeS !== undefined && active && s.stopCount > 0 && onCuffCard && (
              <button onClick={(e) => { e.stopPropagation(); onCuffCard(mode); }} title="One printable page: route map + station times, Apollo cuff-checklist style"
                style={{ marginTop:5, width:'100%', background:'rgba(244,162,97,0.12)', color:'#f4c49a', border:'1px solid rgba(244,162,97,0.55)',
                  borderRadius:3, padding:'3px 0', fontFamily:'monospace', fontSize:fs(7.5), letterSpacing:'0.1em', cursor:'pointer' }}>
                ▤ PRINT CUFF CARD
              </button>
            )}
            {s && s.walkTimeS === undefined && (
              <>
                <div style={{color:'rgba(160,200,160,0.7)',fontSize:fs(7.5),marginBottom:2}}>
                  Risk: <span style={{color:'#ffcc44'}}>{s.riskPercent.toFixed(1)}%</span>
                  {'  '}Cost: <span style={{color:'#88ccff'}}>{s.totalCost.toFixed(1)}</span>
                </div>
                <div style={{color:'rgba(100,150,100,0.75)',fontSize:fs(7),lineHeight:1.5}}>
                  {ROUTE_DESC[mode]?.(s)}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Export helpers ----
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportPNG() {
  // The Three.js canvas is the first <canvas> in the 3D scene div
  const canvas = document.querySelector('canvas');
  if (!canvas) return false;
  canvas.toBlob(blob => {
    if (blob) downloadBlob(blob, `${IS_DEM ? 'martian_map' : 'moon_rover'}_${Date.now()}.png`);
  }, 'image/png');
  return true;
}

function exportJSON(waypoints, routes, activeRoute, sunAngleDeg, extra = {}) {
  const payload = {
    version: 2,
    ...extra,
    app: IS_DEM ? 'Martian Map' : 'Moon Rover',
    site: IS_DEM ? { name: SITE.name, center: SITE.meta?.center } : null,
    timestamp: new Date().toISOString(),
    sunAngleDeg,
    activeRoute,
    waypoints: waypoints.map(w => ({ x: +w.x.toFixed(2), z: +w.z.toFixed(2),
      ...(w.dwellS ? { dwellS: w.dwellS, label: w.label } : {}) })),
    routes: routes
      ? Object.fromEntries(Object.entries(routes).map(([mode, r]) => [mode, {
          stats: r.stats,
          path:  r.path.map(([x, y, z]) => [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]),
        }]))
      : null,
  };
  // typed arrays (elapsedS, marginS) → plain arrays
  const json = JSON.stringify(payload, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v, x => +x.toFixed(2)) : v), 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${IS_DEM ? 'martian_map_route' : 'moon_rover_route'}_${Date.now()}.json`);
}


export default function RightPanel({
  roverState, pathRef,
  routes, activeRoute, setActiveRoute,
  waypoints, onAddWaypoint, onSetStartWaypoint, onRemoveLastWaypoint, onClearWaypoints,
  onPlanPath,
  isPlanning = false,
  hasGeology = false, science = null, onPlanScience = () => {}, isPlanningScience = false,
  scienceDwellMin = 20, setScienceDwellMin = () => {},
  objectiveId = null, setObjectiveId = null,
  mission = DEFAULT_MISSION, setMission = () => {},
  sunAngleDeg, setSunAngleDeg,
  sun = null, evaStartMs = null, setEvaStartMs = () => {},
  cameraMode, setCameraMode,
  wireframe, setWireframe,
  orthoOn, setOrthoOn,
  reliefScale = 1, setReliefScale,
  showTrack = false, setShowTrack = null,
  onStartRover, onStopRover, isRoving,
  evaStatus = 'idle', onAbortEva = () => {}, onPauseEva = null,
  drapeLayer = null, setDrapeLayer = null, drapeOpacity = 0.6, setDrapeOpacity = () => {},
  slopeMap, craterMask, hMap,
  learningModel, routeLog, showToast,
  dustMode, dustHazard, cameraSignalLost, cameraSignalQuality, onTriggerDustHazard, onDustPlaced, onClearDustHazard,
  workspace = null, setWorkspace = null, topOffset = 0, inspector = null, hasSelection = false, timeline = null,
  onInspect = null, onProvenance = null, catalog = [],
}) {
  // Mars workspaces: each section belongs to one or more workspaces; the Moon (workspace null) shows them all
  const ws = workspace;
  const show = (...ids) => !ws || ids.includes(ws);
  const narrow = useNarrow();   // phone: bottom sheet under the 3D view
  const [pickMode, setPickMode] = useState(false);
  const [cuffMode, setCuffMode] = useState(null);   // route mode whose cuff card is open
  // Mission workflow (steps 4, 5, 10 are "done" once the crew has looked / exported)
  const [visited, setVisited] = useState({});
  const [layerRequest, setLayerRequest] = useState(null);
  const cuffWx = useSpaceWeather(IS_DEM ? evaStartMs : null);
  useEffect(() => { if (cuffMode) setVisited(v => ({ ...v, exported: true })); }, [cuffMode]);
  const [shareLabel, setShareLabel] = useState('SHARE LINK');

  const handlePick = useCallback(pos => {
    if (waypoints.length === 0) {
      onSetStartWaypoint(pos);
    } else {
      onAddWaypoint(pos);
    }
    setPickMode(false);
  }, [waypoints.length, onSetStartWaypoint, onAddWaypoint]);

  const { x=0, z=0, speed=0, heading=0 } = roverState || {};
  const trail = pathRef?.current?._roverTrail?.length || 0;
  const lm = learningModel?.getStats?.() || { traversals:0, cellsKnown:0, maxHazard:0 };

  // Extract just paths for the mini-map
  const routePaths = routes
    ? Object.fromEntries(Object.entries(routes).map(([m,r])=>[m, r?.path || r]))
    : null;

  const dustPickMode = dustMode === 'dust_placement_mode';
  const startPos = waypoints[0] || null;
  const endPos   = waypoints[waypoints.length-1] || null;

  return (
    <div style={{
      position:'fixed',right:0,bottom:0,
      ...(narrow
        ? { left:0, height:`${SHEET_VH}vh`, borderTop: ws ? `1px solid ${T.ruleStrong}` : '1px solid rgba(80,140,80,0.6)', WebkitOverflowScrolling:'touch' }
        : { top:topOffset, width:PW, borderLeft: ws ? `1px solid ${T.rule}` : '1px solid rgba(35,70,35,0.5)' }),
      background: ws ? T.panel : 'rgba(4,10,4,0.96)',
      display:'flex',flexDirection:'column',overflowY:'auto',
      zIndex:10, backdropFilter: ws ? undefined : 'blur(5px)', fontFamily: ws ? T.sans : undefined,
    }}>
      {/* Header */}
      {ws ? (
        <div style={{ padding:'8px 10px 7px', borderBottom:`1px solid ${T.rule}`, background:T.ground, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:7 }}>
            <span style={{ fontFamily:T.mono, fontSize:13, color:T.accent }}>{WS_META[ws].n}</span>
            <span style={{ color:T.text, fontSize:15, fontWeight:700, letterSpacing:1.2 }}>{WS_META[ws].label}</span>
          </div>
          <div style={{ color:'#c3c9d0', fontSize:13.5, marginTop:3, lineHeight:1.4 }}>{WORKSPACE_HELP[ws].does}</div>
          <More label="How to use this screen" style={{ marginBottom: 0 }}>
            <ol style={{ margin:0, paddingLeft:18, fontSize:13, lineHeight:1.55, color:T.text }}>
              {WORKSPACE_HELP[ws].steps.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </More>
        </div>
      ) : (
      <div style={{padding:'7px 10px 5px',borderBottom:'1px solid rgba(35,70,35,0.4)',
        background:'rgba(0,14,0,0.7)',flexShrink:0}}>
        <div style={{color:'#3dff55',fontSize:fs(10),fontWeight:'bold',letterSpacing:2}}>{IS_DEM ? 'MARTIAN MAP' : 'MOON ROVER SIM'}</div>
        <div style={{color:'#245524',fontSize:fs(7),letterSpacing:1}}>{IS_DEM ? 'MARSWALK PLANNER' : 'MISSION CONTROL TERMINAL'}</div>
      </div>
      )}

      {ws && <style>{`
        .ws-plan > [aria-label="Mission workflow"] { order: -10 }
        .ws-plan > #wf-objective { order: -9 }
        .ws-plan > #route-modes { order: -8 }
        .ws-plan > #route-compare { order: -7 }
        .ws-ops > [aria-label="Mission workflow"] { order: -10 }
        .ws-ops > #eva-exec { order: -9 }
        .ws-ops > #wf-decision { order: -8 }
      `}</style>}
      <div className={ws ? `ws-${ws}` : undefined} style={{flex:1,padding:'6px 8px',display:'flex',flexDirection:'column',gap:8,overflowY:'auto'}}>
        {IS_DEM && show('plan', 'ops') && <WorkflowStrip steps={workflowSteps({ objectiveId, mission, visited, science, routes, activeRoute, evaStatus })}
          onStep={(st) => {
            if (st.layer) setLayerRequest({ layer: st.layer, t: Date.now() });
            const go = () => {
              if (st.target === 'top') { window.scrollTo?.(0, 0); return; }
              document.getElementById(st.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            };
            const w = WORKSPACE_OF_TARGET[st.target];
            if (ws && w && w !== ws) { setWorkspace?.(w); setTimeout(go, 120); } else go();
          }} />}
        {ws && timeline}
        {ws && show('explore') && inspector && <div style={{ padding:'2px 0 8px', borderBottom:`1px solid ${T.rule}` }}>{inspector}</div>}
        {ws && show('analyze') && hasSelection && inspector && <div style={{ padding:'2px 0 8px', borderBottom:`1px solid ${T.rule}` }}>{inspector}</div>}
        {ws && show('plan') && <>
          <Sect label="Mission identity" collapsible defaultOpen={false} summary={`${SITE.meta?.label || SITE.name} · EV1 + EV2`}>
            <div style={{ fontSize: fs(7.5), color: T.text, lineHeight: 1.6 }}>
              <div>Site: <V>{SITE.meta?.label || SITE.name}</V></div>
              <div>Crew: <V>EV1 + EV2</V> (two-person EVA, NASA lunar EVA ConOps)</div>
              <div>Objective: <V>{findObjective(SITE.name, science?.objectiveId || objectiveId)?.name || 'not chosen — see Scientific objective'}</V></div>
            </div>
          </Sect>
          <Sect label="Astronaut & spacesuit" id="wf-crew" collapsible defaultOpen={false}
            summary={`${SUITS[mission.suit]?.label} · ${carryCheck(mission).earthEqKg.toFixed(1)}/${carryCheck(mission).limitKg} kg${carryCheck(mission).ok ? '' : ' · OVER'}`}>
            <div style={{ opacity: isRoving ? 0.5 : 1, pointerEvents: isRoving ? 'none' : 'auto' }}><SuitPart mission={mission} setMission={setMission} /></div>
          </Sect>
          <Sect label="Payload mass" collapsible defaultOpen={false} summary={`${mission.equipmentKg} kg equipment`}>
            <div style={{ opacity: isRoving ? 0.5 : 1, pointerEvents: isRoving ? 'none' : 'auto' }}><PayloadSetup mission={mission} setMission={setMission} /></div>
          </Sect>
          <Sect label="Oxygen & life support" collapsible defaultOpen={false} summary={O2_SCENARIOS[mission.o2?.scenario]?.label || mission.o2?.scenario || '—'}>
            <OxygenSetup mission={mission} setMission={setMission} />
          </Sect>
          <Sect label="Dust exposure & equipment reliability" collapsible defaultOpen={false}
            summary={Object.values(mission.dust || {}).every(v => v && v !== 'unknown') ? 'set' : 'incomplete'}>
            <div style={{ opacity: isRoving ? 0.5 : 1, pointerEvents: isRoving ? 'none' : 'auto' }}><DustSetup mission={mission} setMission={setMission} /></div>
          </Sect>
          <Sect label="EVA limits & safe haven" collapsible defaultOpen={false}
            summary={`${EVA_PROFILES[mission.limits || 'lunar']?.label}${mission.rover ? ' · rover' : ''}${mission.obstacleBuffer ? ' · buffer' : ''}`}>
            <div style={{ opacity: isRoving ? 0.5 : 1, pointerEvents: isRoving ? 'none' : 'auto' }}><LimitsPart mission={mission} setMission={setMission} start={waypoints?.[0]} /></div>
          </Sect>
          {sun && <Sect label="Environmental constraints — Mars time" collapsible defaultOpen={false}
            summary={evaStartMs != null && SITE.meta?.center ? `start ${fmtHourMin(ltstOf(j2000tt(evaStartMs), SITE.meta.center.lon_deg_east))} LTST` : ''}>
            <MarsTimePanel sun={sun} evaStartMs={evaStartMs} setEvaStartMs={setEvaStartMs} />
          </Sect>}
        </>}

        {/* ── Topographic Map — first thing the user sees ── */}
        {show('explore', 'plan', 'ops') && <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
            <Label>{ws ? 'SITE MAP (2D)' : 'TOPOGRAPHIC MAP'}</Label>
            <span style={{fontSize:fs(7),color: dustPickMode?'#ffcc88':'#4a884a'}}>
              {dustPickMode ? '☁ CLICK TO PLACE DUST' : pickMode ? '▶ CLICK TO PLACE WP' : ws ? 'scroll zoom · drag pan · click inspect' : 'SCROLL=ZOOM · DRAG=PAN'}
            </span>
          </div>
          <MiniMap
            waypoints={waypoints}
            roverPos={{x,z,heading}}
            routes={routePaths}
            activeRoute={activeRoute}
            ponr={routes?.[activeRoute]?.stats?.ponrPoint || null}
            pickMode={pickMode}
            onPick={handlePick}
            dustHazard={dustHazard}
            dustPickMode={dustPickMode}
            onDustPlace={onDustPlaced}
            orthoOn={!wireframe && orthoOn}
            showTrack={showTrack}
            onInspect={onInspect}
          />
          <div style={{fontSize:fs(7),color:'#3a5a3a',marginTop:3,display:'flex',gap:4,justifyContent:'space-between'}}>
            <span style={{color:startPos?'#22ff66':'#2a4a2a'}}>
              S: {startPos?`${startPos.x.toFixed(0)},${startPos.z.toFixed(0)}`:'--'}
            </span>
            <span style={{color:endPos&&waypoints.length>1?'#ff4422':'#4a2a2a'}}>
              E: {endPos&&waypoints.length>1?`${endPos.x.toFixed(0)},${endPos.z.toFixed(0)}`:'--'}
            </span>
          </div>
          {IS_DEM && SITE.track && setShowTrack && !['explore', 'analyze'].includes(ws) && (
            <div style={{marginTop:5}}>
              <Btn active={showTrack} color="#c8ccff" onClick={()=>setShowTrack(v=>!v)} style={{width:'100%'}}
                title={`${SITE.track.rover}'s own route through this site (sols ${SITE.track.sols[0]}–${SITE.track.sols[1]}, ${(SITE.track.length_m/1000).toFixed(1)} km) and named places — ${SITE.track.credit}`}>
                {showTrack ? '✓ ' : ''}{SITE.track.rover.toUpperCase()}'S ROUTE & PLACES
              </Btn>
              {showTrack && SITE.track.labels.some(l=>l.derived) && (
                <div style={{fontSize:fs(6.5),color:'#6a7a6a',marginTop:2}}>Region names: this project's derived levels, not NASA's mapped units.</div>
              )}
            </div>
          )}
          <div style={{height:1,background: ws ? T.rule : 'rgba(30,70,30,0.2)',marginTop:8}}/>
        </div>}

        {/* Terrain */}
        {show('plan', 'ops') && <Sect label="Terrain Mode" collapsible={!!ws} defaultOpen={!ws}
          summary={`${wireframe ? 'WIRE' : SITE.ortho && orthoOn ? 'HiRISE' : 'DEM'} · relief ×${reliefScale}`}>
          <Row>
            <Btn active={!wireframe && !(SITE.ortho && orthoOn)} onClick={()=>{setWireframe(false); setOrthoOn?.(false);}}>{IS_DEM ? 'DEM' : 'PROCEDURAL'}</Btn>
            {SITE.ortho && (
              <Btn active={!wireframe && orthoOn} onClick={()=>{setWireframe(false); setOrthoOn(true);}}
                title={`Orbital image: ${SITE.ortho.source?.title}`}>HiRISE</Btn>
            )}
            <Btn active={wireframe}  onClick={()=>setWireframe(true)}>WIRE</Btn>
          </Row>
          {hasRelief() && setReliefScale && !wireframe && (
            <div style={{marginTop:5}}>
              <Row>
                {RELIEF_SCALES.map(k => (
                  <Btn key={k} active={reliefScale===k} onClick={()=>setReliefScale(k)}
                    title={k===1 ? 'True slopes of the 1 m HiRISE DTM' : `Relief shading ×${k}: slopes drawn ${k}× steeper. Shading only — heights, slopes, routes and every number stay true.`}>
                    {k===1 ? 'RELIEF ×1' : `×${k}`}
                  </Btn>
                ))}
              </Row>
              <div style={{fontSize:fs(6.5),color:'#6a7a6a',marginTop:2}}>
                Shading: 1 m HiRISE DTM{reliefScale>1 ? ` · slopes ×${reliefScale} for visibility (numbers unchanged)` : ' · true slopes'}
              </div>
            </div>
          )}
        </Sect>}

        {/* Waypoints */}
        {show('plan') && <Sect label={`Waypoints (${waypoints.length})`}>
          {/* Waypoint list */}
          {waypoints.length > 0 && (
            <div style={{marginBottom:5,maxHeight:Math.round(58*UI_SCALE),overflowY:'auto',fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(0,12,0,0.4)',borderRadius:3,padding:'3px 5px'}}>
              {waypoints.map((wp,i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:4,marginBottom:1}}>
                  <div style={{width:5,height:5,borderRadius:'50%',flexShrink:0,
                    background:i===0?'#22ff55':i===waypoints.length-1?'#ff4422':WP_COLORS_2D[i%WP_COLORS_2D.length]}}/>
                  <span style={{color:'#779977'}}>{i===0?'S':i===waypoints.length-1?'E':i}:</span>
                  <span style={{color:'#aaffaa'}}>{wp.x.toFixed(0)},{wp.z.toFixed(0)}</span>
                  {wp.label && <span style={{color:'#ffbb66',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={wp.label}>⛏ {wp.label}</span>}
                </div>
              ))}
            </div>
          )}
          <Row style={{marginBottom:4}}>
            <Btn active={pickMode} color="#44ffaa"
              onClick={()=>setPickMode(m=>!m)}>
              {pickMode?'● ADDING…':'+ ADD WP'}
            </Btn>
            <Btn onClick={onRemoveLastWaypoint} disabled={waypoints.length===0}>
              ← REMOVE
            </Btn>
          </Row>
          <Row>
            <Btn onClick={onClearWaypoints} disabled={waypoints.length===0}>CLEAR ALL</Btn>
            <Btn disabled={waypoints.length<2 || isPlanning} onClick={onPlanPath}
              style={{flex:1.5,background:'rgba(0,65,0,0.55)',borderColor:'rgba(0,180,0,0.5)',
                color:'#44ff88',fontWeight:'bold'}}>
              {isPlanning ? 'PLANNING…' : 'PLAN PATH'}
            </Btn>
          </Row>
        </Sect>}


        {hasGeology && show('plan') && (
        <Sect label="Scientific objective & stops" id="wf-objective">
          <SciencePanel science={science} onPlan={onPlanScience} busy={isPlanningScience || isPlanning}
            dwellMin={scienceDwellMin} setDwellMin={setScienceDwellMin} disabled={isRoving}
            objectiveId={objectiveId} setObjectiveId={setObjectiveId} mission={mission} onInspect={onInspect} />
        </Sect>
        )}

        {/* Sun — DEM: Mars24 time controls; procedural: manual dial */}
        {IS_DEM && sun ? null : show('plan') && (
        <Sect label="Sun Direction">
          <div style={{display:'flex',gap:7,alignItems:'center'}}>
            <SunDial angle={sunAngleDeg} onChange={setSunAngleDeg}/>
            <div style={{flex:1}}>
              <div style={{color:'#FFD700',fontSize:fs(14),fontWeight:'bold',marginBottom:3}}>{sunAngleDeg}°</div>
              <input type="range" min={0} max={359} value={sunAngleDeg}
                onChange={e=>setSunAngleDeg(Number(e.target.value))} style={{width:'100%'}}/>
              <div style={{color:'#554433',fontSize:fs(7),marginTop:2}}>
                {['N','NE','E','SE','S','SW','W','NW','N'][Math.round(sunAngleDeg/45)%8]} — PATH FAVORS LIT ZONES
              </div>
            </div>
          </div>
        </Sect>
        )}

        {/* Route selector + start */}
        {show('plan', 'ops') && <Sect label={ws === 'plan' ? 'Route modes' : ws === 'ops' ? 'EVA execution' : IS_DEM ? 'Route & EVA' : 'Select Route'} id={ws === 'ops' ? 'eva-exec' : 'route-modes'}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,marginBottom:5}}>
            {Object.entries(ROUTE_COLORS)
              .filter(([mode]) => mode !== 'HOME_RETURN')
              .map(([mode,color])=>(
              <div key={mode} onClick={()=>setActiveRoute(mode)} style={{
                padding:'5px 3px',textAlign:'center',cursor:'pointer',borderRadius:3,
                fontSize:fs(9),fontWeight:'bold',
                border:`1px solid ${activeRoute===mode?color:'rgba(40,70,40,0.35)'}`,
                color:activeRoute===mode?color:'#446644',
                background:activeRoute===mode?'rgba(0,0,0,0.5)':'rgba(6,12,6,0.35)',
                boxShadow:activeRoute===mode?`0 0 7px ${color}44`:'none',
                transition:'all 0.12s',
              }}>
                <span style={{display:'inline-block',width:5,height:5,borderRadius:'50%',background:color,
                  marginRight:3,verticalAlign:'middle'}}/>
                {mode}
              </div>
            ))}
          </div>
          {ws === 'plan' && <RouteModeNote mode={activeRoute} routes={routes} onInspect={onInspect} />}
          {IS_DEM ? show('ops') && (
            <>
              <Btn onClick={evaStatus==='playing' ? onPauseEva : onStartRover}
                disabled={!routes||!routes[activeRoute]}
                style={{width:'100%',padding:'7px 0',
                  background:evaStatus==='playing'?'rgba(60,40,0,0.6)':'rgba(0,65,0,0.6)',
                  border:`1px solid ${evaStatus==='playing'?'rgba(220,170,40,0.6)':'rgba(40,180,40,0.6)'}`,
                  color:evaStatus==='playing'?'#ffd166':'#44ff88',fontSize:fs(10),fontWeight:'bold',letterSpacing:1}}>
                {evaStatus==='playing' ? '❚❚  PAUSE EVA' : evaStatus==='paused' ? '▶  RESUME EVA'
                  : evaStatus==='done' ? '↻  REPLAY EVA' : '▶  START EVA'}
              </Btn>
              {evaStatus !== 'idle' && (
                <Row style={{marginTop:4}}>
                  <Btn onClick={onAbortEva} color="#ff8a3a" disabled={evaStatus==='done' || evaStatus==='ready'}>⏏ ABORT EVA</Btn>
                  <Btn onClick={onStopRover}>✕ CLOSE</Btn>
                </Row>
              )}
            </>
          ) : (
          <Btn onClick={isRoving?onStopRover:onStartRover}
            disabled={!routes||!routes[activeRoute]}
            style={{width:'100%',padding:'7px 0',
              background:isRoving?'rgba(65,0,0,0.6)':'rgba(0,65,0,0.6)',
              border:`1px solid ${isRoving?'rgba(180,40,40,0.6)':'rgba(40,180,40,0.6)'}`,
              color:isRoving?'#ff5533':'#44ff88',fontSize:fs(10),fontWeight:'bold',letterSpacing:1}}>
            {isRoving?'■  STOP ROVER':'▶  START ROVER'}
          </Btn>
          )}
        </Sect>}

        {/* ── Hazard Control (DEM: contingency) ── */}
        {show('ops') && <Sect label={IS_DEM ? 'Contingency' : 'Hazard Control'}>
          {/* Status banner */}
          {dustMode === DUST_STATES.INTERFERENCE && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(60,20,0,0.7)',border:'1px solid rgba(255,120,0,0.6)',color:'#ffcc66',
              letterSpacing:0.4}}>
              ⚠ DUST INTERFERENCE DETECTED
            </div>
          )}
          {dustMode === DUST_STATES.SIGNAL_LOST && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(65,0,0,0.72)',border:'1px solid rgba(255,80,80,0.68)',color:'#ff8a66',
              letterSpacing:0.4}}>
              ✖ SIGNAL LOST / OPTICAL SENSOR FAILURE
            </div>
          )}
          {dustMode === DUST_STATES.RETURN_HOME && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(40,10,0,0.7)',border:'1px solid rgba(255,80,0,0.5)',color:'#ff9955',
              letterSpacing:0.4,animation:'slideDown 0.25s ease'}}>
              {IS_DEM ? '↩ EVA ABORTED — CREW RETURNING TO THE HABITAT' : '↩ RETURNING TO HOME BASE'}
            </div>
          )}
          {dustMode === DUST_STATES.PRESENT && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(24,24,24,0.62)',border:'1px solid rgba(150,150,150,0.45)',color:'#c9c9c9',
              letterSpacing:0.4}}>
              {IS_DEM ? '☁ DUST DEVIL — ROUTE LOOK-AHEAD ACTIVE' : '☁ DUST PRESENT - CONTINUOUS MONITORING'}
            </div>
          )}
          {dustMode === DUST_STATES.STOPPED && (
            <div style={{marginBottom:5,padding:'4px 6px',borderRadius:3,fontSize:fs(8),fontFamily:'monospace',
              background:'rgba(0,30,0,0.7)',border:'1px solid rgba(60,180,60,0.5)',color:'#88ffaa',
              letterSpacing:0.4}}>
              {IS_DEM ? '✓ Crew safe at the habitat.' : '✓ Rover stopped safely.'}
            </div>
          )}

          {/* Dust-hazard trigger button — arms/cancels PLACEMENT mode so the
              user can click the map to drop a hazard; it does NOT drive the
              rover home itself. That's why the idle label says "SIMULATE
              DUST HAZARD" rather than "RETURN TO HOME" — the actual return
              drive is auto-triggered later, once the placed hazard causes
              sensor interference (see startReturnToHome() in App.jsx). */}
          <button onClick={onTriggerDustHazard} style={{
            width:'100%',padding:'6px 0',fontSize:fs(9),fontFamily:'monospace',fontWeight:'bold',
            letterSpacing:0.7,cursor:'pointer',borderRadius:3,marginBottom:4,
            background: dustPickMode
              ? 'rgba(80,40,0,0.7)'
              : dustMode===DUST_STATES.RETURN_HOME||dustMode===DUST_STATES.INTERFERENCE||dustMode===DUST_STATES.SIGNAL_LOST
                ? 'rgba(50,20,0,0.5)'
                : 'rgba(50,20,0,0.6)',
            border:`1px solid ${dustPickMode?'rgba(255,160,0,0.8)':'rgba(255,100,0,0.55)'}`,
            color: dustPickMode ? '#ffcc44' : '#ff9944',
            display:'flex',alignItems:'center',justifyContent:'center',gap:5,
            boxShadow: dustPickMode ? '0 0 8px rgba(255,140,0,0.4)' : 'none',
          }}>
            <span style={{fontSize:fs(11)}}>☁</span>
            {dustPickMode ? (IS_DEM ? '● PLACING DUST DEVIL… (CANCEL)' : '● PLACING DUST… (CANCEL)')
              : (IS_DEM ? 'SIMULATE DUST DEVIL' : 'SIMULATE DUST HAZARD')}
          </button>

          {dustHazard && (
            <div style={{fontSize:fs(7),fontFamily:'monospace',color:'#b5b5b5',marginBottom:3}}>
              {IS_DEM ? 'HELMET CAM SIGNAL' : 'CAM SIGNAL'}: <span style={{color:cameraSignalLost ? '#ff6655' : '#aaffaa'}}>{cameraSignalLost ? 'LOST' : `${Math.round((cameraSignalQuality ?? 1) * 100)}%`}</span>
            </div>
          )}

          {/* Dust hazard info + clear button */}
          {IS_DEM && (
            <More label="What does the dust-devil drill simulate?">
            <div style={{fontSize:fs(7),color:'#b0a080',lineHeight:1.45}}>
              Press the button, then click the site map to drop a dust devil. When it lies on the route within the next {Math.round(600/60)} min of walking,
              the crew sets a <b>{DUST_REROUTE.safetyMarginM.value} m safety zone</b> around it (dashed yellow ring) and a <b>new SAFE route</b> is planned
              from the point where they noticed it — the remaining stops and home, outside the zone (stops inside it are skipped). The new route
              (yellow) is taken if the crew can still walk home within the EVA budget at every point (time already spent included), the oxygen
              covers the rest of the plan plus the reserve and they are home before sunset — you get an information message with the extra time.
              Only if no such route exists: <b>“No new route found — returning to the start point for safety”</b>, and the walk home also avoids the zone when possible (orange dashed).
              <br/><i>Illustrative: the dust devil does not move; radius and safety distance are design choices, not an operational NASA procedure.</i>
            </div>
            </More>
          )}
          {dustHazard && (
            <div style={{display:'flex',alignItems:'center',gap:3}}>
              <div style={{flex:1,fontSize:fs(7),fontFamily:'monospace',color:'rgba(200,160,100,0.8)',
                background:'rgba(40,20,0,0.4)',borderRadius:3,padding:'3px 5px'}}>
                ☁ ({dustHazard.x.toFixed(0)},{dustHazard.z.toFixed(0)}) r={dustHazard.radius}m
              </div>
              <Btn onClick={onClearDustHazard} color="#ff8844"
                style={{flex:'none',padding:'3px 7px',fontSize:fs(7)}}>
                CLEAR
              </Btn>
            </div>
          )}
        </Sect>}

        {/* Route Analysis */}
        {show('plan', 'ops') && <Sect label={ws === 'plan' ? 'Route comparison' : ws === 'ops' ? 'Mission summary & safety — GO / NO-GO' : 'Route Analysis — GO / NO-GO'} id={ws === 'plan' ? 'route-compare' : 'wf-decision'}>
          {IS_DEM && show('ops') && <MissionSummary routes={routes} activeRoute={activeRoute} science={science} mission={mission} startMs={evaStartMs} />}
          <RouteAnalysis key={ws || 'all'} routes={routes} activeRoute={activeRoute} onSelect={setActiveRoute} onCuffCard={IS_DEM ? setCuffMode : null} startMs={evaStartMs} mission={mission} openDecision={ws === 'ops'}/>
          {cuffMode && routes?.[cuffMode]?.stats?.marginS && (
            <CuffCard mode={cuffMode} route={routes[cuffMode]} startMs={evaStartMs} mission={mission} onClose={() => setCuffMode(null)}
              assess={evaAssessments(routes[cuffMode], cuffWx, { mission, startMs: evaStartMs })}
              objective={science?.objectiveId ? findObjective(SITE.name, science.objectiveId) : null}
              hazards={(() => { const hz = getHazardMap(); return hz ? routeHazards(routes[cuffMode].path, hz.cls, cellIdx) : null; })()} />
          )}
        </Sect>}

        {/* Camera */}
        {show('explore', 'ops') && <Sect label="Camera">
          <Row>
            <Btn active={cameraMode==='free'}   onClick={()=>setCameraMode('free')}>FREE</Btn>
            <Btn active={cameraMode==='follow'} onClick={()=>setCameraMode('follow')}>{IS_DEM ? 'FOLLOW EV1' : 'FOLLOW'}</Btn>
            {IS_DEM && <Btn active={cameraMode==='overview'} onClick={()=>setCameraMode('overview')}>OVERVIEW</Btn>}
          </Row>
        </Sect>}

        {/* Heatmap */}
        {show('analyze') && <div id="wf-layers" style={{ scrollMarginTop: 6 }}>
        {ws && <Label>Terrain analysis — layers, legend, compare</Label>}
        <HeatmapViewer sunAngle={sunAngleDeg} sunElevation={sun?.elevationDeg} learningModel={learningModel}
          refreshKey={routes} drape={drapeLayer} onDrape={setDrapeLayer}
          drapeOpacity={drapeOpacity} setDrapeOpacity={setDrapeOpacity}
          request={layerRequest} onLayerShown={(l) => setVisited(v => ({ ...v, layers: true, ...(l === HAZARD_LAYER ? { hazards: true } : {}) }))}/>
        </div>}
        {ws && show('analyze') && <ScienceData catalog={catalog} onInspect={onInspect} onProvenance={onProvenance} />}

        {/* Image processing proof panel */}
        {show('analyze', 'ops') && <ProcessingMapPreview
          slopeMap={slopeMap}
          craterMask={craterMask}
          hMap={hMap}
          roverPos={{ x, z, heading }}
          signalLost={cameraSignalLost}
          signalQuality={cameraSignalQuality}
        />}

        {IS_DEM && show('analyze') && (
          <Sect label="Mars AI Terrain Segmentation" id="wf-ai-terrain">
            <TerrainSegmentation crewPos={evaStatus !== 'idle' ? { x, z } : null} />
          </Sect>
        )}

        {/* AI (rover traversal learning — Moon mode only) */}
        {!IS_DEM && (
        <Sect label="AI Learning">
          <div style={{fontSize:fs(8),color:'#557755',lineHeight:1.9,fontFamily:'monospace'}}>
            <div>Traversals:  <V>{lm.traversals}</V></div>
            <div>Cells known: <V>{lm.cellsKnown}</V></div>
            <div>Max hazard:  <V c={lm.maxHazard>0.7?'#ff6644':'#99ff99'}>{(lm.maxHazard||0).toFixed(3)}</V></div>
          </div>
        </Sect>
        )}

        {/* Telemetry */}
        {show('ops') && <Sect label={IS_DEM ? 'Telemetry (EV1)' : 'Telemetry'}>
          <div style={{fontFamily:'monospace',fontSize:fs(8),color:'#557755',lineHeight:1.9}}>
            <div>X: <V>{x.toFixed(1)}</V>  Z: <V>{z.toFixed(1)}</V> m</div>
            {IS_DEM && (() => { const ll = localToLatLon(x, z); return ll && (
              <div>Lat/Lon: <V>{ll.lat.toFixed(5)}°N {ll.lon.toFixed(5)}°E</V></div>); })()}
            <div>Speed: <V>{(speed*3.6).toFixed(1)}</V> km/h{IS_DEM ? ' (mission time)' : ''}</div>
            <div>Heading: <V>{((heading*180/Math.PI+360)%360).toFixed(0)}°</V></div>
            {!IS_DEM && <div>Trail pts: <V>{trail}</V></div>}
          </div>
        </Sect>}

        {/* Exports & Share */}
        {show('ops') && <Sect label="Export & Share" id="wf-export">
          <div style={{display:'flex',flexDirection:'column',gap:4}}>

            {/* PNG */}
            <button onClick={() => {
              const ok = exportPNG();
              if (!ok) { showToast?.('Could not capture scene — try again in a moment.', 'warning'); return; }
              showToast?.('PNG saved to Downloads.', 'info');
            }} style={{
              width:'100%', padding:'6px 0', fontSize:fs(9), fontFamily:'monospace',
              fontWeight:'bold', letterSpacing:0.6, cursor:'pointer', borderRadius:3,
              background:'rgba(0,30,50,0.6)', border:'1px solid rgba(40,120,180,0.55)',
              color:'#66ccff', display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}>
              <span style={{fontSize:fs(11)}}>📷</span> EXPORT PNG
            </button>

            {/* JSON */}
            <button onClick={() => {
              if (!routes && waypoints.length < 2) {
                showToast?.('Plan a route first to export JSON.', 'warning'); return;
              }
              exportJSON(waypoints, routes, activeRoute, sunAngleDeg, IS_DEM ? missionExport({ science, mission, routes, activeRoute, startMs: evaStartMs }) : {});
              setVisited(v => ({ ...v, exported: true }));
              showToast?.('JSON route file saved to Downloads.', 'info');
            }} style={{
              width:'100%', padding:'6px 0', fontSize:fs(9), fontFamily:'monospace',
              fontWeight:'bold', letterSpacing:0.6, cursor:'pointer', borderRadius:3,
              background:'rgba(0,40,10,0.6)', border:'1px solid rgba(40,180,80,0.55)',
              color:'#66ff99', display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}>
              <span style={{fontSize:fs(11)}}>📄</span> EXPORT JSON
            </button>

            {/* Share link */}
            <button onClick={async () => {
              setVisited(v => ({ ...v, exported: true }));
              if (waypoints.length < 1) {
                showToast?.('Add at least one waypoint to share.', 'warning'); return;
              }
              const url = buildShareURL(window.location.href, SITE.name, {
                waypoints, science: !!science, route: activeRoute, startMs: evaStartMs,
                mission, dwellMin: scienceDwellMin, objectiveId: science?.objectiveId || objectiveId,
              });
              try {
                await navigator.clipboard.writeText(url);
                setShareLabel('✓ COPIED!');
                showToast?.('Share link copied to clipboard.', 'info');
                setTimeout(() => setShareLabel('SHARE LINK'), 2500);
              } catch {
                // Fallback: open in new window so user can copy manually
                window.prompt('Copy this link:', url);
              }
            }} style={{
              width:'100%', padding:'6px 0', fontSize:fs(9), fontFamily:'monospace',
              fontWeight:'bold', letterSpacing:0.6, cursor:'pointer', borderRadius:3,
              background:'rgba(40,20,0,0.6)', border:'1px solid rgba(180,120,40,0.55)',
              color:'#ffcc66', display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}>
              <span style={{fontSize:fs(11)}}>🔗</span> {shareLabel}
            </button>

          </div>
        </Sect>}

        {/* Log */}
        {show('ops') && <Sect label={IS_DEM ? 'Mission Log' : 'Route Log'}>
          <div style={{fontSize:fs(7),color:'#3a5a3a',maxHeight:Math.round(68*UI_SCALE),overflowY:'auto',fontFamily:'monospace'}}>
            {routeLog?.length
              ?routeLog.slice(-14).map((l,i)=>(
                <div key={i} style={{color:l.includes('[ERR]')?'#ff6644':'#557755',marginBottom:1}}>{l}</div>
              ))
              :<div style={{color:'#253a25'}}>▶ Add waypoints and press PLAN PATH.</div>
            }
          </div>
        </Sect>}

      </div>
    </div>
  );
}
