/**
 * Gate 1: buyer identity verification against the HCS registry. Owner: P1.
 *
 * Four checks, each failing closed. The distinction the reasons preserve:
 * "the registry says no" (not registered / inactive / not attested) is a
 * refusal backed by evidence, while "the registry cannot be reached" is not
 * evidence of anything — a mirror-node outage must read as *"cannot be
 * verified right now"*, never as "not registered", or an outage would let a
 * refusal masquerade as a verdict.
 */

import type { IdentityCheck } from "../types/marketplace.js";
import { attestCompliance, SCORE_COMPLIANT } from "./attestation.js";
import { resolveProfile, type ResolvedProfile } from "./registry.js";
import { parseUaid } from "./uaid.js";

/**
 * The seller's decision on whether to deal with `uaid`.
 *
 * 1. The UAID parses.
 * 2. The registry holds a profile for it (read via the mirror node).
 * 3. That profile is active.
 * 4. A compliance attestation scores {@link SCORE_COMPLIANT} — and the
 *    attestation travels with the result either way, so a refusal is backed
 *    by the same public record an acceptance is.
 *
 * No attestation is written for UAIDs that fail earlier checks: attesting an
 * identity nobody registered would only pollute the trail.
 */
export async function verifyBuyerIdentity(uaid: string): Promise<IdentityCheck> {
  // 1. Malformed input is refused before any network call.
  try {
    parseUaid(uaid);
  } catch {
    return { verified: false, reason: `Buyer id "${uaid}" is not a valid UAID.` };
  }

  // 2. Registered?
  let resolved: ResolvedProfile | undefined;
  try {
    resolved = await resolveProfile(uaid);
  } catch (error) {
    return {
      verified: false,
      reason: `Buyer cannot be verified right now — the identity registry is unreachable (${(error as Error).message}).`,
    };
  }
  if (!resolved) {
    return {
      verified: false,
      reason: "Buyer is not registered in the identity registry.",
    };
  }

  const { profile } = resolved;

  // 3. Still active?
  if (profile.active !== true) {
    return {
      verified: false,
      reason: "Buyer's registry profile is marked inactive.",
      nativeId: profile.nativeId,
      name: profile.name,
    };
  }

  // 4. Attested compliant? The attestation write itself needs the network, so
  // a failure here is also "cannot be verified", not a verdict.
  try {
    const attestation = await attestCompliance(uaid);
    if (attestation.response < SCORE_COMPLIANT) {
      return {
        verified: false,
        reason:
          "Buyer is registered but holds no compliance attestation from the rights holder — refusal recorded on HCS.",
        nativeId: profile.nativeId,
        name: profile.name,
        attestation,
      };
    }
    return {
      verified: true,
      reason: "Buyer is registered, active and attested compliant.",
      nativeId: profile.nativeId,
      name: profile.name,
      attestation,
    };
  } catch (error) {
    return {
      verified: false,
      reason: `Buyer cannot be verified right now — recording the compliance attestation failed (${(error as Error).message}).`,
      nativeId: profile.nativeId,
      name: profile.name,
    };
  }
}
