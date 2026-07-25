/**
 * Agent reputation on HCS, replacing the ERC-8004 ReputationRegistry. Owner: P1.
 *
 * After a deal settles, the seller records publicly how it went. That record is
 * what lets a *future* seller — one that has never met this buyer — decide
 * whether to deal with it, without any central marketplace vouching for anyone.
 * The payment transaction is cited in the feedback message, so the claim is
 * checkable against Hedera rather than merely asserted.
 *
 * ⚠️ Not idempotent: every call appends another feedback message and shifts the
 * average. Nothing here deduplicates by payment id — the caller's completion
 * guard (feedback is submitted exactly once, when a sale completes) is still
 * what prevents double-rating.
 */

import { createHash } from "node:crypto";
import type { Client } from "@hiero-ledger/sdk";
import { logAuditEvent } from "../hedera/audit.js";
import { createSellerClient } from "../hedera/clients.js";
import { fetchTopicMessages } from "../hedera/mirror.js";
import { getSellerUaid } from "./agent-ids.js";
import { requireIdentityTopicId } from "./registry.js";
import { parseUaid } from "./uaid.js";

/** Marks feedback about a completed licensing deal. */
export const FEEDBACK_TAG = "licenceCompleted";

/** Score for a deal that completed as agreed. */
export const SCORE_SUCCESS = 100;
/** Score for a deal that did not. */
export const SCORE_FAILURE = 0;

export interface FeedbackResult {
  subjectUaid: string;
  issuerUaid: string;
  score: number;
  feedbackHash: string;
  sequenceNumber: number;
  transactionId: string;
}

export interface ReputationEntry {
  subjectUaid: string;
  issuerUaid: string;
  score: number;
  tag: string;
  /** The payment transaction the feedback cites. */
  paymentTxId: string;
  feedbackHash: string;
  sequenceNumber: number;
  consensusTimestamp: string;
}

export interface Reputation {
  count: number;
  /** 0 when no feedback exists — a stranger, not a proven failure. */
  averageScore: number;
  /** Newest first. */
  entries: ReputationEntry[];
}

/** sha256 over the feedback claims, so a reader can confirm nothing was altered. */
function feedbackHashOf(
  subjectUaid: string,
  issuerUaid: string,
  score: number,
  paymentTxId: string,
): string {
  const claims = JSON.stringify({
    tag: FEEDBACK_TAG,
    subjectUaid,
    issuerUaid,
    score,
    proofOfPayment: { txId: paymentTxId },
  });
  return `0x${createHash("sha256").update(claims, "utf8").digest("hex")}`;
}

/**
 * Records the seller's verdict on a buyer after a deal.
 *
 * @param buyerUaid UAID of the buyer being rated
 * @param score {@link SCORE_SUCCESS} or {@link SCORE_FAILURE}
 * @param paymentTxId the Hedera transaction that settled the payment
 */
export async function submitFeedback(
  buyerUaid: string,
  score: number,
  paymentTxId: string,
  client?: Client,
): Promise<FeedbackResult> {
  parseUaid(buyerUaid); // throws on malformed input
  if (!paymentTxId) {
    throw new Error(
      "A payment transaction id is required — feedback without proof of payment is worth nothing.",
    );
  }

  const issuerUaid = getSellerUaid();
  const feedbackHash = feedbackHashOf(buyerUaid, issuerUaid, score, paymentTxId);
  const message = {
    event: "agent_feedback",
    subjectUaid: buyerUaid,
    issuerUaid,
    score,
    tag: FEEDBACK_TAG,
    proofOfPayment: { txId: paymentTxId },
    feedbackHash,
  };

  const ownClient = client ?? createSellerClient();
  try {
    const write = await logAuditEvent(ownClient, message, requireIdentityTopicId());
    return {
      subjectUaid: buyerUaid,
      issuerUaid,
      score,
      feedbackHash,
      sequenceNumber: write.sequenceNumber,
      transactionId: write.transactionId,
    };
  } finally {
    if (!client) ownClient.close();
  }
}

/**
 * Reads an agent's reputation off the identity topic, through the mirror node —
 * the same way a stranger deciding whether to trust it would.
 */
export async function readReputation(uaid: string): Promise<Reputation> {
  const messages = await fetchTopicMessages(100, requireIdentityTopicId());

  const entries: ReputationEntry[] = [];
  for (const message of messages) {
    const json = message.json;
    if (!json || json["event"] !== "agent_feedback") continue;
    if (json["subjectUaid"] !== uaid) continue;
    const proof = json["proofOfPayment"] as { txId?: unknown } | undefined;
    entries.push({
      subjectUaid: uaid,
      issuerUaid: String(json["issuerUaid"] ?? ""),
      score: Number(json["score"] ?? 0),
      tag: String(json["tag"] ?? ""),
      paymentTxId: String(proof?.txId ?? ""),
      feedbackHash: String(json["feedbackHash"] ?? ""),
      sequenceNumber: message.sequenceNumber,
      consensusTimestamp: message.consensusTimestamp,
    });
  }

  const count = entries.length;
  const averageScore =
    count === 0 ? 0 : entries.reduce((sum, entry) => sum + entry.score, 0) / count;

  return { count, averageScore, entries };
}
