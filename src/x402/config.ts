import { Hbar } from "@hiero-ledger/sdk";
import type { Network } from "@x402/core/types";

/**
 * Shared facts about the paid data endpoint.
 *
 * Kept apart from `server.ts` because that module starts listening as soon as
 * it is imported — the seller agent needs to *describe* the endpoint when it
 * accepts an offer, without booting a second copy of it.
 */

export const X402_PORT = 4021;

export const X402_BASE_URL =
  process.env.X402_BASE_URL ?? `http://localhost:${X402_PORT}`;

export const COHORT_INSIGHT_PATH = "/data/cohort-insight";

/** Price of one cohort insight. Advertised in HBAR, charged in tinybars. */
export const COHORT_INSIGHT_PRICE_HBAR = "0.5";
export const COHORT_INSIGHT_PRICE_TINYBAR = Hbar.fromString(
  COHORT_INSIGHT_PRICE_HBAR,
).toTinybars().toString();

/** Native HBAR. Hedera's own token has no contract address — it is asset 0.0.0. */
export const HBAR_ASSET_ID = "0.0.0";

export const NETWORK: Network = "hedera:testnet";
