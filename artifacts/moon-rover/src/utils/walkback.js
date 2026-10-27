/**
 * Walk-back margin — "her an eve dönebilir miyim?"
 *
 * Ev (başlangıç/habitat) hücresinden iki tam Dijkstra:
 *   fromHome[i] : evden i hücresine en hızlı yürüme süresi [s]
 *   toHome[i]   : i hücresinden eve en hızlı yürüme süresi [s]
 * Süreler walkModel ile hesaplanır, yöne bağlıdır (yokuş ≠ iniş), bu yüzden
 * iki harita aynı değildir. Duvar hücreleri geçilmez (Infinity).
 *
 * Rota boyunca her noktada:
 *   margin = EVA bütçesi − (o ana kadar geçen süre + oradan eve en hızlı dönüş)
 * margin'in ilk negatif olduğu nokta = dönüşü olmayan nokta (point of no return).
 *
 * Saf modül: grid dizileri parametre olarak gelir; Node'da test edilebilir.
 */

import { walkTimeS } from './walkModel.js';

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

// Tipli dizilerle min-heap (anahtar = süre, değer = hücre indeksi)
class IndexHeap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  grow() {
    const k = new Float64Array(this.k.length * 2); k.set(this.k); this.k = k;
    const v = new Int32Array(this.v.length * 2); v.set(this.v); this.v = v;
  }
  push(key, val) {
    if (this.n === this.k.length) this.grow();
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() { // returns value; key in this.lastKey
    const K = this.k, V = this.v;
    const topV = V[0]; this.lastKey = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        const a = 2 * i + 1;
        if (a >= n) break;
        const b = a + 1;
        const m = b < n && K[b] < K[a] ? b : a;
        if (K[m] >= key) break;
        K[i] = K[m]; V[i] = V[m]; i = m;
      }
      K[i] = key; V[i] = val;
    }
    return topV;
  }
}

/**
 * @param {number} homeIdx  ev hücresi (row*n+col)
 * @param {Float32Array} hMap yükseklikler [m]
 * @param {Uint8Array} wall  1 = geçilmez
 * @param {number} n  grid kenar düğüm sayısı
 * @param {number} cell  düğüm aralığı [m]
 * @param {'from'|'to'} direction  'from': ev→hücre, 'to': hücre→ev
 * @param {number} [maxS=Infinity]  bu süreden uzak hücreler genişletilmez (Infinity kalır)
 */
export function dijkstraTimes(homeIdx, hMap, wall, n, cell, direction, maxS = Infinity) {
  const dist = new Float64Array(n * n).fill(Infinity);
  const done = new Uint8Array(n * n);
  const heap = new IndexHeap(1 << 16);
  const diagLen = cell * Math.SQRT2;
  const toHome = direction === 'to';
  dist[homeIdx] = 0;
  heap.push(0, homeIdx);
  while (heap.n > 0) {
    const k = heap.pop();
    if (done[k]) continue;
    done[k] = 1;
    const dk = dist[k];
    if (dk > maxS) { dist[k] = Infinity; continue; }
    const r = (k / n) | 0, c = k - r * n;
    for (let d = 0; d < 8; d++) {
      const nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
      const nk = nr * n + nc;
      if (done[nk] || wall[nk]) continue;
      const len = d < 4 ? cell : diagLen;
      // 'from': k→nk yürünür (dh = h[nk]-h[k]); 'to': nk→k yürünür (dh = h[k]-h[nk])
      const dh = toHome ? hMap[k] - hMap[nk] : hMap[nk] - hMap[k];
      const t = dk + walkTimeS(len, dh);
      if (t < dist[nk]) { dist[nk] = t; heap.push(t, nk); }
    }
  }
  return dist;
}

/** İki yönlü ev haritaları. */
export function homeTimeMaps(homeIdx, hMap, wall, n, cell) {
  return {
    homeIdx,
    fromHome: dijkstraTimes(homeIdx, hMap, wall, n, cell, 'from'),
    toHome: dijkstraTimes(homeIdx, hMap, wall, n, cell, 'to'),
  };
}

