import type { Schema } from "../amplify/data/resource";
import {
  closedLeadCountFor,
  companyRevenueFor,
  incentiveFor,
  pctOf,
  sumTargetsInPeriod,
  tradingSplit,
  openedByOther,
} from "./revenue";

type Lead = Schema["Lead"]["type"];
type Staff = Schema["StaffProfile"]["type"];
type Trade = Schema["Trade"]["type"];
type Target = Schema["Target"]["type"];
type InsuranceRevenue = Schema["InsuranceRevenue"]["type"];

export type ReportPeriod = "thisWeek" | "thisMonth" | "lastMonth";

const STAGE_IDS = ["new", "meeting", "followup", "inprogress", "closed", "rejected"];

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
  closedTarget: number | null;
  closedActual: number;
  closedPct: number | null;
  revenueTarget: number | null;
  revenueActual: number;
  revenuePct: number | null;
  incentiveEarned: number;
}

/**
 * Deals-closed timing uses Lead.closedAt (falls back to updatedAt for
 * rows closed before that field existed). Handoffs use handoffAt with
 * the same fallback.
 */
export function buildEmployeeReport(
  leads: Lead[],
  staff: Staff[],
  period: ReportPeriod,
  extras?: { targets?: Target[]; trades?: Trade[]; insurance?: InsuranceRevenue[] }
): { rows: EmployeeReportRow[]; range: { start: string; end: string; label: string } } {
  const range = periodRange(period);
  const dateOf = (s?: string | null) => (s ? s.slice(0, 10) : "");
  const inRange = (d: string) => !!d && d >= range.start && d <= range.end;
  const nameOf = (username: string) => {
    const raw = staff.find((s) => s.username === username)?.displayName ?? username;
    return raw.includes("@") ? raw.split("@")[0] : raw;
  };

  const targets = extras?.targets ?? [];
  const trades = extras?.trades ?? [];
  const insurance = extras?.insurance ?? [];

  const usernames = new Set<string>();
  staff.forEach((s) => { if (s.username) usernames.add(s.username); });
  leads.forEach((l) => {
    if (l.sourcedBy) usernames.add(l.sourcedBy);
    if (l.owner) usernames.add(l.owner);
  });
  trades.forEach((t) => { if (t.owner) usernames.add(t.owner); });
  insurance.forEach((r) => { if (r.username) usernames.add(r.username); });

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
          if (l.stage === "closed" && inRange(dateOf(l.closedAt ?? l.updatedAt))) {
            dealsClosedCount++;
            dealsClosedValue += l.value ?? 0;
          }
        }
        if (l.sourcedBy === username && l.owner && l.owner !== l.sourcedBy && inRange(dateOf(l.handoffAt ?? l.updatedAt))) {
          handoffsToRM++;
        }
      });

      const summed = sumTargetsInPeriod(targets, username, range);
      const closedTarget = summed.weeksSet > 0 ? summed.leadsClosedTarget : null;
      const revenueTarget = summed.weeksSet > 0 ? summed.revenueTarget : null;
      const closedActual = closedLeadCountFor(username, leads, range);
      const revenueActual = companyRevenueFor(username, range, trades, insurance);
      const incentiveEarned = incentiveFor(username, range, trades, insurance);

      return {
        username,
        displayName: nameOf(username),
        leadsSourced,
        dealsClosedCount,
        dealsClosedValue,
        handoffsToRM,
        pipeline,
        closedTarget,
        closedActual,
        closedPct: pctOf(closedActual, closedTarget),
        revenueTarget,
        revenueActual,
        revenuePct: pctOf(revenueActual, revenueTarget),
        incentiveEarned,
      };
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
    "Closed Target",
    "Closed Actual",
    "Closed % Achieved",
    "Revenue Target (INR)",
    "Revenue Actual (INR)",
    "Revenue % Achieved",
    "Incentive Earned (INR)",
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
      r.closedTarget ?? "",
      r.closedActual,
      r.closedPct ?? "",
      r.revenueTarget ?? "",
      r.revenueActual,
      r.revenuePct ?? "",
      r.incentiveEarned,
      ...STAGE_IDS.map((s) => r.pipeline[s] ?? 0),
    ];
    lines.push(cells.map(csvEscape).join(","));
  });
  return lines.join("\n");
}

/** CSV of trades in a date range (inclusive YYYY-MM-DD). Optional name resolver for the Dealer column.
 *  Dealers downloading their own log omit brokerage and company ₹. */
export function tradesToCSV(
  trades: Trade[],
  range: { start: string; end: string },
  dealerName?: (username?: string | null) => string,
  dealerOnly?: boolean
): string {
  const header = dealerOnly
    ? ["Date", "Client Name", "Buying Lot", "Account Opened By", "Your Revenue (INR)"]
    : [
        "Date",
        "Dealer",
        "Client Name",
        "Buying Lot",
        "Account Opened By",
        "Brokerage (INR)",
        "Company Revenue (INR)",
        "Dealer Revenue (INR)",
      ];
  const lines = [header.map(csvEscape).join(",")];
  trades
    .filter((t) => {
      const d = (t.createdAt ?? "").slice(0, 10);
      return !!d && d >= range.start && d <= range.end;
    })
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .forEach((t) => {
      const date = (t.createdAt ?? "").slice(0, 10);
      const brokerage = t.brokerage ?? 0;
      const split = tradingSplit(brokerage, t);
      const opened = openedByOther(t)
        ? (dealerName ? dealerName(t.accountOpenedBy) : (t.accountOpenedBy ?? ""))
        : "OWN";
      lines.push(
        (dealerOnly
          ? [date, t.clientName, t.buyingLot ?? "", opened, split.dealer]
          : [
              date,
              dealerName ? dealerName(t.owner) : (t.owner ?? ""),
              t.clientName,
              t.buyingLot ?? "",
              opened,
              brokerage,
              split.company,
              split.dealer,
            ]
        ).map(csvEscape).join(",")
      );
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
