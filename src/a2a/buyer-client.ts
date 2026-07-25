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
  /** The owner's floor, when the seller disclosed it on a price refusal. */
  sellerMinimumHbar?: number;
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
  const minPrice = Number(replyMetadata["minPriceHbar"]);

  return {
    decision: extractDecision(raw),
    reason:
      typeof replyMetadata["reason"] === "string" ? replyMetadata["reason"] : undefined,
    reply: extractReply(raw),
    payment: replyMetadata["payment"] as PaymentInstruction | undefined,
    ...(Number.isFinite(minPrice) ? { sellerMinimumHbar: minPrice } : {}),
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

/** One round of an autonomous negotiation, for display and assertions. */
export interface NegotiationRound {
  round: number;
  offeredPriceHbar: number;
  decision?: string;
  reason?: string;
}

export interface StrategyResult {
  /** How the negotiation ended: the last reply received. */
  negotiation: NegotiationResponse;
  /** Every round, in order — the haggle as it happened. */
  rounds: NegotiationRound[];
  /** Why the buyer stopped, when it walked away without a deal. */
  walkedAwayBecause?: string;
  /** Present when the final round was accepted and the payment settled. */
  purchase?: PayAndFetchResult;
}

/**
 * Negotiates with a light strategy instead of a single take-it-or-leave-it
 * offer. No model call — three rules an economist would recognise:
 *
 *  1. Only counter when countering can help. A price refusal invites a raise;
 *     a category, data-type or identity refusal does not — no amount of money
 *     fixes "the owner does not sell health data", so the buyer walks.
 *  2. Offer the seller's stated floor. A price refusal discloses the owner's
 *     minimum (prose and metadata); the rational counter is exactly that
 *     number — never more, and no blind incremental creep.
 *  3. The budget is a hard wall. If the floor is above budget the buyer walks
 *     without another word, and even the settlement is capped at the budget,
 *     so an endpoint charging more than authorised gets nothing.
 *
 * The seller's policy is deterministic throughout — what this adds is a buyer
 * that *reacts* to refusals instead of giving up after one.
 */
export async function negotiateWithStrategy(
  criteria: DataCriteria,
  openingPriceHbar: number,
  budgetHbar: number,
  options: {
    baseUrl?: string;
    onStep?: (message: string) => void;
    maxRounds?: number;
    /** Settle the accepted offer (default true) — the fully autonomous path. */
    pay?: boolean;
  } = {},
): Promise<StrategyResult> {
  const log = options.onStep ?? (() => {});
  const maxRounds = options.maxRounds ?? 3;
  const baseUrl = options.baseUrl ?? SELLER_BASE_URL;

  if (openingPriceHbar > budgetHbar) {
    throw new Error(
      `Opening offer ${openingPriceHbar} ℏ exceeds the budget ${budgetHbar} ℏ — the strategy cannot start above its own wall.`,
    );
  }

  const rounds: NegotiationRound[] = [];
  let offer = openingPriceHbar;
  let response = await sendNegotiationRequest(criteria, offer, baseUrl);

  for (let round = 1; ; round += 1) {
    rounds.push({
      round,
      offeredPriceHbar: offer,
      decision: response.decision,
      reason: response.reason,
    });
    log(`round ${round}: offered ${offer} ℏ → ${response.decision}${response.reason ? ` (${response.reason})` : ""}`);

    if (response.decision === "accept") break;

    // Rule 1 — a refusal money cannot fix ends the negotiation immediately.
    if (response.reason !== "price_too_low") {
      const because = `refused for ${response.reason ?? "an unknown reason"} — not a matter of price, walking away`;
      log(because);
      return { negotiation: response, rounds, walkedAwayBecause: because };
    }

    if (round >= maxRounds) {
      const because = `no deal within ${maxRounds} rounds — walking away`;
      log(because);
      return { negotiation: response, rounds, walkedAwayBecause: because };
    }

    // Rule 2 — counter at the disclosed floor; without one, split the distance
    // to budget rather than creeping blindly.
    const floor = response.sellerMinimumHbar;
    const next =
      floor !== undefined ? floor : Math.round(((offer + budgetHbar) / 2) * 100) / 100;

    // Rule 3 — the budget is a wall, and a counter must actually improve.
    if (next > budgetHbar || next <= offer) {
      const because =
        floor !== undefined
          ? `the owner's floor is ${floor} ℏ and our budget is ${budgetHbar} ℏ — walking away`
          : `cannot improve the offer within budget ${budgetHbar} ℏ — walking away`;
      log(because);
      return { negotiation: response, rounds, walkedAwayBecause: because };
    }

    log(`countering at ${next} ℏ${floor !== undefined ? " (the owner's stated floor)" : ""}, budget ${budgetHbar} ℏ`);
    offer = next;
    response = await counterOffer(response, criteria, offer, baseUrl);
  }

  if (options.pay === false || !response.payment?.url) {
    return { negotiation: response, rounds };
  }

  // Settlement stays inside the budget too: a quote above it is refused
  // unsigned, exactly like a quote above the negotiated price.
  const budgetTinybar = String(Math.round(budgetHbar * 100_000_000));
  const cap =
    BigInt(response.payment.priceTinybar) < BigInt(budgetTinybar)
      ? response.payment.priceTinybar
      : budgetTinybar;

  const purchase = await payAndFetch(response.payment.url, {
    maxAmountTinybar: cap,
    onStep: log,
  });

  return { negotiation: response, rounds, purchase };
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
