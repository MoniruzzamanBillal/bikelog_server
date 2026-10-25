# 59 — Engine oil: measure "km on this oil" backward, price it with the oil that ran it

**Status**: ✅ Code complete — implemented 2026-10-25. `yarn build` clean, `yarn lint` 0 errors
(pre-existing baseline unchanged, none in the touched file). Verified by logic trace against the
reporter's live data; **not exercised over HTTP** (no local Neon-backed server / auth in session).
**Scope**: `bikelog_server/` only, one file — `engineOilLog/engineOilLog.service.ts`
(`withPeriodFields` + the neighbour pairing in `getEngineOilLogsFromDB`). No migration, no new
route, no response-shape change — the two keys `kmOnThisOil` / `costPerKm` keep their types
(`number | null`), only their **values** change.
**Companion**: `bikelog_app/ai context/specs/61-engine-oil-km-backward.md` (the card now renders
km even when `costPerKm` is null). `bikelog_client-web-` needs no code change — only a stale
comment in `engineOilLogColumns.tsx` was corrected.

---

## Request

> I change my first engine oil when my odo was 290 … then how are you showing 470 km on [that
> card]? … the odometer reading is when I change my oil, so the old oil runs from (760−290).

The card's last line (`470 km on this oil · ৳1.49/km`) is from spec 54 D12's two derived list
fields. They were computed **forward** — a row's period was closed by its *newer* neighbour — so
the distance the oil ran landed on the card where that oil was **installed**, not where it was
drained. The rider reads a change's odometer reading as the moment that oil's life **ended**, so
the number appeared one card too early and the newest change showed nothing.

---

## Goal

On each oil-change card, `kmOnThisOil` = how far the oil that was just **drained** ran =
`thisReading − previousChange'sReading` (the very first change counting from odometer 0), and
`costPerKm` = the price of the oil that actually ran that distance ÷ that distance.

Worked against bike `6a61f2bee818bed8200d6490` (newest→oldest `[1615, 760, 290]`, costs
`600 / 775 / 700`):

| Card (odometer) | kmOnThisOil | costPerKm |
| --- | --- | --- |
| 1615 (newest) | 1615 − 760 = **855** | 775 ÷ 855 = **0.9064** |
| 760 | 760 − 290 = **470** | 700 ÷ 470 = **1.4894** |
| 290 (oldest) | 290 − 0 = **290** | **null** (no earlier oil's cost) |

---

## Design

### Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | A row's period is closed by its **older** neighbour: `kmOnThisOil = this.reading − older.reading` | The rider's model: the odometer reading on a change is where that oil's life ended. This is the **opposite** of fuel-log spec 57 D2 (forward), and that divergence is deliberate — see H1 |
| D2 | The oldest change on record **counts from 0**: `kmOnThisOil = this.reading` when there is no older neighbour | The rider's stated model ("the engine oil runs from 0–290"). Confirmed with the developer in session |
| D3 | `costPerKm = olderNeighbour.cost / kmOnThisOil` — the **previous** change's cost, not this row's | Price and distance must describe the same oil: the oil that ran `this−older` was the one *installed* at the older change, and its price is the older row's cost. This row's own cost bought the *new* oil, which has not run yet |
| D4 | Oldest change → `costPerKm: null` (distance but no ৳/km) | No older neighbour means no prior oil cost to divide. The client renders the km line without the ৳/km suffix |
| D5 | Keep the `kmOnThisOil > 0` guard on `costPerKm` (null, never `Infinity`) | Two changes can share a reading (the sequence check allows equal readings); `cost / 0` serialises as `null` through JSON anyway |
| D6 | The off-page neighbour query now selects `cost` too and `Number()`-converts it | `costPerKm` divides the older neighbour's cost, so the one off-page row needs its cost; `toApiShape` (L53) already does `Number(Decimal)` for the in-page shaped rows — mirror it so both neighbour kinds carry a plain `number` |

### Hazards

| # | Hazard | Handling |
| --- | --- | --- |
| H1 | A future "consistency pass" sees fuel (forward) and oil (backward) disagree and unifies them | **Do not.** They answer different questions: a fuel tank is burned over the ride that *follows* the fill (forward); an oil change records the end of the oil that *preceded* it (backward). The divergence is the correct behaviour, documented in both D1s |
| H2 | Pagination: the last row on a full page has its older neighbour on the *next* page | One extra `findFirst` pairs the page's **oldest** row with the change older than it (`changeDate` `lt`, `createdAt` `lt` tie-break, `orderBy` desc). Mirror of the forward version, flipped. Verified by the `limit=2` trace below |
| H3 | The "count from 0" rule is wrong for a used bike / logging started mid-life | Accepted for this single-user app at the developer's instruction. If a multi-user case ever reports a wrong oldest-card figure, revisit D2 (switch to `null`), not the whole model |

---

## Verification

- `yarn build` (tsc) clean; `yarn lint` 0 errors, no new warnings in the touched file.
- Logic trace on the reporter's three rows → matches the Goal table exactly.
- **Pagination boundary** (`&limit=2`): page 1 `[1615, 760]` — the 760 row (page's oldest) still
  gets `470 / 1.4894` via the off-page older-neighbour query; page 2 `[290]` → `290 / null`.
- **Owed (operator)**: the live Postman pass over HTTP against a Neon-backed server — the
  compiled Prisma query, the `Decimal` round-trip on the off-page `cost`, and serialisation are
  unverified in-session.
