# EVA assessment — Payload & Mass · Dust Exposure & Equipment Reliability · Terrain & Mobility

*Interplanetary Survival Guide: Martian Map* · NASA Space Apps Challenge 2026 · Team PERIAPSIS

This document describes the three assessments shown under the decision of the active route. Each has its own result and explanation, and they are never merged into a single score.

## 1. Audit of the existing implementation (before this work)

| What | Where | How it worked |
|---|---|---|
| Suit mass | `config/mission.js` `SUITS` | Mars suit target 104 kg (≈ 42 kg pressure garment + ≈ 62 kg life-support backpack) and lunar xEMU 170 kg — Ogilvie et al., ICES 2026 (NTRS 20260005410) |
| Equipment | `DEFAULT_MISSION.equipmentKg`, one 0–40 kg slider | a single figure with no breakdown |
| Carry limit | `carryCheck()` | (suit + equipment) × g_Mars / g_Earth ≤ 23 kg NIOSH lift limit + 22 kg pressure offset = 45 kg Earth-equivalent; a hard constraint (NO-GO) |
| Mobility | `walkModel`, `walkback`, `pathfinder` | Tobler-shaped slope–speed curve scaled to the EVA profile's level speed (2.0 or 1.21 km/h); A* routes, Dijkstra walk-back maps, walk-back margin, point of no return |
| Load effect on speed | — | none: carried mass never changed walking speed |
| EVA duration | `param('evaDurationH')` | 8 h (lunar ConOps) or 7.5 h (Mars-conservative) |
| Dust | `dustHazardModel`, `evaPlayback` | only a user-placed dust devil that aborts the EVA playback; no equipment or exposure assessment |

Conclusions:

- The life-support mass is already inside the suit mass, so it must not be entered as payload.
- No load–speed model existed, and none was found that is validated at Mars gravity, so none was added.
- Dust had no equipment assessment.

## 2. Payload & Mass (`web/src/utils/payload.js`)

**Inputs.** Suit choice plus either one equipment figure (as before) or an itemised payload:

- scientific instruments
- communication equipment beyond the suit radio
- sampling equipment
- emergency supplies
- additional payload

The crew enters the masses. No default mass is invented: switching to itemised moves the current single figure into *additional payload*.

**Calculation.** The assessment reuses `carryCheck()`, so the limit and the formula are unchanged.

- total mass = suit mass + Σ items
- Earth-equivalent weight = total × 3.711 / 9.80665
- remaining Earth-equivalent = 45 − Earth-equivalent weight
- remaining mass = remaining Earth-equivalent × 9.80665 / 3.711

The itemised sum is written back to `equipmentKg`, so the planner and the share link carry the same total.

**No double counting.**

- The pressure garment and life-support backpack are listed as *in the suit mass* and cannot be entered.
- The suit radio and avionics are *assumed* to be in the backpack mass, which is why the communications category is "beyond the suit radio".
- Unknown keys are ignored.

**Results.**

- **WITHIN LIMIT** or **OVER LIMIT**. Over the limit, the existing carried-weight hard constraint fails, so the decision is NO-GO.
- **INSUFFICIENT DATA** for a missing, negative, non-numeric or infinite entry. The decision is then INSUFFICIENT DATA, unless a hard constraint already fails.

**No mobility penalty.** No validated physical model of walking speed against carried load at Mars gravity was found, so payload is a constraint only.

## 3. Dust Exposure & Equipment Reliability (`web/src/config/dust.js`, `web/src/utils/dust.js`)

### 3.1 Why qualitative

None of the sources below gives a validated degradation rate, failure probability or protection factor for suits or EVA equipment in Martian dust. The module therefore contains:

- no probabilities, percentages or rates (a test walks the whole result object to check this)
- no change to mass or walking speed
- no NO-GO or CONDITIONAL caused by dust

### 3.2 Sources and how they apply to Mars

