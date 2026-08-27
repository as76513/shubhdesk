# ShubhDesk

Internal sales pipeline for **ShubhShree Knowledge Hub Pvt. Ltd.**

Telecaller/salesman work leads through the early stages, then hand off to
a Relationship Manager who closes the deal. Tracks client details, a
client code (`SSKH-YYMM-NNN`), requirements, and win-back follow-ups.

Built with React + Vite + AWS Amplify Gen 2 (Cognito auth, DynamoDB
data). Runs on AWS free tier for a small team. Formulas for NCA, AUM,
SIP, Insurance, trading splits, and incentives live in `src/revenue.ts`
and are documented below.

---

## Quick start (local)

```bash
# 1. Install dependencies
npm install

# 2. Start the Amplify cloud sandbox (provisions Cognito + DynamoDB
#    in your AWS account and writes amplify_outputs.json)
npx ampx sandbox

# 3. In a second terminal, run the app
npm run dev
```

Open the local URL Vite prints. You'll hit the Cognito login screen —
create your first user in the AWS Amplify console (see DEPLOY.md).

---

## Deploying

Push this repo to GitHub, then connect it in the **AWS Amplify console**
(Deploy an app → connect repo). Amplify builds and hosts it, and handles
your custom domain + SSL.

Full step-by-step — including adding staff, roles, and pointing your
GoDaddy domain — is in **[DEPLOY.md](./DEPLOY.md)**.

---

## Project structure

```
amplify/
  auth/resource.ts    Cognito user pool + admin / rm / sales / dealer groups
  data/resource.ts    Lead, Note, Counter, StaffProfile, Trade,
                      CompanyTarget, Target, InsuranceRevenue + auth rules
  backend.ts          Wires it together
src/
  main.tsx            Amplify config + Cognito login gate
  App.tsx             The app UI (loads from backend, role-aware)
  leadClient.ts       Lead / Note / Staff / Counter calls
  tradeClient.ts      Trade CRUD (standalone from the pipeline)
  targetClient.ts     CompanyTarget, weekly Target, InsuranceRevenue
  revenue.ts          NCA / AUM / SIP / Insurance actuals + trading splits
  report.ts           Admin employee CSV + trades CSV
DEPLOY.md             Full deployment guide
SCHEMA_DESIGN.md      Data model, access patterns, NoSQL design notes
```

---

## Pipeline workflow

Stages, in order: **New Lead → Meeting/Consultation → Follow-up →
Deal In Progress → Deal Closed / Deal Rejected.**

From **New Lead**, the drawer shows an explicit choice rather than a
generic dropdown — "→ Proceed to Meeting" or "✕ Client Rejected" — so
that outcome is a visible decision point, not just one option buried in
a grid of every stage. Rejected is also reachable from any later stage
(a deal can fall through after a meeting too), via the full stage grid
below that choice. Rejecting (from anywhere) requires picking a
one-click **reason** (Not Interested / Chose Competitor / Budget / Bad
Timing / Other) — no skipping — which feeds the win-back follow-up
decision later. The reason is shown as a red badge next to the stage
pill in the drawer, and on the board it replaces the owner's name in
a rejected lead's card (once a lead is dead, why it died is more
useful than who owns it).

