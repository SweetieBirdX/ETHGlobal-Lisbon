import { Hbar } from "@hiero-ledger/sdk";
import type { Network } from "@x402/core/types";

/**
 * Shared facts about the paid licence endpoint.
 *
 * Kept apart from `server.ts` because that module starts listening as soon as
 * it is imported — the seller agent needs to *describe* the endpoint when it
 * accepts an offer, without booting a second copy of it.
 *
 * There is deliberately no fixed price here: every licence is priced per
 * negotiation via `quotePrice` (shares × the track's per-share rate), and the
 * x402 route quotes the same amount dynamically from the licence row.
 */

export const X402_PORT = 4021;

export const X402_BASE_URL =
  process.env.X402_BASE_URL ?? `http://localhost:${X402_PORT}`;

export const LICENCE_GRANT_PATH = "/licence/grant";

/** HBAR amounts are advertised in ℏ but charged in tinybars (10⁻⁸ ℏ). */
export function hbarToTinybar(hbar: number | string): string {
  return Hbar.fromString(String(hbar)).toTinybars().toString();
}

/** Native HBAR. Hedera's own token has no contract address — it is asset 0.0.0. */
export const HBAR_ASSET_ID = "0.0.0";

export const NETWORK: Network = "hedera:testnet";
