import { keccak256, toUtf8Bytes, type Contract, type LogDescription } from "ethers";
import { SELLER_AGENT_URL } from "../a2a/seller-agent-card.js";
import { reputationRegistry } from "./contracts.js";
import { createSellerWallet } from "./wallets.js";

/**
 * Reputation feedback on the ERC-8004 ReputationRegistry.
 *
 * After a deal settles, the seller records publicly how it went. That record is
 * what lets a *future* seller — one that has never met this buyer — decide
 * whether to deal with it, without any central marketplace vouching for anyone.
 * The payment transaction is cited in the feedback document, so the claim is
 * checkable against Hedera rather than merely asserted.
 */

/** Marks feedback about a completed data-access deal. */
export const FEEDBACK_TAG = "dataAccessCompleted";

/** Score for a deal that completed as agreed. */
export const SCORE_SUCCESS = 100;
/** Score for a deal that did not. */
export const SCORE_FAILURE = 0;

/** ReputationRegistry stores whole numbers plus a decimals field. */
const VALUE_DECIMALS = 0;

/** Hedera's relay does not reliably estimate this call. */
const GAS_LIMIT = 1_000_000n;

export interface FeedbackDocument {
  tag: string;
  score: number;
  outcome: "completed" | "failed";
  /** Cites the Hedera transaction that settled the payment. */
  proofOfPayment: { txHash: string };
  issuedAt: string;
}

export interface FeedbackResult {
  agentId: string;
  score: number;
  transactionHash: string;
  feedbackIndex: string;
  feedbackURI: string;
  feedbackHash: string;
}

export function buildFeedbackDocument(
  score: number,
  paymentTxHash: string,
): FeedbackDocument {
  return {
    tag: FEEDBACK_TAG,
    score,
    outcome: score >= SCORE_SUCCESS ? "completed" : "failed",
    proofOfPayment: { txHash: paymentTxHash },
    issuedAt: new Date().toISOString(),
  };
}

export function toFeedbackUri(document: FeedbackDocument): string {
  const base64 = Buffer.from(JSON.stringify(document), "utf8").toString("base64");
  return `data:application/json;base64,${base64}`;
}

/**
 * Records the seller's verdict on a buyer after a deal.
 *
 * @param buyerAgentId ERC-8004 id of the buyer being rated
 * @param score {@link SCORE_SUCCESS} or {@link SCORE_FAILURE}
 * @param paymentTxHash the Hedera transaction that settled the payment
 */
export async function submitFeedback(
  buyerAgentId: string,
  score: number,
  paymentTxHash: string,
): Promise<FeedbackResult> {
  if (!/^\d+$/.test(buyerAgentId)) {
    throw new Error(`Invalid agent id: ${buyerAgentId}`);
  }
  if (!paymentTxHash) {
    throw new Error(
      "A payment transaction hash is required — feedback without proof of payment is worth nothing.",
    );
  }

  const document = buildFeedbackDocument(score, paymentTxHash);
  const feedbackURI = toFeedbackUri(document);
  // Lets a reader confirm the document was not altered after the fact, even if
  // the URI ever moves off-chain.
  const feedbackHash = keccak256(toUtf8Bytes(JSON.stringify(document)));

  const registry = reputationRegistry.connect(createSellerWallet()) as Contract;

  const tx = await registry["giveFeedback"]!(
    buyerAgentId,
    score,
    VALUE_DECIMALS,
    FEEDBACK_TAG,
    "", // tag2 unused
    SELLER_AGENT_URL, // endpoint the deal happened over
    feedbackURI,
    feedbackHash,
    { gasLimit: GAS_LIMIT },
  );

  const receipt = await tx.wait();
  if (!receipt) throw new Error(`Feedback transaction ${tx.hash} produced no receipt`);

  // The index is assigned on-chain and arrives via the event.
  const event = receipt.logs
    .map((log: { topics: readonly string[]; data: string }): LogDescription | null => {
      try {
        return reputationRegistry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: LogDescription | null) => parsed?.name === "NewFeedback");

  if (!event) {
    throw new Error(`No NewFeedback event in transaction ${tx.hash}`);
  }

  return {
    agentId: buyerAgentId,
    score,
    transactionHash: tx.hash,
    feedbackIndex: String(event.args["feedbackIndex"]),
    feedbackURI,
    feedbackHash,
  };
}
