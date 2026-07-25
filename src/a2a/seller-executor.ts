import { randomUUID } from "node:crypto";
import { Role, type Message, type Part } from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";

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

export class SellerExecutor implements AgentExecutor {
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const offerText = extractText(requestContext.userMessage);
    const { decision, reply } = decideOnOffer(offerText);

    const response: Message = {
      messageId: randomUUID(),
      contextId: requestContext.contextId,
      taskId: requestContext.taskId,
      role: Role.ROLE_AGENT,
      parts: [textPart(reply)],
      // The buyer agent needs to branch on the outcome without parsing prose.
      metadata: { decision },
      extensions: [],
      referenceTaskIds: [],
    };

    eventBus.publish(AgentEvent.message(response));
    eventBus.finished();
  }

  /**
   * Nothing to cancel: a decision is produced synchronously inside `execute`,
   * so there is never an in-flight task to interrupt. This changes in Phase 7,
   * where accepting kicks off a payment the buyer has to complete.
   */
  async cancelTask(
    _taskId: string,
    _eventBus: ExecutionEventBus,
  ): Promise<void> {}
}
