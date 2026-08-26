# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ShubhDesk — internal sales pipeline (Kanban-style CRM) for ShubhShree Knowledge Hub Pvt. Ltd. Telecallers/salesmen work leads through early stages, then hand off to a Relationship Manager (RM) who closes the deal. React + Vite frontend on AWS Amplify Gen 2 (Cognito auth, DynamoDB/AppSync data), sized for a team under 10 people on the AWS free tier.

## Commands

```bash
npm install          # install deps
npx ampx sandbox      # start local Amplify cloud sandbox (Cognito + DynamoDB in your AWS account);
                      # writes amplify_outputs.json — required before `npm run dev` will work
npm run dev           # Vite dev server (in a second terminal, alongside the sandbox)
npm run build         # tsc -b && vite build
npm run preview       # preview the production build
npm run sandbox       # alias for `ampx sandbox`
```

There is no lint or test script configured in `package.json`. `tsc -b` (part of `npm run build`) is the only type-checking step.

The app cannot run without a live sandbox: `src/main.tsx` imports `../amplify_outputs.json`, which only exists after `npx ampx sandbox` has run at least once and is regenerated (hot-reloaded) whenever the `amplify/` schema changes.

## Architecture

**Two-sided app: `amplify/` defines the backend-as-code, `src/` is the entire frontend.**

- `amplify/auth/resource.ts` — Cognito user pool, email login, no self-signup (`hideSignUp` in the UI). Four groups: `admin`, `rm`, `sales`, `dealer`. Staff accounts are created by hand in the Amplify console, one group each.
- `amplify/data/resource.ts` — the data model and, critically, the **authorization rules that enforce the business logic server-side**: `Lead` has an `owner` field (who currently controls it) and a separate `sourcedBy` field (who originally created it, set once). `allow.ownerDefinedIn('owner')` grants full read/write to the current owner; `allow.ownerDefinedIn('sourcedBy').to(['read'])` gives the original salesman permanent read-only visibility after handoff. This is the mechanism behind the whole sales→RM handoff feature — it is not just a UI convention, AppSync/Cognito reject writes from a non-owner even if the client were bypassed. `Lead.email` is `.required()` — enforced both by client-side form validation and the schema itself.
- `amplify/backend.ts` — wires `auth` + `data` together via `defineBackend`.
- `Trade` (in `amplify/data/resource.ts`) is a **fully standalone** model — not related to `Lead` at all. It's the entire data surface for the `dealer` role: `clientName`, `buyingLot` (free text — instrument + quantity, dealer's own shorthand, deliberately not a structured field), `brokerage` (integer, ₹), and `owner`. Auth is just `allow.group('admin')` + `allow.ownerDefinedIn('owner')` — a dealer only ever sees their own trades. `src/tradeClient.ts` is the CRUD client for it, mirroring `leadClient.ts`'s pattern but intentionally not reusing any of its code, since the two models don't share anything.
- `src/leadClient.ts` — the only place that talks to the Amplify Data client (`generateClient<Schema>()`). All reads/writes for `Lead`, `Note`, `StaffProfile`, `Counter` go through here. Notable behaviors:
  - `getMe()` derives the caller's `role` from the Cognito `cognito:groups` claim (admin > rm > sales precedence).
  - `nextClientCode()` uses a per-month `Counter` row to generate sequential `SSKH-YYMM-NNN` codes.
  - `moveStage()` detects the sales→RM handoff (moving into `meeting` from a sales stage with an `rmUsername` given), reassigns `owner`, and writes a system-type `Note` in the same call.
  - `friendlyError(e, fallback)` turns a raw GraphQL error array / `Error` into a plain-language message with the technical detail appended — used by every catch block in `App.tsx` so error banners are shareable with support instead of generic "couldn't do X" text.
