/** Space-weather lookup for the EVA date, shared by the panel, the decision, the HUD and the cuff card. */
import { useEffect, useState } from 'react';
import { spaceWeatherAt, fetchSpaceWeatherLive } from '../utils/radiation';
import { SITE } from '../three/terrainGenerator';


// ---- Radiation / space weather (DONKI) for the EVA date ----
/** Space-weather events for the EVA date: bundled archive, else a live DONKI lookup (past dates only).
 *  One lookup per date (fetchSpaceWeatherLive caches), shared by the sun panel and the route decision. */
export function useSpaceWeather(startMs) {
  const [live, setLive] = useState(null);
  let wx = Number.isFinite(startMs) ? spaceWeatherAt(SITE.spaceWeather, startMs) : null;
  const needLive = !!wx && wx.advisory === 'no-data' && startMs < Date.now();
  useEffect(() => {
    setLive(null);
    if (!needLive) return undefined;
    let on = true;
    fetchSpaceWeatherLive(startMs).then(r => { if (on) setLive(r); });
    return () => { on = false; };
  }, [needLive, Math.floor((startMs || 0) / 86400e3)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (needLive && live) wx = spaceWeatherAt(live, startMs);
  return { wx, live: !!(needLive && live), future: Number.isFinite(startMs) && startMs > Date.now() };
}
