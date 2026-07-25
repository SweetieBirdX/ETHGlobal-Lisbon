import { randomUUID } from "node:crypto";
import { Role, type Message, type Part, type SendMessageResult } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { getBuyerAgentId } from "../erc8004/agent-ids.js";
import { payAndFetch, type PayAndFetchResult } from "../x402/pay.js";
import { SELLER_AGENT_URL } from "./seller-agent-card.js";

/**
 * The research company's buyer agent.
 *
 * It knows one thing about the seller: a base URL. Everything else — which
 * transport to use, which protocol version, where the JSON-RPC endpoint lives —
 * comes from the agent card the factory downloads, which is what makes this an
 * agent-to-agent interaction rather than two halves of one program.
 */

/** Base URL of the seller agent, derived from the endpoint it advertises. */
export const SELLER_BASE_URL = new URL(SELLER_AGENT_URL).origin;

/** What the buyer wants to buy access to. */
export interface DataCriteria {
  /** Fitness data category, e.g. "running performance". */
  category: string;
  /** Age band of the cohort, e.g. "25-34". */
  ageRange?: string;
  /** How many participants the buyer wants in the aggregate. */
  cohortSize?: number;
  /**
   * Specific data types requested, e.g. ["performanceScore"] or the
   * health-bucket ["cycleTracking"]. Omitted = the standard aggregate.
   */
  dataTypes?: string[];
}

/** The paid endpoint the seller routes an accepted offer to (Phase 7.1). */
export interface PaymentInstruction {
  url: string;
  method: string;
  priceHbar: string;
  priceTinybar: string;
  asset: string;
  network: string;
  scheme: string;
}

/** Identifies an open negotiation, so a follow-up lands in the same task. */
export interface NegotiationSession {
  taskId: string;
  contextId: string;
}

export interface NegotiationResponse {
  /** `"accept"` or `"decline"` as reported by the seller, when it said. */
  decision?: string;
  /** Why the seller declined, when it did. */
  reason?: string;
  /** The seller's reply in plain text. */
  reply: string;
  /** Where and what to pay — present only when the offer was accepted. */
  payment?: PaymentInstruction;
  /**
   * The task this reply belongs to. A declined offer leaves the task open
   * (input-required), so passing these back via {@link counterOffer} continues
   * the same negotiation instead of opening a new one.
   */
  taskId: string;
  contextId: string;
  /** Untouched result, for callers that need the task/message details. */
  raw: SendMessageResult;
}

