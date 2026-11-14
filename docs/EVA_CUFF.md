# MARTIAN EVA CUFF — wrist console and printed backup

A proposed Martian Map concept: the selected mission on a forearm display, with a printed backup
checklist that works without it. Inspired by the Apollo 15–17 cuff checklists (NASA JSC-20466
format) and rugged tactical wrist displays (Elbit Smart WristView, USSOCOM tactical display
research) — design references only. **Not a NASA device, not manufactured, not tested in a suit or
environment, not flight-qualified; there is no hardware link.**

Open it in **04 OPERATIONS → Martian EVA Cuff — wrist console** (*OPEN WRIST CONSOLE*,
*PRINT BACKUP CUFF*, *Device concept*).

## Audit — what it reuses (no second mission data system)

| Existing | Used for |
|---|---|
| `utils/cuffCard.js` `buildCuffCard` (station table: arrive, stay, BACK, LEAVE BY, margin, →H) | TASKS, RETURN, printed page 1 and 2 |
| route `stats` (pathfinder): margin profile, PONR, slope, rock, light, radiation | STATUS, HAZARDS, RETURN |
| `evaAssessments` → decision (GO / CONDITIONAL / NO-GO / INSUFFICIENT DATA), payload, dust, oxygen | STATUS, HAZARDS, printed status |
| `evaPlayback` / `evaSnapshot` (EVA simulation): MET, pose, stop states, live margin, O₂ state, abort, dust re-route | everything during the playback |
| stop cards (`stopCards.js` via `scienceStopCards`) | TASKS: activity, geology, risk, confidence |
| `routeHazards` + hazard classes | HAZARDS list and hazard marks on the MAP |
| mission settings: suit, itemised payload, O₂ scenario, EVA limits, rover | EQUIPMENT, limits, O₂ |
| site segmentation summary | HAZARDS line marked AI-PREDICTED |

All of it goes through one pure function, `utils/evaCuff.js` `cuffModel()`, used by both the
console (`workspace/EvaCuff.jsx`) and printed page 2 (`components/CuffCard.jsx`), so the two always agree.

## Screens

F1 STATUS · F2 MAP · F3 TASKS · F4 HAZARDS · F5 RETURN on the left keys; the guarded **EMER** key
opens the emergency reference from any screen with one press; PLAY/PAUSE and ABORT drive the
existing EVA playback; PRINT opens the printed backup.

* Position: **PLANNED** before the EVA, **SIMULATED** during the playback — never presented as live telemetry.
* Oxygen: initial mass, remaining mass, scenario rate and estimated duration come from the existing
  oxygen model (`utils/oxygen.js`, BVAD scenario rates), labelled *model estimate*. Tank pressure
  is not modelled and is not shown. Suit mass does not change with the oxygen display.
* Safety: the decision is the app's own. During the EVA an unsafe return (walk-back margin < 0, point
  of no return passed, O₂ not enough to walk home) is shown as **NO-GO / RETURN NOW** — never GO.
* Every hazard and emergency line carries its kind: MEASURED, ORBITAL, DERIVED, MODEL,
  AI-PREDICTED, PROJECT RULE, SIMULATED, NASA REF.
* Emergency: only the rules this planner applies (abort, margin, O₂, dust devil, terrain limits) and
  the NASA sources of the limits. **Suit and comms failure procedures are not modelled and are not given.**

## Offline copy

The latest mission is kept in this browser (localStorage) with its sync time. With no mission
loaded, the console shows that copy as **OFFLINE COPY hh:mm — may be stale**. This is browser
storage, not a hardware synchronisation.

## Printed backup

Page 1 is the existing Apollo-style cuff card (route map, station table, turn-back rules). Page 2 is
the **EVA BACKUP CHECKLIST**: tick-box EVA sequence with LEAVE BY times and stop instructions,
equipment checklist, resource limits (O₂ when validated), return rules, hazards with their kind of
evidence, and the emergency reference. Each page prints on one A4 sheet.

## Implemented · simulated · not implemented

| Implemented | Simulated only | Not implemented (hardware) |
|---|---|---|
| six screens from the real mission and the EVA playback; abort / play from the cuff; printed 2-page backup; offline browser copy; device concept drawing | position, MET, O₂ use (playback + scenario model); dust devil drill | sensors, positioning, tank pressure, radio / data link, physical keys, glove input, environmental or suit qualification |

## Tests

`web/tests/evaCuff.test.mjs` (planned vs simulated labels, mission changes, stop states, never GO
with an unsafe return, equipment, sources, no invented suit procedures) and the browser test
(console screens, one-press EMER, two-page A4 PDF with the backup checklist).