/**
 * En hızlı eve dönüş yolu (EVA iptali / abort).
 *
 * `toHome` Dijkstra haritasında her adımda, (komşuya yürüme süresi + komşunun
 * eve süresi) toplamını en aza indiren komşuya geçilir. Bu toplam tam olarak
 * toHome[c] olduğundan yolun süresi Dijkstra'nın verdiği en kısa dönüş süresine
 * eşittir — walk-back marjının varsaydığı yolun ta kendisi.
 *
 * Başlangıç hücresi duvar/ulaşılamaz ise `searchR` hücre yarıçapında eve süresi
 * sonlu olan en yakın hücreden başlanır (rota yumuşatması duvar kenarına
 * değebilir).
 *
 * @returns {{cells:number[], timeS:number}|null}  cells[0] = başlangıç (veya
 *   en yakın geçerli hücre), son = ev; ulaşılamıyorsa null
 */
export function descendToHome(startIdx, toHome, hMap, wall, n, cell, searchR = 3) {
  let k = startIdx;
  if (!Number.isFinite(toHome[k]) || (wall && wall[k])) {
    const r0 = (k / n) | 0, c0 = k - r0 * n;
    let best = -1, bestD = Infinity;
    for (let dr = -searchR; dr <= searchR; dr++) for (let dc = -searchR; dc <= searchR; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || r >= n || c < 0 || c >= n) continue;
      const kk = r * n + c;
      if ((wall && wall[kk]) || !Number.isFinite(toHome[kk])) continue;
      const d = Math.hypot(dr, dc);
      if (d < bestD) { bestD = d; best = kk; }
    }
    if (best < 0) return null;
    k = best;
  }
  const cells = [k];
  const diagLen = cell * Math.SQRT2;
  for (let guard = 0; toHome[k] > 0 && guard < n * n; guard++) {
    const r = (k / n) | 0, c = k - r * n;
    let next = -1, nextVal = Infinity;
    for (let d = 0; d < 8; d++) {
      const nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
      const nk = nr * n + nc;
      if ((wall && wall[nk]) || !Number.isFinite(toHome[nk])) continue;
      // k → nk yürünür: dh = h[nk] − h[k]
      const v = walkTimeS(d < 4 ? cell : diagLen, hMap[nk] - hMap[k]) + toHome[nk];
      if (v < nextVal) { nextVal = v; next = nk; }
    }
    if (next < 0 || !(toHome[next] < toHome[k])) break;   // olmamalı; sonsuz döngüye karşı
    cells.push(next);
    k = next;
  }
  if (toHome[k] !== 0) return null;
  return { cells, timeS: toHome[cells[0]] };
}

/**
 * Rota boyunca geri dönüş marjı.
 * @param {Array<[x,y,z]>} path  dünya koordinatlarında rota
 * @param {(x,z)=>number} heightAt
 * @param {(x,z)=>number} cellIndexAt  dünya → grid hücre indeksi
 * @param {Float64Array} toHome
 * @param {number} budgetS
 * @param {Map<number,number>} [dwellAt]  rota indeksi → o noktada bekleme [s] (bilim durağı);
 *        bekleme o noktanın geçen süresine eklenir (marj beklemeden SONRA ölçülür)
 */
export function walkbackProfile(path, heightAt, cellIndexAt, toHome, budgetS, dwellAt = null) {
  const nPts = path.length;
  const elapsed = new Float64Array(nPts);
  const margin = new Float64Array(nPts);
  let minMargin = Infinity, minIdx = 0, ponrIdx = -1;
  for (let i = 0; i < nPts; i++) {
    if (i > 0) {
      const [x0, , z0] = path[i - 1], [x1, , z1] = path[i];
      elapsed[i] = elapsed[i - 1]
        + walkTimeS(Math.hypot(x1 - x0, z1 - z0), heightAt(x1, z1) - heightAt(x0, z0));
    }
    if (dwellAt?.has(i)) elapsed[i] += dwellAt.get(i);
    const back = toHome[cellIndexAt(path[i][0], path[i][2])];
    margin[i] = budgetS - elapsed[i] - back;           // back=Infinity → -Infinity
    if (margin[i] < minMargin) { minMargin = margin[i]; minIdx = i; }
    if (ponrIdx < 0 && margin[i] < 0) ponrIdx = i;
  }
  const last = nPts - 1;
  const returnS = toHome[cellIndexAt(path[last][0], path[last][2])];
  return {
    elapsed, margin,
    minMarginS: minMargin,
    minMarginIdx: minIdx,
    ponrIdx,                              // -1 = her noktadan eve dönülebilir
    returnFromEndS: returnS,              // varıştan eve en hızlı dönüş
    roundTripS: elapsed[last] + returnS,
  };
}
