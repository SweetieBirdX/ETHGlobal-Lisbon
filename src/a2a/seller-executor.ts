import { randomUUID } from "node:crypto";
import { ZeroAddress } from "ethers";
import { Role, type Message, type Part } from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import {
  CohortTooSmallError,
  getCohortInsight,
  MIN_COHORT_SIZE,
} from "../data/aggregate.js";
import {
  insertQuery,
  openDatabase,
  updateQueryStatus,
  type QueryRow,
} from "../data/db.js";
import { getApprovedAgentIds } from "../erc8004/agent-ids.js";
import { identityRegistry } from "../erc8004/contracts.js";
import { SCORE_SUCCESS, submitFeedback } from "../erc8004/feedback.js";
import { fromDataUri } from "../erc8004/registration-files.js";
import { logAuditEvent } from "../hedera/audit.js";
import { createSellerClient } from "../hedera/clients.js";
import { parsePolicy, type DataPolicy } from "../policy/parser.js";
import {
  COHORT_INSIGHT_PATH,
  COHORT_INSIGHT_PRICE_HBAR,
  COHORT_INSIGHT_PRICE_TINYBAR,
  HBAR_ASSET_ID,
  NETWORK,
  X402_BASE_URL,
} from "../x402/config.js";

/**
 * The seller agent's negotiation logic.
 *
 * An offer passes through three gates in order, and each one can only ever
 * narrow what happens next: is the buyer who they say they are (ERC-8004), does
 * the owner's policy permit this sale, and can the cohort be reported without
 * exposing an individual. No human is involved in any of them.
 */

export type NegotiationDecision = "accept" | "decline";

/** Why an offer was turned down, for the reply and the audit trail. */
export type DeclineReason =
  | "identity_unverified"
  | "offer_incomplete"
  | "category_mismatch"
  | "price_too_low"
  | "cohort_too_small"
  /** Something failed on the seller's side; the buyer is not at fault. */
  | "internal_error";

/**
 * Everything the buyer agent needs to pay and collect, sent with an
 * acceptance. It can act on this without a human reading the reply.
 */
export interface PaymentInstruction {
  /** x402-protected URL, with the agreed cohort criteria already applied. */
  url: string;
  method: "GET";
  /** What the endpoint will charge, in HBAR. */
  priceHbar: string;
  /** The same amount in tinybar, which is what actually gets signed. */
  priceTinybar: string;
  /** Native HBAR (`0.0.0`). */
  asset: string;
  network: string;
  scheme: "exact";
}

export interface NegotiationResult {
  decision: NegotiationDecision;
  reply: string;
  reason?: DeclineReason;
  /** Size of the cohort the buyer would receive, when the offer is accepted. */
  cohortSize?: number;
  /** Present only on an acceptance. */
  payment?: PaymentInstruction;
}

/** What the buyer is asking for, read off the A2A message metadata. */
export interface Offer {
  category?: string;
  priceHbar?: number;
  ageRange?: string;
}

/**
 * The owner's policy, as typed in plain language.
 *
 * Overridable with `POLICY_STATEMENT` so a demo can change the rules without a
 * code change; Phase 8.2's form calls {@link setPolicy} instead.
 */
export const DEFAULT_POLICY_STATEMENT =
  process.env.POLICY_STATEMENT ??
  "You can sell aggregated statistics from my running and cycling data — performance scores and " +
    "session counts only — to verified research companies, minimum 0.4 HBAR per query. " +
    "Never share my heart rate, and never any health or medication data.";

let cachedPolicy: DataPolicy | null = null;

/**
 * Returns the active policy, parsing the statement once.
 *
 * Parsing per negotiation would put an LLM call on the critical path of every
 * offer and risk the answer drifting between them; the owner set the policy
 * once, so it is interpreted once.
 */
export async function getPolicy(): Promise<DataPolicy> {
  if (cachedPolicy) return cachedPolicy;

  try {
    cachedPolicy = await parsePolicy(DEFAULT_POLICY_STATEMENT);
  } catch (error) {
    // If the owner's instructions cannot be interpreted, the safe reading is
    // "sell nothing" — never "sell anything".
    throw new Error(
      `Could not interpret the owner's policy, so no sale can be authorised: ${String(error).slice(0, 160)}`,
    );
  }

  return cachedPolicy;
}

