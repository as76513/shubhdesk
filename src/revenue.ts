import type { Schema } from "../amplify/data/resource";

type Lead = Schema["Lead"]["type"];
type Trade = Schema["Trade"]["type"];
type InsuranceRevenue = Schema["InsuranceRevenue"]["type"];
type Target = Schema["Target"]["type"];
type CompanyTarget = Schema["CompanyTarget"]["type"];

/**
 * v1 revenue splits — hardcoded until the partner discussion lands a
 * fuller formula (SIP/Loans, per-employee rates, etc.). Change these
 * constants and the rest of the app follows.
 *
 * Trading:  company = brokerage − 20% platform
 *           dealer  = 30% of company
 *           if accountOpenedBy is set and is not the dealer, that 30% is
 *           split 50/50 — dealer keeps half, the opener gets the other half
 * Insurance: company is admin-entered; salesperson = 50% of company
 */
export const TRADING_PLATFORM_FEE = 0.2;
export const DEALER_SHARE_OF_COMPANY = 0.3;
export const DEALER_OPENED_ELSEWHERE_CUT = 0.5;
export const INSURANCE_SALES_SHARE = 0.5;
/** Stored on Trade.accountOpenedBy when the dealer opened the account themselves. */
export const ACCOUNT_OPENED_OWN = "OWN";

/** True when admin recorded that someone other than the dealer opened the account. */
export function openedByOther(trade: { owner?: string | null; accountOpenedBy?: string | null }): boolean {
  const opened = trade.accountOpenedBy;
  if (!opened || opened === ACCOUNT_OPENED_OWN || opened === trade.owner) return false;
  return true;
}

export function accountOpenedBySelectValue(trade: { owner?: string | null; accountOpenedBy?: string | null }): string {
  return openedByOther(trade) ? (trade.accountOpenedBy as string) : ACCOUNT_OPENED_OWN;
}

