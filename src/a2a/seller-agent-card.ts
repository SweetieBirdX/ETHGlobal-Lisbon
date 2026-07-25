import type { AgentCard } from "@a2a-js/sdk";
import { duplicateInterfacesForLegacy } from "@a2a-js/sdk/compat/v0_3";

/**
 * The seller agent's public manifest.
 *
 * This is how a buyer agent discovers us: it fetches the card, sees the
 * `data-access-negotiation` skill, and knows it can open a negotiation without
 * any prior arrangement between the two operators — which is the whole point of
 * agent-to-agent commerce.
 *
 * The card is served at `/.well-known/agent-card.json` by the Phase 4.3 server.
 */

/** Where the seller agent answers A2A JSON-RPC calls. */
export const SELLER_AGENT_URL = "http://localhost:4000/a2a/jsonrpc";

/**
 * The same endpoint is advertised twice: once for A2A 1.0 (what the installed
 * `@a2a-js/sdk` speaks natively) and once for 0.3, so buyer agents built
 * against the older spec can still find and call us.
 */
const supportedInterfaces = duplicateInterfacesForLegacy(
  [
    {
      url: SELLER_AGENT_URL,
      protocolBinding: "JSONRPC",
      tenant: "",
      protocolVersion: "1.0",
    },
  ],
  ["JSONRPC"],
);

export const sellerAgentCard: AgentCard = {
  name: "Fitness Data Seller Agent",
  description:
    "Personal data agent acting for an individual who owns their fitness and performance data. " +
    "Negotiates access to anonymised cohort aggregates on the owner's behalf, autonomously and " +
    "against a policy the owner set once in plain language. Raw data never leaves the owner's " +
    "encrypted store — buyers receive aggregates, and only after payment settles on Hedera.",
  version: "0.1.0",
  provider: {
    organization: "Personal Fitness Data Marketplace",
    url: "https://github.com/SweetieBirdX/ETHGlobal-Lisbon",
  },
  supportedInterfaces,
  capabilities: {
    // No callbacks: a negotiation is short enough to answer in-band, and the
    // buyer agent is the one that acts next (by paying), so there is nothing
    // to push.
    pushNotifications: false,
    streaming: false,
    extensions: [],
  },
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  skills: [
    {
      id: "data-access-negotiation",
      name: "Data access negotiation",
      description:
        "Receives an offer for access to a fitness data cohort (category, cohort size, price in HBAR), " +
        "checks the buyer's ERC-8004 identity, evaluates the offer against the owner's policy, and either " +
        "declines with a reason or accepts and returns an x402-protected endpoint the buyer can pay to.",
      tags: ["negotiation", "data-marketplace", "fitness", "hedera", "x402", "erc-8004"],
      examples: [
        "We would like running performance data for ages 25-34. We can pay 0.5 HBAR for the cohort aggregate.",
        "Offering 0.1 HBAR for sleep data across 500 participants.",
        "What categories of data can we buy, and at what price?",
      ],
      inputModes: ["text"],
      outputModes: ["text"],
      securityRequirements: [],
    },
  ],
  // Anyone may open a negotiation — trust comes from the buyer's on-chain
  // ERC-8004 identity (checked in Phase 5.4), not from a transport credential.
  securitySchemes: {},
  securityRequirements: [],
  signatures: [],
};
