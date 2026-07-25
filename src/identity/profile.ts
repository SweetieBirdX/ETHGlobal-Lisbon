/**
 * Agent profile documents for the HCS identity registry. Owner: P1.
 *
 * Ports the shape of the old ERC-8004 registration files (erc8004/registration-files.ts)
 * with everything EVM dropped: no on-chain URI, no token image — the profile itself is
 * published to an HCS topic and read back through the mirror node.
 */

import { createHash } from "node:crypto";
import { SELLER_AGENT_URL } from "../a2a/seller-agent-card.js";
import { deriveUaid, UAID_PROTO } from "./uaid.js";

/** A protocol endpoint the agent exposes. */
export interface AgentService {
  name: string;
  endpoint: string;
  version: string;
}

export interface AgentProfile {
  uaid: string;
  name: string;
  description: string;
  /** e.g. "hedera:testnet:0.0.9697053" — the Hedera account behind the agent. */
  nativeId: string;
  /** Endpoints the agent serves. Empty when it only initiates, never receives. */
  services: AgentService[];
  /** Protocols the agent speaks, whether or not it exposes an endpoint for them. */
  protocols: string[];
  x402Support: boolean;
  /** Set false to retire an identity without deleting history. */
  active: boolean;
  /** Trust models the agent participates in. */
  supportedTrust: string[];
  issuedAt: string;
}

/** A2A protocol version advertised to buyers built against the older spec. */
const A2A_VERSION = "0.3.0";

export function sellerProfile(accountId: string): AgentProfile {
  return {
    uaid: deriveUaid(accountId, { proto: UAID_PROTO }),
    name: "Rights Holder Licensing Agent",
    description:
      "Licensing agent acting for a music rights holder. Negotiates fractional licences " +
      "(sync, mechanical, sampling, performance) over the rights holder's tracks against a " +
      "policy set in plain language, and grants a licence only once payment has settled on " +
      "Hedera. Master references stay encrypted until a licence is paid for.",
    nativeId: `hedera:testnet:${accountId}`,
    services: [
      {
        name: "A2A",
        endpoint: SELLER_AGENT_URL,
        version: A2A_VERSION,
      },
    ],
    protocols: ["a2a", "x402"],
    x402Support: true,
    active: true,
    supportedTrust: ["reputation"],
    issuedAt: new Date().toISOString(),
  };
}

export function buyerProfile(accountId: string): AgentProfile {
  return {
    uaid: deriveUaid(accountId, { proto: UAID_PROTO }),
    name: "Content Producer Procurement Agent",
    description:
      "Procurement agent for a content production studio. Discovers rights holder agents, " +
      "negotiates fractional music licences for film, game and documentary productions, and " +
      "settles the agreed price autonomously over x402 on Hedera — no human approves an " +
      "individual purchase.",
    nativeId: `hedera:testnet:${accountId}`,
    // The buyer initiates negotiations and never receives them, so it exposes no
    // A2A endpoint. Advertising one it does not serve would publish a false claim.
    services: [],
    protocols: ["a2a", "x402"],
    x402Support: true,
    active: true,
    supportedTrust: ["reputation"],
    issuedAt: new Date().toISOString(),
  };
}

/**
 * sha256 hex over the profile's identity claims, so a published profile is
 * tamper-evident. `issuedAt` is excluded and keys are sorted: the hash must be
 * reproducible by anyone re-deriving it later, independent of when (or in what
 * key order) the profile was serialised.
 */
export function profileHash(profile: AgentProfile): string {
  const { issuedAt: _issuedAt, ...claims } = profile;
  const canonical = JSON.stringify(sortKeysDeep(claims));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortKeysDeep(child)]),
    );
  }
  return value;
}
