import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";

/**
 * Reads the agent ids minted by `scripts/register-agents.ts`.
 *
 * Both sides of the negotiation need these: the buyer to say who it is, the
 * seller to decide whether that identity is one it will deal with.
 */

export interface RegisteredAgentRecord {
  agentId: string;
  owner: string;
  transactionHash: string;
  agentURI: string;
}

interface AgentIdsFile {
  seller: RegisteredAgentRecord;
  buyer: RegisteredAgentRecord;
  registeredAt: string;
}

const AGENT_IDS_FILE = "agent-ids.json";

let cached: AgentIdsFile | null = null;

function loadAgentIds(): AgentIdsFile {
  if (cached) return cached;

  if (!existsSync(AGENT_IDS_FILE)) {
    throw new Error(
      `${AGENT_IDS_FILE} not found — run \`npx tsx scripts/register-agents.ts\` to mint the agent identities.`,
    );
  }

  cached = JSON.parse(readFileSync(AGENT_IDS_FILE, "utf8")) as AgentIdsFile;
  return cached;
}

/** Env override exists so a test can act as an agent that is not in the file. */
export function getBuyerAgentId(): string {
  return process.env.BUYER_AGENT_ID ?? loadAgentIds().buyer.agentId;
}

export function getSellerAgentId(): string {
  return process.env.SELLER_AGENT_ID ?? loadAgentIds().seller.agentId;
}

/**
 * Stand-in for a compliance attestation from the ERC-8004 ValidationRegistry.
 *
 * A real deployment would read an attestation signed by an audit body; for the
 * hackathon the seller simply keeps a list of agent ids it has vetted. Being
 * registered on-chain proves an agent exists — this is the separate question of
 * whether the data owner is willing to sell to it.
 */
export function getApprovedAgentIds(): string[] {
  const configured = process.env.APPROVED_AGENT_IDS;
  if (configured) {
    return configured.split(",").map((id) => id.trim()).filter(Boolean);
  }
  return [loadAgentIds().buyer.agentId];
}
