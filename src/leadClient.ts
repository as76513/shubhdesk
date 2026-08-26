import { generateClient } from 'aws-amplify/data';
import { getCurrentUser, fetchAuthSession, fetchUserAttributes } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';

/**
 * ShubhDesk — data client
 * ---------------------------------------------------------------
 * These functions are the real-backend replacements for the
 * in-memory handlers in the prototype (moveStage, addNote, addLead).
 * The React components stay almost identical — only the data source
 * changes from useState/SEED to these calls.
 */

const client = generateClient<Schema>();

// Stages owned by sales, mirroring the prototype constant.
const SALES_STAGES = ['new', 'calling', 'contacted'];

export type Role = 'admin' | 'rm' | 'sales';

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
  const { data, errors } = await client.models.StaffProfile.list({
    filter: { role: { eq: 'rm' } },
  });
  if (errors) throw errors;
  return data;
}

/** All staff profiles, to resolve usernames -> display names on cards. */
export async function listStaff() {
  const { data, errors } = await client.models.StaffProfile.list();
  if (errors) throw errors;
  return data;
}


/** All leads the signed-in user is allowed to see (server enforces this). */
export async function listLeads() {
  const { data, errors } = await client.models.Lead.list();
  if (errors) throw errors;
  return data;
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
  const { data, errors } = await client.models.Lead.list({
    filter: { followUpOn: { le: cutoff } },
  });
  if (errors) throw errors;
  return data;
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
    newStage === 'meeting' && SALES_STAGES.includes(lead.stage ?? '') && rmUsername;

  const update: Record<string, unknown> = { id: lead.id, stage: newStage };
  if (isHandoff) update.owner = rmUsername;
  if (newStage === 'rejected' && rejectionReason) update.rejectionReason = rejectionReason;

  const { data, errors } = await client.models.Lead.update(update as any);
  if (errors) throw errors;

  // Write the matching activity-log entry.
  const reasonLabel = rejectionReason ? REJECTION_REASON_LABELS[rejectionReason] : undefined;
  await addNote(
    lead.id,
    isHandoff
      ? `Handed off to ${rmUsername} by ${me.username}`
      : `Moved to ${newStage}${reasonLabel ? ` (Reason: ${reasonLabel})` : ''}`,
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
  const { data, errors } = await client.models.Note.list({
    filter: { leadId: { eq: leadId } },
  });
  if (errors) throw errors;
  return data.sort(
    (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  );
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
