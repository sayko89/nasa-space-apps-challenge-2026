# Oxygen consumption & carried mass

*Interplanetary Survival Guide: Martian Map* · NASA Space Apps Challenge 2026 · Team PERIAPSIS

Code:

- `web/src/config/oxygen.js` (values and sources)
- `web/src/utils/oxygen.js` (model)
- `web/src/utils/evaPlayback.js` (live tracking)
- `web/src/components/OxygenPanel.jsx` (setup and HUD)

## 1. Audit (before this work)

| Looked for | Found |
|---|---|
| Oxygen tank capacity, oxygen consumption | **none** |
| Metabolic model | none. Walking speed comes from a Tobler-shaped slope–speed curve; the only metabolic figure is the Mars/Moon suited cost ratio 1.65 (Norcross et al. 2009), used to slow the Mars-conservative walk |
| Suit mass | `config/mission.js`: 104 kg Mars target (≈ 42 kg garment + ≈ 62 kg life-support backpack), 170 kg xEMU — Ogilvie et al., ICES 2026; consumables are not split out |
| Carry limit | `carryCheck()`: 45 kg Earth-equivalent (Mars weight of suit + equipment); unchanged |
| EVA time | planner `elapsedS`, walk-back margin, point of no return; playback on **mission time** (`EvaPlayback.t`): pause stops it, the speed multiplier scales it, abort switches to the fastest-return timeline |
| Reserve | 30-min walk-back reserve from the Apollo 17 traverse planning data (environment condition) |

Oxygen is therefore tracked on the existing mission clock. The existing mass, limit, walk-back and decision code is reused and not duplicated.

## 2. NASA reference values

NASA *Life Support Baseline Values and Assumptions Document* (BVAD), NASA/TP-2015-218570/REV2, Feb 2022, §4.6.2. The figures are for a 4-hour Mars surface sortie:

| Scenario in the app | BVAD architecture | Per 4-h sortie | Rate |
|---|---|---:|---:|
| Closed-loop reference | completely closed-loop PLSS: metabolic O₂ and leakage only | 0.3 kg | **0.076 kg/h** |
| Swing-bed CO₂ removal | swing bed venting CO₂ and water to the Martian atmosphere; extra O₂ lost as sweep gas | 0.6 kg | **0.15 kg/h** |
| Cryogenic O₂ for cooling | cryogenic O₂ used for thermal control and breathing | 4.0 kg | **1.0 kg/h** |

Also in BVAD, used here only for context:

- **Table 4-70** gives a typical EVA metabolic O₂ consumption of 0.086 kg per crew-member hour at 1.062 MJ/h (RQ 0.90).
- **Table 4-71** gives suited metabolic rates, for example Apollo lunar surface EVA 517 / 1030 / 2607 kJ/h (minimum / average / maximum).
- **Table 4-69** gives lunar O₂ losses including leakage of 0.069 / 0.092 / 0.110 kg/h (low / nominal / high).

These are **architecture references, not interchangeable rates and not the specification of a Mars suit.** The default scenario is the swing bed, the architecture of BVAD's xEMU suitport example. It is still a reference.

## 3. Model

- O₂ consumed(t) = ∫ rate dt over a piecewise-constant rate history. The scenario can be changed during an EVA; the new rate applies from that mission time, and the past is not re-priced.
- O₂ remaining(t) = max(0, O₂ initial − O₂ consumed(t))
- Reserve % = remaining / initial
- Remaining duration = remaining / rate
- O₂ to walk home = rate × fastest walk home from the current position (the walk-back time the planner and the abort use)
- Return feasible = remaining ≥ O₂ to walk home
- Reserve kept = remaining ≥ O₂ to walk home + rate × reserve

**Measured, sourced or simulated?** The rates are **sourced** reference values, and the elapsed time is **simulated** (the planned or played-back EVA). Nothing is measured.

**Activity link.** It was investigated and is not implemented. BVAD relates O₂ to metabolic rate only through typical values (Table 4-70) and ranges (Table 4-71). This planner has no metabolic rate per activity (walking, sampling, resting), so scaling O₂ with activity would need numbers that cannot be sourced for each segment. The rate is constant within a scenario and labelled an approximation.

**Initial oxygen.** No published Mars-suit oxygen capacity was found. The crew can enter one (0.05–20 kg). If left empty, it is **sized** to the suit's design EVA duration at the scenario rate: 8 h × rate, from xEVA ConOps §4.1.4, "EVAs of up to 8 hours". This is an assumption, labelled "(sized)".

