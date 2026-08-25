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
  leadClient.ts       All backend calls
DEPLOY.md             Full deployment guide
```

---

## Roles

| Role  | Sees | Can do |
|-------|------|--------|
| sales | own + sourced leads | create leads, work New→Contacted, hand off to RM |
| rm    | all leads | take handoffs, run Meeting→Closed, win-back list |
| admin | everything | full control |

Handoff: moving a lead to **Meeting** transfers ownership to the chosen
RM. The original salesman keeps read-only visibility. All enforced
server-side by the auth rules in `amplify/data/resource.ts`.
