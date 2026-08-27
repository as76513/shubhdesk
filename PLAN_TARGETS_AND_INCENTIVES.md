# Plan: Weekly Targets & Incentive Calculation

> **Superseded.** This was the pre-build design. What shipped is different:
> shared NCA / AUM / SIP / Insurance quotas (`CompanyTarget`), not a
> per-employee weekly ₹ target for sales/RM; trading/insurance splits in
> `src/revenue.ts` instead of an `IncentiveRate` model. See
> [README.md — How numbers are calculated](./README.md#how-numbers-are-calculated).
> Keep this file only as historical context — do not implement the models
> below as written.

---

## Original intent (not current product)

Two admin-configured features, planned together because they share a foundation: both are "admin sets a number per employee, tied to the ₹ value that employee generates in a period."

---

## Feature 1: Weekly Targets

**What**: Admin sets a ₹ revenue target for each employee (sales/RM) for a given week. Employees can see their own target and live progress against it.

### Data model

New `Target` model:

| Field | Type | Notes |
|---|---|---|
| `username` | string, required | the employee the target is for (Cognito username, same convention as `Lead.owner`) |
| `weekStart` | date, required | Monday of the target week — use ISO week start for consistency |
| `targetValue` | integer | ₹ amount |

Identifier: `['username', 'weekStart']` (one target per employee per week — a second `create` for the same pair should be an `update`, not a duplicate row).

Auth: `allow.group('admin')` full control; `allow.ownerDefinedIn('username').to(['read'])` so an employee can see only their own target.

### Progress calculation

Reuse the exact "this week" boundary logic already in `src/report.ts`'s `periodRange('thisWeek')` — don't reinvent week math. Progress = sum of `Lead.value` where `owner = employee`, `stage = closed`, and `updatedAt` falls in that week, divided by `targetValue`.

### UI

- **Admin**: a "Targets" tab (or a section inside an existing admin view) — pick employee, pick week (defaults to current), enter ₹ amount. Table below shows every employee's current-week target + progress bar, side by side (a lightweight leaderboard).
- **Employee (sales/RM)**: a stat card ("Weekly Target: ₹X — 62% there") visible on their own board, using the existing `StatBar` pattern.

### Good ideas to consider

1. **Progress bar color-coding** (red < 50%, amber 50–80%, green > 80%) — scannable at a glance, no new concept to learn.
2. **Auto-carry-forward**: if admin hasn't set a target for the new week yet, default the input to last week's value instead of blank — cuts down a weekly chore.
3. **Fold into the existing CSV report** (`src/report.ts`) as extra columns (Target / Actual / % Achieved) rather than a separate export — the report already computes `dealsClosedValue` per employee per period; this is additive, not a new pipeline.
4. **A small celebratory note** when someone crosses 100% (even just a colored banner, no need for anything fancier) — cheap, motivating.

### Open questions for tomorrow

- Target metric: **closed deal ₹ value** (proposed above), or something else — lead count? Number of deals closed regardless of value? Worth deciding before building the model.
- Should dealers get a target too (weekly brokerage goal), or is this sales/RM only for now?
- Weekly only, or should admin be able to set monthly targets too? (If monthly ever matters, the same model works with a `periodType` field — not urgent to build now, just worth deciding if it's in scope.)

---

## Feature 2: Incentive / Commission Calculation

**What**: Admin configures a commission **rate** per employee, per service type (Trading / SIP / Insurance / Loans — real commission structures usually do differ by product). The app then calculates how much incentive each employee has earned from their closed deals.

### Data model

New `IncentiveRate` model:

| Field | Type | Notes |
|---|---|---|
| `username` | string, required | the employee this rate applies to |
| `service` | enum, required | `Trading` / `SIP` / `Insurance` / `Loans` — same enum as `Lead.service` |
| `ratePercent` | float, required | e.g. `2.5` meaning 2.5% |
| `effectiveFrom` | date, required | see "important design decision" below |

Auth: `allow.group('admin')` full control; `allow.ownerDefinedIn('username').to(['read'])` so an employee can see their own rate structure (transparency).

### ⚠️ Important design decision: rates change over time

If an admin revises someone's Insurance rate from 10% to 12% partway through the year, a naive "always use the current rate" calculation would **retroactively misstate every past month's incentive** the moment the rate changes. The `effectiveFrom` field above exists specifically so a calculation for a given month always finds "the rate that was active on that date," not just whatever the rate is today. This is worth getting right from the start — it's much more annoying to fix after incentives have already been calculated and (maybe) paid out against wrong numbers.

### Calculation

For an employee, for a period (week/month): for each service, sum `Lead.value` where `owner = employee`, `stage = closed`, `service = X`, closed within the period → multiply by the rate that was `effectiveFrom` on or before that close date for that employee+service. Sum across all four services = total incentive for the period.

### UI

- **Admin**: an "Incentive Rates" table (Employee × 4 service columns, editable %), admin-only, probably living alongside the Targets tab.
- **Everyone**: extend the existing employee CSV report (`src/report.ts`) with an "Incentive Earned" column — this is the natural home for it, since the report already groups closed-deal value by employee and by (indirectly) service.
- **Employee**: a "This Month's Incentive: ₹X" stat, same pattern as the Weekly Target card.

### Good ideas to consider

1. **Keep v1 flat-rate-per-service.** Tiered/slab rates (e.g., 1% up to ₹5L, 1.5% beyond) are a common real-world structure but meaningfully more complex to build and explain — good v2 candidate, not v1.
2. **Reuse the report, don't build a parallel one.** `report.ts` already has almost everything needed (`dealsClosedValue` per employee, already period-filtered) — this should be an extension, not a new CSV/view.
3. **Employee-visible transparency** (their own rate + their own running total) matters a lot for trust in a commission scheme — worth prioritizing over admin-side polish.

### Open questions for tomorrow

- Should "closed" in the CRM be enough to count toward incentive, or does a real commission need a further gate (e.g., "payment/premium actually received," not just "marked closed in the pipeline")? Financial services commissions often only pay out once money has actually moved — if that's the case here, `stage = closed` alone may not be the right trigger, and a separate confirmation step might be needed.
- Monthly incentive periods, or should this also support weekly (tying into Feature 1's weekly cadence)?
- Any minimum threshold (e.g., no incentive below ₹X of closed value) or cap?

---

## Suggested build order

1. `Target` model + admin UI (simpler, no historical-accuracy concern) — good first piece to ship and get feedback on.
2. `IncentiveRate` model with `effectiveFrom` handled correctly from day one (retrofitting historical accuracy later is much harder than building it in from the start).
3. Extend `report.ts`'s CSV with both Target-vs-Actual and Incentive-Earned columns, rather than building either as a standalone view.
