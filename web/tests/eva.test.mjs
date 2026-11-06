/**
 * EVA playback tests (Stage 7): timeline, fastest return path, playback controller.
 *   node --test web/tests/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { site } = await import('../src/terrain/siteData.js');

// 160×160, 4 m: eastward 6% slope + gentle waves + a walled-in pit (unreachable)
const N = 160, CELL = 4;
const heights = new Float32Array(N * N);
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  let h = 0.06 * c * CELL + 1.2 * Math.sin(r / 7) * Math.cos(c / 11);
  const d = Math.hypot(r - 120, c - 120);
  if (d > 7 && d < 10) h += 30;
  heights[r * N + c] = h;
}
Object.assign(site, {
  mode: 'dem', name: 'evatest', gridRes: N, cellM: CELL, sizeM: (N - 1) * CELL,
  heights, heightOrigin: 0,
  meta: { center: { lat_deg: 18.44, lon_deg_east: 77.45 }, grid: { n: N, cell_m: CELL, span_m: (N - 1) * CELL },
          projection: { mars_radius_m: 3396190 } },
});

const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const WB = await import('../src/utils/walkback.js');
const W = await import('../src/utils/walkModel.js');
const TL = await import('../src/utils/evaTimeline.js');
const EP = await import('../src/utils/evaPlayback.js');

const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();
const HALF = (N - 1) * CELL / 2;
const world = (c, r) => ({ x: -HALF + c * CELL, z: -HALF + r * CELL });
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('buildTimeline/sampleTimeline: arrival, dwell, walking interpolation', () => {
  const path = [[0, 0, 0], [30, 0, 40], [30, 0, 40], [90, 0, 40]];   // incl. a zero-length segment
  const el = [0, 100, 700, 820];                                       // 600 s dwell at idx 2
  const tl = TL.buildTimeline(path, el, [{ idx: 2, dwellS: 600, label: 'Stop A' }]);
  assert.equal(tl.totalS, 820);
  assert.equal(tl.lengthM, 50 + 60);
  assert.deepEqual([...tl.arr], [0, 100, 100, 820]);
  assert.deepEqual([...tl.dep], [0, 100, 700, 820]);
  assert.equal(tl.stops.length, 1);
  assert.equal(tl.stops[0].n, 1);
  assert.equal(tl.stops[0].arriveS, 100);
  assert.equal(tl.stops[0].departS, 700);

  assert.equal(TL.sampleTimeline(tl, -5).state, 'pre');
  const a = TL.sampleTimeline(tl, 50);
  assert.equal(a.state, 'walk');
  assert.ok(close(a.x, 15) && close(a.z, 20) && close(a.distM, 25));
  assert.ok(close(a.speedMs, 0.5));
  assert.ok(close(a.heading, Math.atan2(30, 40)));
  const d = TL.sampleTimeline(tl, 400);
  assert.equal(d.state, 'dwell');
  assert.equal(d.atIdx, 2);
  assert.ok(close(d.x, 30) && close(d.z, 40));
  assert.equal(TL.currentStop(tl, d).label, 'Stop A');
  const w2 = TL.sampleTimeline(tl, 760);
  assert.equal(w2.state, 'walk');
  assert.ok(close(w2.x, 60) && close(w2.z, 40));
  assert.ok(close(w2.heading, Math.PI / 2));
  assert.equal(TL.sampleTimeline(tl, 820).state, 'done');
  assert.equal(TL.sampleTimeline(tl, 1e9).state, 'done');
  assert.equal(TL.nextStop(tl, a).n, 1);
  assert.equal(TL.nextStop(tl, w2), null);
  assert.equal(TL.stopsCompleted(tl, 699), 0);
  assert.equal(TL.stopsCompleted(tl, 700), 1);
  // Path ahead of t=0 within 60 s reaches (15,20) at 50 s → distance to (15,20) is 0
  assert.ok(TL.minDistanceAhead(tl, 0, 60, 15, 20) < 1e-9);
  // ... but a point near the last leg is far until the window covers it
  assert.ok(TL.minDistanceAhead(tl, 0, 60, 80, 40) > 40);
  assert.ok(TL.minDistanceAhead(tl, 0, 900, 80, 40) < 1e-9);
  assert.throws(() => TL.buildTimeline(path, [0, 100, 50, 60]), /backwards/);
  assert.throws(() => TL.buildTimeline(path, [0, 1]), /mismatch/);
});

test('descendToHome: exact fastest return on the Dijkstra map', () => {
  const homeIdx = 80 * N + 40;
  const wall = P.getWallMap();
  const maps = WB.homeTimeMaps(homeIdx, hm, wall, N, CELL);
  let checked = 0;
  for (const [r, c] of [[10, 10], [150, 150], [80, 150], [5, 90], [140, 60], [81, 41], [80, 40]]) {
    const k = r * N + c;
    const res = WB.descendToHome(k, maps.toHome, hm, wall, N, CELL);
    assert.ok(res, `cell ${r},${c} reachable`);
    assert.equal(res.cells[res.cells.length - 1], homeIdx);
    let t = 0;
    for (let i = 1; i < res.cells.length; i++) {
      const a = res.cells[i - 1], b = res.cells[i];
      const ra = (a / N) | 0, ca = a - ra * N, rb = (b / N) | 0, cb = b - rb * N;
      assert.ok(Math.max(Math.abs(ra - rb), Math.abs(ca - cb)) === 1, 'neighbouring cells');
      assert.equal(wall[b], 0, 'never through a wall');
      assert.ok(maps.toHome[b] < maps.toHome[a], 'strictly closer to home');
      t += W.walkTimeS(ra !== rb && ca !== cb ? CELL * Math.SQRT2 : CELL, hm[b] - hm[a]);
    }
    assert.ok(close(t, maps.toHome[k], 1e-6 * Math.max(1, t)), `time ${t} vs toHome ${maps.toHome[k]}`);
    assert.ok(close(res.timeS, maps.toHome[k]));
    checked++;
  }
  assert.equal(checked, 7);
  // Inside the walled pit: unreachable → null
  assert.equal(WB.descendToHome(120 * N + 120, maps.toHome, hm, wall, N, CELL), null);
});

// Science-style plan: home → A (dwell 15 min) → B (dwell 10 min) → home
const HOME = world(40, 80);
const A = world(70, 50), B = world(100, 95);
function planLoop(dwellA = 900, dwellB = 600, modes = ['FAST']) {
  return P.planAllRoutes([HOME, { ...A, dwellS: dwellA, label: 'Unit A' }, { ...B, dwellS: dwellB, label: 'Unit B' }, HOME],
    sm, cm, hm, 45, null, { modes });
}
function envFor() {
  return {
    toHomeAt: (x, z) => P.toHomeTimeAt(x, z),
    returnPath: (x, z) => P.fastestReturnPath(x, z, hm),
    heightAt: T.getTerrainHeight,
  };
}

test('planner stats feed the timeline: total = round trip, stops at the right times', () => {
  const r = planLoop().FAST;
  const s = r.stats;
  assert.equal(s.stops.length, 2);
  assert.deepEqual(s.stops.map(x => x.label), ['Unit A', 'Unit B']);
  assert.equal(s.elapsedS.length, r.path.length);
  const tl = TL.buildTimeline(r.path, s.elapsedS, s.stops);
  assert.ok(close(tl.totalS, s.roundTripS, 1e-6), `${tl.totalS} vs ${s.roundTripS}`);
  assert.equal(tl.stops.length, 2);
  for (const st of tl.stops) {
    const mid = TL.sampleTimeline(tl, (st.arriveS + st.departS) / 2);
    assert.equal(mid.state, 'dwell');
    assert.equal(mid.atIdx, st.idx);
  }
  const [sa, sb] = tl.stops;
  assert.ok(Math.hypot(sa.x - A.x, sa.z - A.z) < 12, 'stop 1 near A');
  assert.ok(Math.hypot(sb.x - B.x, sb.z - B.z) < 12, 'stop 2 near B');
  assert.ok(close(sb.dwellS, 600) && close(sa.dwellS, 900));
});

test('fastestReturnPath: starts at the crew, ends at home, time = toHome + first step', () => {
  planLoop();                     // installs home maps for HOME
  const p = world(120.3, 30.7);
  const r = P.fastestReturnPath(p.x, p.z, hm);
  assert.ok(r && r.path.length > 2);
  assert.ok(close(r.path[0][0], p.x) && close(r.path[0][2], p.z));
  const end = r.path[r.path.length - 1];
  assert.ok(close(end[0], HOME.x) && close(end[2], HOME.z));
  const tl = TL.timelineFromPath(r.path, T.getTerrainHeight, 1000);
  const [x1, , z1] = r.path[1];
  const first = W.walkTimeS(Math.hypot(x1 - p.x, z1 - p.z), T.getTerrainHeight(x1, z1) - T.getTerrainHeight(p.x, p.z));
  assert.ok(close(tl.totalS - 1000, first + r.gridTimeS, 1e-6), `${tl.totalS - 1000} vs ${first + r.gridTimeS}`);
});

test('EvaPlayback: events, live margin = planner margin, completion', () => {
  const r = planLoop().FAST;
  const pb = new EP.EvaPlayback();
  const seen = [];
  pb.subscribe((kind, p) => { if (kind === 'event') seen.push(p.events[p.events.length - 1]); });
  pb.load(r.path, r.stats, { mode: 'FAST', budgetS: r.stats.budgetS, ponrIdx: r.stats.ponrIdx }, envFor());
  assert.equal(pb.status, 'ready');
  // Live margin at each departure equals the planner's margin profile
  for (let i = 0; i < r.path.length; i += 7) {
    assert.ok(close(pb.marginAt(r.stats.elapsedS[i]), r.stats.marginS[i], 1e-6), `margin at point ${i}`);
  }
  pb.setSpeed(600);
  pb.play();
  let guard = 0;
  while (pb.status === 'playing' && guard++ < 100000) pb.tick(0.05);
  assert.equal(pb.status, 'done');
  assert.ok(close(pb.t, r.stats.roundTripS, 1e-6));
  const kinds = seen.map(e => e.kind);
  assert.deepEqual(kinds.filter(k => k === 'arrive' || k === 'depart'), ['arrive', 'depart', 'arrive', 'depart']);
  assert.equal(kinds[kinds.length - 1], 'done');
  assert.ok(!kinds.includes('ponr'), 'GO plan never passes the point of no return');
  const snap = EP.evaSnapshot(pb);
  assert.equal(snap.activity.kind, 'done');
  assert.equal(snap.stopsDone, 2);
  assert.ok(snap.distHomeM < 1e-6);
  assert.ok(close(snap.margin, r.stats.budgetS - r.stats.roundTripS, 1e-6));
});

test('EvaPlayback: abort walks the fastest path home; EV2 trails on the nominal route', () => {
  const r = planLoop().FAST;
  const pb = new EP.EvaPlayback();
  pb.load(r.path, r.stats, { budgetS: r.stats.budgetS }, envFor());
  assert.equal(pb.abort('test'), false, 'cannot abort before the EVA starts');
  pb.setSpeed(1); pb.play();
  const tl = pb.nominal;
  const tWalk = tl.stops[0].departS + 200;            // walking from A towards B
  pb.tick(tWalk);
  assert.equal(pb.pose().state, 'walk');
  const before = pb.pose();
  const margin0 = pb.marginAt();
  assert.equal(pb.abort('test'), true);
  assert.equal(pb.abort('again'), false);
  assert.ok(pb.aborted && close(pb.aborted.t0, tWalk));
  // ETA = fastest return from here (+ the step to the cell centre) → margin is preserved
  const back = P.toHomeTimeAt(before.x, before.z);
  assert.ok(Math.abs(pb.aborted.etaS - back) < 10, `eta ${pb.aborted.etaS} vs toHome ${back}`);
  assert.ok(Math.abs(pb.marginAt() - margin0) < 10);
  // EV2 (10 s behind) is still on the nominal route just before the abort point
  const ev2 = pb.pose(EP.EV2_LAG_S);
  const nominalEv2 = TL.sampleTimeline(tl, tWalk - EP.EV2_LAG_S);
  assert.ok(close(ev2.x, nominalEv2.x) && close(ev2.z, nominalEv2.z));
  pb.setSpeed(600);
  let guard = 0;
  while (pb.status === 'playing' && guard++ < 100000) pb.tick(0.05);
  assert.equal(pb.status, 'done');
  assert.ok(close(pb.t, pb.active.totalS));
  const end = pb.pose();
  assert.ok(Math.hypot(end.x - HOME.x, end.z - HOME.z) < 1e-6, 'home after abort');
  assert.ok(pb.t < r.stats.roundTripS, 'abort is shorter than finishing the plan');
  pb.seek(10);
  assert.ok(close(pb.t, pb.active.totalS), 'seek disabled after abort');
  pb.restart(false);
  assert.equal(pb.aborted, null);
  assert.equal(pb.t, 0);
});

test('EvaPlayback: point of no return event on a NO-GO plan; dust devil ahead aborts', () => {
  const r = planLoop(3600, 3600).FAST;
  const tight = r.stats.roundTripS - 1200;            // budget 20 min short of the plan
  const pb = new EP.EvaPlayback();
  pb.load(r.path, r.stats, { budgetS: tight }, envFor());
  pb.setSpeed(600); pb.play();
  let guard = 0;
  while (pb.status === 'playing' && guard++ < 100000) pb.tick(0.05);
  const kinds = pb.events.map(e => e.kind);
  assert.ok(kinds.includes('ponr'));
  assert.ok(kinds.includes('margin'));
  assert.ok(pb.events.find(e => e.kind === 'ponr').t > 0);

  // Dust devil placed on the second leg → abort before reaching it
  const pb2 = new EP.EvaPlayback();
  pb2.load(r.path, r.stats, { budgetS: r.stats.budgetS }, envFor());
  const st2 = pb2.nominal.stops[1];
  pb2.setHazard({ x: st2.x, z: st2.z, radius: 30, interferenceRadius: 40 });
  pb2.setSpeed(30); pb2.play();
  guard = 0;
  while (pb2.status === 'playing' && !pb2.aborted && guard++ < 100000) pb2.tick(0.05);
  assert.ok(pb2.aborted, 'aborted');
  assert.match(pb2.aborted.reason, /dust devil/);
  assert.ok(pb2.aborted.t0 < st2.arriveS, 'aborted before reaching the dust devil');
  assert.ok(pb2.aborted.t0 > st2.arriveS - EP.HAZARD_LOOKAHEAD_S - 120, 'and not long before it came into the look-ahead window');
});
