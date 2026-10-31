/**
 * Surface radiation for a Marswalk.
 *
 * Galactic cosmic rays: the only long, direct measurement on the Martian surface is
 * Curiosity's RAD at Gale crater. Jezero sits ~1.8 km higher (thinner atmosphere above
 * it), so the true dose there is likely a little higher; the app says so.
 *
 * Solar particle events (SEP) can raise the surface dose quickly; the space-weather
 * card lists DONKI events around the EVA date and recommends postponing during one.
 */

export const RADIATION = {
  gcrDoseEquivalentMSvPerDay: {
    value: 0.64,
    uncertainty: 0.12,
    status: 'sourced',
    source: 'Hassler et al. (2014), Mars\' surface radiation environment measured with the MSL Curiosity rover, Science 343, 1244797',
    url: 'https://doi.org/10.1126/science.1244797',
    note: 'Measured at Gale crater (−4.4 km) between Aug 2012 and Jun 2013. Applied to Jezero (−2.6 km) without an altitude correction.',
  },
  gcrAbsorbedMGyPerDay: {
    value: 0.21,
    uncertainty: 0.04,
    status: 'sourced',
    source: 'Hassler et al. (2014), Science 343, 1244797',
    url: 'https://doi.org/10.1126/science.1244797',
  },
  careerLimitMSv: {
    value: 600,
    status: 'sourced',
    source: 'NASA-STD-3001 Volume 1, Rev B (2022): career effective dose limit',
    url: 'https://www.nasa.gov/wp-content/uploads/2023/03/nasa-std-3001-vol-1-rev-b-with-errata.pdf',
  },
  sepWindowDays: {
    value: 2,
    status: 'design',
    note: 'An SEP event within ± this many days of the EVA start triggers a postpone advisory. Design choice.',
  },
};

/** Dose equivalent [mSv] from galactic cosmic rays for `seconds` spent outside. */
export function evaDoseMSv(seconds) {
  return RADIATION.gcrDoseEquivalentMSvPerDay.value * Math.max(0, seconds) / 86400;
}

/** Share of the career limit, 0..1. */
export function careerFraction(mSv) {
  return mSv / RADIATION.careerLimitMSv.value;
}

/**
 * Space-weather events near an EVA.
 * @param {object|null} wx  space_weather.json: { events: [{type, time, ...}] }
 * @param {number} startMs  EVA start (UTC ms)
 * @returns {{ near: object[], sep: object[], advisory: 'postpone'|'clear'|'no-data', coverage: [string,string]|null }}
 */
export function spaceWeatherAt(wx, startMs) {
  if (!wx || !Array.isArray(wx.events)) return { near: [], sep: [], advisory: 'no-data', coverage: null };
  const day = 86400e3;
  const w = RADIATION.sepWindowDays.value * day;
  const near = wx.events
    .filter(e => Math.abs(Date.parse(e.time) - startMs) <= w)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const sep = near.filter(e => e.type === 'SEP');
  const [from, to] = wx.coverage || [];
  const covered = from && to && startMs >= Date.parse(from) && startMs <= Date.parse(to) + day;
  return {
    near,
    sep,
    advisory: !covered ? 'no-data' : sep.length ? 'postpone' : 'clear',
    coverage: from && to ? [from, to] : null,
  };
}