| Source | Program · date | Kind | Used for | Limitations |
|---|---|---|---|---|
| Gaier, *The Effects of Lunar Dust on EVA Systems During the Apollo Missions*, NASA/TM-2005-213610 | Apollo · 2005 | lunar research, analogy | the nine dust effects; which ones simple mitigation did not solve (clogging, abrasion, heat rejection) | lunar regolith, short missions, old suits |
| Jones et al., *Artemis Suit Material Project Overview*, ICES-2025-56 | Artemis suit materials, NASA JSC · Jul 2025 | lunar research, analogy | outer layer: Ortho-Fabric "significant deficiencies in dust repellency and abrasion resistance" (lunar simulant tumbler) | lab test with lunar simulant; its numbers are not used in any calculation |
| NASA, *EVA System Maturation Team Gap List* | EVA Systems / xEMU · Jan 2020 | lunar research, analogy | dust-tolerant bearings, mechanisms and quick disconnects are open gaps; scratch-resistant visor; Martian dust properties unknown | status list, not tests; xEMU is lunar |
| Litofsky, *Dust Mitigation Technology Roadmap* Rev C | NASA JSC · 2026 | lunar research, analogy | covers, seals, connectors; "might not be directly applicable to Martian dust" | mostly lunar; no suit numbers |
| JPL, *How NASA's Perseverance Is Helping Prepare Astronauts for Mars* | Mars 2020 SHERLOC calibration target · 26 Mar 2025 | **direct Mars evidence** | spacesuit materials (visor polycarbonate, Vectran, Teflons, Ortho-Fabric) change on Mars; ~50 % of observed changes in the first 200 days | per-material results not published; mostly UV, not abrasion in an EVA |
| JPL, *NASA Mars Orbiters Reveal Seasonal Dust Storm Pattern* (Kass et al., GRL) | MRO Mars Climate Sounder · 9 Jun 2016 | **direct Mars evidence** | dusty season: southern spring and summer (Ls 180°–360°) | seasonal pattern, not a forecast |
| Edwards & Buz, *THEMIS-derived Thermal Inertia of Jezero Crater* | Mars Odyssey THEMIS · 2021 | **direct Mars evidence** (orbital) | dust-mantled ground: thermal inertia < 150 | 100 m pixels; Jezero only |
| Wang et al., *Potential Health Impacts … of Martian Dust*, GeoHealth | peer-reviewed review · Feb 2025 | **direct Mars evidence** (composition) | why dust carried inside matters (perchlorates, silica, fine grains) | health, not equipment |
| MARS-V, Gobi Desert (press coverage, Oct 2025) | Mongolian NGO analog station | **Mars analog** | reviewed, **not used**: no results published | Earth analog |
| This project's rules | — | project assumption | turning the evidence into classes | team judgement |

**xEMU.** The xEMU is NASA's exploration suit developed for Artemis lunar surface EVAs. It is not a Mars-certified suit. Its dust work is used here as an engineering reference only.

### 3.3 Configuration (Mission setup → Dust protection)

Every setting is a category. *Not specified* is the default and is reported as missing.

| Setting | Options | Covers |
|---|---|---|
| Suit outer layer | Ortho-Fabric (EMU baseline) · new EPG material (in development) · not specified | joints |
| Joint & bearing protection | dust-tolerant bearings · standard · not specified | bearings |
| Equipment dust protection | instruments enclosed / sealed · exposed · not specified | sampling instruments |
| Protective covers | covers on connectors, optics, mechanisms · none · not specified | connectors, optics, rover interfaces, mechanisms |

A protection is shown as *protected — not validated for Martian dust*. **It never lowers a vulnerability class**, because no protection has been validated against Martian dust.

### 3.4 Component assessment and classification rules

The classification rules are:

- **High:** a failure mechanism that Apollo reported as not solved by simple mitigation (clogging, abrasion, seal failure) **and** that is still an open NASA gap.
- **Moderate:** a mechanism Apollo reported, but where the part is meant to touch dust, or the effect can be seen and dealt with in the field.
- **Low:** none of the seven groups qualifies on the evidence found.

| Component | Mechanism | Class | Evidence | Confidence |
|---|---|---|---|---|
| Spacesuit joints (soft goods) | abrasion where the fabric flexes; dust through the layers | high | Gaier 2005, Jones 2025, JPL 2025 | low — lunar simulant; Mars exposure is mostly UV |
| Bearings & mechanical interfaces | regolith in bearing races | high | Gaier 2005, EVA gap list 2020, Litofsky 2026 | low |
| External connectors & quick disconnects | dust on mating faces and seals | high | Gaier 2005, EVA gap list 2020, Litofsky 2026 | low |
| Sampling instruments & tools | coating; clogged hinges and container seals | moderate | Gaier 2005 | low |
| Cameras & optical surfaces (incl. visor) | reduced visibility; scratching | moderate | Gaier 2005, EVA gap list 2020, JPL 2025 | low |
| Rover interfaces | dust carried into hatches, seals, umbilicals | high | Gaier 2005, Litofsky 2026, Wang 2025 | low |
| Exposed moving mechanisms | jammed valves, latches, actuators | high | Gaier 2005, EVA gap list 2020 | low |

Each component in the app also lists its operational precautions, for example:

- inspect the outer layer after the EVA
- keep caps on until mating
- clean suits before ingress

### 3.5 Exposure factors

