import type { Schema } from "../amplify/data/resource";

type Lead = Schema["Lead"]["type"];
type Trade = Schema["Trade"]["type"];
type InsuranceRevenue = Schema["InsuranceRevenue"]["type"];
type Target = Schema["Target"]["type"];

/**
 * v1 revenue splits — hardcoded until the partner discussion lands a
 * fuller formula (SIP/Loans, per-employee rates, etc.). Change these
 * constants and the rest of the app follows.
 *
 * Trading:  company = brokerage − 20% platform
 *           dealer  = 30% of company
 * Insurance: company is admin-entered; salesperson = 50% of company
 */
export const TRADING_PLATFORM_FEE = 0.2;
export const DEALER_SHARE_OF_COMPANY = 0.3;
export const INSURANCE_SALES_SHARE = 0.5;

export function tradingSplit(brokerage: number): { company: number; dealer: number } {
  const company = Math.round(brokerage * (1 - TRADING_PLATFORM_FEE));
  const dealer = Math.round(company * DEALER_SHARE_OF_COMPANY);
  return { company, dealer };
}

export function insuranceSplit(companyRevenue: number): { company: number; sales: number } {
  return {
    company: companyRevenue,
    sales: Math.round(companyRevenue * INSURANCE_SALES_SHARE),
  };
}

export function inDateRange(iso: string | null | undefined, start: string, end: string): boolean {
  const d = (iso ?? "").slice(0, 10);
  return !!d && d >= start && d <= end;
}

/** Local calendar YYYY-MM-DD — avoids UTC-shift off-by-ones in IST. */
export function toISODateLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the week containing `d`, as YYYY-MM-DD. */
export function mondayOf(d: Date = new Date()): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffToMonday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - diffToMonday);
  return toISODateLocal(copy);
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toISODateLocal(date);
}

export function weekBounds(weekStart: string): { start: string; end: string } {
  return { start: weekStart, end: addDaysISO(weekStart, 6) };
}

/**
 * A closed lead counts for the current owner (usually the RM who closed
 * it) and, if different, the original salesperson — so both roles can
 * have a meaningful "leads closed" target after handoff.
 */
export function closedLeadCountFor(
  username: string,
  leads: Lead[],
  range: { start: string; end: string }
): number {
  return leads.filter(
    (l) =>
      l.stage === "closed" &&
      inDateRange(l.updatedAt, range.start, range.end) &&
      (l.owner === username || l.sourcedBy === username)
  ).length;
}

/** Company revenue attributed to this employee in the range (Trading + Insurance only). */
export function companyRevenueFor(
  username: string,
  range: { start: string; end: string },
  trades: Trade[],
  insurance: InsuranceRevenue[]
): number {
  const trading = trades
    .filter((t) => t.owner === username && inDateRange(t.createdAt, range.start, range.end))
    .reduce((s, t) => s + tradingSplit(t.brokerage ?? 0).company, 0);
  const ins = insurance
    .filter((r) => r.username === username && inDateRange(r.earnedOn, range.start, range.end))
    .reduce((s, r) => s + (r.companyRevenue ?? 0), 0);
  return trading + ins;
}

/** Employee payout in the range: dealer 30% of trading company, sales 50% of insurance company. */
export function incentiveFor(
  username: string,
  range: { start: string; end: string },
  trades: Trade[],
  insurance: InsuranceRevenue[]
): number {
  const dealerCut = trades
    .filter((t) => t.owner === username && inDateRange(t.createdAt, range.start, range.end))
    .reduce((s, t) => s + tradingSplit(t.brokerage ?? 0).dealer, 0);
  const salesCut = insurance
    .filter((r) => r.username === username && inDateRange(r.earnedOn, range.start, range.end))
    .reduce((s, r) => s + insuranceSplit(r.companyRevenue ?? 0).sales, 0);
  return dealerCut + salesCut;
}

export function findTarget(
  targets: Target[],
  username: string,
  weekStart: string
): Target | undefined {
  return targets.find((t) => t.username === username && t.weekStart === weekStart);
}

/** Sum of weekly targets whose Monday falls inside the period (used by the monthly CSV). */
export function sumTargetsInPeriod(
  targets: Target[],
  username: string,
  range: { start: string; end: string }
): { leadsClosedTarget: number; revenueTarget: number; weeksSet: number } {
  const mine = targets.filter(
    (t) => t.username === username && inDateRange(t.weekStart, range.start, range.end)
  );
  return {
    leadsClosedTarget: mine.reduce((s, t) => s + (t.leadsClosedTarget ?? 0), 0),
    revenueTarget: mine.reduce((s, t) => s + (t.revenueTarget ?? 0), 0),
    weeksSet: mine.length,
  };
}

/** null when no target is set, so the UI can show "—" instead of 0%. */
export function pctOf(actual: number, target: number | null | undefined): number | null {
  if (target == null || target <= 0) return null;
  return Math.round((actual / target) * 100);
}

export function progressColor(pct: number | null): string {
  if (pct == null) return "#9CA3AF";
  if (pct < 50) return "#DC2626";
  if (pct < 80) return "#D97706";
  return "#15803D";
}
