import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

/**
 * CRUD for weekly Target rows and admin-entered InsuranceRevenue.
 * Separate from leadClient / tradeClient — these models are the
 * targets-and-incentives surface, not the pipeline or the trade log.
 */

const client = generateClient<Schema>();

export async function listTargets() {
  const { data, errors } = await client.models.Target.list({ limit: 1000 });
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
  const { data, errors } = await client.models.InsuranceRevenue.list({ limit: 1000 });
  if (errors) throw errors;
  return data;
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
