import { generateClient } from 'aws-amplify/data';
import { getCurrentUser, fetchAuthSession, fetchUserAttributes } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import { toISODateLocal } from './revenue';

/**
 * ShubhDesk — data client
 * ---------------------------------------------------------------
 * These functions are the real-backend replacements for the
 * in-memory handlers in the prototype (moveStage, addNote, addLead).
 * The React components stay almost identical — only the data source
 * changes from useState/SEED to these calls.
 */

const client = generateClient<Schema>();

/** Walk Amplify list() pages so the board/report never silently stop at the first page. */
async function listAllPages<T>(
  fetch: (nextToken?: string | null) => Promise<{
    data?: Array<T | null> | null;
    nextToken?: string | null;
    errors?: unknown;
  }>
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: nt } = await fetch(nextToken);
    if (errors) throw errors;
    for (const row of data ?? []) {
      if (row) out.push(row);
    }
    nextToken = nt ?? null;
  } while (nextToken);
  return out;
}

// Stages owned by sales, mirroring the STAGES constant in App.tsx.
const SALES_STAGES = ['new'];

export type Role = 'admin' | 'rm' | 'sales' | 'dealer';

/** The signed-in user's id, display name, and role (from Cognito group). */
export async function getMe(): Promise<{
  username: string;
  displayName: string;
  role: Role;
}> {
  const user = await getCurrentUser();
  const session = await fetchAuthSession();
  const groups =
    (session.tokens?.accessToken?.payload['cognito:groups'] as string[]) ?? [];
  const role: Role = groups.includes('admin')
    ? 'admin'
    : groups.includes('rm')
    ? 'rm'
    : groups.includes('dealer')
    ? 'dealer'
    : 'sales';

  let displayName = user.username;
  try {
    const attrs = await fetchUserAttributes();
    displayName = attrs.preferred_username || attrs.email || user.username;
  } catch {
    /* fall back to username */
  }

  return { username: user.username, displayName, role };
}

/**
 * All RM users, for the handoff dropdown. Reads from the Cognito-backed
 * StaffProfile records (see note in App on seeding these). Falls back to
 * an empty list if none exist yet.
 */
export async function listRMs() {
  return listAllPages((nextToken) =>
    client.models.StaffProfile.list({
      filter: { role: { eq: 'rm' } },
      limit: 1000,
      nextToken,
    })
  );
}

/** All staff profiles, to resolve usernames -> display names on cards. */
export async function listStaff() {
  return listAllPages((nextToken) =>
    client.models.StaffProfile.list({ limit: 1000, nextToken })
  );
}

/**
 * Create a StaffProfile row for the current user if one doesn't exist
 * yet, using the local part of their email as a friendly display name
 * (e.g. "dealer@shubhdesk.test" -> "dealer"). Runs once per login and
 * is a no-op if a row already exists — this is what stops every new
 * hire from showing up as a raw Cognito ID until an admin manually
 * seeds a StaffProfile row for them.
 */
export async function ensureOwnStaffProfile(role: Role) {
  const user = await getCurrentUser();
  const { data: existing, errors } = await client.models.StaffProfile.list({
    filter: { username: { eq: user.username } },
  });
  if (errors) throw errors;
  if (existing.length > 0) {
    const row = existing[0];
    // Cognito group is the source of truth; keep StaffProfile.role in
    // sync so target strips and the RM picker don't use a stale role
    // after someone is moved between groups.
    if (row && row.role !== role) {
      const { data, errors: updateErrors } = await client.models.StaffProfile.update({
        id: row.id,
        role,
      });
      if (updateErrors) throw updateErrors;
      return data;
    }
    return row;
  }

  let displayName = user.username;
  try {
    const attrs = await fetchUserAttributes();
    if (attrs.email) displayName = attrs.email.split('@')[0];
    else if (attrs.preferred_username) displayName = attrs.preferred_username;
  } catch {
    /* fall back to username */
  }

  const { data, errors: createErrors } = await client.models.StaffProfile.create({
    username: user.username,
    displayName,
    role,
  });
  if (createErrors) throw createErrors;
  return data;
}


/** All leads the signed-in user is allowed to see (server enforces this). */
export async function listLeads() {
  return listAllPages((nextToken) =>
    client.models.Lead.list({ limit: 1000, nextToken })
  );
}

/**
 * Generate the next client code for the current month, e.g. SSKH-2608-042.
 * Uses a per-month Counter row so numbers stay short and restart monthly.
 */
async function nextClientCode(): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const period = `${yy}${mm}`;

  const existing = await client.models.Counter.get({ period }).catch(() => null);
  let seq = 1;
  if (existing?.data) {
    seq = (existing.data.seq ?? 0) + 1;
    await client.models.Counter.update({ period, seq });
  } else {
    await client.models.Counter.create({ period, seq: 1 });
  }
  return `SSKH-${period}-${String(seq).padStart(3, '0')}`;
}

/** Create a new lead. Records creator as owner + sourcedBy, assigns a code. */
export async function createLead(input: {
  client: string;
  phone?: string;
  email: string;
  requirements?: string;
  service: 'Trading' | 'SIP' | 'Insurance' | 'Loans';
  value?: number;
  source?: 'cold_call' | 'referral' | 'walk_in' | 'existing_client' | 'digital' | 'other';
}) {
  const me = await getCurrentUser();
  const clientCode = await nextClientCode();
  const { data, errors } = await client.models.Lead.create({
    ...input,
    email: input.email.trim(),
    clientCode,
    stage: 'new',
    owner: me.username,
    sourcedBy: me.username,
  });
  if (errors) throw errors;
  return data;
}

