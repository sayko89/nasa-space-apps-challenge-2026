/**
 * Shared display formatters (English UI).
 */

/** 3720 → "1 h 02 min"; under an hour → "42 min". */
export function fmtHM(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.round(Math.abs(sec) / 60);
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h} h ${String(mm).padStart(2, '0')} min` : `${mm} min`;
}

/** Signed version for margins: −1 h 05 min. */
export function fmtSignedHM(sec) {
  if (!Number.isFinite(sec)) return '—';
  return (sec < 0 ? '−' : '') + fmtHM(sec);
}

/** Mission clock: 3725 → "01:02:05". */
export function fmtClock(sec) {
  if (!Number.isFinite(sec)) return '--:--:--';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Hours of day → "HH:MM". */
export function fmtHourMin(h) {
  if (!Number.isFinite(h)) return '--:--';
  const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Metres → "640 m" / "1.24 km". */
export function fmtDist(m) {
  if (!Number.isFinite(m)) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
