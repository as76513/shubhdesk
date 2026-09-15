# ShubhDesk

Internal sales pipeline for **ShubhShree Knowledge Hub Pvt. Ltd.**

Wealth Managers and Advisors work a lead end-to-end through New Lead →
Meeting → Joint Meeting → Deal Closed. Tracks client details, a
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
  auth/resource.ts    Cognito user pool + admin / wealth_manager / advisor groups
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

Stages, in order: **New Lead → Meeting → Joint Meeting → Deal Closed.**
Follow-up, Deal In Progress, and Rejected are no longer pipeline
columns. Existing rows in those old stages still load (the GraphQL
enum keeps the values); leftover Follow-up / In Progress cards show
under Joint Meeting. Rejected leads stay in List, not on the board.

From **New Lead**, the drawer shows "→ Proceed to Meeting" or
"✕ Client Rejected". From **Meeting**, "→ Proceed to Joint Meeting"
prompts for who you went on the call with and where. From **Joint
Meeting**, "→ Deal Closed" closes it out. The owner never changes as a
lead moves through these stages — one person works it start to finish.
Rejecting (from anywhere) requires picking a one-click **reason** (Not
Interested / Chose Competitor / Budget / Bad Timing / Other) — no
skipping — which feeds the win-back follow-up decision later. The
reason is shown as a red badge next to the stage pill in the drawer.

