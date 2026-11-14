/**
 * Hazard map — what makes each 4 m cell of the site hard or unsafe to walk, from data only:
 * the HiRISE DTM (slope, rock relief, closed depressions), the rover's own ground-view
 * positions (how well the ground is known) and, with a rover, its walk-back reach.
 *
 * Classes (one per cell, highest priority first):
 *   1 over the slope limit        (wall — the planner never enters it)
 *   2 rock obstacle               (wall)
 *   3 obstacle buffer             within HAZARD_PARAMS.obstacleBufferM of a wall
 *   4 closed depression           crater / pit ≥ depressionM deep (DTM sinks filled)
 *   5 steep                       slope over steepFraction × limit
 *   6 rough                       rock relief over roughFraction × limit
 *   7 beyond rover reach          walk to the rover longer than its limit (rover mode only)
 *   8 known only from orbit       no rover ground-view position within unseenM
 *   0 none of the above
 * Thresholds: config/marswalkProfile.js (HAZARD_PARAMS) — only the slope limit is sourced.
 *
 * Pure (typed arrays in, typed arrays out): tested in Node (tests/hazards.test.mjs).
 */

export const HAZARD_CLASSES = [
  { id: 0, key: 'none', name: 'no flagged hazard', color: [0, 0, 0, 0], hard: false },
  { id: 1, key: 'slope', name: 'over the slope limit (no-go)', color: [255, 40, 60, 235], hard: true },
  { id: 2, key: 'rock', name: 'rock obstacle (no-go)', color: [180, 40, 255, 235], hard: true },
  { id: 3, key: 'buffer', name: 'next to an obstacle', color: [255, 140, 170, 190], hard: false },
  { id: 4, key: 'depression', name: 'closed depression / crater', color: [60, 140, 255, 210], hard: false },
  { id: 5, key: 'steep', name: 'steep ground', color: [255, 150, 40, 190], hard: false },
  { id: 6, key: 'rough', name: 'rough ground (rocks)', color: [230, 210, 60, 180], hard: false },
  { id: 7, key: 'rover', name: 'beyond rover walk-back', color: [120, 220, 255, 140], hard: false },
  { id: 8, key: 'unseen', name: 'known only from orbit', color: [170, 170, 170, 110], hard: false },
];

/** Binary dilation of a 0/1 grid by a disk of radius r cells (Euclidean). */
export function dilate(mask, n, r) {
  if (!(r > 0)) return mask.slice();
  const out = new Uint8Array(mask.length);
  const offs = [];
  for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) if (dr * dr + dc * dc <= r * r) offs.push([dr, dc]);
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    if (!mask[row * n + col]) continue;
    for (const [dr, dc] of offs) {
      const rr = row + dr, cc = col + dc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n) out[rr * n + cc] = 1;
    }
  }
  return out;
}

/**
 * Depth of closed depressions [m]: priority-flood fill of the DTM from its border
 * (Barnes et al. 2014), depth = filled − original. 0 where water would drain off the site.
 */
export function depressionDepth(h, n) {
  const N = n * n, filled = new Float32Array(h), done = new Uint8Array(N);
  // binary heap of cell indices keyed by filled height
  const heap = new Int32Array(N); let size = 0;
  const less = (a, b) => filled[heap[a]] < filled[heap[b]];
  const push = (i) => { heap[size] = i; let k = size++; while (k > 0) { const p = (k - 1) >> 1; if (!less(k, p)) break; [heap[k], heap[p]] = [heap[p], heap[k]]; k = p; } };
  const pop = () => {
    const top = heap[0]; heap[0] = heap[--size]; let k = 0;
    for (;;) { const l = 2 * k + 1, r = l + 1; let m = k;
      if (l < size && less(l, m)) m = l; if (r < size && less(r, m)) m = r;
      if (m === k) break; [heap[k], heap[m]] = [heap[m], heap[k]]; k = m; }
    return top;
  };
  for (let k = 0; k < n; k++) for (const i of [k, (n - 1) * n + k, k * n, k * n + n - 1]) if (!done[i]) { done[i] = 1; push(i); }
  while (size) {
    const i = pop(), row = (i / n) | 0, col = i - row * n;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const rr = row + dr, cc = col + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const j = rr * n + cc;
      if (done[j]) continue;
      done[j] = 1;
      if (filled[j] < filled[i]) filled[j] = filled[i];
      push(j);
    }
  }
  const depth = new Float32Array(N);
  for (let i = 0; i < N; i++) depth[i] = filled[i] - h[i];
  return depth;
}