function textPart(value: string): Part {
  return {
    content: { $case: "text", value },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}

/** Renders the offer as the sentence a human buyer would have written. */
export function formatOffer(criteria: DataCriteria, offeredPrice: number): string {
  const details = [
    `category: ${criteria.category}`,
    criteria.ageRange ? `age range: ${criteria.ageRange}` : undefined,
    criteria.cohortSize ? `cohort size: ${criteria.cohortSize}` : undefined,
    criteria.dataTypes?.length
      ? `data types: ${criteria.dataTypes.join(", ")}`
      : undefined,
  ].filter(Boolean);

  return (
    `We would like access to an anonymised cohort aggregate (${details.join(", ")}). ` +
    `Our offered price is ${offeredPrice} HBAR, payable immediately on acceptance.`
  );
}

/**
 * The seller may answer with a bare `Message` or with a `Task` carrying the
 * message in its status — this reads either without the caller caring which.
 */
function responseMessage(result: SendMessageResult): Message | undefined {
  return "parts" in result ? result : result.status?.message;
}

/** Pulls the reply text out of whatever the seller returned. */
function extractReply(result: SendMessageResult): string {
  const parts = responseMessage(result)?.parts ?? [];
  return parts
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .join(" ")
    .trim();
}

function extractDecision(result: SendMessageResult): string | undefined {
  const decision = responseMessage(result)?.metadata?.["decision"];
  return typeof decision === "string" ? decision : undefined;
}

function extractMetadata(result: SendMessageResult): Record<string, unknown> {
  return responseMessage(result)?.metadata ?? {};
}

/**
 * The task/context ids of this exchange, whichever shape the result took.
 *
 * A Task carries them as `id`/`contextId`; a bare Message echoes them as
 * `taskId`/`contextId`. Since session 46 the seller answers with Tasks, so the
 * first branch is the live one — the second keeps old-shape peers readable.
 */
function extractSession(result: SendMessageResult): NegotiationSession {
  if ("parts" in result) {
    return { taskId: result.taskId, contextId: result.contextId };
  }
  return { taskId: result.id, contextId: result.contextId };
}

/**
 * Sends arbitrary text to the seller agent.
 *
 * Useful for the messages a negotiation opens with before there is an offer on
 * the table ("what do you have?"), and for exercising the seller's rejection
 * path, which a fully-formed offer never reaches.
 */
export async function sendNegotiationMessage(
  text: string,
  metadata?: Record<string, unknown>,
  baseUrl: string = SELLER_BASE_URL,
  /** Continue an existing negotiation instead of opening a new one. */
  session?: NegotiationSession,
): Promise<NegotiationResponse> {
  const factory = new ClientFactory();
  // Reads /.well-known/agent-card.json and picks a transport from the card.
  const client = await factory.createFromUrl(baseUrl);

  const message: Message = {
    messageId: randomUUID(),
    // Empty ids open a fresh negotiation; a session's ids land the message in
    // the same task, which the seller's reply then acknowledges as a round.
    contextId: session?.contextId ?? "",
    taskId: session?.taskId ?? "",
    role: Role.ROLE_USER,
    parts: [textPart(text)],
    // The buyer names its ERC-8004 identity on every message; the seller looks
    // it up in the registry before deciding whether to deal (Phase 5.4).
    metadata: { buyerAgentId: getBuyerAgentId(), ...metadata },
    extensions: [],
    referenceTaskIds: [],
  };

  const raw = await client.sendMessage({
    tenant: "",
    message,
    configuration: undefined,
    metadata: undefined,
  });

  const replyMetadata = extractMetadata(raw);

  return {
    decision: extractDecision(raw),
    reason:
      typeof replyMetadata["reason"] === "string" ? replyMetadata["reason"] : undefined,
    reply: extractReply(raw),
    payment: replyMetadata["payment"] as PaymentInstruction | undefined,
    ...extractSession(raw),
    raw,
  };
}

/**
 * Opens a negotiation with the seller agent and returns its answer.
 *
 * @param criteria what cohort the buyer wants
 * @param offeredPrice price in HBAR the buyer is willing to pay
 */
export async function sendNegotiationRequest(
  criteria: DataCriteria,
  offeredPrice: number,
  baseUrl: string = SELLER_BASE_URL,
  session?: NegotiationSession,
): Promise<NegotiationResponse> {
  return sendNegotiationMessage(
    formatOffer(criteria, offeredPrice),
    // Sent alongside the prose so the seller can act on exact numbers rather
    // than parsing them back out of the sentence.
    { offeredPriceHbar: offeredPrice, ...criteria },
    baseUrl,
    session,
  );
}

/**
 * Raises (or revises) an offer inside the same negotiation.
 *
 * A declined offer leaves the task in `input-required` — the seller's "raise
 * the offer and I will reconsider" is a genuine invitation. This sends the new
 * terms into that same task, and the seller's reply acknowledges the round:
 * "last round you offered X and I declined". The policy itself is unchanged —
 * the same terms always get the same verdict; what continues is the session.
 */
export async function counterOffer(
  previous: NegotiationResponse,
  criteria: DataCriteria,
  offeredPrice: number,
  baseUrl: string = SELLER_BASE_URL,
): Promise<NegotiationResponse> {
  if (!previous.taskId) {
    throw new Error(
      "The previous reply carried no taskId — there is no negotiation to continue.",
    );
  }
  return sendNegotiationRequest(criteria, offeredPrice, baseUrl, {
    taskId: previous.taskId,
    contextId: previous.contextId,
  });
}

export interface PurchaseResult {
  negotiation: NegotiationResponse;
  /** Present only when the seller accepted and the payment went through. */
  purchase?: PayAndFetchResult;
}

/**
 * Negotiates and, if the seller accepts, pays — end to end, unattended.
 *
 * This is the behaviour the whole project is about: the buyer agent reads the
 * endpoint and price off the acceptance, settles a real Hedera payment, and
 * collects the data, with no human approving the transaction. A decline simply
 * comes back with its reason and nothing is paid.
 */
export async function negotiateAndPurchase(
  criteria: DataCriteria,
  offeredPrice: number,
  options: { baseUrl?: string; onStep?: (message: string) => void } = {},
): Promise<PurchaseResult> {
  const log = options.onStep ?? (() => {});

  const negotiation = await sendNegotiationRequest(
    criteria,
    offeredPrice,
    options.baseUrl ?? SELLER_BASE_URL,
  );
  log(`negotiation: ${negotiation.decision}${negotiation.reason ? ` (${negotiation.reason})` : ""}`);

  if (negotiation.decision !== "accept") {
    return { negotiation };
  }

  if (!negotiation.payment?.url) {
    throw new Error(
      "Seller accepted but returned no payment instruction — cannot pay without an endpoint.",
    );
  }

  // Pay no more than the seller quoted during the negotiation: the endpoint is
  // asked again for its price, and a higher one is refused rather than signed.
  const purchase = await payAndFetch(negotiation.payment.url, {
    maxAmountTinybar: negotiation.payment.priceTinybar,
    onStep: log,
  });

  return { negotiation, purchase };
}
