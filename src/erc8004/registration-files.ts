import { SELLER_AGENT_URL } from "../a2a/seller-agent-card.js";

/**
 * ERC-8004 registration files for the two agents.
 *
 * The registry stores a URI per agent, not the metadata itself. These documents
 * are what that URI resolves to: who the agent is, what protocols it speaks and
 * on what basis it can be trusted. Encoding them as `data:` URIs keeps the demo
 * self-contained — no IPFS pin or web host that could be down during judging.
 */

/** A protocol endpoint the agent exposes. */
export interface AgentService {
  name: string;
  endpoint: string;
  version: string;
}

export interface RegistrationFile {
  /** Identifies the document as an ERC-8004 registration file. */
  type: string;
  name: string;
  description: string;
  /** Avatar shown by explorers; a data URI keeps it dependency-free. */
  image: string;
  services: AgentService[];
  /** Whether the agent can transact over x402. */
  x402Support: boolean;
  /** Set false to retire an identity without burning the token. */
  active: boolean;
  /** Trust models the agent participates in. */
  supportedTrust: string[];
}

export const REGISTRATION_FILE_TYPE =
  "https://eips.ethereum.org/EIPS/eip-8004#registration";

/** A2A protocol version advertised to buyers built against the older spec. */
const A2A_VERSION = "0.3.0";

/** 1x1 transparent PNG — a placeholder that needs no external host. */
const PLACEHOLDER_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const sellerRegistrationFile: RegistrationFile = {
  type: REGISTRATION_FILE_TYPE,
  name: "Fitness Data Seller Agent",
  description:
    "Personal data agent acting for an individual who owns their fitness and performance data. " +
    "Negotiates access to anonymised cohort aggregates on the owner's behalf against a policy the " +
    "owner set in plain language, and releases data only once payment has settled on Hedera. " +
    "Raw records never leave the owner's encrypted store.",
  image: PLACEHOLDER_IMAGE,
  services: [
    {
      name: "A2A",
      endpoint: SELLER_AGENT_URL,
      version: A2A_VERSION,
    },
  ],
  x402Support: true,
  active: true,
  supportedTrust: ["reputation"],
};

export const buyerRegistrationFile: RegistrationFile = {
  type: REGISTRATION_FILE_TYPE,
  name: "Health Research Buyer Agent",
  description:
    "Research organisation's procurement agent. Discovers data seller agents, negotiates access to " +
    "anonymised fitness cohort aggregates, and settles the agreed price autonomously over x402 on " +
    "Hedera — no human approves an individual purchase.",
  image: PLACEHOLDER_IMAGE,
  // The buyer initiates negotiations and never receives them, so it exposes no
  // A2A endpoint. Advertising one it does not serve would put a false claim
  // on-chain; add an entry here if a buyer-side server is ever built.
  services: [],
  x402Support: true,
  active: true,
  supportedTrust: ["reputation"],
};

/**
 * Encodes a registration file as the `data:` URI stored on-chain.
 *
 * `register(string agentURI)` takes any URI; a data URI means the metadata
 * travels with the token instead of depending on a host staying up.
 */
export function toDataUri(file: RegistrationFile): string {
  const json = JSON.stringify(file);
  const base64 = Buffer.from(json, "utf8").toString("base64");
  return `data:application/json;base64,${base64}`;
}

/**
 * Reverses {@link toDataUri}. The seller needs this in Phase 5.4 to read a
 * buyer's registration file back out of the registry before trusting it.
 */
export function fromDataUri(uri: string): RegistrationFile {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) {
    throw new Error(
      `Not a base64 JSON data URI: ${uri.slice(0, 40)}${uri.length > 40 ? "…" : ""}`,
    );
  }
  const json = Buffer.from(uri.slice(prefix.length), "base64").toString("utf8");
  return JSON.parse(json) as RegistrationFile;
}
