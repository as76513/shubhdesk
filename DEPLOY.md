# ShubhDesk — Deployment Guide (AWS Amplify + GoDaddy)

This is the end-to-end path to get ShubhDesk live at
`desk.shubhshreeknowledgehub.com` on your AWS free-tier account.
Everything here stays within free tier for under 10 users.

---

## What you're deploying

- **Frontend:** the React app (the prototype, wired to the backend)
- **Auth:** Cognito user pool with `admin` / `rm` / `sales` / `dealer` groups
- **Data:** DynamoDB tables for `Lead`, `Note`, `StaffProfile`, `Counter`,
  `Trade`, `CompanyTarget`, `Target`, and `InsuranceRevenue`, behind AppSync
- **Hosting + SSL + domain:** all handled by Amplify Hosting

The `amplify/` folder already defines auth and data. Frontend clients:
`src/leadClient.ts`, `src/tradeClient.ts`, `src/targetClient.ts`.
Business formulas (NCA / AUM / SIP / Insurance / trading splits) are in
`src/revenue.ts` and documented in README.md.

---

## Step 1 — Prerequisites (30 min)

1. Install Node.js 18+ and Git.
2. Create a GitHub (or GitLab/Bitbucket) repo and push your app there.
   Amplify deploys from a connected repo.
3. Have your AWS account login ready.

---

## Step 2 — Scaffold the Amplify app (1 hour)

In your React project root:

```bash
npm create amplify@latest
```

This creates an `amplify/` folder. Replace its generated files with the
three from this bundle:

- `amplify/auth/resource.ts`
- `amplify/data/resource.ts`
- `amplify/backend.ts`

Then start the local cloud sandbox to test the backend live:

```bash
npx ampx sandbox
```

This provisions a temporary copy of Cognito + DynamoDB in your AWS
account and writes an `amplify_outputs.json` file into your project.
Leave it running while you develop — it hot-reloads on schema changes.

---

## Step 3 — Connect the frontend (mostly done)

The wired frontend is already built — you don't adapt the prototype by
hand. Copy these files into your project's `src/`:

- `src/main.tsx` — configures Amplify and shows the Cognito login gate
  (`<Authenticator hideSignUp>`), themed navy/gold.
- `src/App.tsx` — the full app: loads leads from the backend, reads the
  signed-in user's role from their Cognito group, and calls the data
  client for every action. Includes loading and error states. Dealers
  skip the pipeline and see only trades; admin also has Trades and
  Targets tabs.
- `src/leadClient.ts` — Lead / Note / Staff / Counter (list, create,
  move/handoff, notes, follow-ups, staff directory, lead delete).
- `src/tradeClient.ts` — Trade CRUD.
- `src/targetClient.ts` — CompanyTarget, weekly Target, InsuranceRevenue.
- `src/revenue.ts` — NCA / AUM / SIP / Insurance actuals and trading splits.

Install the libraries:

```bash
npm install aws-amplify @aws-amplify/ui-react
```

Put your logo at `src/shubhshree-logo.jpg` (or change the `LOGO`
constant near the top of `App.tsx` to your hosted URL).

That's it — the components already use the real data source. The only
thing they need is a running backend (Step 2) so `amplify_outputs.json`
exists.

---

## Step 4 — Add your staff (20 min)

Two small things per employee: a **login** (Cognito) and a **profile
row** (so the app can show their name and list RMs for handoff).

**4a. Cognito login.** In the Amplify console → **Authentication** →
**Users**, for each of your ~8 people:

1. Create the user with their email.
2. Add them to one group: `sales`, `rm`, `dealer`, or `admin`.

Cognito emails them an invite — no passwords to manage by hand.

**4b. Staff profile (usually automatic).** The app creates a
`StaffProfile` row for each person the first time they log in, using
the local part of their email as the display name (e.g.
`anita@shubhshreeknowledgehub.com` → "anita"). Nothing to do here for
the app to work correctly.

If you want a nicer name than the auto-generated one, edit the row
afterward in the Amplify console → **Data manager**:

- `username` — must match their Cognito username exactly (not their email)
- `displayName` — e.g. "Anita Desai (RM)"
- `role` — `sales`, `rm`, `dealer`, or `admin`

This directory is what turns usernames into friendly names on cards and
populates the "Hand off to RM" dropdown.

---

## Step 5 — Deploy to Amplify Hosting (1 hour)

1. In the AWS Amplify console, choose **Deploy an app** and connect your
   Git repo and branch (e.g. `main`).
2. Amplify auto-detects the build settings for a Vite/React + Amplify
   Gen 2 app. Accept them.
3. First build takes a few minutes. You get a URL like
   `https://main.d1234abcd.amplifyapp.com` — test it end to end.

Every push to `main` now redeploys automatically.

---

## Step 6 — Point your GoDaddy domain (30 min + DNS wait)

You'll use a subdomain like `desk.shubhshreeknowledgehub.com` so it
doesn't collide with your existing app on `app.` and site on the root.

1. In the Amplify console → your app → **Hosting** → **Custom domains**
   → **Add domain**.
2. Enter `shubhshreeknowledgehub.com`. Amplify will ask which
   subdomain to map — set `desk` → your `main` branch.
3. Amplify shows you **DNS records to add** — typically:
   - one **CNAME** for `desk` pointing at the Amplify domain, and
   - one **CNAME** (or the validation record) for the SSL certificate.
4. Log in to **GoDaddy** → your domain → **DNS** → **Manage Zones**.
   Add each record exactly as Amplify shows:
   - Type: `CNAME`
   - Name/Host: `desk` (GoDaddy adds the domain automatically)
   - Value/Points to: the Amplify target Amplify gave you
   - TTL: default (1 hour) is fine
5. Save. DNS propagation + certificate issue usually takes 20 minutes
   to a couple of hours. Amplify shows the status as it verifies.

When it flips to **Available**, `https://desk.shubhshreeknowledgehub.com`
serves ShubhDesk with a valid SSL certificate. Done.

---

## Step 7 — Swap the logo for production

In the app header, change the logo `src` from the bundled
`./shubhshree-logo.jpg` to your hosted copy:

```
https://app.shubhshreeknowledgehub.com/assets/logo.png
```

(or upload the logo to your Amplify app's public folder and reference
it there).

---

## Cost note (free tier)

For under 10 users, expected monthly AWS cost is effectively zero:

- Cognito: free up to 50,000 monthly active users
- DynamoDB: 25 GB storage + ample read/write in free tier
- AppSync + Amplify Hosting: within free tier at your traffic

The only charges that can appear beyond free tier are tiny data-transfer
and build-minute overages — realistically a few rupees a month.

---

## Realistic timeline

| Day | Work |
|-----|------|
| 1 | Steps 1–2: repo, scaffold, sandbox running |
| 2–3 | Step 3: wire frontend to backend, test all flows |
| 4 | Step 4: add staff, test roles & handoff end to end |
| 5 | Step 5: deploy to Amplify Hosting |
| 6 | Step 6: GoDaddy domain + SSL |
| 7 | Buffer: real-device testing on phones + desktops, fixes |

Comfortably inside your one-week target.
