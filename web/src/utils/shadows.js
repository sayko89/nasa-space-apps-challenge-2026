/**
 * Arazi gölgeleri — DEM üzerinde güneşe doğru ışın izleme (horizon test).
 *
 * Bir nokta gölgededir ⇔ güneş yönünde ilerlerken arazi, noktadan güneşe
 * çizilen ışının üstüne çıkar. Işın yüksekliği: h0 + d·tan(el).
 * Arama mesafesi alandaki en yüksek noktaya kadar sınırlıdır:
 *   dmax = (hmax − h0) / tan(el)
 * Güneş ufkun altındaysa (el ≤ 0) her yer karanlık sayılır.
 *
 * Sınırlama: yalnızca site grid'i içindeki arazi gölge düşürür; grid dışındaki
 * yüksekler (ör. ~20 km uzaktaki Jezero krater duvarı) alçak güneşte gölge
 * yapabilir ama modellenmez.
 *
 * Saf modül; Node'da test edilebilir.
 */

const D2R = Math.PI / 180;

/**
 * Grid düğümü (col,row) için gölge testi. hmax: alandaki en yüksek değer.
 *
 * Işın sabit adımla değil, grid çizgilerini kestiği her noktada örneklenir
 * (DDA). Arazi bilinear olduğundan grid çizgileri boyunca düğümler arasında
 * doğrusaldır; tepeler ve ince sırtlar bu kesişimlerde yakalanır. Sabit adımlı
 * örnekleme, tepeyi ıskalayıp gölgeyi kısa gösteriyordu (test: duvar gölgesi).
 */
function shadowedNode(h, n, cell, col, row, dx, dz, tanEl, hmax) {
  const h0 = h[row * n + col];
  const dmax = (hmax - h0) / tanEl;                 // metre
  if (dmax <= 0) return false;
  const tEnd = dmax / cell;                         // hücre birimi
  const stepU = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepV = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaU = stepU ? 1 / Math.abs(dx) : Infinity;
  const tDeltaV = stepV ? 1 / Math.abs(dz) : Infinity;
  let tMaxU = tDeltaU, tMaxV = tDeltaV;             // başlangıç tam düğümde → ilk kesişim bir hücre ötede
  const tanCell = tanEl * cell;
  while (true) {
    const t = Math.min(tMaxU, tMaxV);
    if (t > tEnd) return false;
    if (tMaxU <= tMaxV) tMaxU += tDeltaU; else tMaxV += tDeltaV;
    const u = col + dx * t, v = row + dz * t;
    if (u < 0 || v < 0 || u > n - 1 || v > n - 1) return false;   // grid dışı → bilinmiyor, aydınlık say
    const c0 = Math.min(n - 2, Math.floor(u + 1e-9)), r0 = Math.min(n - 2, Math.floor(v + 1e-9));
    const fu = Math.min(1, Math.max(0, u - c0)), fv = Math.min(1, Math.max(0, v - r0));
    const i = r0 * n + c0;
    const ht = (h[i] * (1 - fu) + h[i + 1] * fu) * (1 - fv) + (h[i + n] * (1 - fu) + h[i + n + 1] * fu) * fv;
    if (ht > h0 + t * tanCell) return true;
  }
}

function maxOf(h) { let m = -Infinity; for (let i = 0; i < h.length; i++) if (h[i] > m) m = h[i]; return m; }

/**
 * Tüm grid için gölge maskesi (1 = gölge veya gece).
 * @param {Float32Array} h  yükseklikler, satır 0 = kuzey (z artışı = güney)
 */
export function shadowMask(h, n, cell, azimuthDeg, elevationDeg) {
  const mask = new Uint8Array(n * n);
  if (elevationDeg <= 0) { mask.fill(1); return mask; }
  const az = azimuthDeg * D2R;
  const dx = Math.sin(az), dz = -Math.cos(az);            // güneşe doğru yatay yön (x doğu, z güney)
  const tanEl = Math.tan(elevationDeg * D2R);
  const hmax = maxOf(h);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (shadowedNode(h, n, cell, c, r, dx, dz, tanEl, hmax)) mask[r * n + c] = 1;
  }
  return mask;
}

/**
 * Tek nokta için gölge testi (rota örneklemesi). Dünya koordinatı → grid.
 * @param {number} half  alanın yarı genişliği (dünya x/z: -half…+half)
 */
export function isShadowedAt(h, n, cell, half, x, z, azimuthDeg, elevationDeg, hmax) {
  if (elevationDeg <= 0) return true;
  const az = azimuthDeg * D2R;
  const col = (x + half) / cell, row = (z + half) / cell;
  const c = Math.max(0, Math.min(n - 1, Math.round(col)));
  const r = Math.max(0, Math.min(n - 1, Math.round(row)));
  return shadowedNode(h, n, cell, c, r, Math.sin(az), -Math.cos(az), Math.tan(elevationDeg * D2R), hmax ?? maxOf(h));
}

export { maxOf as heightMax };
