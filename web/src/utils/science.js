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
 * 4) Mission objective (o.filter, config/objectives.js): which candidates may exist and what
 *    they are worth. With no filter the planner behaves exactly as before.
 *      units      'all' | 'none' | { surface?: [names], bedrock?: [names] } — unit-pair candidates
 *      contacts   true | false                                              — contact candidates
 *      minerals   null (all) | [CRISM class names]                          — mineral candidates / M: tags
 *      chemTags   null (all) | [ChemCam anomaly tags, e.g. 'CaO high']      — re-sample candidates
 *      targets    0 | k — up to k measured ChemCam targets (any chemistry) as candidates, tag T:<name>
 *    Tags that are filtered out are not scored, so the objective steers the Held–Karp
 *    optimiser through the candidate set and the weights, not through a separate algorithm.
 *
 * Saf modül: grid dizileri parametre olarak gelir; Node'da test edilir.
 */

import { dijkstraTimes } from './walkback.js';

export const MAX_EXACT_STOPS = 14;

export { decodeRle, decodeGeology } from '../terrain/geology.js';

/** Does the objective filter let this CRISM class / unit pair / anomaly tag count? */
const mineralAllowed = (f, name) => !f || f.minerals == null || f.minerals.includes(name);
const chemAllowed = (f, tag) => !f || f.chemTags == null || f.chemTags.includes(tag);
function unitAllowed(f, surfaceName, bedrockName) {
  const u = f?.units ?? 'all';
  if (u === 'all') return true;
  if (u === 'none') return false;
  return (!u.surface || u.surface.includes(surfaceName)) && (!u.bedrock || u.bedrock.includes(bedrockName));
}

/** Tags a stop at cell i samples: bedrock (B:), surface (S:) and, with a CRISM layer, mineral (M:). */
function cellTags(geo, i, min, filter = null) {
  const t = [];
  const b = geo.bedrockUnits[geo.bedrock[i]], s = geo.surfaceUnits[geo.surface[i]];
  if (b) t.push('B:' + b);
  if (s) t.push('S:' + s);
  const m = min && min.code[i] ? min.classes[min.code[i]] : null;
  if (m && mineralAllowed(filter, m)) t.push('M:' + m);
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
 *                            maxReturnS? — only cells this close (walking time) to home, e.g. the rover's 30 min,
 *                            chemCells? Map(cellIdx → [{tag, name, sol, diff}]) — rocks whose measured chemistry
 *                            stands out (ChemCam); one "re-sample" candidate per distinct tag, at most
 *                            maxChemCandidates (2), added after the unit candidates }
 * @returns {Array<{id,idx,row,col,kind,tags,label,rtS}>}
 */
