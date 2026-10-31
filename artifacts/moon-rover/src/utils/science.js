/**
 * Bilim durakları + EVA optimizasyonu (Aşama 6).
 *
 * Girdi: geology.json (pipeline/build_geology.py; Stack et al. 2020 haritası,
 * site gridine rasterleştirilmiş yüzey + ana kaya birimleri).
 *
 * 1) Aday duraklar (candidateStops)
 *    - Her (yüzey, ana kaya) birim çifti için: birimin İÇİNDE (çevresindeki
 *      (2r+1)² hücrenin hepsi aynı çift) ve evden gidiş+dönüşü en kısa hücre
 *      → "en yakın temsilci mostra".
 *    - Her ana kaya kontağı (iki farklı ana kaya biriminin komşu olduğu hücre)
 *      için en yakın kontak hücresi.
 *    - Elenir: duvar, ulaşılamaz, radyal sınır dışı, tek başına bütçeye sığmayan.
 * 2) Değer: durakların örneklediği FARKLI etiketlerin ağırlıklı toplamı
 *    (B:ana kaya birimi, S:yüzey birimi, C:kontak). Aynı birimi ikinci kez
 *    görmek değer katmaz (çeşitlilik). Ağırlıklar tasarım tercihidir.
 * 3) Optimizasyon (optimizeTour): ev → durak alt kümesi (sıralı) → ev,
 *    toplam (yürüme + durak süresi) ≤ bütçe. Alt küme DP'si (Held–Karp) ile
 *    KESİN çözüm (k ≤ 14 aday). Eşit değerde en kısa toplam süre seçilir.
 *    Tur eve döndüğü için toplam ≤ bütçe ⇒ her noktada walk-back marjı ≥ 0
 *    (kalan tur süresi ≥ en hızlı dönüş).
 *
 * Saf modül: grid dizileri parametre olarak gelir; Node'da test edilir.
 */

import { dijkstraTimes } from './walkback.js';

export const MAX_EXACT_STOPS = 14;

export { decodeRle, decodeGeology } from '../terrain/geology.js';

/** Tags a stop at cell i samples: bedrock (B:), surface (S:) and, with a CRISM layer, mineral (M:). */
function cellTags(geo, i, min) {
  const t = [];
  const b = geo.bedrockUnits[geo.bedrock[i]], s = geo.surfaceUnits[geo.surface[i]];
  if (b) t.push('B:' + b);
  if (s) t.push('S:' + s);
  const m = min && min.code[i] ? min.classes[min.code[i]] : null;
  if (m) t.push('M:' + m);
  return t;
}

/** Whole (2r+1)² neighbourhood shows the same CRISM mineral (any confidence)? */
function isMineralInterior(min, n, i, r) {
  const row = (i / n) | 0, col = i - row * n, m = min.code[i];
  if (!m || row < r || col < r || row >= n - r || col >= n - r) return false;
  for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) if (min.code[i + dr * n + dc] !== m) return false;
  return true;
}

/** (2r+1)² komşuluğun tamamı aynı birim çiftinde mi? */
function isInterior(geo, i, r) {
  const n = geo.n, row = (i / n) | 0, col = i - row * n;
  if (row < r || col < r || row >= n - r || col >= n - r) return false;
  const s = geo.surface[i], b = geo.bedrock[i];
  for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
    const k = i + dr * n + dc;
    if (geo.surface[k] !== s || geo.bedrock[k] !== b) return false;
  }
  return true;
}

/**
 * @param {object} geo      decodeGeology çıktısı
 * @param {object} home     { homeIdx, fromHome, toHome }
 * @param {object} o        { cellM, wall, budgetS, dwellS, maxRadialM, interiorR=2, minHomeDistM=0, maxCandidates=12,
 *                            minerals? (CRISM layer: { code, classes }) — adds one candidate per detected mineral,
 *                            maxReturnS? — only cells this close (walking time) to home, e.g. the rover's 30 min }
 * @returns {Array<{id,idx,row,col,kind,tags,label,rtS}>}
 */
