<p align="center">
  <a href="https://sayko89.github.io/nasa-space-apps-challenge-2026/"><img src="docs/img/banner.svg" alt="Martian Map — Interplanetary Survival Guide, NASA Space Apps Challenge 2026" width="100%"></a>
</p>

<p align="center">
  <a href="https://sayko89.github.io/nasa-space-apps-challenge-2026/"><img src="https://img.shields.io/badge/live_demo-open_in_browser-f4a261?style=for-the-badge&labelColor=1c0f0b" alt="Live demo"></a>
  <img src="https://img.shields.io/badge/NASA_Space_Apps-2026-fcd9bd?style=for-the-badge&labelColor=1c0f0b" alt="NASA Space Apps Challenge 2026">
  <img src="https://img.shields.io/badge/challenge-Martian_Map-e76f51?style=for-the-badge&labelColor=1c0f0b" alt="Interplanetary Survival Guide: Martian Map">
  <a href="https://github.com/sayko89/nasa-space-apps-challenge-2026/actions/workflows/deploy-pages.yml"><img src="https://img.shields.io/github/actions/workflow/status/sayko89/nasa-space-apps-challenge-2026/deploy-pages.yml?style=for-the-badge&labelColor=1c0f0b&label=tests%20%2B%20deploy" alt="Tests and deploy"></a>
</p>

<p align="center"><b>Team PERIAPSIS</b> · NASA Space Apps Challenge 2026 · <i>Interplanetary Survival Guide: Martian Map</i></p>

---

The first people to walk on Mars will want the best map possible. **Martian Map** is that map for one real place: the floor of **Jezero crater** around the Perseverance landing site. It layers data from **four NASA Mars missions** into a single 3D view, plans a two-person **Marswalk** that visits the most interesting rocks and minerals, proves at every step that the crew can still walk home (or back to their rover), and then plays the whole EVA out on a mission clock.

> **Why another Mars map?** Tools like JPL's Mars Trek and the USGS–NASA geologic maps layer data over the whole planet, at regional scale. An astronaut on a single Marswalk needs the opposite: one 2 km × 2 km area, every layer on the same **4 m grid**, rocks picked out at **1 m**, and a plan that says *where to walk, what to sample, and when to turn back*. Martian Map is built for that hyperlocal scale.

![EV1 samples a geology stop while EV2 documents it; the HUD shows the mission clock, the walk-back margin and the radiation dose](docs/img/hero.jpg)

## Try it

