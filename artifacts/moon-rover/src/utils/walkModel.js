/**
 * Walk model — skafandrlı yürüyüş süresi (DEM modu).
 *
 * Hız, eğime ve YÖNE bağlıdır (yokuş yukarı ≠ aşağı):
 *   v(g) = v0 · exp(-3.5 · (|g + 0.05| - 0.05))        g = dh / yatay mesafe
 * Tobler (1993) hiking fonksiyonunun düz zeminde v0'a ölçeklenmiş hali.
 * v0 = NASA xEVA ConOps düz zemin yürüme hızı. Kaynak ve varsayım notları:
 * config/marswalkProfile.js. Bağımlılığı yoktur; Node'da test edilebilir.
 */

import { param } from '../config/marswalkProfile.js';

const TOBLER_K = 3.5;
const TOBLER_OFFSET = 0.05;

/** Düz zemin hızı [m/s]. */
export function levelSpeedMs() {
  return (param('levelWalkSpeedKmh') * 1000) / 3600;
}

/** Eğim (rise/run, işaretli; + = yokuş yukarı) için yürüme hızı [m/s]. */
export function walkSpeedMs(grade) {
  return levelSpeedMs() * Math.exp(-TOBLER_K * (Math.abs(grade + TOBLER_OFFSET) - TOBLER_OFFSET));
}

/** Modelin ulaşabileceği en yüksek hız [m/s] (g = -0.05'te). A* heuristic'i için. */
export function maxSpeedMs() {
  return levelSpeedMs() * Math.exp(TOBLER_K * TOBLER_OFFSET);
}

/** Yatay mesafe [m] ve yükseklik farkı [m] için yürüme süresi [s]. */
export function walkTimeS(horizM, dhM) {
  if (horizM <= 1e-9) return 0;
  return horizM / walkSpeedMs(dhM / horizM);
}

/**
 * Bir polyline ([[x,y,z],...]) boyunca, verilen yönde istatistikler.
 * Yükseklik olarak noktaların y değeri değil `heightAt(x,z)` kullanılır
 * (rota çizgisi zeminden biraz yukarı kaldırılmış olabilir).
 */
export function pathWalkStats(path, heightAt) {
  let horiz = 0, time = 0, climb = 0, descent = 0, maxGrade = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, , z0] = path[i - 1];
    const [x1, , z1] = path[i];
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (d <= 1e-9) continue;
    const dh = heightAt(x1, z1) - heightAt(x0, z0);
    horiz += d;
    time += walkTimeS(d, dh);
    if (dh > 0) climb += dh; else descent -= dh;
    maxGrade = Math.max(maxGrade, Math.abs(dh / d));
  }
  return { horizM: horiz, timeS: time, climbM: climb, descentM: descent, maxPathGrade: maxGrade };
}

/** Aynı yolu ters yönde yürümenin süresi [s] (yokuş/iniş yer değiştirir). */
export function reverseWalkTimeS(path, heightAt) {
  return pathWalkStats([...path].reverse(), heightAt).timeS;
}