/** Replaces the active policy — used by the frontend and by tests. */
export function setPolicy(policy: DataPolicy | null): void {
  cachedPolicy = policy;
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
 * Builds the paid-endpoint instruction for an accepted offer.
 *
 * The criteria are baked into the URL by the seller rather than left to the
 * buyer, so the request that gets paid for is the one that was negotiated.
 */
export function buildPaymentInstruction(
  activityType: string,
  ageRange?: string,
  queryId?: number,
): PaymentInstruction {
  const params = new URLSearchParams({ activityType });
  if (ageRange) params.set("ageRange", ageRange);
  // Carries the negotiation into the payment, so the seller can tie a settled
  // transaction back to the buyer and terms that were agreed.
  if (queryId !== undefined) params.set("queryId", String(queryId));

  return {
    url: `${X402_BASE_URL}${COHORT_INSIGHT_PATH}?${params}`,
    method: "GET",
    priceHbar: COHORT_INSIGHT_PRICE_HBAR,
    priceTinybar: COHORT_INSIGHT_PRICE_TINYBAR,
    asset: HBAR_ASSET_ID,
    network: NETWORK,
    scheme: "exact",
  };
}

export interface CompletedSale {
  queryId: number;
  buyerAgentId: string;
  transactionId: string;
  /** HCS sequence number of the audit entry, when the write succeeded. */
  auditSequenceNumber?: number;
  /** ReputationRegistry index of the feedback, when the write succeeded. */
  feedbackIndex?: string;
  /** Steps that failed, so a partial completion is never reported as clean. */
  errors: string[];
}

/**
 * Everything the seller does *after* a payment settles, in order:
 * write the audit entry to HCS, publish reputation feedback about the buyer,
 * then mark the sale complete in the local ledger.
 *
 * Each step is attempted even if an earlier one failed — a reputation outage
 * should not cost the audit trail its record — and every failure is reported
 * back rather than swallowed.
 */
export async function recordCompletedSale(
  queryId: number,
  transactionId: string,
): Promise<CompletedSale> {
  const db = openDatabase();
  const errors: string[] = [];

  try {
    const query = db
      .prepare("SELECT * FROM queries WHERE id = ?")
      .get(queryId) as QueryRow | undefined;

    if (!query) {
      throw new Error(`No negotiation recorded for queryId ${queryId}`);
    }

    const result: CompletedSale = {
      queryId,
      buyerAgentId: query.buyer_agent_id,
      transactionId,
      errors,
    };

    // 1. Audit trail on HCS — the public, tamper-evident record that this
    //    exchange happened, carrying no raw data.
    const seller = createSellerClient();
    try {
      const audit = await logAuditEvent(seller, {
        event: "data_access_completed",
        queryId,
        buyerAgentId: query.buyer_agent_id,
        criteria: JSON.parse(query.criteria),
        priceHbar: query.price,
        paymentTransactionId: transactionId,
      });
      result.auditSequenceNumber = audit.sequenceNumber;
    } catch (error) {
      errors.push(`HCS audit log failed: ${String(error).slice(0, 160)}`);
    } finally {
      seller.close();
    }

    // 2. Reputation — the buyer paid as agreed, and the feedback cites the
    //    transaction so the claim is checkable.
    try {
      const feedback = await submitFeedback(
        query.buyer_agent_id,
        SCORE_SUCCESS,
        transactionId,
      );
      result.feedbackIndex = feedback.feedbackIndex;
    } catch (error) {
      errors.push(`Reputation feedback failed: ${String(error).slice(0, 160)}`);
    }

    // 3. Local ledger.
    updateQueryStatus(db, queryId, "completed", transactionId);

    return result;
  } finally {
    db.close();
  }
}

/** Reads the offer out of the message metadata the buyer client attaches. */
export function extractOffer(message: Message): Offer {
  const metadata = message.metadata ?? {};
  const price = metadata["offeredPriceHbar"];
  const category = metadata["category"];
  const ageRange = metadata["ageRange"];

  return {
    category: typeof category === "string" ? category : undefined,
    priceHbar: typeof price === "number" ? price : Number(price) || undefined,
    ageRange: typeof ageRange === "string" ? ageRange : undefined,
  };
}

/**
 * Matches a buyer's wording against a permitted category.
 *
 * Buyers describe what they want in their own terms ("running performance"),
 * so an exact string match would reject offers the policy actually allows.
 */
function matchCategory(requested: string, allowed: string[]): string | undefined {
  const needle = requested.trim().toLowerCase();
  return allowed.find(
    (category) => needle === category || needle.includes(category.toLowerCase()),
  );
}

/**
 * Decides an offer against the owner's policy.
 *
 * Pure and synchronous, so the rules can be tested without a network: the
 * cohort-availability check happens separately in `execute`.
 */
export function evaluateOffer(offer: Offer, policy: DataPolicy): NegotiationResult {
  if (!offer.category || offer.priceHbar === undefined || Number.isNaN(offer.priceHbar)) {
    return {
      decision: "decline",
      reason: "offer_incomplete",
      reply:
        "Your offer is incomplete. Send the data category and the price in HBAR you are offering, " +
        "and I will evaluate it against the data owner's policy.",
    };
  }

  const matched = matchCategory(offer.category, policy.allowedCategories);
  if (!matched) {
    return {
      decision: "decline",
      reason: "category_mismatch",
      reply:
        `Category mismatch — the owner's policy does not permit selling "${offer.category}" data. ` +
        `Permitted: ${policy.allowedCategories.join(", ") || "nothing at present"}. ` +
        "This is not a matter of price.",
    };
  }

  if (offer.priceHbar < policy.minPrice) {
    return {
      decision: "decline",
      reason: "price_too_low",
      reply:
        `Price too low — you offered ${offer.priceHbar} HBAR and the owner's minimum is ${policy.minPrice} HBAR ` +
        `for ${matched} data. Raise the offer and I will reconsider.`,
    };
  }

  return {
    decision: "accept",
    reply:
      `Offer accepted for ${matched} data at ${offer.priceHbar} HBAR. ` +
      "The cohort aggregate is available from the paid endpoint; settle the x402 payment and it will be released. " +
      "Raw records stay in the owner's encrypted store.",
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
  let wallet: string;
  try {
    wallet = await identityRegistry.getAgentWallet!(agentId);
  } catch (error) {
    // The registry being unreachable is not evidence the buyer is honest, so
    // this fails closed — but it says so, rather than blaming the buyer.
    return {
      verified: false,
      reason: `the ERC-8004 registry could not be reached, so agent ${agentId} cannot be verified right now (${String(error).slice(0, 100)})`,
    };
  }

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
    // A negotiation must always end in an answer. Anything unexpected becomes a
    // decline the buyer can read, never a hung request or a stack trace.
    try {
      await this.negotiate(requestContext, eventBus);
    } catch (error) {
      console.error("[negotiation] unexpected failure:", error);
      this.publishReply(requestContext, eventBus, {
        decision: "decline",
        reason: "internal_error",
        reply:
          "I could not complete this negotiation because of a problem on my side. " +
          "Nothing has been charged. Please try again shortly.",
      });
    }
  }

  private async negotiate(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const buyerAgentId = requestContext.userMessage.metadata?.["buyerAgentId"];

    // Gate 1 — identity. An unidentified or unverified buyer never reaches the
    // policy, so no offer from one can be accepted.
    if (typeof buyerAgentId !== "string" && typeof buyerAgentId !== "number") {
      this.publishReply(requestContext, eventBus, {
        decision: "decline",
        reason: "identity_unverified",
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
          reason: "identity_unverified",
          reply: `Identity check failed — ${identity.reason}. I only negotiate with verified agents.`,
        },
        identity,
      );
      return;
    }

    // Gate 2 — the owner's policy.
    const offer = extractOffer(requestContext.userMessage);
    const verdict = evaluateOffer(offer, await getPolicy());
    if (verdict.decision === "decline") {
      this.publishReply(requestContext, eventBus, verdict, identity);
      return;
    }

    // Gate 3 — can this cohort actually be reported? Checking here, before the
    // buyer is routed to the paid endpoint, is what stops them paying for a
    // request the aggregator would refuse.
    const activityType = matchCategory(
      offer.category!,
      (await getPolicy()).allowedCategories,
    )!;

    let cohortSize: number;
    try {
      const insight = await getCohortInsight({
        activityType,
        ...(offer.ageRange ? { ageRange: offer.ageRange } : {}),
      });
      cohortSize = insight.participantCount;
    } catch (error) {
      if (error instanceof CohortTooSmallError) {
        this.publishReply(
          requestContext,
          eventBus,
          {
            decision: "decline",
            reason: "cohort_too_small",
            reply:
              `Your criteria match only ${error.matched} of the owner's records, below the minimum of ` +
              `${MIN_COHORT_SIZE} needed to report an aggregate without exposing an individual. ` +
              "Broaden the criteria and I will reconsider — you have not been charged.",
          },
          identity,
        );
        return;
      }
      throw error;
    }

    // Record the agreed terms before handing out a payment URL, so a settled
    // payment can be matched back to who agreed to what.
    const db = openDatabase();
    let queryId: number;
    try {
      queryId = insertQuery(
        db,
        String(buyerAgentId),
        { activityType, ...(offer.ageRange ? { ageRange: offer.ageRange } : {}) },
        offer.priceHbar!,
        "accepted",
      );
    } finally {
      db.close();
    }

    const payment = buildPaymentInstruction(activityType, offer.ageRange, queryId);

    this.publishReply(
      requestContext,
      eventBus,
      {
        ...verdict,
        cohortSize,
        payment,
        reply:
          `${verdict.reply} Cohort: ${cohortSize} participants. ` +
          `Pay ${payment.priceHbar} HBAR (${payment.priceTinybar} tinybar, asset ${payment.asset}) ` +
          `on ${payment.network} and ${payment.method} ${payment.url} — the same request returns the aggregate once settled.`,
      },
      identity,
    );
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
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.cohortSize !== undefined ? { cohortSize: result.cohortSize } : {}),
        // The buyer agent pays straight from this, without reading the prose.
        ...(result.payment ? { payment: result.payment } : {}),
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