/** Set (or clear) the win-back follow-up date on a lead. YYYY-MM-DD. */
export async function setFollowUp(leadId: string, date: string | null) {
  const { data, errors } = await client.models.Lead.update({
    id: leadId,
    followUpOn: date,
  });
  if (errors) throw errors;
  return data;
}

/**
 * Leads with a follow-up date on or before `asOf` (default today) — the
 * "Follow-ups due" win-back list. Server auth already limits which leads
 * a user can see.
 */
export async function listFollowUpsDue(asOf?: string) {
  const cutoff = asOf ?? new Date().toISOString().slice(0, 10);
  return listAllPages((nextToken) =>
    client.models.Lead.list({
      filter: { followUpOn: { le: cutoff } },
      limit: 1000,
      nextToken,
    })
  );
}

const REJECTION_REASON_LABELS: Record<string, string> = {
  not_interested: 'Not Interested',
  competitor: 'Chose Competitor',
  budget: 'Budget',
  bad_timing: 'Bad Timing',
  other: 'Other',
};

/**
 * Move a lead to a new stage.
 * If it's the sales -> RM handoff (entering "meeting" from a sales
 * stage), we also switch `owner` to the chosen RM and write a system
 * log entry — all in the same flow. After this, the salesman loses
 * write access automatically because he's no longer the owner.
 *
 * `rejectionReason` is only meaningful when newStage is "rejected".
 */
export async function moveStage(
  lead: Schema['Lead']['type'],
  newStage: string,
  rmUsername?: string,
  rejectionReason?: string
) {
  const me = await getCurrentUser();
  const isHandoff =
    newStage === 'meeting' && SALES_STAGES.includes(lead.stage ?? '') && !!rmUsername;

  const update: Record<string, unknown> = { id: lead.id, stage: newStage };
  if (isHandoff) {
    update.owner = rmUsername;
    if (!lead.handoffAt) update.handoffAt = toISODateLocal();
  }
  if (newStage === 'rejected' && rejectionReason) update.rejectionReason = rejectionReason;
  if (newStage === 'closed' && lead.stage !== 'closed') {
    update.closedAt = toISODateLocal();
  }
  if (lead.stage === 'closed' && newStage !== 'closed') {
    update.closedAt = null;
  }

  const { data, errors } = await client.models.Lead.update(update as any);
  if (errors) throw errors;

  // Write the matching activity-log entry. People's names are resolved
  // with a fresh staff-directory lookup right here (not a resolver
  // passed in by the caller) so this never shows a stale/wrong name --
  // e.g. an RM whose StaffProfile was auto-created moments ago in
  // another tab still resolves correctly. Stage ids are used as-is
  // (not looked up against App.tsx's STAGES labels) so a legacy or
  // unrecognized stage id shows honestly rather than silently
  // falling back to a plausible-but-wrong label like "New Lead".
  const staff = await listStaff();
  const nameOf = (username: string) => staff.find((s) => s.username === username)?.displayName ?? username;
  const fromStage = lead.stage ?? '(none)';
  const reasonLabel = rejectionReason ? REJECTION_REASON_LABELS[rejectionReason] : undefined;
  await addNote(
    lead.id,
    isHandoff
      ? `Handed off to ${nameOf(rmUsername!)} by ${nameOf(me.username)} (${fromStage} → ${newStage})`
      : `Moved from ${fromStage} to ${newStage}${reasonLabel ? ` (Reason: ${reasonLabel})` : ''}`,
    'system'
  );

  return data;
}

/** Add an entry to a lead's activity log. */
export async function addNote(
  leadId: string,
  text: string,
  type: 'note' | 'system' = 'note'
) {
  const me = await getCurrentUser();
  const { data, errors } = await client.models.Note.create({
    leadId,
    text,
    type,
    author: me.username,
  });
  if (errors) throw errors;
  return data;
}

/** Load a lead's activity log, oldest-first. */
export async function listNotes(leadId: string) {
  const data = await listAllPages((nextToken) =>
    client.models.Note.list({
      filter: { leadId: { eq: leadId } },
      limit: 1000,
      nextToken,
    })
  );
  return data.sort(
    (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  );
}

/**
 * Permanently delete a lead and its activity-log notes.
 * Intended for admin cleanup of unwanted records — UI-gated to admin.
 */
export async function deleteLead(leadId: string) {
  const notes = await listNotes(leadId);
  for (const n of notes) {
    const { errors } = await client.models.Note.delete({ id: n.id });
    if (errors) throw errors;
  }
  const { data, errors } = await client.models.Lead.delete({ id: leadId });
  if (errors) throw errors;
  return data;
}

function extractErrorMessage(e: unknown): string | null {
  if (!e) return null;
  if (Array.isArray(e)) {
    const msg = e.map((x: any) => x?.message).filter(Boolean).join('; ');
    return msg || null;
  }
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as any).message);
  return String(e);
}

/**
 * Turn a raw error (GraphQL error array, Error, or unknown) into a message
 * a non-technical staff member can read and act on, with the original
 * technical detail kept alongside so it can be shared with support.
 */
export function friendlyError(e: unknown, fallback: string): string {
  const raw = extractErrorMessage(e);
  if (!raw) return fallback;

  const lower = raw.toLowerCase();
  let friendly = fallback;
  if (lower.includes('invalid value') || lower.includes('validation')) {
    friendly = "Some of the details entered aren't valid. Please check the form and try again.";
  } else if (lower.includes('not authorized') || lower.includes('unauthorized')) {
    friendly = "You don't have permission to do this. Ask an admin for access.";
  } else if (lower.includes('network') || lower.includes('failed to fetch')) {
    friendly = "Couldn't reach the server. Check your internet connection and try again.";
  }
  return `${friendly}\n(For support: ${raw})`;
}