export function tradingSplit(
  brokerage: number,
  trade?: { owner?: string | null; accountOpenedBy?: string | null }
): { company: number; dealer: number } {
  const company = Math.round(brokerage * (1 - TRADING_PLATFORM_FEE));
  let dealer = Math.round(company * DEALER_SHARE_OF_COMPANY);
  if (trade && openedByOther(trade)) {
    dealer = Math.round(dealer * DEALER_OPENED_ELSEWHERE_CUT);
  }
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

/** Close date for period actuals. Falls back to updatedAt for leads closed before closedAt existed. */
export function closedOn(lead: Lead): string | null | undefined {
  return lead.closedAt ?? lead.updatedAt;
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
      inDateRange(closedOn(l), range.start, range.end) &&
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

/**
 * Opener's share when they are Trade.accountOpenedBy (not OWN / not the dealer).
 * Same rupee amount as the dealer's halved payout on that trade.
 */
export function accountOpenedIncentiveFor(
  username: string,
  range: { start: string; end: string },
  trades: Trade[]
): number {
  return trades
    .filter(
      (t) =>
        t.accountOpenedBy === username &&
        openedByOther(t) &&
        inDateRange(t.createdAt, range.start, range.end)
    )
    .reduce((s, t) => s + tradingSplit(t.brokerage ?? 0, t).dealer, 0);
}

/** Employee payout in the range: dealer cut + opener cut + insurance 50%. */
export function incentiveFor(
  username: string,
  range: { start: string; end: string },
  trades: Trade[],
  insurance: InsuranceRevenue[]
): number {
  const dealerCut = trades
    .filter((t) => t.owner === username && inDateRange(t.createdAt, range.start, range.end))
    .reduce((s, t) => s + tradingSplit(t.brokerage ?? 0, t).dealer, 0);
  const openerCut = accountOpenedIncentiveFor(username, range, trades);
  const salesCut = insurance
    .filter((r) => r.username === username && inDateRange(r.earnedOn, range.start, range.end))
    .reduce((s, r) => s + insuranceSplit(r.companyRevenue ?? 0).sales, 0);
  return dealerCut + openerCut + salesCut;
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

export function hitAnyMetric(actuals: CompanyActuals, target: MetricTargets): boolean {
  return (
    (pctOf(actuals.nca, target.ncaTarget) ?? 0) >= 100 ||
    (pctOf(actuals.aum, target.aumTarget) ?? 0) >= 100 ||
    (pctOf(actuals.sip, target.sipTarget) ?? 0) >= 100 ||
    (pctOf(actuals.insurance, target.insuranceTarget) ?? 0) >= 100
  );
}

export function progressColor(pct: number | null): string {
  if (pct == null) return "#9CA3AF";
  if (pct < 50) return "#DC2626";
  if (pct < 80) return "#D97706";
  return "#15803D";
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function monthBounds(d: Date = new Date()): { start: string; end: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toISODateLocal(start), end: toISODateLocal(end) };
}

export function monthStartOf(d: Date = new Date()): string {
  return toISODateLocal(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function addMonths(iso: string, n: number): string {
  const d = parseISODate(iso);
  return toISODateLocal(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

export function formatMonthLong(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function quarterBounds(d: Date = new Date()): { start: string; end: string; label: string } {
  const q = Math.floor(d.getMonth() / 3);
  const start = new Date(d.getFullYear(), q * 3, 1);
  const end = new Date(d.getFullYear(), q * 3 + 3, 0);
  return { start: toISODateLocal(start), end: toISODateLocal(end), label: `Q${q + 1} ${d.getFullYear()}` };
}

export function yearBounds(d: Date = new Date()): { start: string; end: string; label: string } {
  const y = d.getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
}

export type PeriodType = "monthly" | "quarterly" | "yearly";

export interface MetricTargets {
  ncaTarget: number;
  aumTarget: number;
  sipTarget: number;
  insuranceTarget: number;
}

export function periodRangeFor(
  periodType: PeriodType,
  monthStart: string
): { start: string; end: string; label: string } {
  const d = parseISODate(monthStart);
  if (periodType === "monthly") {
    const m = monthBounds(d);
    return { ...m, label: formatMonthLong(monthStart) };
  }
  if (periodType === "quarterly") return quarterBounds(d);
  return yearBounds(d);
}

/** Starting numbers from the partner table until admin saves their own. */
export const DEFAULT_COMPANY_TARGETS: Record<PeriodType, MetricTargets> = {
  monthly: { ncaTarget: 10, aumTarget: 200_000, sipTarget: 5_000, insuranceTarget: 50_000 },
  quarterly: { ncaTarget: 30, aumTarget: 600_000, sipTarget: 30_000, insuranceTarget: 150_000 },
  yearly: { ncaTarget: 120, aumTarget: 3_000_000, sipTarget: 100_000, insuranceTarget: 600_000 },
};

export function companyTargetOf(
  rows: CompanyTarget[],
  periodType: PeriodType
): MetricTargets {
  const row = rows.find((r) => r.periodType === periodType);
  if (!row) return DEFAULT_COMPANY_TARGETS[periodType];
  return {
    ncaTarget: row.ncaTarget ?? DEFAULT_COMPANY_TARGETS[periodType].ncaTarget,
    aumTarget: row.aumTarget ?? DEFAULT_COMPANY_TARGETS[periodType].aumTarget,
    sipTarget: row.sipTarget ?? DEFAULT_COMPANY_TARGETS[periodType].sipTarget,
    insuranceTarget: row.insuranceTarget ?? DEFAULT_COMPANY_TARGETS[periodType].insuranceTarget,
  };
}

/** Company-level quota = per-person quota × number of sales/RM. */
export function scaleTargets(target: MetricTargets, people: number): MetricTargets {
  const n = Math.max(1, people);
  return {
    ncaTarget: target.ncaTarget * n,
    aumTarget: target.aumTarget * n,
    sipTarget: target.sipTarget * n,
    insuranceTarget: target.insuranceTarget * n,
  };
}

export interface CompanyActuals {
  nca: number;
  aum: number;
  sip: number;
  insurance: number;
}

/**
 * Actuals for a date range. NCA = closed leads (any service).
 * AUM = closed Trading deal value. SIP = closed SIP deal value.
 * Insurance = admin-entered company revenue.
 */
export function companyActualsFor(
  leads: Lead[],
  insurance: InsuranceRevenue[],
  range: { start: string; end: string }
): CompanyActuals {
  const closed = leads.filter(
    (l) => l.stage === "closed" && inDateRange(closedOn(l), range.start, range.end)
  );
  return {
    nca: closed.length,
    aum: closed.filter((l) => l.service === "Trading").reduce((s, l) => s + (l.value ?? 0), 0),
    sip: closed.filter((l) => l.service === "SIP").reduce((s, l) => s + (l.value ?? 0), 0),
    insurance: insurance
      .filter((r) => inDateRange(r.earnedOn, range.start, range.end))
      .reduce((s, r) => s + (r.companyRevenue ?? 0), 0),
  };
}

/**
 * One person's actuals against the shared individual quota.
 * Closed-lead credit matches `closedLeadCountFor` (owner or sourcedBy).
 * Insurance is only the rows admin attributed to this username.
 */
export function personActualsFor(
  username: string,
  leads: Lead[],
  insurance: InsuranceRevenue[],
  range: { start: string; end: string }
): CompanyActuals {
  return companyActualsFor(
    leads.filter((l) => l.owner === username || l.sourcedBy === username),
    insurance.filter((r) => r.username === username),
    range
  );
}

export function lastMonthBounds(d: Date = new Date()): { start: string; end: string } {
  return monthBounds(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}

export function formatWeekRange(weekStart: string): string {
  const end = addDaysISO(weekStart, 6);
  const a = parseISODate(weekStart);
  const b = parseISODate(end);
  const fmt = (dt: Date) => dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${fmt(a)}–${fmt(b)}`;
}

export function formatMonthLabel(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export type TradePeriod = "day" | "thisWeek" | "thisMonth" | "lastMonth";

export function tradePeriodRange(
  period: TradePeriod,
  day: string
): { start: string; end: string; label: string } {
  if (period === "day") return { start: day, end: day, label: day };
  if (period === "thisWeek") {
    const w = weekBounds(mondayOf());
    return { ...w, label: `Week of ${formatWeekRange(w.start)}` };
  }
  if (period === "thisMonth") {
    const m = monthBounds();
    return { ...m, label: formatMonthLabel(m.start) };
  }
  const m = lastMonthBounds();
  return { ...m, label: formatMonthLabel(m.start) };
}

export function sumBrokerage(trades: Trade[]): number {
  return trades.reduce((s, t) => s + (t.brokerage ?? 0), 0);
}