The **Activity Log** in the drawer states each transition explicitly
("Moved from new to meeting", "Handed off to Anita by Amol
(new → meeting)") so the pipeline path is readable from the log text
alone, without needing to cross-reference dates or entry order. Only
notes written from this point on look like this — older entries may
still show raw IDs, since it's stored text and can't be fixed up
after the fact.

Every new lead also gets a **source** (Cold Call / Referral / Walk-in /
Existing Client / Digital / Other) — a single dropdown defaulting to
"Cold Call", not a required field, so it adds no typing overhead to
lead creation.

**Board view** supports drag-and-drop: pick up a lead card (mouse click
and drag, or press-and-hold then drag on touch) and drop it on another
column to move it. Only leads you can edit are draggable, and dropping
on **Meeting** from a sales stage still triggers the RM-handoff picker
described below — drag-and-drop and the drawer's buttons both funnel
through the same move logic, so there's one behavior everywhere.

**Sales → RM handoff**: moving a lead into **Meeting** from **New**
(the only sales-owned stage now) prompts you to pick a Relationship
Manager. Ownership transfers to them immediately; the original
salesman keeps permanent **read-only** visibility (`sourcedBy`) and can
follow progress but not edit or comment further.

**Win-back follow-ups**: any lead — most useful on a rejected or
dormant one — can get a `followUpOn` date. The "Follow-ups Due" tab
(admin/RM only) lists everything due today or earlier, for reconnecting
with clients who didn't convert the first time.

**Top stat bar**: Total Leads, Active, Closed Won, and Pipeline Value
for everyone. Admin gets a 5th card, **Total Brokerage (Mon YYYY)** —
all trades in the current **calendar month** (not today). Below that,
admin sees one **Company targets** strip (see [How numbers are
calculated](#how-numbers-are-calculated)). Sales/RM see their own
progress strip (monthly by default, with quarter/year radios). Admin
can **delete a lead** from the drawer (notes first, then the lead)
after a confirmation that shows client code + name.

---

## Dealer trade log

**Dealer is a separate, standalone role** — it has nothing to do with
the Lead pipeline above. A Dealer's entire screen is a simple log of
trades: **Client Name, Buying Lot, Brokerage**, plus **Account Opened
By**. No stages, no board. A dealer sees and manages only their own
trades. They see **This Month's Incentive** (their dealer payout for
the current calendar month). There is no weekly incentive or revenue
quota.

Admins get an extra **Trades** tab showing every dealer's trades, with:

- Period pills: **Day / This week / This month / Last month** (day
  uses a date picker). Summary cards, Dealer Brokerage, and CSV all
  follow that range.
- **Dealer / Employee Revenue** on the totals strip is the **full**
  30% of company revenue (not reduced for “opened by someone else”).
- **Dealer Brokerage** per dealer shows brokerage plus **Dealer ₹**
  (that dealer’s payout, which *is* halved when the account was opened
  by someone else).
- **Account Opened By** on each trade (admin dropdown): **OWN** = the
  dealer opened it (full 30% of company). Any sales/RM/admin = dealer
  payout × 0.5. Dealers are not in the opener list. Stored on
  `Trade.accountOpenedBy` as `OWN` or a Cognito username (never omit
  the field — Amplify skips `null` on update).
- CSV columns: Date, Dealer, Client Name, Buying Lot, Account Opened
  By, Brokerage, Company Revenue, Dealer Revenue.

---

## Roles

| Role   | Sees | Can do |
|--------|------|--------|
| sales  | own + sourced leads | create leads, hand off to RM from New; own NCA/AUM/SIP/Insurance strip |
| rm     | all leads (read); owned leads (write) | take handoffs, run Meeting→Closed, win-back list; own progress strip |
| dealer | own trades only | log/edit/delete their own trades; this month's incentive |
| admin  | everything | pipeline, Trades, Targets, employee CSV, lead delete, insurance entries, Account Opened By |

All of this is enforced **server-side**, not just hidden in the UI — the
auth rules in `amplify/data/resource.ts` (`allow.ownerDefinedIn('owner')`,
`.to(['read'])` for `sourcedBy`, `allow.group(...)`) mean AppSync itself
rejects a write from anyone who isn't the current owner or an admin,
even if a client bypassed the UI entirely. See `SCHEMA_DESIGN.md` for
how the schema encodes this.

### Staff setup

A `StaffProfile` row (`username`, `displayName`, `role`) is what turns
a raw Cognito ID into a friendly name on cards and in the RM handoff
picker. **This now happens automatically** — the app creates it on a
user's first login, using the local part of their email as the display
name (e.g. `dealer@shubhdesk.test` → "dealer"). No admin step required
for the app to work correctly.

If you want a nicer name than the email prefix, an admin can still
edit the row afterward in the Amplify console's Data manager. The
`StaffProfile.username` there must be the user's actual Cognito
**Username**, which is an auto-generated ID — **not their email** —
visible on the user's detail page in the Cognito console. Full steps
in `DEPLOY.md`.

---

## Validation & error handling

- **Client name** and **Email** are required on new leads (marked with
  a red `*`), checked before the form ever hits the server — an invalid
  or missing email gets a plain-language message immediately instead of
  a generic failure.
- Every action that can fail (create, move, note, follow-up) shows a
  **plain-language explanation** of what went wrong, with the raw
  technical detail appended so it can be copy-pasted and shared with
  whoever maintains the app, instead of a bare "couldn't do X".

---

## Admin: employee activity report

Admins get a "⬇ Report" button that downloads a CSV for This Week /
This Month / Last Month, per employee: leads sourced, deals closed
(count + value), handoffs to RM, pipeline stage breakdown, plus
**Closed Target / Actual / %**, **Revenue Target / Actual / %**, and
**Incentive Earned**.

- Closed dates use `Lead.closedAt` (falls back to `updatedAt` for older
  rows). Handoffs use `Lead.handoffAt` the same way.
- **Deals Closed** in the CSV counts only leads the person currently
  **owns**. **Closed Actual** counts owner **or** `sourcedBy` (same as
  NCA credit).
- **Closed Target / Revenue Target** come from weekly `Target` rows
  whose Monday falls in the report period (the older per-employee
  weekly goals) — not from the NCA/AUM/SIP/Insurance quotas on the
  Targets tab.
- **Revenue Actual** = trading **company** ₹ from trades they own
  (brokerage − 20% platform) + insurance company ₹ attributed to them.
  **Incentive Earned** = dealer payout on those trades (with the
  opened-by 50% rule) + 50% of their insurance company ₹.

Computed client-side from data already loaded — see `src/report.ts`.

---

## Targets tab (admin)

- **Individual quotas** (collapsed by default — one-time setup): the
  same NCA / AUM / SIP / Insurance numbers for every sales and RM, for
  monthly, quarterly, and yearly. Not a team pool and not a per-person
  table. Defaults until admin saves:

  | | Monthly | Quarterly | Yearly |
  |---|---:|---:|---:|
  | NCA (closed clients) | 10 | 30 | 120 |
  | AUM (₹) | 2,00,000 | 6,00,000 | 30,00,000 |
  | SIP (₹) | 5,000 | 30,000 | 1,00,000 |
  | Insurance (₹) | 50,000 | 1,50,000 | 6,00,000 |

- **Employee progress**: one card per sales/RM. **Monthly** by default;
  radios switch the whole list to Quarterly or Yearly (only one cadence
  visible). The heading is the period being shown (e.g. August 2026 /
  Q3 2026 / 2026).
- **Insurance company revenue**: admin enters company ₹ attributed to
  a salesperson (`earnedOn` date); the UI shows their 50% automatically.

On the **pipeline**, admin does **not** see per-person strips. They see
**Company targets** = per-person quota × number of sales/RM, vs
company-wide actuals (each closed deal counted once).

SIP and Loans have **no** trading-style ₹ split yet.

---

## How numbers are calculated

All of this is in `src/revenue.ts`. Change the constants there and the
app follows.

### When a close counts

A lead counts in a month/quarter/year if `stage = closed` and
`closedAt` (or `updatedAt` if `closedAt` is missing) falls in that
range. `closedAt` is set when the lead is moved to Closed and cleared
if it leaves Closed, so later edits (value, notes, follow-up) do not
move the win into another month.

### NCA (new client acquisition)

Count of **closed leads of any service** (Trading, SIP, Insurance,
Loans) in the period.

| View | What is counted |
|---|---|
| One employee (Targets tab, personal strip) | Closed leads where they are **owner or sourcedBy** (both get credit after RM handoff) |
| Company (admin pipeline) | Closed leads **once** (no double-count) |

Goal for one person = the quota admin saved (default 10 / month).
Company goal = that quota × count of sales+RM profiles.

### AUM

Sum of `Lead.value` on **closed Trading** leads in the period.
Same owner/sourcedBy vs company-once rules as NCA.

### SIP

Sum of `Lead.value` on **closed SIP** leads in the period.
Same credit rules as NCA. There is no brokerage split for SIP yet.

### Insurance

Not taken from `Lead.value`. Admin types **company ₹** on
`InsuranceRevenue` (`earnedOn` date, attributed to a `username`).

- Company / employee actual = sum of those rows in the period
  (employee: only rows for that username).
- Salesperson incentive = **50%** of that company ₹
  (`INSURANCE_SALES_SHARE`).

### Trading (dealer trades)

From `Trade.brokerage`:

1. **Company** = brokerage − 20% platform fee (`brokerage × 0.8`).
2. **Dealer payout** = 30% of company (`× 0.3`).
3. If **Account Opened By** is someone other than OWN / this dealer:
   that 30% is multiplied by **0.5**.

The top **Dealer / Employee Revenue** card is step 2 **without**
step 3 (full 30% pool). Per-trade **Dealer ₹** and the Dealer
Brokerage payout column **do** apply step 3.

Constants: `TRADING_PLATFORM_FEE = 0.2`,
`DEALER_SHARE_OF_COMPANY = 0.3`, `DEALER_OPENED_ELSEWHERE_CUT = 0.5`.

### Loans

No revenue formula yet. Closed Loans still count toward **NCA**
(any closed service).

### Incentive (monthly)

Shown on sales/RM and dealer login as **This Month's Incentive**.
Uses the calendar month being viewed (not a week). Formula
(`incentiveFor`): dealer cut from their trades in that month (with
the opened-by rule) + insurance salesperson 50% for rows dated that
month. The employee CSV **Incentive Earned** column uses the same
function for whichever report period is chosen.

---

## Other docs

| File | What it covers |
|---|---|
| [DEPLOY.md](./DEPLOY.md) | Amplify Hosting, domain, creating staff + Cognito groups |
| [SCHEMA_DESIGN.md](./SCHEMA_DESIGN.md) | DynamoDB models, indexes, auth rules, access patterns |
| [CLAUDE.md](./CLAUDE.md) | Architecture notes for coding in this repo |
| [PLAN_TARGETS_AND_INCENTIVES.md](./PLAN_TARGETS_AND_INCENTIVES.md) | **Superseded** early design — what shipped is above |
