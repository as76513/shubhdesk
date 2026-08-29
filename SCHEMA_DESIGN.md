# ShubhDesk — Data & Schema Design

How the data model in `amplify/data/resource.ts` is structured, why it's structured that way, and the NoSQL trade-offs that come with it. Written for whoever next needs to add a field or a new query.

**Business formulas** (how NCA, AUM, SIP, Insurance, trading splits, and incentives are counted) are in [README.md — How numbers are calculated](./README.md#how-numbers-are-calculated) and implemented in `src/revenue.ts`. This file is the data model, not the product math.

## Why DynamoDB / NoSQL here

Amplify Gen 2's `defineData` provisions AppSync + DynamoDB by default, and that fits this app's actual constraint (AWS free tier, team under 10):

- **Scale-to-zero cost.** DynamoDB on-demand bills per request/GB; idle tables cost ~$0. A relational option (RDS/Aurora) has a baseline running-instance cost even with zero traffic.
- **No server to run.** No instance, patching, or connection pooling.
- **Native fit with the auth model.** The sales→RM handoff (`owner` / `sourcedBy` fields) depends on AppSync's owner-based authorization resolvers, which are generated for free from the schema — this is *why* the business logic lives in `amplify/data/resource.ts` and not just in the UI.

The trade-off: DynamoDB doesn't do ad-hoc joins or arbitrary `WHERE` filtering efficiently. You design around known **access patterns**, not around entity relationships. That trade-off is worth writing down here so future changes don't accidentally add a query DynamoDB is bad at.

## One table per model, not one table per record

Amplify Data maps each `a.model()` to its own DynamoDB table. Eight models → eight tables (times two, once per deployed environment — sandbox and production each get their own full set):

| Model | Table role | Partition key |
|---|---|---|
| `Lead` | one item per client/pipeline record | `id` (auto UUID) |
| `Note` | one item per activity-log entry | `id` (auto UUID) |
| `StaffProfile` | one item per employee | `id` (auto UUID) |
| `Counter` | one item per calendar month (`YYMM`) | `period` (custom key, via `.identifier(['period'])`) |
| `Trade` | one item per dealer trade log entry | `id` (auto UUID) |
| `CompanyTarget` | one quota row per cadence; applied as each sales/RM's individual target | `periodType` (`monthly` / `quarterly` / `yearly`) |
| `Target` | one weekly target per employee (legacy, employee strip) | `username` + `weekStart` (composite, via `.identifier`) |
| `InsuranceRevenue` | one admin-entered insurance company-revenue row | `id` (auto UUID) |

Every lead ever created lives as a separate **item** inside the single `Lead` table — the table doesn't grow in count, the item count inside it does.

## Relationships

- `Note.leadId` + `Note.lead = a.belongsTo('Lead', 'leadId')`, mirrored by `Lead.notes = a.hasMany('Note', 'leadId')`.
- This is the only real relationship in the schema. Amplify auto-creates a secondary index on `Note.leadId` to back it, so "all notes for this lead" (`listNotes(leadId)` in `src/leadClient.ts`) is an efficient indexed query, not a table scan.
- Nothing else references anything else — `StaffProfile.username` and `Lead.owner`/`sourcedBy` are plain strings matched against the Cognito identity at the authorization layer, not a foreign key DynamoDB itself enforces.
- `Trade` deliberately has **no** relationship to `Lead`, even though both ultimately trace back to a client — this was an explicit design choice (dealers work standalone from the sales pipeline), not an oversight. If that ever needs to change (e.g., linking a trade back to the lead that generated it), that's a new `leadId` field + `@belongsTo`/`@hasMany` pair, same pattern as `Note`. Do not add that unless the business asks; it is not a missing join.

## Dates that must not ride on `updatedAt`

Amplify stamps `createdAt` / `updatedAt` on every model. **Do not use `updatedAt` as "when this deal closed"** — any later edit (follow-up date, value, owner) moves the lead into a different month and corrupts NCA/AUM/SIP.

| Field | When it is set | Used for |
|---|---|---|
| `Lead.closedAt` | `moveStage` into `closed` (cleared if it leaves closed) | monthly/quarter/year actuals, CSV deals-closed |
| `Lead.handoffAt` | first sales→RM handoff | CSV handoff count |
| `Lead.followUpOn` | admin/RM win-back date | Follow-ups Due view |
| `InsuranceRevenue.earnedOn` | admin-entered | insurance actuals |

Rows closed before `closedAt` existed fall back to `updatedAt` in `closedOn()` (`src/revenue.ts`).

## CompanyTarget is a quota template, not a per-person table

Three rows (`monthly` / `quarterly` / `yearly`). Every sales/RM is measured against those same numbers; actuals are filtered per person in the client. **Do not rename the model** (Amplify would provision a new table and leave the old rows behind). **Do not change `periodType` from string to enum** — it is the DynamoDB key; valid values are enforced in `upsertCompanyTarget`. If quotas ever need to differ by employee, that is a *new* identifier (`username` + `periodType`), a data backfill, and a UI to edit per person — not a silent tweak to the three existing rows.

`Target` (weekly, per username) is still loaded for the admin employee CSV (Closed Target / Revenue Target columns). It is **not** shown on the dealer login — dealers have no revenue quota. Do not merge it into CompanyTarget.

## Access patterns (what the app actually queries)

Every read the app does, and whether it's an efficient indexed `Query` or a `Scan` + filter (fine at this data volume, worth revisiting if it ever grows past a few thousand leads):

| Function (`src/leadClient.ts`) | What it does | Query or Scan |
|---|---|---|
| `listLeads()` | all leads the caller is authorized to see (role filtering happens client-side in `App.tsx`'s `visibleLeads`) | Scan, **paginated** (`listAllPages`, 1000/page) |
| `listNotes(leadId)` | notes for one lead | Scan + filter on `leadId` (GSI from `@belongsTo` exists; list still uses filter + pagination so deleteLead cannot miss notes past the first page) |
| `listFollowUpsDue(asOf)` | leads with `followUpOn <= asOf` | Scan + filter — no index on `followUpOn`; paginated |
| `listRMs()` | `StaffProfile` where `role = 'rm'` | Scan + filter — no index on `role`; paginated |
| `listStaff()` | all staff | Scan; paginated |
| `nextClientCode()` | get/update the `Counter` row for the current `period` | **Query/Get** by primary key — efficient by design |
| `listTrades()` (`src/tradeClient.ts`) | trades the caller owns (dealer), opened (sales/RM via `accountOpenedBy`), or all (admin) | Scan; paginated; auth-filtered per item. The All Trades UI then sorts by `createdAt` **newest first** — do not assume DynamoDB list order is chronological. |
| `listTargets()` (`src/targetClient.ts`) | weekly targets the caller may see (own row for employees; all for admin) | Scan; paginated |
| `listCompanyTargets()` (`src/targetClient.ts`) | the three cadence quota rows (monthly / quarterly / yearly) | Scan (3 rows); paginated |
| `listInsuranceRevenue()` (`src/targetClient.ts`) | admin-entered insurance company revenue (own rows for employees; all for admin) | Scan; paginated |

The two scan-and-filter patterns (`followUpOn`, `role`) are fine today: `StaffProfile` will only ever hold a handful of rows (team size), and `Lead` volume for a ~10-person team's pipeline is small. If lead volume ever grows into the thousands, the fix is a **GSI** on `followUpOn` (and possibly `stage`) so `listFollowUpsDue` becomes an indexed query instead of a full scan — not a schema rewrite, just an added index.

**Not every new feature needs a new query.** The admin employee report (`src/report.ts`) needed leads-per-employee, deals-closed-per-employee, pipeline breakdown, weekly target vs actual, and incentive earned — all of that is computed client-side from the `leads`/`staff`/`targets`/`trades`/`insuranceRevenue` arrays `App.tsx` already has in state, with zero new backend aggregation. Reach for a new query (and think about whether it needs an index) only when the data isn't already loaded on the page doing the aggregating. The Dealer Brokerage summary (per-day total + per-dealer breakdown in `TradesView`) is the same idea applied to `Trade`: it's a `useMemo` over whatever `listTrades()` already returned, not a new backend aggregation query.

Trading / Insurance ₹ splits live in `src/revenue.ts` (company = brokerage − 20% platform, dealer = 30% of company, halved again if `Trade.accountOpenedBy` is someone other than the dealer — that other half is the opener's **Account trading incentive**; insurance salesperson = 50% of admin-entered company revenue). The Trades tab **Dealer / Employee Revenue** card uses the unhalved 30%. NCA / AUM / SIP / Insurance period actuals are also in that file — see README for the full table. SIP and Loans have no revenue formula yet. Do not use `Lead.value` as trading “actual” for incentive.

## Authorization is part of the schema design, not bolted on after

Each model's `.authorization((allow) => [...])` block *is* the access-pattern design for who can touch which rows:

- **`Lead`**: `allow.group('admin')` (full control) + `allow.ownerDefinedIn('owner')` (full control for whoever currently owns it) + `allow.ownerDefinedIn('sourcedBy').to(['read'])` (permanent read-only for the original salesman after handoff) + `allow.group('rm').to(['read'])` (any RM can see incoming leads on the board).
- **`StaffProfile`**: `allow.group('admin')` for full writes, `allow.ownerDefinedIn('username').to(['create','update'])` so a user can create/update *only the row matching their own identity* (this is what lets `ensureOwnStaffProfile()` self-register a row on first login without needing admin-only write access), and `allow.authenticated().to(['read'])` for everyone (needed to resolve display names and populate the RM dropdown). Note this is the one model where the "owner" field (`username`) isn't `owner`/`sourcedBy` by name — `ownerDefinedIn` just needs *a* field that equals the caller's identity, whatever it's called.
- **`Counter`**: `allow.group('admin')` for writes, `allow.authenticated().to(['read','create','update'])` for everyone (any staff member creating a lead needs to bump the sequence).
- **`Note`**: `allow.group('admin')` + `allow.authenticated().to(['read','create'])` (notes are cheap and shared; the sensitive control point is `Lead`, not `Note`).
- **`Trade`**: `allow.group('admin')` + `allow.ownerDefinedIn('owner')` + `allow.ownerDefinedIn('accountOpenedBy').to(['read'])`. A dealer manages only their own trades. Sales/RM named as Account Opened By can **read** those trades (so their login can sum Account trading incentive) but cannot edit them. `accountOpenedBy` is stored as `OWN` (dealer opened it) or a sales/RM/admin Cognito username — empty/`OWN`/same as `owner` → dealer keeps 30% of company; any other person → that 30% is split 50/50 between dealer and opener. Persist `OWN`; do not send `null` on update.
- **`CompanyTarget`**: `allow.group('admin')` full control + `allow.authenticated().to(['read'])`. Identifier is `periodType` — three rows total. Same quota numbers for every sales/RM (individual, not a team pool). Valid `periodType` values enforced in `upsertCompanyTarget`, not as a GraphQL enum on the key.
- **`Target`**: `allow.group('admin')` full control + `allow.ownerDefinedIn('username').to(['read'])`. Composite identifier `['username', 'weekStart']` so saving the same employee+week is an update, not a second row. Legacy weekly employee strip.
- **`InsuranceRevenue`**: same auth as Target (admin writes, employee reads own). Trading revenue is **not** stored here — it is derived from `Trade.brokerage` in `src/revenue.ts`. Only Insurance needs a manual company-revenue amount.

This is why `owner` and `sourcedBy` exist as plain string fields on `Lead` rather than being derived at query time — DynamoDB/AppSync's owner-based auth rules need the identity baked into the item itself to check against on every read/write.

## Checklist for changing this schema later

1. **Name the query before adding the field.** If you're adding a filterable field, write down the exact `list...()` call you'll make against it before deciding whether it needs a GSI.
2. **Prefer a GSI over a new table.** A new access pattern on existing data is almost always an index, not a new model.
3. **Keep identity fields (`owner`, `sourcedBy`) as plain strings set at write time.** Don't try to resolve them dynamically — the owner-based auth rules require the value to live on the item.
4. **New model = new table**, automatically, with its own auth block. There's no shared/multi-tenant table pattern here — don't hand-roll one unless a specific access pattern demands it.