export function candidateStops(geo, home, o) {
  const n = geo.n, N = n * n;
  const { cellM, wall, budgetS, dwellS, maxRadialM } = o;
  const r = o.interiorR ?? 2, maxC = Math.min(o.maxCandidates ?? 12, MAX_EXACT_STOPS);
  const minHomeCells = (o.minHomeDistM ?? 0) / cellM;
  const hr = (home.homeIdx / n) | 0, hc = home.homeIdx - hr * n;
  const best = new Map();              // anahtar → { idx, rt }
  const consider = (key, i, rt, kind, extra) => {
    const cur = best.get(key);
    if (!cur || rt < cur.rt) best.set(key, { idx: i, rt, kind, ...extra });
  };
  for (let i = 0; i < N; i++) {
    if (wall && wall[i]) continue;
    const rt = home.fromHome[i] + home.toHome[i];
    if (!Number.isFinite(rt) || rt + dwellS > budgetS) continue;
    if (o.maxReturnS != null && home.toHome[i] > o.maxReturnS) continue;   // rover safe haven: stay within reach
    const row = (i / n) | 0, col = i - row * n;
    const dHome = Math.hypot(row - hr, col - hc);
    if (dHome * cellM > maxRadialM || dHome < minHomeCells) continue;
    if (geo.bedrock[i] || geo.surface[i]) {
      if (isInterior(geo, i, r)) consider(`U:${geo.surface[i]}:${geo.bedrock[i]}`, i, rt, 'unit');
    }
    if (o.minerals && isMineralInterior(o.minerals, n, i, 1)) consider(`M:${o.minerals.code[i]}`, i, rt, 'mineral');
    // Ana kaya kontağı: sağ veya alt komşu farklı (ikisi de haritalı) ana kaya birimi
    const b = geo.bedrock[i];
    if (b) for (const k of [col + 1 < n ? i + 1 : -1, row + 1 < n ? i + n : -1]) {
      const b2 = k >= 0 ? geo.bedrock[k] : 0;
      if (b2 && b2 !== b && !(wall && wall[k])) {
        const [lo, hi] = b < b2 ? [b, b2] : [b2, b];
        consider(`C:${lo}:${hi}`, i, rt, 'contact', { pair: [lo, hi] });
      }
    }
  }
  const list = [...best.values()].sort((a, b) => a.rt - b.rt).slice(0, maxC);
  return list.map((c, j) => {
    const row = (c.idx / n) | 0, col = c.idx - row * n;
    let tags = cellTags(geo, c.idx, o.minerals), label;
    if (c.kind === 'contact') {
      const [a, b] = c.pair.map(k => geo.bedrockUnits[k]);
      tags = ['B:' + a, 'B:' + b, `C:${a} | ${b}`];
      label = `Contact: ${a} / ${b}`;
    } else if (c.kind === 'mineral') {
      const unit = tags.filter(t => t[0] === 'B' || t[0] === 'S').reverse().map(t => t.slice(2)).join(' on ');
      label = `${tags.find(t => t[0] === 'M').slice(2)} (CRISM)${unit ? ' — ' + unit : ''}`;
    } else {
      label = [...tags].reverse().map(t => t.slice(2)).join(' on ') || 'Unmapped';
    }
    return { id: j, idx: c.idx, row, col, kind: c.kind, tags, label, rtS: c.rt };
  });
}

/** Tag weight by prefix: B bedrock, S surface, M mineral (CRISM), C contact. */
function tagWeight(tag, w) {
  return tag[0] === 'B' ? w.bedrock : tag[0] === 'S' ? w.surface : tag[0] === 'M' ? (w.mineral ?? 2) : w.contact;
}

/** Farklı etiketler kümesinin puanı. */
export function tagScore(tags, w) {
  return [...new Set(tags)].reduce((a, t) => a + tagWeight(t, w), 0);
}

/**
 * Kesin orienteering (alt küme DP'si).
 * @param {number[][]} T   (k+1)×(k+1) yürüme süreleri [s]; 0 = ev, i = durak i−1
 * @param {Array<{tags:string[]}>} stops
 * @param {object} o  { budgetS, dwellS, weights:{bedrock,surface,contact} }
 * @returns {{ order:number[], score:number, totalS:number, walkS:number, dwellTotalS:number, tags:string[] }}
 */
