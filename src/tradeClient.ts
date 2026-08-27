import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';

/**
 * ShubhDesk — dealer trade client
 * ---------------------------------------------------------------
 * Standalone from leadClient.ts: Trade is a separate, minimal model
 * (Client Name, Buying Lot, Brokerage) unrelated to the Lead pipeline.
 */

const client = generateClient<Schema>();

/** Trades the signed-in dealer owns (or all trades, for an admin). */
export async function listTrades() {
  const { data, errors } = await client.models.Trade.list();
  if (errors) throw errors;
  return data;
}

export async function createTrade(input: {
  clientName: string;
  buyingLot?: string;
  brokerage?: number;
  accountOpenedBy?: string | null;
}) {
  const me = await getCurrentUser();
  const { data, errors } = await client.models.Trade.create({
    ...input,
    owner: me.username,
    accountOpenedBy: input.accountOpenedBy || undefined,
  });
  if (errors) throw errors;
  return data;
}

export async function updateTrade(input: {
  id: string;
  clientName?: string;
  buyingLot?: string;
  brokerage?: number;
  accountOpenedBy?: string | null;
}) {
  const { data, errors } = await client.models.Trade.update(input);
  if (errors) throw errors;
  return data;
}

export async function deleteTrade(id: string) {
  const { data, errors } = await client.models.Trade.delete({ id });
  if (errors) throw errors;
  return data;
}
