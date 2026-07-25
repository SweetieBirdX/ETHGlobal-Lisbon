import "dotenv/config";
import { AgentMode } from "@hashgraph/hedera-agent-kit";
import { allCorePlugins } from "@hashgraph/hedera-agent-kit/plugins";
import { HederaLangchainToolkit } from "@hashgraph/hedera-agent-kit-langchain";
import type { Client } from "@hiero-ledger/sdk";
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
 * Builds the seller agent's toolkit.
 *
 * Pass a client in when you need to close it afterwards — the Hedera SDK keeps
 * gRPC connections open and the process will hang without a `client.close()`.
 */
export function createSellerToolkit(
  client: Client = createSellerClient(),
): HederaLangchainToolkit {
  return new HederaLangchainToolkit({
    client,
    configuration: {
      plugins: allCorePlugins,
      context: {
        mode: AgentMode.AUTONOMOUS,
      },
    },
  });
}
