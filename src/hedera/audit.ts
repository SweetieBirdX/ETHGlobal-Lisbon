import "dotenv/config";
import {
  TopicMessageSubmitTransaction,
  type Client,
  type TopicId,
} from "@hiero-ledger/sdk";

/**
 * Audit trail on Hedera Consensus Service.
 *
 * Every step of a negotiation (offer received, identity verified, policy
 * decision, payment settled) is written to a single HCS topic as JSON. The
 * topic is the public, tamper-evident proof that the exchange happened —
 * the raw user data itself never leaves the encrypted off-chain database.
 */

/** Result of a single audit write, useful for linking to HashScan in the demo. */
export interface AuditLogResult {
  topicId: string;
  /** Position of this message in the topic — increases by one per message. */
  sequenceNumber: number;
  transactionId: string;
}

export function requireAuditTopicId(): string {
  const topicId = process.env.HCS_AUDIT_TOPIC_ID;
  if (!topicId) {
    throw new Error(
      "Missing environment variable HCS_AUDIT_TOPIC_ID — run `npx tsx scripts/create-audit-topic.ts` and paste the printed id into .env.",
    );
  }
  return topicId;
}

/**
 * Submits `message` as JSON to the shared audit topic.
 *
 * A `timestamp` is added automatically when the message does not carry one, so
 * every entry is self-describing when read back off the topic.
 */
export async function logAuditEvent(
  client: Client,
  message: object,
  topicId: string | TopicId = requireAuditTopicId(),
): Promise<AuditLogResult> {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...message,
  });

  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(payload)
    .execute(client);

  const receipt = await response.getReceipt(client);

  return {
    topicId: topicId.toString(),
    sequenceNumber: receipt.topicSequenceNumber?.toNumber() ?? 0,
    transactionId: response.transactionId.toString(),
  };
}
