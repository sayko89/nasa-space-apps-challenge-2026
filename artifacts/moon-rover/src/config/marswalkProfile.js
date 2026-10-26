/**
 * Marswalk (astronot EVA) parametreleri — tek doğruluk noktası.
 *
 * Her değer bir kaynağa bağlanmalı: { value, source, status }.
 *   status: 'sourced'      → NASA/ajans dokümanından alındı, `source` alıntıyla dolu
 *           'placeholder'  → GEÇİCİ. Kaynak bağlanana kadar sunumda kullanılmamalı.
 *
 * Aşama 3'te (fiziksel maliyet modeli) yürüme hızı, sarf malzemesi bütçesi vb.
 * buraya eklenecek ve placeholder'lar kaynaklı değerlerle değiştirilecek.
 */

export const MARSWALK_PROFILE = {
  maxWalkableSlopeDeg: {
    value: 25,
    unit: 'deg',
    status: 'placeholder',
    source: null,
    note: 'Bu eşiğin üstündeki DEM hücreleri geçilmez duvar sayılır. '
        + 'NASA EVA kaynağı Aşama 3\'te bağlanacak.',
  },
};

/** Bir parametrenin sayısal değeri (UI ve modeller bunu kullanır). */
export function param(key) {
  return MARSWALK_PROFILE[key].value;
}

/** Kaynağı bağlanmamış parametrelerin listesi (HUD uyarısı için). */
export function placeholderParams() {
  return Object.entries(MARSWALK_PROFILE)
    .filter(([, p]) => p.status !== 'sourced')
    .map(([k]) => k);
}
