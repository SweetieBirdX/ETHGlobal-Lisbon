import { randomUUID } from "node:crypto";
import { ZeroAddress } from "ethers";
import { Role, type Message, type Part } from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { getApprovedAgentIds } from "../erc8004/agent-ids.js";
import { identityRegistry } from "../erc8004/contracts.js";
import { fromDataUri } from "../erc8004/registration-files.js";

/**
 * The seller agent's negotiation logic.
 *
 * This is the skeleton version: the decision is a keyword check, standing in
 * for the real chain of ERC-8004 identity verification (Phase 5.4) and the
 * owner's natural-language policy (Phase 6.5). Everything around the decision —
 * how the offer is read off the A2A message and how the reply is published — is
 * already the real thing, so those later phases only replace `decideOnOffer`.
 */

export type NegotiationDecision = "accept" | "decline";

export interface NegotiationResult {
  decision: NegotiationDecision;
  reply: string;
}

/**
 * A text part. The protobuf-derived `Part` type requires `metadata`,
 * `filename` and `mediaType` to be present even when a part is plain text.
 */
function textPart(value: string): Part {
  return {
    content: { $case: "text", value },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}

/** Pulls the plain text out of an A2A message, ignoring non-text parts. */
export function extractText(message: Message): string {
  return message.parts
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .join(" ")
    .trim();
}

/**
 * Placeholder policy: an offer that names a price is worth continuing with,
 * anything else gets asked for one.
 */
export function decideOnOffer(offerText: string): NegotiationResult {
  const mentionsPrice = offerText.toLowerCase().includes("price");

  if (mentionsPrice) {
    return {
      decision: "accept",
      reply:
        "Offer accepted. The cohort aggregate is available from the paid endpoint; " +
        "settle the x402 payment and the data will be released. Raw records stay in the owner's encrypted store.",
    };
  }

  return {
    decision: "decline",
    reply:
      "No price found in your offer. Send the category, cohort size and the price in HBAR you are offering, " +
      "and I will evaluate it against the data owner's policy.",
  };
}

export interface IdentityCheck {
  verified: boolean;
  /** Why the check failed, for the reply and the audit trail. */
  reason: string;
  /** Wallet the registry has on file, when the identity exists. */
  wallet?: string;
  /** Agent name from the on-chain registration file. */
  name?: string;
}

/**
 * Checks a buyer against the ERC-8004 IdentityRegistry before negotiating.
 *
 * Three separate questions, in order: does this identity exist on-chain, has
 * its owner retired it, and is it one the data owner has agreed to sell to.
 */
export async function verifyBuyerIdentity(
  agentId: string,
): Promise<IdentityCheck> {
  if (!/^\d+$/.test(agentId)) {
    return { verified: false, reason: `"${agentId}" is not a valid agent id` };
  }

  // Returns the zero address for an id that was never minted, rather than
  // reverting the way ownerOf does.
  const wallet: string = await identityRegistry.getAgentWallet!(agentId);
  if (wallet === ZeroAddress) {
    return {
      verified: false,
      reason: `agent ${agentId} is not registered in the ERC-8004 IdentityRegistry`,
    };
  }

  let name: string | undefined;
  try {
    const file = fromDataUri(await identityRegistry.tokenURI!(agentId));
    name = file.name;
    if (!file.active) {
      return {
        verified: false,
        reason: `agent ${agentId} ("${file.name}") is marked inactive`,
        wallet,
        name,
      };
    }
  } catch (error) {
    // An unreadable registration file is not proof of bad faith, but it is not
    // something to trade on either.
    return {
      verified: false,
      reason: `agent ${agentId} has an unreadable registration file (${String(error).slice(0, 80)})`,
      wallet,
    };
  }

  // Stands in for a ValidationRegistry compliance attestation — see
  // getApprovedAgentIds().
  if (!getApprovedAgentIds().includes(agentId)) {
    return {
      verified: false,
      reason: `agent ${agentId} ("${name}") holds no compliance attestation for health data`,
      wallet,
      name,
    };
  }

  return {
    verified: true,
    reason: `agent ${agentId} ("${name}") is registered, active and attested`,
    wallet,
    name,
  };
}

export class SellerExecutor implements AgentExecutor {
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const offerText = extractText(requestContext.userMessage);
    const buyerAgentId = requestContext.userMessage.metadata?.["buyerAgentId"];

    // Identity first: an unidentified or unverified buyer never reaches the
    // policy, so no offer from one can be accepted.
    if (typeof buyerAgentId !== "string" && typeof buyerAgentId !== "number") {
      this.publishReply(requestContext, eventBus, {
        decision: "decline",
        reply:
          "Identify yourself before making an offer: include your ERC-8004 agentId as `buyerAgentId` " +
          "in the message metadata so I can verify you against the IdentityRegistry.",
      });
      return;
    }

    const identity = await verifyBuyerIdentity(String(buyerAgentId));
    if (!identity.verified) {
      this.publishReply(
        requestContext,
        eventBus,
        {
          decision: "decline",
          reply: `Identity check failed — ${identity.reason}. I only negotiate with verified agents.`,
        },
        identity,
      );
      return;
    }

    const { decision, reply } = decideOnOffer(offerText);

    this.publishReply(requestContext, eventBus, { decision, reply }, identity);
  }

  /** Publishes one reply and closes the exchange. */
  private publishReply(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
    result: NegotiationResult,
    identity?: IdentityCheck,
  ): void {
    const response: Message = {
      messageId: randomUUID(),
      contextId: requestContext.contextId,
      taskId: requestContext.taskId,
      role: Role.ROLE_AGENT,
      parts: [textPart(result.reply)],
      // The buyer agent needs to branch on the outcome without parsing prose,
      // and the identity result is what the audit trail records.
      metadata: {
        decision: result.decision,
        identityVerified: identity?.verified ?? false,
        identityReason: identity?.reason ?? "no identity supplied",
      },
      extensions: [],
      referenceTaskIds: [],
    };

    eventBus.publish(AgentEvent.message(response));
    eventBus.finished();
  }

  /**
   * Nothing to cancel: a decision is produced inside `execute`, so there is
   * never an in-flight task to interrupt. This changes in Phase 7, where
   * accepting kicks off a payment the buyer has to complete.
   */
  async cancelTask(
    _taskId: string,
    _eventBus: ExecutionEventBus,
  ): Promise<void> {}
}