| | |
|---|---|
| **Online** | **[sayko89.github.io/nasa-space-apps-challenge-2026](https://sayko89.github.io/nasa-space-apps-challenge-2026/)** — nothing to install |
| **Offline** | **Code → Download ZIP** → unzip → `MartianMap/Start-Windows.bat` (Windows) or `MartianMap/start-mac-linux.sh` (macOS / Linux). Needs only Python 3. |
| **From source** | `pnpm install`, then `pnpm dev` (tests: `pnpm test`) |

**Two sites** — switch at the top left:

| Site | Rover | Science objective |
|---|---|---|
| **Jezero crater** (default) | Perseverance | Bedrock and surface units, contacts and CRISM minerals on the crater floor Perseverance landed on |
| **Mount Sharp boxwork, Gale crater** (`?site=gale`) | Curiosity | Boxwork ridges and hollows, the contacts of the boxwork-bearing layer — the layer Curiosity explored from May 2025 to March 2026 — and re-sampling rocks whose ChemCam chemistry stands out |

![Mount Sharp boxwork site: the HiRISE orbital image draped on the 1 m-derived terrain, with the planned science EVA — stops S2 to S6 on the boxwork-bearing layer, dunes in the foreground, Mount Sharp's layered buttes behind](docs/img/gale-hirise.jpg)

The second site came out of the same pipeline: the site centre is picked from Curiosity's own boxwork-campaign track, and the grid, rock relief, units and ground views are built from it. That is the challenge's "tool or system that generates maps of different locations".

**Quick tour:** set the suit, equipment and rover in **Mission setup** → **PLAN SCIENCE EVA** → open **ground view** on a stop to see it through the rover's own cameras → pick a route (SAFE / ECO / FAST / AUTO) and read its GO / NO-GO card → **PRINT CUFF CARD** for the one-page wrist card → **START EVA** (×1 … ×600, **ABORT EVA**, **SIMULATE DUST DEVIL**) → **Map Layers → DRAPE ON 3D TERRAIN** for minerals, thermal inertia, rocks, geology or slope.

## How it answers the challenge

| The challenge asks for… | In Martian Map |
|---|---|
| A layered, integrated view of a location or route, from **multiple NASA science missions** | One 2 km × 2 km site at 4 m resolution; every layer is resampled onto the same grid: **MRO** (HiRISE terrain, CRISM minerals), **Mars Odyssey** (THEMIS thermal inertia), **Mars 2020** (geology map, MEDA air temperature, Navcam / Mastcam-Z images, rover traverse), **Curiosity** (RAD radiation) |
| **At least three kinds of data** | **Topographic** (HiRISE DTM, rock relief), **thermal** (THEMIS), **spectral** (CRISM), **geologic** (Mars 2020 map), **atmospheric** (MEDA at Jezero, REMS at Gale), **radiation** (RAD + DONKI space weather), **optical** (HiRISE orbital image, Navcam, Mastcam-Z), **chemical** (ChemCam, Gale site) |
| Identify a **science objective** and a location | Sample as many distinct bedrock and surface units, contacts and **CRISM minerals** (olivine, olivine–smectite, pyroxene on this site) as an 8-hour EVA allows, on the crater floor Perseverance landed on |
| **Astronaut safety first**; space weather, radiation | A **dose-rate comparison** — Earth 0.0066, ISS 0.73, Moon 1.37, Mars 0.64 mSv/day, measured — so the crew sees why Mars is different; a **Mars-conservative EVA limit set** (slower walk, 30-min reserve, shorter radius); per-route **GCR dose** vs the 600 mSv NASA career limit, a **DONKI space-weather advisory** (solar particle event within ±2 days → postpone), walk-back margin and point of no return, sunset and terrain shadow, expected air temperature |
| Spacesuits and **carried equipment** affect mobility | **Mission setup**: Mars suit (104 kg) or lunar xEMU (170 kg) plus equipment; the carried weight on Mars must stay under NASA's 45 kg Earth-equivalent limit, or the plan is NO-GO |
| A **route map** that **avoids obstacles such as large rocks** | A* on walking time; slopes above 20° and **rock outcrops / boulders** found in the 1 m HiRISE DTM are walls |
| **Rovers** to transport the crew; astronauts **in pairs** | **Pressurized rover as safe haven**: the crew may never be more than a 30-minute walk from it; a two-person crew (EV1 + EV2) walks the plan |
| **Point-of-view images** so the astronaut knows what to expect | **Ground view** on every science stop: the Perseverance Navcam / Mastcam-Z frames taken from the rover position closest to it, facing the stop |
| A format crews could use: habitat display, tablet, **HUD** | Planning view for the habitat, an EVA **HUD** with mission clock, live walk-back margin, distance home, sun, temperature and dose, and a printable **cuff card** for the wrist |
| A map that can be a **static snapshot**; **inspiration from maps made for other destinations** | The **cuff card**: one printed page per EVA — photo map of the route plus a station table with arrival, stay, walk-back and *leave-by* times — modelled on the Apollo 15–17 cuff checklists and traverse planning data (see [Inspiration](#inspiration-apollo-cuff-checklists)) |
| A time frame | Pick any date and local solar time: sun, shadows, temperature climatology and DONKI events follow it |

## The layers — all real data

| Layer | Data type | Mission / source | Used for |
|---|---|---|---|
| Terrain, 4 m grid over 2 km | topographic | MRO HiRISE — USGS Mars 2020 TRN DTM mosaic | slope walls, walking time, shadows |
| Rock relief | topographic | same DTM at 1 m: relief left in each 4 m cell after removing its slope | boulders / outcrops become walls; route card |
| Thermal inertia | thermal | Mars Odyssey THEMIS — Edwards & Buz (2021) | ground type along the route (dust, sand, rock) |
| Dominant minerals | spectral | MRO CRISM — Parente et al. (2021) | science stops (one per mineral), map layer |
| Surface + bedrock units | geologic | Mars 2020 science-team photogeologic map — Stack et al. (2020) | science stops, map layer |
| Air temperature at 1.45 m *(Jezero)* | atmospheric | Perseverance MEDA, one Mars year — Hueso et al. (2024) | temperature at the time the crew walks |
| Air temperature at 1.6 m *(Gale)* | atmospheric | Curiosity REMS (MODRDR ambient air temperature, PDS), the latest full Mars year: sols 4175–4843, which include the whole boxwork campaign — 20.5 million 1 Hz readings reduced to 5-min means | same, per season (10° of Ls) and time of day |
| Surface radiation | radiation | Curiosity RAD — Hassler et al. (2014): 0.64 mSv/day | EVA dose, HUD |
| Dose rate elsewhere | radiation | Earth background 2.4 mSv/yr (UNSCEAR 2000); ISS 0.73 and Moon surface 1.37 mSv/day (Zhang et al. 2020, Chang'e 4) | comparison bars in the sun & radiation panel; each EVA's dose also as days of Earth background |
| Space weather | radiation | NASA DONKI (looked up live for the EVA date): solar particle events, CMEs modelled to reach Mars, X-class flares | go / postpone advisory for the date |
| Rock chemistry *(Gale site)* | chemical | Curiosity ChemCam LIBS major oxides (PDS, sols 4511–4843): 233 targets in the site, each placed from the rover position + laser pointing and range | "re-sample" stops at rocks that stand out from their layer; chemistry card at stops |
| Orbital image, 0.5 m/px | optical | MRO HiRISE orthomosaics (25 cm) — USGS Mars 2020 TRN mosaic (Jezero), MSL Gale merged mosaic (Gale); warped onto the site grid, aligned with the terrain to ≤ 1 m | **HiRISE** terrain mode (default) and the map base |
| Ground-level images | optical | Perseverance raw-image feed: 947 near-horizontal Navcam / Mastcam-Z frames from 97 rover positions in the site, with pointing | ground view at stops |
| Sun, local solar time | — | Mars24 algorithm (NASA GISS) | light, shadow, darkness, mission clock |
| EVA limits | — | NASA xEVA System ConOps: 20° slope, ~2 km/h, ≤ 8 h, ≤ 2 km | walls, speed, budget, radius |
| Suit mass, carry limit, rover walkback | — | NASA Mars suit study — Ogilvie et al. (ICES 2026) | mission setup, GO checks |

![CRISM minerals draped on the terrain: olivine in red, olivine + smectite in pink, high-Ca pyroxene in brown; the route card lists radiation dose, ground type and minerals crossed](docs/img/minerals.jpg)

![Mission setup: Mars suit (104 kg) with 10 kg of equipment, 43 kg Earth-equivalent against the 45 kg limit; the pressurized rover parked at the start keeps the crew within a 30-minute walk](docs/img/mission.jpg)

## How a Marswalk is planned

1. **Science stops.** Candidates are the nearest interior point of every geologic unit pair, every bedrock contact and every CRISM mineral within reach. Where rover chemistry exists (Gale), up to two more: the nearest rock for each kind of chemical standout — an oxide more than 2× ChemCam's accuracy away from its layer's mean (e.g. *MgO low*, *CaO high*) — so the crew re-samples what Curiosity flagged. Pairwise walking times come from Dijkstra; an exact subset DP (Held–Karp) picks the set and order of stops that samples the most distinct units and minerals while walking + time at stops fits the 8 h budget (and the rover's 30-minute reach, if used).
2. **Routes.** A* on walking time: Tobler's slope–speed shape scaled to NASA's ~2 km/h level pace; cells steeper than 20° or with more than 0.5 m of rock relief are walls. Four route preferences (SAFE, ECO, FAST, AUTO); times always use the same physical model.
3. **Walk-back margin.** At every point: *margin = budget − (time so far + fastest walk home)*. The first point with a negative margin is the **point of no return**.
4. **GO / NO-GO.** GO only if the margin never goes negative, the crew never goes beyond 2 km (or a 30-minute walk from the rover), no slope is above 20° and the suit plus equipment is light enough to carry.
5. **Conditions.** For the moment the crew actually walks each point: sun elevation, terrain shadow, darkness, home before sunset or not, expected air temperature, radiation dose and space-weather events.

## Inspiration: Apollo cuff checklists

On the Moon, Apollo crews did not carry a screen. They wore a small spiral-bound checklist on the wrist, about 18 × 9 cm, its pages turnable in pressurised gloves, and travelled — on foot or by lunar rover — to stations planned on photo maps. The Apollo 17 traverse planning data gave, for every station, the time to spend there (Station 2: 0+50, Station 3: 0+45 …) and the walk back to the lunar module if the rover failed, with a 30-minute life-support reserve on top.

Martian Map prints the same thing for the planned Marswalk. **PRINT CUFF CARD** on the active route opens one A4 page (Print → Save as PDF):

- a **grayscale HiRISE photo map** of the route with numbered stations, direction chevrons, a north arrow, a scale bar and a grid measured from the habitat;
- a **station table** in Apollo's *h+mm* mission-elapsed-time notation: arrival, stay, leg and bearing, local solar time, expected air temperature, **BACK** (the fastest walk home from the station) and **LEAVE BY** — the latest time to leave the station and still be home inside the 8-hour budget. That last column is the one a crew checks on the wrist: if it is later than LEAVE BY, skip the next station and walk home;
- the **turn-back rules** and the EVA summary (distance, climb, minimum margin, dose, temperature range).

Every number on the card is the planner's own: the same timeline the GO / NO-GO decision and the EVA playback use (`web/src/utils/cuffCard.js`, unit tested).

![The cuff card for the Mount Sharp boxwork EVA: HiRISE photo map with six stations and the station table with leave-by times](docs/img/cuff-card.jpg)

## How it is carried out — EVA playback

- Two astronauts walk the plan on a mission clock (×1 … ×600). Positions come from the planner's own timeline, so what you see is exactly what the GO decision was based on.
- At each stop EV1 kneels and samples while EV2 documents; a flag marks every sampled stop.
- The HUD shows mission elapsed time, the current activity, the **live walk-back margin**, distance from the habitat, the sun, the site's air temperature (MEDA or REMS) and the **radiation dose so far**.
- **ABORT EVA** sends the crew home on the fastest path; a **dust devil** on the route within the next 10 minutes of walking triggers an automatic abort.

![A dust devil on the route ahead triggers an abort; the crew walks home on the fastest path (dashed)](docs/img/abort.jpg)

## Verified, not just drawn

`node --test web/tests/*.test.mjs` and `python -m unittest discover pipeline/tests`, run on every push before the demo is deployed:

- **Sun:** USGS reference values, 60 random epochs against `marstime`, an independent vector check and the MEDA team's sunset table (largest difference 0.25 min over 700 sols).
- **Terrain & routes:** shadow length = height / tan(sun elevation); A* reaches the Dijkstra optimum in every mode; the walk-back maps equal A* times both ways.
- **Data:** `climate.json` and `geology.json` match independent recomputations from the original files.
- **Planning & playback:** the stop optimiser equals brute force on 40 random cases; mineral stops are found and scored; the playback timeline equals the planner's round trip; the abort path time equals the Dijkstra return time.
- **Safety numbers:** GCR dose scaling, the SEP advisory window, the suit carry limit (Mars suit passes, xEMU fails) and the rover drive estimate.

## Honest limits

- **EVA limits.** NASA's published EVA limits are lunar (xEVA ConOps: 2 km/h, 8 h, 2 km). NASA's suited walking test found the metabolic cost at Mars gravity "too high to be acceptable" (Norcross et al. 2009, TP-2009-214796), so these are optimistic for Mars. **Mission setup → EVA limits → Mars conservative** derives a stricter set from sourced numbers:
  - *walking speed* 1.21 km/h — the lunar 2 km/h divided by 1.65, the suited oxygen-cost ratio Mars/Moon at the slowest test stage (27.6 vs 16.7 ml/min/kg, Table 5), on the assumption that cost grows in proportion to speed (labelled *assumption*);
  - *planning budget* 7.5 h — the 8 h suit budget minus the 30-minute life-support reserve Apollo 17 kept on every walk-back;
  - *radius* 1.2 km — keeps the lunar 1-hour walk-back at the slower pace.

  The slope limit (20°) is unchanged: no Mars-specific value was found. The effect is large: the same 8-stop Jezero plan goes from 4 h 45 min to 6 h 06 min (81 % of the budget) and its tightest walk-back margin from 3 h 15 min to 1 h 23 min — still GO. The test suit (120 kg MKIII) is heavier than the 104 kg Mars-suit target, so the 1.65 factor may overstate the cost for a lighter suit.
- **Dose comparison.** All four rates are measured, but in different parts of the solar cycle: the Moon value is from 2019 (solar minimum, cosmic rays at their strongest), the Mars value from 2012–13 (near solar maximum). Part of the Moon–Mars gap is that timing. The Earth value is the total natural background, not only cosmic rays.
- The RAD dose rate was measured at Gale crater, about 1.8 km lower than Jezero; with less atmosphere above it, the real dose at Jezero is likely a little higher.
- How slope changes suited walking speed is an assumption (Tobler shape). Time per stop, science-score weights, the 0.5 m rock-relief limit, the ±2-day SEP window and the 10 km/h rover speed are design choices, labelled as such in the app.
- A 1 m DTM shows rocks of a few metres, not smaller ones. Jezero's landing area was chosen for being smooth, so on this site only a handful of cells exceed the 0.5 m rock-relief limit; the layer matters more on rougher terrain. CRISM mineral names are the closest match of each spectral class. Thermal-inertia classes are guidance.
- Temperatures are a one-Mars-year climatology, not a forecast. DONKI covers past dates and is queried live from api.nasa.gov with the public demo key (rate-limited); for a future EVA, or when the lookup fails, the advisory says there is no data.
- **Gale site.** There is no published GIS geologic map of this part of Mount Sharp. The units are derived and say so: *stratigraphic level* is the elevation band Curiosity crossed during the boxwork campaign (−3655 to −3595 m; the rover was always below it before sol 4541 and always above it after leaving the boxwork), on the assumption that the layers here are close to horizontal — the lateral edges of the boxwork terrain are not modelled. *Terrain class* (ridge, hollow, smooth, steep) is relief against a 15 m background in the 2016 merged DEM, which does not resolve the individual boxwork ridges (a few metres wide). The terrain is steep (about a quarter of cells over 20°) and DEM noise raises the rock-relief layer, so routes are more constrained than at Jezero. No THEMIS or CRISM layer yet; RAD and REMS were measured in this crater, so dose and air temperature need no transfer.
- **Gale air temperature.** The climatology is one Mars year (sols 4175–4843) of REMS's own estimate of ambient air temperature, kept only where REMS flags the reading reliable. On a few sols the sensor drops to −115…−120 °C around sunset, which no flag catches; a robust screen against the other sols of the same season and time removes them (76 of 75,703 five-minute means). Curiosity drove up to a few kilometres during that year, so this is the local climate of lower Mount Sharp rather than of one spot. Gale nights are on average 8 °C warmer than Jezero's (from 3 °C colder to 18 °C warmer depending on the season): Gale is 1.8 km lower, under a thicker atmosphere, and closer to the equator.
- **Chemistry.** ChemCam analyses a spot a few millimetres wide on the surface of a rock, at 2–3 m from the mast; its accuracy (RMSEP) is a few wt% for the major oxides, shown on every bar. Target positions come from the rover position and the laser pointing (mast offset ignored, about a metre). As a check, 229 of the 233 targets fall in the stratigraphic level their sol predicts. Jezero has no chemistry layer: SuperCam and PIXL compositions are not yet published as a table in the PDS.
- The orbital image is shown at 0.5 m/px (the mosaics are 25 cm) to keep the download near 4 MB per site; it is a single moment in time, with the lighting of that HiRISE pass baked in.
- Ground-view frame directions are mast azimuth + rover heading, accurate to a few degrees. Only the metadata is stored; the images load from mars.nasa.gov.

## Data & credits

- USGS Astrogeology (2020). *Mars 2020 Terrain Relative Navigation HiRISE DTM Mosaic.* [doi:10.5066/P9REJ9JN](https://doi.org/10.5066/P9REJ9JN)
- Edwards, C. S. & Buz, J. (2021). *THEMIS-derived Thermal Inertia of Jezero Crater, Mars.* Zenodo. [doi:10.5281/zenodo.4931348](https://doi.org/10.5281/zenodo.4931348) (CC BY 4.0)
- Parente, M., Saranathan, A. M., Itoh, Y., Tarnas, J. D., Seelos, F. P., Mustard, J. F. (2021). *Map of the dominant mineralogy over and around the Mars2020 landing ellipse.* Zenodo. [doi:10.5281/zenodo.5575824](https://doi.org/10.5281/zenodo.5575824) (CC BY 4.0)
- Stack, K. M., et al. (2020). *Photogeologic map of the Perseverance rover field site in Jezero crater.* Space Sci. Rev. 216, 127. [doi:10.1007/s11214-020-00739-x](https://doi.org/10.1007/s11214-020-00739-x) (CC BY 4.0)
- Hueso, R., et al. (2024). *Derived environmental temperatures at Jezero crater from the Perseverance Air Temperature Sensors* (v2). Zenodo. [doi:10.5281/zenodo.11198655](https://doi.org/10.5281/zenodo.11198655) (CC BY 4.0)
- Zhang, S., Wimmer-Schweingruber, R. F., et al. (2020). First measurements of the radiation dose on the lunar surface. *Science Advances* 6, eaaz1334. [doi:10.1126/sciadv.aaz1334](https://doi.org/10.1126/sciadv.aaz1334) · UNSCEAR (2000), *Sources and Effects of Ionizing Radiation* — 2.4 mSv/year natural background. [UN press release](https://press.un.org/en/2000/20000606.ga9718.doc.html)
- Hassler, D. M., et al. (2014). *Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover.* Science 343, 1244797. [doi:10.1126/science.1244797](https://doi.org/10.1126/science.1244797)
- NASA Community Coordinated Modeling Center. *DONKI — Space Weather Database Of Notifications, Knowledge, Information.* [kauai.ccmc.gsfc.nasa.gov/DONKI](https://kauai.ccmc.gsfc.nasa.gov/DONKI/)
- NASA/JPL-Caltech. Mars 2020 Perseverance raw images (Navcam, Mastcam-Z) and rover waypoints (MMGIS).
- USGS Astrogeology (2020). *Mars 2020 Terrain Relative Navigation HiRISE Orthorectified Image Mosaic.* [doi:10.5066/P9QJDP48](https://doi.org/10.5066/P9QJDP48)
- Calef III, F. J. & Parker, T. (2016). *MSL Gale Merged Orthophoto Mosaic 25cm*, v3. PDS Annex, USGS. [astrogeology.usgs.gov](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- Parker, T. & Calef III, F. J. (2016). *MSL Gale Merged DEM 1m*, v3. PDS Annex, USGS. [astrogeology.usgs.gov](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m)
- NASA Manned Spacecraft Center (1972). *Apollo 17 Traverse Planning Data*, 3rd ed.; Apollo Lunar Surface Journal. [nasa.gov](https://www.nasa.gov/wp-content/uploads/static/history/alsj/a17/A17TraversePlanningData.pdf) · Cuff checklist, EVA 2 & 3, Apollo 16, Smithsonian National Air and Space Museum. [Google Arts & Culture](https://artsandculture.google.com/asset/cuff-checklist-eva-2-3-apollo-16-young/0wHa5HswXSXP3Q)
- Gómez-Elvira, J., et al. (2012). REMS: The Environmental Sensor Suite for the Mars Science Laboratory Rover. *Space Sci. Rev.* 170, 583–640. Data: REMS MODRDR, NASA PDS Atmospheres Node (mslrem_1001).
- Wiens, R. C., Maurice, S., et al. *MSL ChemCam LIBS derived data (RDR), major-oxide compositions*, PDS Geosciences Node (Release 42, 2026); calibration: Clegg, S. M., et al. (2017), Spectrochim. Acta B 129, 64–85.
- NASA/JPL-Caltech/MSSS. Mars Science Laboratory Curiosity raw images (Navcam, Mastcam) and rover waypoints (MMGIS); boxwork campaign dates from the NASA Curiosity mission blog.
- Ogilvie, R., et al. (2026). *Mars Spacesuit Mass Requirements.* ICES-2026. [NASA NTRS 20260005410](https://ntrs.nasa.gov/citations/20260005410)
- NASA-STD-3001 Volume 1, Rev B (2022): career effective dose limit 600 mSv.
- Allison, M. & McEwen, M. (2000). Mars24 algorithm, NASA GISS. NASA EVA-EXP-0042 Rev B (2020), *Exploration EVA System ConOps*. NASA (2020), *EVA Lunar Surface ConOps*. Norcross, J., et al. (2009), NASA/TP-2009-214796. Tobler, W. (1993), NCGIA TR 93-1.

## Use of AI

Developed with AI assistance (Anthropic Claude) for code, data pipelines, tests and documentation, under the team's direction and review. All data come from the sources above. The astronauts, dust devil and other 3D objects are original procedural models written in code; no AI-generated images are used.

## Repository map

```
web/     the web app (React + Three.js / react-three-fiber, Vite)
  src/utils/              walkModel · pathfinder (A*) · walkback (Dijkstra) · science (stop optimiser)
                          radiation · marsTime (Mars24) · shadows · climate · evaTimeline + evaPlayback
  src/config/             marswalkProfile (EVA limits) · mission (suit, equipment, rover)
  src/components/         MoonScene (3D) · MarsCrew · EvaHud · RightPanel · PovViewer (ground view)
  public/sites/jezero/    grid.bin · ortho (HiRISE) · geology · climate · layers (THEMIS, CRISM, rocks) · pov
  public/sites/gale/      grid.bin · ortho (HiRISE) · climate (REMS) · geology (derived) · layers (rocks) · chemistry (ChemCam) · pov (Curiosity)
  tests/                  node --test suites
pipeline/                 fetch_sources · fetch_gale · fetch_chemistry · fetch_rems · build_site · build_ortho · build_layers · build_space_weather
                          build_pov · build_climate · build_geology · build_gale_geology · build_chemistry · build_climate_rems
                          build_offline
MartianMap/               ready-to-run offline package
```

`?site=moon` still opens the original procedural Moon rover simulator this project grew from (TUA Astro Hackathon).

## Rebuilding the data

The processed data are committed, so the app runs as is. Sources are fetched by GitHub Actions (`.github/workflows/fetch-sources.yml`, `fetch-dtm.yml`, `fetch-gale.yml`, `fetch-gale-pov.yml`, `fetch-chemistry.yml`, `fetch-ortho.yml` — which also builds the HiRISE textures — and `fetch-rems.yml`) into `pipeline/sources/`; then:

```bash
pip install -r pipeline/requirements.txt
python pipeline/build_layers.py         # THEMIS, CRISM, rock relief → layers.json
python pipeline/build_layers.py --site gale && python pipeline/build_gale_geology.py
python pipeline/build_chemistry.py      # ChemCam targets → sites/gale/chemistry.json
python pipeline/build_climate_rems.py   # REMS 5-min means → sites/gale/climate.json
python pipeline/build_space_weather.py  # DONKI → space_weather.json
python pipeline/build_offline.py        # refresh MartianMap/app
```

## License

MIT for the code. Data keep their own licenses (CC BY 4.0 or public domain, listed above).