- `src/App.tsx` — the entire UI (board/list/follow-ups views, lead drawer, new-lead modal) as one file, inline-styled (`S` style object + a `CSS` template string), no component library beyond `@aws-amplify/ui-react`'s `Authenticator` and `@dnd-kit/core` for the board. Role-based visibility is re-derived client-side (`visibleLeads`, `canEdit`) purely for UX — the actual enforcement is server-side per above, so client-side checks here are a convenience, not a security boundary.
  - `requestMove()` is the single entry point for moving a lead to a new stage — both the drawer's stage buttons and the board's drag-and-drop call it, so the RM-handoff branching logic lives in one place, not duplicated. It routes into `handoffPrompt` state (a modal at the `App` level, not inside the drawer) whenever the target is `meeting` from a sales stage.
  - The board (`Board`/`DroppableColumn`/`DraggableLeadCard`) uses `@dnd-kit/core` with separate `MouseSensor` (distance-activated, so a plain click still opens the drawer) and `TouchSensor` (delay-activated, so a quick swipe still scrolls) — native HTML5 drag-and-drop was tried first and dropped because it doesn't respond to touch at all.
  - `LeadDrawer` shows an explicit "→ Proceed to Meeting" / "✕ Client Rejected" choice when a lead is in `new`, above the general stage grid — a UI decision point, not a schema change (`rejected` was already a valid target from any stage). Moving to `rejected` from *any* entry point (drawer, drag-and-drop, the general grid) routes through `requestMove` into a `rejectPrompt` modal for an optional one-click reason (`Lead.rejectionReason`), same lifted-state pattern as the handoff prompt.
  - `Lead.source` is captured once, at creation, via a plain `<select>` on the New Lead form defaulting to `cold_call` — deliberately optional and pre-filled so it adds zero data-entry friction. `SOURCES`/`REJECTION_REASONS` in `App.tsx` mirror the `source`/`rejectionReason` enums in `amplify/data/resource.ts`, same duplication pattern as `STAGES`.
- `src/main.tsx` — Amplify configuration + the Cognito `<Authenticator>` login gate wrapping `<App>`, with a custom navy/gold theme.
- `src/report.ts` — the admin-only employee activity report (CSV download). Pure client-side aggregation over the `leads`/`staff` already loaded into `App.tsx` state — no new queries, no backend changes. See "Access patterns" in `SCHEMA_DESIGN.md` before adding a report metric that isn't derivable from already-loaded data; that would need a new indexed query, not just a new column here. `tradesToCSV()` in the same file does the equivalent for `Trade` (filtered by day, not by employee).
- **Dealer role**: `App.tsx` branches to a dedicated, minimal render (`me.role === "dealer"`) that skips the entire Lead pipeline UI — no board, no tabs, no drawer — and shows only `TradesView`. Admins get the same `TradesView` component via an extra "Trades" tab alongside the pipeline views. `TradesView` computes a same-day "Dealer Brokerage" summary (total + per-dealer breakdown via `nameOf`) client-side from whatever `trades` it's handed — for a dealer that's just their own trades (so the breakdown is trivially one row); for admin it's everyone's. The initial-load `useEffect` in `App` is role-branched: dealers fetch only `listTrades()` + `listStaff()` (for `nameOf`), never `listLeads()`/`listRMs()` — no point loading pipeline data a role can't see.

**Stages** (`STAGES` in `App.tsx`, mirrored by the `stage` enum in `amplify/data/resource.ts`): `new → meeting → followup → inprogress → closed / rejected`. `calling`/`contacted` were removed from the enum (2026-08) — the intermediate call-tracking stages weren't needed and were collapsed into `new`. `SALES_STAGES = [new]` marks the only pre-handoff stage; entering `meeting` from it triggers the RM-handoff flow (prompts for an RM, transfers `owner`). The board grid is 3 columns (`repeat(3, ...)` in the `.board` CSS class) to fit the current 6 stages evenly — update that alongside `STAGES` if the stage count changes again.

**Follow-ups / win-back**: `followUpOn` (date) on a `Lead` drives the "Follow-ups Due" view — leads with a due date on or before today, for reconnecting with dormant/rejected clients.

When changing the data model, edit `amplify/data/resource.ts` and keep the sandbox (`ampx sandbox`) running so the schema and generated types hot-reload; `src/leadClient.ts` and `src/App.tsx` consume `Schema['Lead']['type']` etc. directly from that file. See [SCHEMA_DESIGN.md](./SCHEMA_DESIGN.md) for the full data model, access patterns (query vs. scan), and a checklist for adding fields/queries without accidentally introducing an unindexed scan.

## Deployment

Full deployment steps (Amplify Hosting, custom domain via GoDaddy, adding staff/roles) are in [DEPLOY.md](./DEPLOY.md). Notably: every push to the connected branch (`main`) auto-deploys via Amplify Hosting, and staff are provisioned two ways — a Cognito user (console) and a matching `StaffProfile` row. **`StaffProfile.username` must be the user's actual Cognito `Username`, which is an auto-generated ID (a UUID), not their email** — this pool is configured with `usernameAttributes: [email]` for *sign-in*, but Cognito still assigns a random Username under the hood, and that's what `getCurrentUser().username` returns and what `owner`/`sourcedBy` get set to. Look it up on the user's detail page in the Cognito console.
