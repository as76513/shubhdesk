# ShubhDesk

Internal sales pipeline for **ShubhShree Knowledge Hub Pvt. Ltd.**

Telecaller/salesman work leads through the early stages, then hand off to
a Relationship Manager who closes the deal. Tracks client details, a
client code (`SSKH-YYMM-NNN`), requirements, and win-back follow-ups.

Built with React + Vite + AWS Amplify Gen 2 (Cognito auth, DynamoDB
data). Runs on AWS free tier for a small team.

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
  auth/resource.ts    Cognito user pool + admin/rm/sales groups
  data/resource.ts    Lead, Note, Counter, StaffProfile models + auth rules
  backend.ts          Wires it together
src/
  main.tsx            Amplify config + Cognito login gate
  App.tsx             The app UI (loads from backend, role-aware)
  leadClient.ts       All backend calls + friendlyError() error messaging
  report.ts           Admin employee activity report (CSV)
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
decision later.

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

---

## Dealer trade log

**Dealer is a separate, standalone role** — it has nothing to do with
the Lead pipeline above. A Dealer's entire screen is a simple log of
trades: **Client Name, Buying Lot, Brokerage**, no stages, no board.
A dealer sees and manages only their own trades.

Admins get an extra **Trades** tab (alongside the pipeline views)
showing every dealer's trades, with:
- A date picker (defaults to today) and a **"⬇ Download Day's
  Trades"** CSV export (Date, Client Name, Buying Lot, Brokerage).
- A **Dealer Brokerage** summary for that date — total brokerage
  earned, total trade count, and a per-dealer breakdown — so you can
  see at a glance who earned what on a given day.

---

## Roles

| Role   | Sees | Can do |
|--------|------|--------|
| sales  | own + sourced leads | create leads, hand off to RM from New |
| rm     | all leads (read); owned leads (write) | take handoffs, run Meeting→Closed, win-back list |
| dealer | own trades only | log/edit/delete their own trades |
| admin  | everything | full control, including the employee activity report and all dealer trades |

All of this is enforced **server-side**, not just hidden in the UI — the
auth rules in `amplify/data/resource.ts` (`allow.ownerDefinedIn('owner')`,
`.to(['read'])` for `sourcedBy`, `allow.group(...)`) mean AppSync itself
rejects a write from anyone who isn't the current owner or an admin,
even if a client bypassed the UI entirely. See `SCHEMA_DESIGN.md` for
how the schema encodes this.

### Staff setup gotcha

Every employee needs **two** things, not one: a Cognito user (created in
the console) *and* a matching `StaffProfile` row (`username`,
`displayName`, `role`) — otherwise they show up as a raw ID instead of
their name, and RMs without a profile row won't appear in the handoff
picker at all. The `StaffProfile.username` must be their actual Cognito
**Username**, which is an auto-generated ID — **not their email** —
visible on the user's detail page in the Cognito console. Full steps in
`DEPLOY.md`.

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
(count + value), handoffs to RM, and current pipeline stage breakdown.
Computed entirely client-side from data already loaded — see
`src/report.ts`.
