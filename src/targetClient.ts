import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import type { PeriodType } from "./revenue";

/**
 * CRUD for weekly Target rows and admin-entered InsuranceRevenue.
 * Separate from leadClient / tradeClient — these models are the
 * targets-and-incentives surface, not the pipeline or the trade log.
 */

const client = generateClient<Schema>();

const PERIOD_TYPES: PeriodType[] = ["monthly", "quarterly", "yearly"];

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

export async function listTargets() {
  return listAllPages((nextToken) =>
    client.models.Target.list({ limit: 1000, nextToken })
  );
}

export async function listCompanyTargets() {
  return listAllPages((nextToken) =>
    client.models.CompanyTarget.list({ limit: 10, nextToken })
  );
}

export async function upsertCompanyTarget(input: {
  periodType: string;
  ncaTarget: number;
  aumTarget: number;
  sipTarget: number;
  insuranceTarget: number;
}) {
  if (!PERIOD_TYPES.includes(input.periodType as PeriodType)) {
    throw new Error(`periodType must be monthly, quarterly, or yearly (got "${input.periodType}")`);
  }
  const existing = await client.models.CompanyTarget.get({ periodType: input.periodType });
  if (existing.errors) throw existing.errors;

  if (existing.data) {
    const { data, errors } = await client.models.CompanyTarget.update(input);
    if (errors) throw errors;
    return data;
  }
  const { data, errors } = await client.models.CompanyTarget.create(input);
  if (errors) throw errors;
  return data;
}

export async function upsertTarget(input: {
  username: string;
  weekStart: string;
  leadsClosedTarget: number;
  revenueTarget: number;
}) {
  const existing = await client.models.Target.get({
    username: input.username,
    weekStart: input.weekStart,
  });
  if (existing.errors) throw existing.errors;

  if (existing.data) {
    const { data, errors } = await client.models.Target.update(input);
    if (errors) throw errors;
    return data;
  }
  const { data, errors } = await client.models.Target.create(input);
  if (errors) throw errors;
  return data;
}

export async function listInsuranceRevenue() {
  return listAllPages((nextToken) =>
    client.models.InsuranceRevenue.list({ limit: 1000, nextToken })
  );
}

export async function createInsuranceRevenue(input: {
  username: string;
  companyRevenue: number;
  earnedOn: string;
  note?: string;
}) {
  const { data, errors } = await client.models.InsuranceRevenue.create(input);
  if (errors) throw errors;
  return data;
}

export async function updateInsuranceRevenue(input: {
  id: string;
  username?: string;
  companyRevenue?: number;
  earnedOn?: string;
  note?: string | null;
}) {
  const { data, errors } = await client.models.InsuranceRevenue.update(input);
  if (errors) throw errors;
  return data;
}

export async function deleteInsuranceRevenue(id: string) {
  const { data, errors } = await client.models.InsuranceRevenue.delete({ id });
  if (errors) throw errors;
  return data;
}
