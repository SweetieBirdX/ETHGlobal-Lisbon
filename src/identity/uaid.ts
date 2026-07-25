/**
 * HCS-14 UAID derivation for our agents. Owner: P1.
 *
 * Format: did:uaid:{id};proto={proto};nativeId=hedera:testnet:{accountId};uid={uid}
 *
 * HCS-14 says the id segment is the sanitised method-specific identifier of an EXISTING
 * W3C DID — the standard computes no new hash. Our agents have no pre-existing did:key,
 * so we derive a stable id from sha256("hedera:testnet:" + accountId) in base64url instead.
 * Deterministic and collision-free for our purposes, but it means we do NOT claim full
 * HCS-14 conformance — the id is self-derived, not carried over from another DID method.
 */

import { createHash } from "node:crypto";

export const UAID_PROTO = "a2a";

const NATIVE_ID_PREFIX = "hedera:testnet:";
const ACCOUNT_ID_PATTERN = /^\d+\.\d+\.\d+$/;

export interface UaidParts {
  id: string;
  proto: string;
  nativeId: string;
  uid: string;
}

/** Strip everything after the first `;`, `?` or `#` — HCS-14's id sanitisation rule. */
function sanitiseId(id: string): string {
  return id.split(/[;?#]/, 1)[0];
}

export function deriveUaid(
  accountId: string,
  { proto, uid = "0" }: { proto: string; uid?: string | number },
): string {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error(`Invalid Hedera account id: ${accountId}`);
  }
  const nativeId = `${NATIVE_ID_PREFIX}${accountId}`;
  const id = sanitiseId(
    createHash("sha256").update(nativeId, "utf8").digest("base64url"),
  );
  return `did:uaid:${id};proto=${proto};nativeId=${nativeId};uid=${uid}`;
}

export function parseUaid(uaid: string): UaidParts {
  if (typeof uaid !== "string" || !uaid.startsWith("did:uaid:")) {
    throw new Error(`Malformed UAID (missing did:uaid: prefix): ${uaid}`);
  }
  const [id, ...paramParts] = uaid.slice("did:uaid:".length).split(";");
  if (!id) {
    throw new Error(`Malformed UAID (empty id segment): ${uaid}`);
  }
  const params = new Map<string, string>();
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Malformed UAID parameter "${part}" in: ${uaid}`);
    }
    params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const proto = params.get("proto");
  const nativeId = params.get("nativeId");
  const uid = params.get("uid");
  if (!proto || !nativeId || uid === undefined) {
    throw new Error(`Malformed UAID (needs proto, nativeId and uid): ${uaid}`);
  }
  return { id, proto, nativeId, uid };
}

/** "did:uaid:...;nativeId=hedera:testnet:0.0.9697053;..." → "0.0.9697053" */
export function accountIdFromUaid(uaid: string): string {
  const { nativeId } = parseUaid(uaid);
  if (!nativeId.startsWith(NATIVE_ID_PREFIX)) {
    throw new Error(`UAID nativeId is not a Hedera testnet account: ${nativeId}`);
  }
  const accountId = nativeId.slice(NATIVE_ID_PREFIX.length);
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error(`UAID nativeId holds an invalid account id: ${nativeId}`);
  }
  return accountId;
}
