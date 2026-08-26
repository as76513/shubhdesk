# ShubhDesk — Data & Schema Design

How the data model in `amplify/data/resource.ts` is structured, why it's structured that way, and the NoSQL trade-offs that come with it. Written for whoever next needs to add a field or a new query.

## Why DynamoDB / NoSQL here

Amplify Gen 2's `defineData` provisions AppSync + DynamoDB by default, and that fits this app's actual constraint (AWS free tier, team under 10):

- **Scale-to-zero cost.** DynamoDB on-demand bills per request/GB; idle tables cost ~$0. A relational option (RDS/Aurora) has a baseline running-instance cost even with zero traffic.
- **No server to run.** No instance, patching, or connection pooling.
- **Native fit with the auth model.** The sales→RM handoff (`owner` / `sourcedBy` fields) depends on AppSync's owner-based authorization resolvers, which are generated for free from the schema — this is *why* the business logic lives in `amplify/data/resource.ts` and not just in the UI.

The trade-off: DynamoDB doesn't do ad-hoc joins or arbitrary `WHERE` filtering efficiently. You design around known **access patterns**, not around entity relationships. That trade-off is worth writing down here so future changes don't accidentally add a query DynamoDB is bad at.

## One table per model, not one table per record

Amplify Data maps each `a.model()` to its own DynamoDB table. Five models → five tables (times two, once per deployed environment — sandbox and production each get their own full set):

| Model | Table role | Partition key |
|---|---|---|
| `Lead` | one item per client/pipeline record | `id` (auto UUID) |
| `Note` | one item per activity-log entry | `id` (auto UUID) |
| `StaffProfile` | one item per employee | `id` (auto UUID) |
| `Counter` | one item per calendar month (`YYMM`) | `period` (custom key, via `.identifier(['period'])`) |
| `Trade` | one item per dealer trade log entry | `id` (auto UUID) |

Every lead ever created lives as a separate **item** inside the single `Lead` table — the table doesn't grow in count, the item count inside it does.

## Relationships

- `Note.leadId` + `Note.lead = a.belongsTo('Lead', 'leadId')`, mirrored by `Lead.notes = a.hasMany('Note', 'leadId')`.
- This is the only real relationship in the schema. Amplify auto-creates a secondary index on `Note.leadId` to back it, so "all notes for this lead" (`listNotes(leadId)` in `src/leadClient.ts`) is an efficient indexed query, not a table scan.
- Nothing else references anything else — `StaffProfile.username` and `Lead.owner`/`sourcedBy` are plain strings matched against the Cognito identity at the authorization layer, not a foreign key DynamoDB itself enforces.
- `Trade` deliberately has **no** relationship to `Lead`, even though both ultimately trace back to a client — this was an explicit design choice (dealers work standalone from the sales pipeline), not an oversight. If that ever needs to change (e.g., linking a trade back to the lead that generated it), that's a new `leadId` field + `@belongsTo`/`@hasMany` pair, same pattern as `Note`.

## Access patterns (what the app actually queries)

Every read the app does, and whether it's an efficient indexed `Query` or a `Scan` + filter (fine at this data volume, worth revisiting if it ever grows past a few thousand leads):

| Function (`src/leadClient.ts`) | What it does | Query or Scan |
|---|---|---|
| `listLeads()` | all leads the caller is authorized to see (role filtering happens client-side in `App.tsx`'s `visibleLeads`) | Scan (whole table, auth-filtered server-side per item) |
| `listNotes(leadId)` | notes for one lead | **Query** via the `leadId` GSI from `@belongsTo` |
| `listFollowUpsDue(asOf)` | leads with `followUpOn <= asOf` | Scan + filter — no index on `followUpOn` |
| `listRMs()` | `StaffProfile` where `role = 'rm'` | Scan + filter — no index on `role` |
| `listStaff()` | all staff | Scan (whole table) |
| `nextClientCode()` | get/update the `Counter` row for the current `period` | **Query/Get** by primary key — efficient by design |
| `listTrades()` (`src/tradeClient.ts`) | trades the caller owns, or all trades for admin (role filtering is server-side via the `Trade` auth rule, same as Lead) | Scan (whole table, auth-filtered per item) |

The two scan-and-filter patterns (`followUpOn`, `role`) are fine today: `StaffProfile` will only ever hold a handful of rows (team size), and `Lead` volume for a ~10-person team's pipeline is small. If lead volume ever grows into the thousands, the fix is a **GSI** on `followUpOn` (and possibly `stage`) so `listFollowUpsDue` becomes an indexed query instead of a full scan — not a schema rewrite, just an added index.

**Not every new feature needs a new query.** The admin employee report (`src/report.ts`) needed leads-per-employee, deals-closed-per-employee, and a pipeline breakdown — all of that is computed client-side from the `leads`/`staff` arrays `App.tsx` already has in state from `listLeads()`/`listStaff()`, with zero new backend calls. Reach for a new query (and think about whether it needs an index) only when the data isn't already loaded on the page doing the aggregating. The Dealer Brokerage summary (per-day total + per-dealer breakdown in `TradesView`) is the same idea applied to `Trade`: it's a `useMemo` over whatever `listTrades()` already returned, not a new backend aggregation query.

## Authorization is part of the schema design, not bolted on after

Each model's `.authorization((allow) => [...])` block *is* the access-pattern design for who can touch which rows:

- **`Lead`**: `allow.group('admin')` (full control) + `allow.ownerDefinedIn('owner')` (full control for whoever currently owns it) + `allow.ownerDefinedIn('sourcedBy').to(['read'])` (permanent read-only for the original salesman after handoff) + `allow.group('rm').to(['read'])` (any RM can see incoming leads on the board).
- **`StaffProfile`**: `allow.group('admin')` for writes, `allow.authenticated().to(['read'])` for everyone (needed to resolve display names and populate the RM dropdown).
- **`Counter`**: `allow.group('admin')` for writes, `allow.authenticated().to(['read','create','update'])` for everyone (any staff member creating a lead needs to bump the sequence).
- **`Note`**: `allow.group('admin')` + `allow.authenticated().to(['read','create'])` (notes are cheap and shared; the sensitive control point is `Lead`, not `Note`).
- **`Trade`**: `allow.group('admin')` + `allow.ownerDefinedIn('owner')` — no group-level read for anyone else, unlike `Lead`'s `rm` read rule. A dealer's trades are private to them and admin; there's no equivalent of RMs "seeing incoming handoffs" here because there's no handoff into `Trade` at all.

This is why `owner` and `sourcedBy` exist as plain string fields on `Lead` rather than being derived at query time — DynamoDB/AppSync's owner-based auth rules need the identity baked into the item itself to check against on every read/write.

## Checklist for changing this schema later

1. **Name the query before adding the field.** If you're adding a filterable field, write down the exact `list...()` call you'll make against it before deciding whether it needs a GSI.
2. **Prefer a GSI over a new table.** A new access pattern on existing data is almost always an index, not a new model.
3. **Keep identity fields (`owner`, `sourcedBy`) as plain strings set at write time.** Don't try to resolve them dynamically — the owner-based auth rules require the value to live on the item.
4. **New model = new table**, automatically, with its own auth block. There's no shared/multi-tenant table pattern here — don't hand-roll one unless a specific access pattern demands it.
