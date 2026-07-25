import "dotenv/config";
import { AgentMode } from "@hashgraph/hedera-agent-kit";
import { HcsAuditTrailHook } from "@hashgraph/hedera-agent-kit/hooks";
import { allCorePlugins } from "@hashgraph/hedera-agent-kit/plugins";
import { HederaLangchainToolkit } from "@hashgraph/hedera-agent-kit-langchain";
import type { Client } from "@hiero-ledger/sdk";
import { requireAuditTopicId } from "./audit.js";
import { createSellerClient } from "./clients.js";

/**
 * Hedera Agent Kit toolkit for the seller agent.
 *
 * `AgentMode.AUTONOMOUS` is the point of the whole project: the toolkit signs
 * and submits transactions with the seller's operator key on its own, instead
 * of handing unsigned bytes back for a human to approve (`RETURN_BYTES`).
 *
 * `allCorePlugins` exposes the full core tool set (HBAR transfers, HCS topics,
 * balance queries, ...) as LangChain tools, so the agent can pick the right one
 * during a negotiation rather than us hard-coding the call.
 */

/**
 * Tools whose executions are written to the HCS audit topic.
 *
 * Reads are audited alongside writes on purpose: the trail is meant to show
 * what the agent did on the user's behalf, and "the agent looked at your
 * account" is part of that story. Adding a tool here costs one extra HCS
 * message (and its fee) per call, so the list stays limited to the tools the
 * marketplace flow actually uses.
 */
export const AUDITED_TOOLS = [
  "get_hbar_balance_query_tool",
  "transfer_hbar_tool",
  "submit_topic_message_tool",
];

/**
 * Builds the seller agent's toolkit.
 *
 * Pass a client in when you need to close it afterwards — the Hedera SDK keeps
 * gRPC connections open and the process will hang without a `client.close()`.
 * The same client also pays for the audit messages.
 */
export function createSellerToolkit(
  client: Client = createSellerClient(),
): HederaLangchainToolkit {
  // Throws when HCS_AUDIT_TOPIC_ID is unset, so a missing audit trail fails
  // loudly at startup instead of silently dropping the evidence.
  const auditHook = new HcsAuditTrailHook(
    AUDITED_TOOLS,
    requireAuditTopicId(),
    client,
  );

  return new HederaLangchainToolkit({
    client,
    configuration: {
      plugins: allCorePlugins,
      context: {
        mode: AgentMode.AUTONOMOUS,
        hooks: [auditHook],
      },
    },
  });
}
