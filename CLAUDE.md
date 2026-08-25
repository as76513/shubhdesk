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

- `amplify/auth/resource.ts` — Cognito user pool, email login, no self-signup (`hideSignUp` in the UI). Three groups: `admin`, `rm`, `sales`. Staff accounts are created by hand in the Amplify console, one group each.
- `amplify/data/resource.ts` — the data model and, critically, the **authorization rules that enforce the business logic server-side**: `Lead` has an `owner` field (who currently controls it) and a separate `sourcedBy` field (who originally created it, set once). `allow.ownerDefinedIn('owner')` grants full read/write to the current owner; `allow.ownerDefinedIn('sourcedBy').to(['read'])` gives the original salesman permanent read-only visibility after handoff. This is the mechanism behind the whole sales→RM handoff feature — it is not just a UI convention, AppSync/Cognito reject writes from a non-owner even if the client were bypassed.
- `amplify/backend.ts` — wires `auth` + `data` together via `defineBackend`.
- `src/leadClient.ts` — the only place that talks to the Amplify Data client (`generateClient<Schema>()`). All reads/writes for `Lead`, `Note`, `StaffProfile`, `Counter` go through here. Notable behaviors:
  - `getMe()` derives the caller's `role` from the Cognito `cognito:groups` claim (admin > rm > sales precedence).
  - `nextClientCode()` uses a per-month `Counter` row to generate sequential `SSKH-YYMM-NNN` codes.
  - `moveStage()` detects the sales→RM handoff (moving into `meeting` from a sales stage with an `rmUsername` given), reassigns `owner`, and writes a system-type `Note` in the same call.
- `src/App.tsx` — the entire UI (board/list/follow-ups views, lead drawer, new-lead modal) as one file, inline-styled (`S` style object + a `CSS` template string), no component library beyond `@aws-amplify/ui-react`'s `Authenticator`. Role-based visibility is re-derived client-side (`visibleLeads`, `canEdit`) purely for UX — the actual enforcement is server-side per above, so client-side checks here are a convenience, not a security boundary.
- `src/main.tsx` — Amplify configuration + the Cognito `<Authenticator>` login gate wrapping `<App>`, with a custom navy/gold theme.

**Stages** (`STAGES` in `App.tsx`, mirrored by the `stage` enum in `amplify/data/resource.ts`): `new → calling → contacted → meeting → followup → inprogress → closed / rejected`. `SALES_STAGES = [new, calling, contacted]` marks which stages are pre-handoff; entering `meeting` from one of these triggers the RM-handoff flow (prompts for an RM, transfers `owner`).

**Follow-ups / win-back**: `followUpOn` (date) on a `Lead` drives the "Follow-ups Due" view — leads with a due date on or before today, for reconnecting with dormant/rejected clients.

When changing the data model, edit `amplify/data/resource.ts` and keep the sandbox (`ampx sandbox`) running so the schema and generated types hot-reload; `src/leadClient.ts` and `src/App.tsx` consume `Schema['Lead']['type']` etc. directly from that file.

## Deployment

Full deployment steps (Amplify Hosting, custom domain via GoDaddy, adding staff/roles) are in [DEPLOY.md](./DEPLOY.md). Notably: every push to the connected branch (`main`) auto-deploys via Amplify Hosting, and staff are provisioned two ways — a Cognito user (console) and a matching `StaffProfile` row (`username` must match the Cognito username exactly) so the app can resolve display names and populate the RM handoff dropdown.
