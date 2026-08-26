import type { Schema } from "../amplify/data/resource";

type Lead = Schema["Lead"]["type"];
type Staff = Schema["StaffProfile"]["type"];

export type ReportPeriod = "thisWeek" | "thisMonth" | "lastMonth";

const STAGE_IDS = ["new", "calling", "contacted", "meeting", "followup", "inprogress", "closed", "rejected"];

const toISO = (d: Date) => d.toISOString().slice(0, 10);

export function periodRange(period: ReportPeriod): { start: string; end: string; label: string } {
  const today = new Date();

  if (period === "thisWeek") {
    const diffToMonday = (today.getDay() + 6) % 7; // Monday-start week
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    return { start: toISO(monday), end: toISO(today), label: "This Week" };
  }
  if (period === "thisMonth") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: toISO(first), end: toISO(today), label: "This Month" };
  }
  // lastMonth
  const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 86400000);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
  return { start: toISO(lastMonthStart), end: toISO(lastMonthEnd), label: "Last Month" };
}

export interface EmployeeReportRow {
  username: string;
  displayName: string;
  leadsSourced: number;
  dealsClosedCount: number;
  dealsClosedValue: number;
  handoffsToRM: number;
  pipeline: Record<string, number>;
}

/**
 * Deals-closed and handoff timing use each lead's updatedAt as an
 * approximation, since the schema doesn't track a separate closedAt /
 * handoffAt timestamp. Good enough for a weekly/monthly summary, not
 * an audit trail.
 */
export function buildEmployeeReport(
  leads: Lead[],
  staff: Staff[],
  period: ReportPeriod
): { rows: EmployeeReportRow[]; range: { start: string; end: string; label: string } } {
  const range = periodRange(period);
  const dateOf = (s?: string | null) => (s ? s.slice(0, 10) : "");
  const inRange = (d: string) => !!d && d >= range.start && d <= range.end;
  const nameOf = (username: string) => {
    const raw = staff.find((s) => s.username === username)?.displayName ?? username;
    return raw.includes("@") ? raw.split("@")[0] : raw;
  };

  const usernames = new Set<string>();
  leads.forEach((l) => {
    if (l.sourcedBy) usernames.add(l.sourcedBy);
    if (l.owner) usernames.add(l.owner);
  });

  const rows: EmployeeReportRow[] = Array.from(usernames)
    .map((username) => {
      const pipeline: Record<string, number> = {};
      STAGE_IDS.forEach((s) => (pipeline[s] = 0));

      let leadsSourced = 0;
      let dealsClosedCount = 0;
      let dealsClosedValue = 0;
      let handoffsToRM = 0;

      leads.forEach((l) => {
        if (l.sourcedBy === username && inRange(dateOf(l.createdAt))) {
          leadsSourced++;
        }
        if (l.owner === username) {
          const stage = l.stage ?? "new";
          pipeline[stage] = (pipeline[stage] ?? 0) + 1;
          if (l.stage === "closed" && inRange(dateOf(l.updatedAt))) {
            dealsClosedCount++;
            dealsClosedValue += l.value ?? 0;
          }
        }
        if (l.sourcedBy === username && l.owner && l.owner !== l.sourcedBy && inRange(dateOf(l.updatedAt))) {
          handoffsToRM++;
        }
      });

      return { username, displayName: nameOf(username), leadsSourced, dealsClosedCount, dealsClosedValue, handoffsToRM, pipeline };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { rows, range };
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCSV(rows: EmployeeReportRow[]): string {
  const header = [
    "Employee",
    "Leads Sourced",
    "Deals Closed",
    "Deals Closed Value (INR)",
    "Handoffs to RM",
    ...STAGE_IDS.map((s) => `Pipeline: ${s}`),
  ];
  const lines = [header.map(csvEscape).join(",")];
  rows.forEach((r) => {
    const cells = [
      r.displayName,
      r.leadsSourced,
      r.dealsClosedCount,
      r.dealsClosedValue,
      r.handoffsToRM,
      ...STAGE_IDS.map((s) => r.pipeline[s] ?? 0),
    ];
    lines.push(cells.map(csvEscape).join(","));
  });
  return lines.join("\n");
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
