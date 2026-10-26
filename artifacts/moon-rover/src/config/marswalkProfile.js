/**
 * Marswalk (astronot EVA) parametreleri — tek doğruluk noktası.
 *
 * Her değer: { value, unit, status, source, quote?, note? }
 *   status: 'sourced'     → NASA dokümanından; `source` + `quote` dolu
 *           'assumption'  → kaynaklı bir modelin bu probleme uyarlanması;
 *                           `note` neyin varsayıldığını açıkça söyler
 *           'design'      → planlama tercihi (fiziksel iddia değil)
 *           'placeholder' → GEÇİCİ, sunumda kullanılmamalı
 *
 * ÖNEMLİ KISIT: Bulunabilen NASA EVA operasyon değerleri AY için yazılmış
 * (xEVA ConOps). Mars'a özgü resmi bir eğim/hız/mesafe limiti bulunamadı.
 * NASA'nın skafandrlı yürüme testi Mars yerçekiminde (3/8 g) geri yürüyüşü
 * kabul edilemez bulduğu için (TP-2009-214796) bu değerler Mars için
 * İYİMSER kabul edilmeli. Bkz. MARS_CAVEAT.
 */

const XEVA = 'NASA EVA-EXP-0042 Rev B, Exploration EVA System Concept of Operations (2020)';
const XEVA_URL = 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf';

export const MARSWALK_PROFILE = {
  maxWalkableSlopeDeg: {
    value: 20,
    unit: 'deg',
    status: 'sourced',
    source: `${XEVA} §4.2.1.3`,
    url: XEVA_URL,
    quote: 'Walking up/down/across a slope of up to 20°',
    note: 'Ay ConOps değeri. Bu eğimin üstündeki DEM hücreleri geçilmez duvar.',
  },
  levelWalkSpeedKmh: {
    value: 2.0,
    unit: 'km/h',
    status: 'sourced',
    source: `${XEVA} §4.2.1.3.1.1`,
    url: XEVA_URL,
    quote: 'Traverses assume an ~2 km/hr walking pace over relatively level regolith',
    note: 'Dokümanda TBR (to be resolved) olarak işaretli.',
  },
  evaDurationH: {
    value: 8,
    unit: 'h',
    status: 'sourced',
    source: `${XEVA} §4.1.4`,
    url: XEVA_URL,
    quote: 'The xEVA suit will support EVAs of up to 8 hours in duration (6±2 hours).',
    note: 'Planlama bütçesi. Ek 1 saatlik yedek O₂ (§4.2.1.1) yalnızca acil durum içindir, plana dahil edilmez.',
  },
  maxRadialDistanceKm: {
    value: 2,
    unit: 'km',
    status: 'sourced',
    source: `${XEVA} §4.2.1.3.1`,
    url: XEVA_URL,
    quote: 'a walking traverse of up to 2 km away from the lander on the lunar surface (radial distance)',
  },
  slopeSpeedModel: {
    value: 'tobler',
    unit: null,
    status: 'assumption',
    source: 'Tobler, W. (1993). Three presentations on geographical analysis and modeling. NCGIA Technical Report 93-1.',
    note: 'Eğimin hıza etkisi için NASA verisi bulunamadı. Tobler hiking fonksiyonu '
        + '(Dünya, skafandrsız yürüyüş) yalnızca ŞEKİL olarak kullanılır: '
        + 'v(g) = v0 · exp(-3.5·|g + 0.05|) / exp(-3.5·0.05), düz zeminde v0 = levelWalkSpeedKmh.',
  },
};

/**
 * Rota modlarının tercih ağırlıkları — fiziksel iddia DEĞİL, planlama tercihi.
 * Raporlanan süreler her modda aynı fiziksel modelle (Tobler+NASA hız) hesaplanır;
 * bu ağırlıklar yalnızca hangi yolun seçileceğini etkiler.
 *   slopeAversion: hücre süresi × (1 + k·(eğim/limit)²)  — dik zeminden uzak dur
 *   climbPenaltyS: her metre tırmanış için ek ceza [s]    — az tırmanış
 */
export const MODE_WEIGHTS = {
  FAST: { slopeAversion: 0,   climbPenaltyS: 0,  status: 'design', desc: 'En kısa yürüme süresi' },
  SAFE: { slopeAversion: 4,   climbPenaltyS: 0,  status: 'design', desc: 'Eğim sınırından en uzak yol' },
  ECO:  { slopeAversion: 0.5, climbPenaltyS: 60, status: 'design', desc: 'En az tırmanış (enerji/ısı yükü)' },
  AUTO: { slopeAversion: 1.5, climbPenaltyS: 20, status: 'design', desc: 'Dengeli' },
};

export const MARS_CAVEAT = {
  source: 'Norcross et al., NASA/TP-2009-214796, Feasibility of Performing a Suited 10-km Ambulation on the Moon',
  url: 'https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf',
  note: 'MKIII skafandrıyla 10 km geri yürüyüş Ay yerçekiminde yapılabilir bulundu; '
      + 'Mars yerçekiminde (3/8 g) kabul edilemez — denekler tempolu yürürken neredeyse maksimum eforla çalıştı. '
      + 'Ay ConOps değerleri Mars için iyimserdir.',
};

/** Bir parametrenin sayısal değeri (UI ve modeller bunu kullanır). */
export function param(key) {
  return MARSWALK_PROFILE[key].value;
}

/** Kaynağı bağlanmamış (placeholder) parametreler — HUD uyarısı için. */
export function placeholderParams() {
  return Object.entries(MARSWALK_PROFILE)
    .filter(([, p]) => p.status === 'placeholder')
    .map(([k]) => k);
}

/** Varsayım olarak işaretli parametreler — HUD'da ayrı gösterilir. */
export function assumptionParams() {
  return Object.entries(MARSWALK_PROFILE)
    .filter(([, p]) => p.status === 'assumption')
    .map(([k]) => k);
}
