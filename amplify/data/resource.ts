import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * ShubhDesk — Data model
 * ---------------------------------------------------------------
 * Pipeline: Lead + Note. Directory: StaffProfile. Codes: Counter.
 * Advisor log: Trade (standalone). Quotas: CompanyTarget (shared
 * individual numbers, one row per cadence) + Target (advisor weekly).
 * Insurance company ₹: InsuranceRevenue (admin-entered).
 *
 * The ownership + read-only rules you asked for are enforced HERE,
 * on the server — not just hidden in the UI. That means even if
 * someone bypassed the app, Cognito + AppSync would still block a
 * wealth manager from editing a lead whose ownership moved elsewhere.
 *
 * Ownership rule:
 *   - `owner`     = who currently controls the lead (auto-managed).
 *   - `sourcedBy` = who first created it (never changes).
 *
 * Joint Meeting records who the owner went on the call with
 * (`jointWith`) and where (`meetingLocation`). Owner does not change.
 * `sourcedBy` still preserves read-only visibility if ownership is
 * later reassigned.
 */

const schema = a.schema({
  Lead: a
    .model({
      // --- Client record ---
      clientCode: a.string(),        // human reference, e.g. SSKH-2608-042
      client: a.string().required(), // client name
      phone: a.string(),
      email: a.email(),              // optional; not collected on New Lead
      requirements: a.string(),      // what the client wants (demands/notes)
      meetingLocation: a.string(),   // where the meeting / joint call happened
      // Colleague on the joint call (Cognito username). Not the owner.
      jointWith: a.string(),

      // --- Pipeline ---
      service: a.enum([
        'Investment',
        'Trading',
        'Both',
        'SIP',
        'Insurance',
        'Loans',
      ]),
      // Live pipeline: new → meeting → joint_meeting → closed.
      // followup / inprogress / rejected stay in the enum so existing
      // DynamoDB items still read; they are not board stages.
      stage: a.enum([
        'new',
        'meeting',
        'joint_meeting',
        'followup',
        'inprogress',
        'closed',
        'rejected',
      ]),
      value: a.integer(),

      // Where the lead came from. Optional, defaults to a sensible
      // choice in the UI — not meant to add data-entry overhead.
      source: a.enum(['cold_call', 'referral', 'walk_in', 'existing_client', 'digital', 'other']),

      // Why a lead was rejected. Optional and only ever set when
      // stage moves to "rejected" — feeds the win-back follow-up flow.
      rejectionReason: a.enum(['not_interested', 'competitor', 'budget', 'bad_timing', 'other']),

      // --- Win-back follow-up ---
      // Date to revisit a dormant/rejected client (YYYY-MM-DD).
      followUpOn: a.date(),

      // Calendar date the lead was closed (YYYY-MM-DD, local). Set in
      // moveStage when entering "closed"; cleared if it leaves closed.
      // Monthly NCA/AUM/SIP actuals use this so a later edit (follow-up
      // date, value, note-adjacent updates) cannot shift the close into
      // another month via Amplify's automatic updatedAt.
      closedAt: a.date(),

      // Calendar date of the first joint meeting (YYYY-MM-DD). Set once
      // when the lead first enters "joint_meeting". Report counts use
      // this instead of updatedAt for the same reason as closedAt.
      handoffAt: a.date(),

      // Who currently controls the lead. Amplify keeps this in sync
      // with the logged-in user identifier used by the owner rule.
      owner: a.string(),

      // The wealth manager/advisor who originally created the lead. Set
      // once, never reassigned — this is what preserves read-only
      // visibility if ownership is ever reassigned.
      sourcedBy: a.string(),

      // One Lead has many Note entries (the activity log).
      notes: a.hasMany('Note', 'leadId'),
    })
    .authorization((allow) => [
      // Admin: full control over every lead.
      allow.group('admin'),

      // Current owner: full control (read + update + delete) of their
      // own leads. `ownerDefinedIn('owner')` ties this rule to the
      // `owner` field above, so ownership transfers with a field write.
      allow.ownerDefinedIn('owner'),

      // Original owner: READ-ONLY if `owner` is ever reassigned. This is
      // a second owner-style rule bound to `sourcedBy`, narrowed to read
      // only.
      allow.ownerDefinedIn('sourcedBy').to(['read']),
    ]),

  // Staff directory: maps a Cognito username to a display name and role.
  // Lets the app show "Anita" on cards and populate people-pickers (joint
  // meeting colleague, account opener) without querying Cognito from the
  // browser. Auto-created by the app on first login (see
  // ensureOwnStaffProfile in leadClient.ts) if missing, using the user's
  // email; admins can fix up displayName afterward via the Data manager.
  StaffProfile: a
    .model({
      username: a.string().required(), // matches Cognito username
      displayName: a.string().required(),
      // Live roles: admin / wealth_manager / advisor.
      // sales / rm / dealer stay so existing DynamoDB rows still read;
      // AppSync rejects the whole listStaff query if any item has an
      // enum value that is not listed here.
      role: a.enum(['admin', 'wealth_manager', 'advisor', 'sales', 'rm', 'dealer']),
    })
    .authorization((allow) => [
      allow.group('admin'),
      // A user may create/update only their own row (username must
      // match their own identity) — this is what lets self-registration
      // work without granting broad write access to the directory.
      allow.ownerDefinedIn('username').to(['create', 'update']),
      // Everyone can read the directory (needed for names + people-pickers).
      allow.authenticated().to(['read']),
    ]),

  // Monthly sequence counter for client codes (SSKH-YYMM-NNN).
  // One row per YYMM period; `seq` increments as leads are created.
  Counter: a
    .model({
      period: a.string().required(), // e.g. "2608"
      seq: a.integer().default(0),
    })
    .identifier(['period'])
    .authorization((allow) => [
      allow.group('admin'),
      // Any signed-in staff can read/update the counter when creating a lead.
      allow.authenticated().to(['read', 'create', 'update']),
    ]),

  // Advisor trade log. Deliberately standalone from Lead — advisors
  // execute trades independently of the wealth-manager pipeline, and this
  // is intentionally a minimal 3-field record, not a cut-down Lead.
  Trade: a
    .model({
      clientName: a.string().required(),
      buyingLot: a.string(),   // free text: instrument + quantity, advisor's own shorthand
      brokerage: a.integer(),  // brokerage earned on the trade, in rupees
      owner: a.string(),       // the advisor who logged it
      // Who opened the trading account: OWN or a wealth manager/admin username.
      accountOpenedBy: a.string(),
    })
    .authorization((allow) => [
      allow.group('admin'),
      // An advisor sees and manages only their own trades.
      allow.ownerDefinedIn('owner'),
      // Wealth managers named as Account Opened By can read those trades. No writes.
      allow.ownerDefinedIn('accountOpenedBy').to(['read']),
    ]),

  // Company-set individual quotas, one row per cadence. Same numbers
  // for every wealth manager (not a team pool, not per-person rows). Do
  // not rename this model — Amplify would create a new table and drop
  // the three existing rows. If quotas ever need to differ by person, add
  // `username` to the identifier then; don't pre-split the table now.
  CompanyTarget: a
    .model({
      // Keep as string (not enum): this field is the DynamoDB key.
      // Changing its GraphQL type would risk a table rebuild. Valid
      // values are enforced in upsertCompanyTarget: monthly | quarterly | yearly.
      periodType: a.string().required(),
      ncaTarget: a.integer().default(0),         // New Client Acquisition (count)
      aumTarget: a.integer().default(0),         // AUM in ₹
      sipTarget: a.integer().default(0),         // SIP in ₹
      insuranceTarget: a.integer().default(0),   // Insurance in ₹
    })
    .identifier(['periodType'])
    .authorization((allow) => [
      allow.group('admin'),
      allow.authenticated().to(['read']),
    ]),

  // Legacy weekly per-employee goals (admin CSV Closed/Revenue Target).
  // Not shown on advisor login — advisors have no revenue quota.
  // Wealth managers now use CompanyTarget on their personal strip instead.
  Target: a
    .model({
      username: a.string().required(), // Cognito username, same as Lead.owner
      weekStart: a.string().required(), // Monday of the week, YYYY-MM-DD
      leadsClosedTarget: a.integer().default(0), // count of closed deals
      revenueTarget: a.integer().default(0),     // ₹ company revenue attributed to them
    })
    .identifier(['username', 'weekStart'])
    .authorization((allow) => [
      allow.group('admin'),
      allow.ownerDefinedIn('username').to(['read']),
    ]),

  // Admin-entered company revenue for Insurance (Trading is derived from
  // Trade.brokerage — do not duplicate it here). Wealth manager incentive
  // is 50% of companyRevenue, computed in src/revenue.ts, not stored.
  InsuranceRevenue: a
    .model({
      username: a.string().required(), // employee this amount is attributed to
      companyRevenue: a.integer().required(), // ₹ the company actually earned
      earnedOn: a.date().required(),   // YYYY-MM-DD the revenue belongs to
      note: a.string(),
    })
    .authorization((allow) => [
      allow.group('admin'),
      allow.ownerDefinedIn('username').to(['read']),
    ]),

  // Admin-entered AUM / company revenue / incentive. Replaces calculated
  // advisor incentive and lead-value AUM on progress strips. Employees
  // can read their own rows (username) so their month bar can show them.
  FinanceEntry: a
    .model({
      kind: a.enum(['aum', 'revenue', 'incentive']),
      username: a.string().required(),
      amount: a.integer().required(),
      earnedOn: a.date().required(),
      note: a.string(),
    })
    .authorization((allow) => [
      allow.group('admin'),
      allow.ownerDefinedIn('username').to(['read']),
    ]),

  Note: a
    .model({
      leadId: a.id().required(),
      lead: a.belongsTo('Lead', 'leadId'),

      text: a.string().required(),
      // "note" = a human comment, "system" = auto entry (stage change,
      // handoff). The UI styles them differently.
      type: a.enum(['note', 'system']),
      author: a.string(), // Cognito username at write time; resolved to a display name via nameOf() at render, same as Lead.owner/sourcedBy
    })
    .authorization((allow) => [
      allow.group('admin'),
      // Any signed-in staff member can read the log and add entries.
      // (Notes are cheap and shared; the sensitive control is on Lead.)
      allow.authenticated().to(['read', 'create']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Everyone signs in through Cognito. No public API-key access.
    defaultAuthorizationMode: 'userPool',
  },
});