/**
 * @param {object} g  { n, cellM, heights, slopeDeg (Float32, degrees), rock (Float32 m | null),
 *                      maxSlopeDeg, maxRockReliefM, params (HAZARD_PARAMS values),
 *                      stations ([{ x, z }] world m | null), toHome (Float32 s | null), roverLimitS | null,
 *                      cellToWorld(i) → { x, z } }
 * @returns {{ cls: Uint8Array, counts: number[], depth: Float32Array }}
 */
export function hazardMap(g) {
  const { n, cellM, heights, slopeDeg, rock, maxSlopeDeg, maxRockReliefM, params } = g;
  const N = n * n;
  const wallSlope = new Uint8Array(N), wallRock = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (slopeDeg[i] > maxSlopeDeg) wallSlope[i] = 1;
    else if (rock && rock[i] > maxRockReliefM) wallRock[i] = 1;
  }
  const walls = new Uint8Array(N);
  for (let i = 0; i < N; i++) walls[i] = wallSlope[i] | wallRock[i];
  const near = dilate(walls, n, Math.round(params.obstacleBufferM / cellM));
  const depth = depressionDepth(heights, n);
  // known only from orbit: farther than unseenM from every rover ground-view position
  let seen = null;
  if (g.stations?.length) {
    seen = new Uint8Array(N);
    const r = Math.ceil(params.unseenM / cellM), half = (n - 1) * cellM / 2;
    for (const s of g.stations) {
      const c0 = Math.round((s.x + half) / cellM), r0 = Math.round((s.z + half) / cellM);
      for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
        if (dr * dr + dc * dc > r * r) continue;
        const rr = r0 + dr, cc = c0 + dc;
        if (rr >= 0 && cc >= 0 && rr < n && cc < n) seen[rr * n + cc] = 1;
      }
    }
  }
  const steep = params.steepFraction * maxSlopeDeg, rough = params.roughFraction * maxRockReliefM;
  const cls = new Uint8Array(N), counts = new Array(HAZARD_CLASSES.length).fill(0);
  for (let i = 0; i < N; i++) {
    let c = 0;
    if (wallSlope[i]) c = 1;
    else if (wallRock[i]) c = 2;
    else if (near[i]) c = 3;
    else if (depth[i] >= params.depressionM) c = 4;
    else if (slopeDeg[i] > steep) c = 5;
    else if (rock && rock[i] > rough) c = 6;
    else if (g.toHome && g.roverLimitS != null && !(g.toHome[i] <= g.roverLimitS)) c = 7;
    else if (seen && !seen[i]) c = 8;
    cls[i] = c; counts[c]++;
  }
  return { cls, counts, depth };
}

/** Hazard classes a route crosses: [{ id, name, hard, lengthM }] by length, largest first. */
export function routeHazards(path, cls, cellIndexAt) {
  const len = new Array(HAZARD_CLASSES.length).fill(0);
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
    len[cls[cellIndexAt(path[i][0], path[i][2])]] += seg;
  }
  return HAZARD_CLASSES.filter(c => c.id > 0 && len[c.id] > 0)
    .map(c => ({ id: c.id, key: c.key, name: c.name, hard: c.hard, lengthM: len[c.id] }))
    .sort((a, b) => b.lengthM - a.lengthM);
}