**Reserve.** Configurable from 0 to 120 min. The default is 30 min, the life-support consumables reserve of the Apollo 17 traverse planning data. It is not an O₂ standard of a Mars suit.

## 4. Fixed vs consumable mass

**Total carried mass = (suit mass − initial O₂) + O₂ remaining + other equipment**

- The suit mass of the study is taken as the **charged** suit, with oxygen inside it, which is an assumption. Oxygen is therefore never counted twice. The mass at the start equals the existing carry-check mass, so the 45 kg Earth-equivalent limit and its convention are unchanged.
- As oxygen is used, the carried mass falls by exactly the O₂ consumed. The fixed suit and PLSS mass does not change.
- **Walking speed does not change** with the falling mass. There is no validated mass–speed model at Mars gravity, so dynamic mass is shown as a separate operational figure.

## 5. Safety and planning

The planner knows the worst point of a route: the largest *elapsed time + fastest walk home* = EVA budget − tightest walk-back margin.

| Rule | Decision |
|---|---|
| O₂ endurance < worst point (cannot get home from somewhere on the route) | hard constraint fails → **NO-GO** |
| Return covered, but not with the reserve | environment condition → **CONDITIONAL** ("oxygen reserve not kept") |
| Scenario unknown, initial O₂ or reserve outside its range | **INSUFFICIENT DATA** |
| Return and reserve covered | no effect |

A route is never GO when the oxygen cannot cover the safe return. With a sized tank and the lunar limit set (8-h budget), the oxygen rule gives the same answer as the walk-back budget and the 30-min reserve, so the two agree. Under the Mars-conservative set the 7.5-h budget already keeps the 30 min aside, so the budget is the tighter rule. An entered tank, a different reserve or a different scenario makes it bite on its own.

## 6. Live EVA (HUD → O₂ & MASS)

The HUD shows:

- a progress bar for the O₂ reserve
- initial, remaining and consumed O₂
- how long the O₂ lasts
- the O₂ needed to walk home
- the current carried mass and its split
- the scenario, with a selector to change it live

There are two charts over the active timeline (the current rate continues ahead):

- **O₂ remaining**, against *walk home + reserve* and *rest of plan + reserve*. Where the remaining line falls under the walk-home line, the return is no longer feasible.
- **Carried mass over time.**

Events appear in the HUD log:

- O₂ scenario changed (return re-evaluated)
- O₂ reserve insufficient
- O₂ not enough to walk home (shown in red)
- oxygen depleted

These are updated while walking, at science stops, while waiting and on an abort's walk home. A paused EVA does not consume; seeking back restores the state.

## 7. Tests

| File | Checks |
|---|---|
| `oxygen.test.mjs` | BVAD values and per-sortie consistency; depletion per scenario; sized initial O₂; piecewise rates; zero boundary (never negative, endurance 0, return infeasible); reserve warning; mass = fixed + O₂ + equipment, equal to the carry check at the start, falls only by O₂ used; invalid settings → INSUFFICIENT DATA; NO-GO / CONDITIONAL / GO from oxygen; decision unchanged without oxygen; playback: pause does not consume, speed multipliers give the same O₂ for the same mission time, stops and walking consume, abort and walk home consume, rate change mid-EVA is not retroactive and raises a warning, reserve and depletion events, seek back, monotone charts |
| `realMobility.test.mjs` (Jezero), `realOxygenGale.test.mjs` | real routes: sized tanks agree with the walk-back budget and 30-min reserve for all three scenarios; a 1 kg tank is NO-GO for the cryogenic architecture but enough for the closed loop; real-route playback with the app's environment, abort and walk home |
| `moonMode.test.mjs` | `?site=moon`: no walk-back profile, so no oxygen check is applied |

## 8. Limitations

- The rates are architecture references for a 4-hour Mars sortie, not measured Mars-suit consumption. Real consumption depends on the metabolic rate, leakage and suit design.
- The rate does not follow activity. Climbing, sampling and resting all use the scenario rate.
- The initial oxygen is unknown for a Mars suit. The sized value is an assumption.
- The suit mass is assumed to include the oxygen. The study does not split out consumables.
- The falling mass does not speed up walking.
- Oxygen is per crew member. Buddy sharing and secondary oxygen (xEVA ConOps §4.2.1.1: an extra hour for emergencies) are not modelled.
