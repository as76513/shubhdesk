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

const JOINT_STAGE = 'joint_meeting';

export type Role = 'admin' | 'wealth_manager' | 'advisor';

function titlePart(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** "tejasvi.dhumal" / email → "Tejasvi - Dhumal". Already "First - Last" is left as-is. */
export function personListName(displayName?: string | null, email?: string | null): string {
  const raw = (email?.split('@')[0] || displayName || '').trim();
  if (!raw) return '—';
  if (/\s-\s/.test(raw)) return raw;
  const parts = raw.split(/[._]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${titlePart(parts[0])} - ${parts.slice(1).map(titlePart).join(' ')}`;
  }
  return titlePart(parts[0]);
}

/** Map leftover StaffProfile.role values from before the group rename. */
export function liveStaffRole(role?: string | null): Role | undefined {
  if (role === 'sales' || role === 'rm') return 'wealth_manager';
  if (role === 'dealer') return 'advisor';
  if (role === 'admin' || role === 'wealth_manager' || role === 'advisor') return role;
  return undefined;
}

export function isShubhshreeAdmin(staff: { displayName?: string | null; role?: string | null }): boolean {
  const name = (staff.displayName ?? '').trim();
  return name === 'Admin' || /shubhshree\.admin/i.test(name);
}

/** Live colleagues for Joint Meeting — current Cognito staff only, not leftover test rows. */
export function isJointMeetingColleague(staff: { role?: string | null; displayName?: string | null }): boolean {
  if (isShubhshreeAdmin(staff)) return false;
  const role = staff.role;
  return role === 'wealth_manager' || role === 'advisor' || role === 'admin';
}

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
    : groups.includes('advisor')
    ? 'advisor'
    : 'wealth_manager';

  let displayName = user.username;
  try {
    const attrs = await fetchUserAttributes();
    displayName = attrs.preferred_username || attrs.email || user.username;
  } catch {
    /* fall back to username */
  }

  return { username: user.username, displayName, role };
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
 * (e.g. "advisor@shubhdesk.test" -> "advisor"). Runs once per login and
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
  let fromEmail: string | undefined;
  try {
    const attrs = await fetchUserAttributes();
    fromEmail = attrs.email;
  } catch {
    /* fall back below */
  }
  const displayName = personListName(undefined, fromEmail) !== '—'
    ? personListName(undefined, fromEmail)
    : user.username;

  if (existing.length > 0) {
    const row = existing[0];
    const patch: { id: string; role?: Role; displayName?: string } = { id: row.id };
    if (row && row.role !== role) patch.role = role;
    if (row && fromEmail && row.displayName !== displayName) patch.displayName = displayName;
    if (patch.role || patch.displayName) {
      const { data, errors: updateErrors } = await client.models.StaffProfile.update(patch);
      if (updateErrors) throw updateErrors;
      return data;
    }
    return row;
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
  requirements?: string;
  service: 'Investment' | 'Trading' | 'Both' | 'SIP' | 'Insurance' | 'Loans';
  value?: number;
  source?: 'cold_call' | 'referral' | 'walk_in' | 'existing_client' | 'digital' | 'other';
  meetingLocation?: string;
  jointWith?: string;
}) {
  const me = await getCurrentUser();
  const clientCode = await nextClientCode();
  const jointWith = input.jointWith?.trim();
  const meetingLocation = input.meetingLocation?.trim();
  const { data, errors } = await client.models.Lead.create({
    client: input.client,
    phone: input.phone,
    requirements: input.requirements,
    service: input.service,
    value: input.value,
    source: input.source,
    meetingLocation: meetingLocation || undefined,
    jointWith: jointWith || undefined,
    clientCode,
    stage: jointWith ? 'joint_meeting' : 'new',
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
 * Entering Joint Meeting stores `jointWith` + `meetingLocation` and
 * writes a system note. Owner does not change — this records who the
 * current owner went on the joint call with.
 *
 * `rejectionReason` is only meaningful when newStage is "rejected".
 */
export async function moveStage(
  lead: Schema['Lead']['type'],
  newStage: string,
  opts?: { jointWith?: string; meetingLocation?: string; rejectionReason?: string }
) {
  const me = await getCurrentUser();
  const jointWith = opts?.jointWith?.trim();
  const meetingLocation = opts?.meetingLocation?.trim();
  const rejectionReason = opts?.rejectionReason;
  const isJoint = newStage === JOINT_STAGE && !!jointWith;

  const update: Record<string, unknown> = { id: lead.id, stage: newStage };
  if (isJoint) {
    update.jointWith = jointWith;
    if (meetingLocation) update.meetingLocation = meetingLocation;
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
  // e.g. a colleague whose StaffProfile was auto-created moments ago in
  // another tab still resolves correctly. Stage ids are used as-is
  // (not looked up against App.tsx's STAGES labels) so a legacy or
  // unrecognized stage id shows honestly rather than silently
  // falling back to a plausible-but-wrong label like "New Lead".
  const staff = await listStaff();
  const nameOf = (username: string) => staff.find((s) => s.username === username)?.displayName ?? username;
  const fromStage = lead.stage ?? '(none)';
  const reasonLabel = rejectionReason ? REJECTION_REASON_LABELS[rejectionReason] : undefined;
  const jointNote = isJoint
    ? `Joint meeting with ${nameOf(jointWith!)}${meetingLocation ? ` at ${meetingLocation}` : ''} by ${nameOf(me.username)} (${fromStage} → ${newStage})`
    : `Moved from ${fromStage} to ${newStage}${reasonLabel ? ` (Reason: ${reasonLabel})` : ''}`;
  await addNote(lead.id, jointNote, 'system');

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