export function candidateStops(geo, home, o) {
  const n = geo.n, N = n * n;
  const { cellM, wall, budgetS, dwellS, maxRadialM } = o;
  const f = o.filter || null;
  const wantContacts = f?.contacts ?? true;
  const bestTarget = new Map();        // 'T:<name>' → nearest measured ChemCam target (re-investigation)
  const r = o.interiorR ?? 2, maxC = Math.min(o.maxCandidates ?? 12, MAX_EXACT_STOPS);
  const minHomeCells = (o.minHomeDistM ?? 0) / cellM;
  const hr = (home.homeIdx / n) | 0, hc = home.homeIdx - hr * n;
  const best = new Map();              // anahtar → { idx, rt }
  const bestChem = new Map();          // 'X:<oxide high|low>' → nearest measured rock with that anomaly
  const consider = (key, i, rt, kind, extra, map = best) => {
    const cur = map.get(key);
    if (!cur || rt < cur.rt) map.set(key, { idx: i, rt, kind, ...extra });
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
      if (unitAllowed(f, geo.surfaceUnits[geo.surface[i]], geo.bedrockUnits[geo.bedrock[i]]) && isInterior(geo, i, r)) {
        consider(`U:${geo.surface[i]}:${geo.bedrock[i]}`, i, rt, 'unit');
      }
    }
    if (o.minerals && isMineralInterior(o.minerals, n, i, 1) && mineralAllowed(f, o.minerals.classes[o.minerals.code[i]])) {
      consider(`M:${o.minerals.code[i]}`, i, rt, 'mineral');
    }
    const chem = o.chemCells?.get(i);
    if (chem) for (const a of chem) if (chemAllowed(f, a.tag)) consider(`X:${a.tag}`, i, rt, 'chemistry', { chem: a }, bestChem);
    const tgt = f?.targets ? o.targetCells?.get(i) : null;
    if (tgt) for (const t of tgt) consider(`T:${t.name}`, i, rt, 'target', { target: t }, bestTarget);
    // Ana kaya kontağı: sağ veya alt komşu farklı (ikisi de haritalı) ana kaya birimi
    const b = wantContacts ? geo.bedrock[i] : 0;
    if (b) for (const k of [col + 1 < n ? i + 1 : -1, row + 1 < n ? i + n : -1]) {
      const b2 = k >= 0 ? geo.bedrock[k] : 0;
      if (b2 && b2 !== b && !(wall && wall[k])) {
        const [lo, hi] = b < b2 ? [b, b2] : [b2, b];
        consider(`C:${lo}:${hi}`, i, rt, 'contact', { pair: [lo, hi] });
      }
    }
  }
  const list = [...best.values()].sort((a, b) => a.rt - b.rt).slice(0, maxC);
  const maxX = Math.min(f?.maxChem ?? o.maxChemCandidates ?? 2, MAX_EXACT_STOPS - list.length);
  if (maxX > 0) list.push(...[...bestChem.values()].sort((a, b) => a.rt - b.rt).slice(0, maxX));
  const maxT = Math.min(f?.targets ?? 0, MAX_EXACT_STOPS - list.length);
  if (maxT > 0) list.push(...[...bestTarget.values()].sort((a, b) => a.rt - b.rt).slice(0, maxT));
  return list.map((c, j) => {
    const row = (c.idx / n) | 0, col = c.idx - row * n;
    let tags = cellTags(geo, c.idx, o.minerals, f), label;
    if (c.kind === 'contact') {
      const [a, b] = c.pair.map(k => geo.bedrockUnits[k]);
      tags = ['B:' + a, 'B:' + b, `C:${a} | ${b}`];
      label = `Contact: ${a} / ${b}`;
    } else if (c.kind === 'chemistry') {
      const a = c.chem;
      tags = [...tags, 'X:' + a.tag];
      label = `Re-sample ${a.name} — ChemCam ${a.tag} (${a.diff > 0 ? '+' : ''}${a.diff.toFixed(1)} wt%, sol ${a.sol})`;
    } else if (c.kind === 'target') {
      const t = c.target;
      tags = [...tags, 'T:' + t.name];
      label = `Re-investigate ${t.name} — ChemCam target (sol ${t.sol})`;
    } else if (c.kind === 'mineral') {
      const unit = tags.filter(t => t[0] === 'B' || t[0] === 'S').reverse().map(t => t.slice(2)).join(' on ');
      label = `${tags.find(t => t[0] === 'M').slice(2)} (CRISM)${unit ? ' — ' + unit : ''}`;
    } else {
      label = [...tags].reverse().map(t => t.slice(2)).join(' on ') || 'Unmapped';
    }
    const out = { id: j, idx: c.idx, row, col, kind: c.kind, tags, label, rtS: c.rt };
    if (c.chem) out.chem = c.chem;
    if (c.target) out.target = c.target;
    return out;
  });
}

/** Tag weight by prefix: B bedrock, S surface, M mineral (CRISM), X measured chemistry (ChemCam),
 *  T measured ChemCam target, C contact. An optional per-unit table (w.surfaceUnits / w.bedrockUnits:
 *  { name: weight }) overrides the bedrock / surface weight for named units. */
export function tagWeight(tag, w) {
  const p = tag[0], name = tag.slice(2);
  if (p === 'B') return w.bedrockUnits?.[name] ?? w.bedrock;
  if (p === 'S') return w.surfaceUnits?.[name] ?? w.surface;
  return p === 'M' ? (w.mineral ?? 2) : p === 'X' ? (w.chemistry ?? 2) : p === 'T' ? (w.target ?? 0) : w.contact;
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
  let cands = candidateStops(geo, home, { ...o, wall });
  // A candidate that adds nothing to the objective's score is not a stop for this objective
  if (o.filter) cands = cands.filter(c => c.tags.some(t => tagWeight(t, o.weights) > 0)).map((c, j) => ({ ...c, id: j }));
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
