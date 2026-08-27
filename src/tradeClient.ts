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
  const openedBy = input.accountOpenedBy?.trim() || "OWN";
  const { data, errors } = await client.models.Trade.create({
    clientName: input.clientName,
    buyingLot: input.buyingLot,
    brokerage: input.brokerage,
    owner: me.username,
    accountOpenedBy: openedBy,
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
  const payload: {
    id: string;
    clientName?: string;
    buyingLot?: string;
    brokerage?: number;
    accountOpenedBy?: string;
  } = { id: input.id };
  if (input.clientName !== undefined) payload.clientName = input.clientName;
  if (input.buyingLot !== undefined) payload.buyingLot = input.buyingLot;
  if (input.brokerage !== undefined) payload.brokerage = input.brokerage;
  if (input.accountOpenedBy !== undefined) {
    payload.accountOpenedBy = input.accountOpenedBy?.trim() || "OWN";
  }
  const { data, errors } = await client.models.Trade.update(payload);
  if (errors) throw errors;
  return data;
}

export async function deleteTrade(id: string) {
  const { data, errors } = await client.models.Trade.delete({ id });
  if (errors) throw errors;
  return data;
}
