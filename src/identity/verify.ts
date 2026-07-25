/** Gate 1: buyer identity verification against the HCS registry. Owner: P1. */

import type { IdentityCheck } from "../types/marketplace.js";

export async function verifyBuyerIdentity(uaid: string): Promise<IdentityCheck> {
  throw new Error("TODO(P1): not implemented");
}