| Factor | Rule | Source |
|---|---|---|
| Season | the EVA date's Ls is in 180°–360° | Kass et al. 2016 |
| Dust-mantled ground | share of route points with thermal inertia < 150 (Jezero); *missing* where there is no thermal layer (Gale) | Edwards & Buz 2021 |
| Regolith contact | number of sampling stops | Gaier 2005 |

The exposure level is a label, not a number:

- **elevated** if the season or the ground factor is present
- **baseline** otherwise
- **unknown** without an EVA date

### 3.6 Warnings

The warnings are generated by fixed rules:

- an **unprotected** component gives its own warning, for example "Exposed mechanical interfaces may be vulnerable to regolith intrusion", "Optical surfaces may require additional protection" or "Unprotected joints may require inspection or maintenance"
- a **protected** component gives a note that its protection is not validated for Martian dust
- an **unknown** setting is listed as missing, with the components it leaves unassessed
- the **dusty season** gives a seasonal warning that says it is not a forecast
- **always:** "Dust exposure information is insufficient to quantify degradation."

The dust result is **WARNINGS**, or **INSUFFICIENT DATA** when a protection setting is not specified. In the decision it is a note and never changes the status.

## 4. Terrain & Mobility (`web/src/utils/mobility.js`)

A view of figures the planner already computed. Nothing is recalculated:

| Item | From |
|---|---|
| Terrain slope | max slope vs limit (hard constraint), share steeper than 15° |
| Surface roughness | rock-relief layer along the route |
| Rock obstacles | hazard classes on the route (walls, obstacle buffer) |
| Craters / closed depressions | depression class on the route |
| Walking distance | distance walked, farthest from start vs limit |
| Walking duration | walk + stops vs EVA budget |
| Return safety | walk-back margin, point of no return, 30-min reserve |
| Rover walk-back | rover mode only |
| Suit mobility | the EVA profile's level speed and its source (lunar ConOps, or Norcross et al. 2009 for Mars-conservative) |
| Equipment-related mobility | none applied: no validated model |

The results are:

- **FAIL** when a slope, distance, duration, return or rover rule fails
- **CAUTION** for an obstacle edge, depression or reserve condition
- **INSUFFICIENT DATA** when a core item cannot be evaluated
- **PASS** otherwise

The Mars-conservative speed factor (×1.65, Norcross et al. 2009) is the only validated mobility parameter. It applies to every walking time, outbound and on the way back. A real-data test at Jezero checks that both scale by the same factor.

## 5. Integration with the decision

| Situation | Decision |
|---|---|
| Payload over the limit | NO-GO (existing carried-weight rule) |
| Payload entry missing / invalid | INSUFFICIENT DATA |
| Terrain rule fails | NO-GO, unchanged |
| Depression / obstacle edge / reserve | CONDITIONAL, unchanged |
| Dust warnings, any number | note only — GO stays GO, NO-GO stays NO-GO |
| Dust settings not specified | note only, listed as missing in the dust result |

Changing dust settings, or the split of a payload with the same total, does not re-plan the route, because only planner inputs trigger a re-plan. The JSON export includes the three assessments.

## 6. Tests

| File | Checks |
|---|---|
| `payload.test.mjs` | total = suit + items, same as `carryCheck`; 45 kg limit unchanged; suit parts never added; unknown keys ignored; remaining capacity; missing / invalid → INSUFFICIENT DATA |
| `dust.test.mjs` | seven components, ≥ 2 classes, each with mechanism, rationale, warning, evidence; lunar / analog / Mars sources classified; MARS-V not used; xEMU never Mars-certified; no probability / percentage / rate fields; protection never lowers a class; no duplicate warnings; unknown settings, date and layer reported; dusty season and dust-mantled ground |
| `mobility.test.mjs` | items from the planner and decision, no penalties; FAIL / CAUTION / INSUFFICIENT DATA; dust never changes the decision; NO-GO stays NO-GO; assessments independent; over-limit payload NO-GO; invalid payload INSUFFICIENT DATA; hard constraints unchanged |
| `realMobility.test.mjs` | real Jezero route: identical path and walking times with 0 kg and 40 kg + dust settings, only the carry check changes; Mars speed factor applies outbound and on the return |
| `shareLink.test.mjs` (new test) | payload items and dust settings survive the link; bad values dropped |

## 7. Limitations

- Dust is qualitative. A quantitative model needs validated Martian-dust test data for suit materials, bearings, seals and connectors, which was not found.
- Most dust evidence is lunar. The Perseverance samples are Mars data, but their per-material results are not yet published.
- Dust-mantled ground is known only at Jezero, at 100 m resolution, and a thin coating does not show.
- The dusty season is a seasonal pattern; no dust forecast is used.
- Payload does not slow the walk because no validated load–speed model was found. A heavy load at the limit may still cost more energy in reality.
- The suit radio is assumed to be inside the life-support mass.