export function optimizeTour(T, stops, o) {
  const k = stops.length;
  if (k > MAX_EXACT_STOPS) throw new Error(`at most ${MAX_EXACT_STOPS} candidates`);
  const { budgetS, dwellS, weights } = o;
  // Etiketleri bit'lere çevir
  const tagIds = new Map();
  const stopBits = stops.map(s => s.tags.reduce((m, t) => {
    if (!tagIds.has(t)) tagIds.set(t, tagIds.size);
    return m | (1 << tagIds.get(t));
  }, 0));
  if (tagIds.size > 30) throw new Error('too many distinct tags');
  const tagW = [...tagIds.keys()].map(t => tagWeight(t, weights));
  const scoreOfBits = (bits) => { let s = 0; for (let t = 0; t < tagW.length; t++) if (bits >> t & 1) s += tagW[t]; return s; };

  // Budama için eve dönüşün alt sınırı: herhangi bir duraktan eve en kısa süre.
  // (Gerçek Dijkstra sürelerinde üçgen eşitsizliği tutar ve T[q][0] de olurdu;
  // genel matrislerde de doğru kalsın diye en gevşek sınır.)
  let minHome = Infinity;
  for (let j = 0; j < k; j++) minHome = Math.min(minHome, T[j + 1][0]);
  const M = 1 << k;
  const dp = new Float64Array(M * k).fill(Infinity);   // dp[mask*k + j]: ev → mask (j'de biter)
  const par = new Int8Array(M * k).fill(-1);
  for (let j = 0; j < k; j++) dp[(1 << j) * k + j] = T[0][j + 1] + dwellS;
  let best = { mask: 0, last: -1, score: 0, totalS: 0 };
  for (let mask = 1; mask < M; mask++) {
    let bits = 0;
    for (let j = 0; j < k; j++) if (mask >> j & 1) bits |= stopBits[j];
    const score = scoreOfBits(bits);
    for (let j = 0; j < k; j++) {
      const t = dp[mask * k + j];
      if (!(t < Infinity)) continue;
      const total = t + T[j + 1][0];
      if (total <= budgetS && (score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && total < best.totalS))) {
        best = { mask, last: j, score, totalS: total };
      }
      // genişlet
      for (let q = 0; q < k; q++) {
        if (mask >> q & 1) continue;
        const nt = t + T[j + 1][q + 1] + dwellS;
        if (nt + minHome > budgetS) continue;              // bütçe kesin aşılıyorsa genişletme
        const nm = mask | (1 << q);
        if (nt < dp[nm * k + q]) { dp[nm * k + q] = nt; par[nm * k + q] = j; }
      }
    }
  }
  const order = [];
  for (let mask = best.mask, j = best.last; j >= 0;) {
    order.push(j);
    const p = par[mask * k + j];
    mask &= ~(1 << j); j = p;
  }
  order.reverse();
  const dwellTotalS = order.length * dwellS;
  const tags = [...tagIds.keys()].filter((_, t) => order.reduce((m, j) => m | stopBits[j], 0) >> t & 1);
  return { order, score: best.score, totalS: best.totalS, walkS: best.totalS - dwellTotalS, dwellTotalS, tags };
}

/**
 * Uçtan uca: adaylar + ikili süre matrisi + optimum tur.
 * Her adaydan 'from' Dijkstra (bütçeyle kesilmiş); ev için mevcut haritalar.
 */
export function planScienceEva(geo, home, hMap, wall, o) {
  const n = geo.n;
  const cands = candidateStops(geo, home, { ...o, wall });
  const k = cands.length;
  const T = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(Infinity));
  T[0][0] = 0;
  for (let j = 0; j < k; j++) { T[0][j + 1] = home.fromHome[cands[j].idx]; T[j + 1][0] = home.toHome[cands[j].idx]; }
  for (let i = 0; i < k; i++) {
    const d = dijkstraTimes(cands[i].idx, hMap, wall, n, o.cellM, 'from', o.budgetS);
    for (let j = 0; j < k; j++) T[i + 1][j + 1] = i === j ? 0 : d[cands[j].idx];
  }
  const tour = optimizeTour(T, cands, o);
  return { candidates: cands, T, tour, stops: tour.order.map(j => cands[j]) };
}