The **Activity Log** in the drawer states each transition explicitly
("Moved from new to meeting", "Joint meeting with Anita at the client's
office by Amol (meeting → joint_meeting)") so the pipeline path is
readable from the log text alone, without needing to cross-reference
dates or entry order. Only notes written from this point on look like
this — older entries may still show raw IDs, since it's stored text
and can't be fixed up after the fact.

Every new lead also gets a **source** (Cold Call / Referral / Walk-in /
Existing Client / Digital / Other) — a single dropdown defaulting to
"Cold Call", not a required field, so it adds no typing overhead to
lead creation.

**Board view** supports drag-and-drop: pick up a lead card (mouse click
and drag, or press-and-hold then drag on touch) and drop it on another
column to move it. Only leads you can edit are draggable, and dropping
on **Joint Meeting** from New Lead or Meeting still triggers the joint
meeting prompt described below — drag-and-drop and the drawer's buttons
both funnel through the same move logic, so there's one behavior
everywhere.

**Joint Meeting**: moving a lead into **Joint Meeting** from **New
Lead** or **Meeting** prompts you to record who you went with
(`jointWith`, any colleague) and where (`meetingLocation`). Ownership
does not change — the lead stays with whoever is working it.

**Win-back follow-ups**: any lead — most useful on a rejected or
dormant one — can get a `followUpOn` date. The "Follow-ups Due" tab
(admin/Wealth Manager only) lists everything due today or earlier, for
reconnecting with clients who didn't convert the first time.

**Top stat bar**: Total Leads, Active, Closed Won, and **Revenue**
(admin-entered company revenue for the current calendar month —
everyone sees their own amount; admin sees the company total). Below
that, admin sees one **Company targets** strip. Wealth
Manager/**Advisor** see their own progress strip (monthly by default).
Admin can **delete a lead** from the drawer after confirmation.

---

## Advisor trade log

**Advisor** uses the **same Lead pipeline as Wealth Manager** (board,
My Leads, New Lead) and still has a **Trades** tab for their own log:
**Client Name, Buying Lot, Brokerage**, plus **Account Opened By**.
They see the same **monthly progress** strip as Wealth Manager plus
**This Month's Incentive** (admin-entered only). Trades do **not** show
calculated advisor revenue, brokerage totals, or payouts.

Admins get an extra **Trades** tab showing every advisor's trades, with:

- Period pills: **Day / This week / This month / Last month**. Admin
  sees **Total Brokerage** and **Company Revenue** (brokerage − 20%
  platform). No advisor/employee payout cards.
- **Account Opened By** on each trade (admin dropdown): **OWN** or a
  Wealth Manager/admin. Advisors are not in the opener list.
- **All Trades** is sorted by `createdAt`, **newest first**. Deleting a
  trade asks for confirmation.
- CSV: Date, Advisor, Client Name, Buying Lot, Account Opened By,
  Brokerage (raw). No company or advisor payout columns.

The UI is **phone-friendly** (≤720px): header wraps, progress +
incentive stack, and trade/lead/insurance rows become labeled cards
instead of a clipped table.

---

## Roles

| Role           | Sees | Can do |
|----------------|------|--------|
| wealth_manager | own + sourced leads | create leads, work New Lead → Meeting → Joint Meeting → Deal Closed; own NCA/AUM/SIP/Insurance strip + admin-entered monthly incentive |
| advisor        | own + sourced leads; own trades | same pipeline and month progress bar as wealth_manager; log/edit/delete own trades; admin-entered incentive |
| admin          | everything | pipeline, Trades, Targets, employee CSV, confirmed deletes (lead / trade / insurance), Account Opened By |

All of this is enforced **server-side**, not just hidden in the UI — the
auth rules in `amplify/data/resource.ts` (`allow.ownerDefinedIn('owner')`,
`.to(['read'])` for `sourcedBy`, `allow.group(...)`) mean AppSync itself
rejects a write from anyone who isn't the current owner or an admin,
even if a client bypassed the UI entirely. See `SCHEMA_DESIGN.md` for
how the schema encodes this.

### Staff setup

A `StaffProfile` row (`username`, `displayName`, `role`) is what turns
a raw Cognito ID into a friendly name on cards and in people-pickers
(joint meeting colleague, account opener). **This now happens
automatically** — the app creates it on a user's first login, using the
local part of their email as the display name (e.g.
`advisor@shubhdesk.test` → "advisor"). No admin step required for the
app to work correctly.

If you want a nicer name than the email prefix, an admin can still
edit the row afterward in the Amplify console's Data manager. The
`StaffProfile.username` there must be the user's actual Cognito
**Username**, which is an auto-generated ID — **not their email** —
visible on the user's detail page in the Cognito console. Full steps
in `DEPLOY.md`.

---

## Validation & error handling

- **Client name** is required on new leads (marked with a red `*`).
  Email is not collected. Location and an optional **Joint Meeting**
  colleague (everyone except you) can be set on create; picking a
  colleague places the card in Joint Meeting.
- Every action that can fail (create, move, note, follow-up) shows a
  **plain-language explanation** of what went wrong, with the raw
  technical detail appended so it can be copy-pasted and shared with
  whoever maintains the app, instead of a bare "couldn't do X".

---

## Admin: employee activity report

Admins get a "⬇ Report" button that downloads a CSV for This Week /
This Month / Last Month, per employee: leads sourced, deals closed
(count + value), owner handoffs, pipeline stage breakdown, plus
**Closed Target / Actual / %**, **Revenue Target / Actual / %**, and
**Incentive Earned**.

- Closed dates use `Lead.closedAt` (falls back to `updatedAt` for older
  rows). Owner handoffs use `Lead.handoffAt` the same way — this only
  counts a lead whose current `owner` differs from `sourcedBy`, which
  the app itself no longer does automatically, so it's effectively a
  historical figure for older data.
- **Deals Closed** in the CSV counts only leads the person currently
  **owns**. **Closed Actual** counts owner **or** `sourcedBy` (same as
  NCA credit).
- **Closed Target / Revenue Target** come from weekly `Target` rows
  whose Monday falls in the report period (the older per-employee
  weekly goals) — not from the NCA/AUM/SIP/Insurance quotas on the
  Targets tab.
- **Revenue Actual** and **Incentive Earned** sum admin-entered
  `FinanceEntry` rows (`revenue` / `incentive`) for that employee in
  the report period. Trade brokerage is not split into these columns.

Computed client-side from data already loaded — see `src/report.ts`.

---

## Targets tab (admin)

- **Individual quotas** (collapsed by default — one-time setup): the
  same NCA / AUM / SIP / Insurance numbers for every Wealth Manager, for
  monthly, quarterly, and yearly. Not a team pool and not a per-person
  table. Defaults until admin saves:

  | | Monthly | Quarterly | Yearly |
  |---|---:|---:|---:|
  | NCA (closed clients) | 10 | 30 | 120 |
  | AUM (₹) | 2,00,000 | 6,00,000 | 30,00,000 |
  | SIP (₹) | 5,000 | 30,000 | 1,00,000 |
  | Insurance (₹) | 50,000 | 1,50,000 | 6,00,000 |

- **Employee progress**: one card per Wealth Manager/Advisor. **Monthly**
  by default; radios switch the whole list to Quarterly or Yearly (only
  one cadence visible). The heading is the period being shown (e.g.
  August 2026 / Q3 2026 / 2026).
- **Insurance company revenue**: admin enters company ₹ attributed to
  a Wealth Manager (`earnedOn` date); the UI shows their 50%
  automatically. Deleting an entry asks for confirmation.

On the **pipeline**, admin does **not** see per-person strips. They see
**Company targets** = per-person quota × number of Wealth Managers, vs
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

Count of **closed leads of any service** (Investment, Trading, Both,
SIP, Insurance, Loans) in the period.

| View | What is counted |
|---|---|
| One employee (Targets tab, personal strip) | Closed leads where they are **owner or sourcedBy** (both get credit if ownership is ever reassigned) |
| Company (admin pipeline) | Closed leads **once** (no double-count) |

Goal for one person = the quota admin saved (default 10 / month).
Company goal = that quota × count of Wealth Manager profiles.

### AUM

Sum of admin-entered **AUM Tracking** rows (`FinanceEntry` kind
`aum`: date, employee, amount) in the period. Not taken from closed
Trading lead value.

### SIP

Sum of `Lead.value` on **closed SIP** leads in the period.
Same credit rules as NCA. There is no brokerage split for SIP yet.

### Insurance

Not taken from `Lead.value`. Admin types **company ₹** on
`InsuranceRevenue` (`earnedOn` date, attributed to a `username`).

- Company / employee actual = sum of those rows in the period
  (employee: only rows for that username).
- Wealth Manager incentive = **50%** of that company ₹
  (`INSURANCE_WEALTH_MANAGER_SHARE`).

### Trading (advisor trades)

**Company revenue** = brokerage − 20% platform (`brokerage × 0.8`).
Shown on the admin Trades tab (totals + Company ₹ column) and admin
CSV. Advisor / employee payout is **not** calculated or shown.
Incentive is admin-entered on Targets (`FinanceEntry`).

### Loans

No revenue formula yet. Closed Loans still count toward **NCA**
(any closed service).

### Incentive (monthly)

Admin enters **Employee + incentive amount + date** on the Targets
tab (below Revenue). Shown on Wealth Manager/Advisor as **This Month's
Incentive**. There is no calculated advisor-trade incentive. The
employee CSV **Incentive Earned** column sums those admin rows for
the report period.

Admin also enters **Revenue** (company ₹, employee, date) on Targets
— that total replaces the old Pipeline Value card.

---

## Other docs

| File | What it covers |
|---|---|
| [DEPLOY.md](./DEPLOY.md) | Amplify Hosting, domain, creating staff + Cognito groups |
| [SCHEMA_DESIGN.md](./SCHEMA_DESIGN.md) | DynamoDB models, indexes, auth rules, access patterns |
| [CLAUDE.md](./CLAUDE.md) | Architecture notes for coding in this repo |
| [PLAN_TARGETS_AND_INCENTIVES.md](./PLAN_TARGETS_AND_INCENTIVES.md) | **Superseded** early design — what shipped is above |
