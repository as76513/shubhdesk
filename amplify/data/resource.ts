import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * ShubhDesk — Data model
 * ---------------------------------------------------------------
 * Two models: Lead and Note (the activity-log entries).
 *
 * The ownership + read-only rules you asked for are enforced HERE,
 * on the server — not just hidden in the UI. That means even if
 * someone bypassed the app, Cognito + AppSync would still block a
 * salesman from editing a lead he has handed off.
 *
 * Ownership rule:
 *   - `owner`     = who currently controls the lead (auto-managed).
 *   - `sourcedBy` = the salesman who first created it (never changes).
 *
 * When a lead moves to the "meeting" stage, the app sets `owner` to
 * the chosen RM. From that moment the salesman is no longer the
 * owner, so his write access falls away automatically — but because
 * we ALSO allow the original `sourcedBy` user to READ, he keeps his
 * read-only visibility. Exactly the behaviour from the prototype.
 */

const schema = a.schema({
  Lead: a
    .model({
      // --- Client record ---
      clientCode: a.string(),        // human reference, e.g. SSKH-2608-042
      client: a.string().required(), // client name
      phone: a.string(),
      email: a.email().required(),
      requirements: a.string(),      // what the client wants (demands/notes)

      // --- Pipeline ---
      service: a.enum(['Trading', 'SIP', 'Insurance', 'Loans']),
      stage: a.enum([
        'new',
        'meeting',
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

      // Who currently controls the lead. Amplify keeps this in sync
      // with the logged-in user identifier used by the owner rule.
      owner: a.string(),

      // The salesman who originally created the lead. Set once, never
      // reassigned — this is what preserves read-only visibility after
      // handoff.
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

      // Original salesman: READ-ONLY once handed off. This is a second
      // owner-style rule bound to `sourcedBy`, narrowed to read only.
      allow.ownerDefinedIn('sourcedBy').to(['read']),

      // Any RM can read leads (so they see incoming handoffs on the
      // board). Writes still require being the owner via the rule above.
      allow.group('rm').to(['read']),
    ]),

  // Staff directory: maps a Cognito username to a display name and role.
  // Lets the app show "Anita (RM)" on cards and populate the handoff
  // dropdown without querying Cognito from the browser. Create one row
  // per employee (see seed step in the deploy guide).
  StaffProfile: a
    .model({
      username: a.string().required(), // matches Cognito username
      displayName: a.string().required(),
      role: a.enum(['admin', 'rm', 'sales']),
    })
    .authorization((allow) => [
      allow.group('admin'),
      // Everyone can read the directory (needed for names + handoff list).
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

  Note: a
    .model({
      leadId: a.id().required(),
      lead: a.belongsTo('Lead', 'leadId'),

      text: a.string().required(),
      // "note" = a human comment, "system" = auto entry (stage change,
      // handoff). The UI styles them differently.
      type: a.enum(['note', 'system']),
      author: a.string(), // display name captured at write time
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
