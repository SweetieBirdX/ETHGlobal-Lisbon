import "dotenv/config";
import { requireAuditTopicId } from "./audit.js";

/**
 * Reading the audit topic back off the mirror node.
 *
 * The point of writing to HCS is that a third party can check it, so anything
 * asserting on the trail should read it the way a third party would — through
 * the public mirror node, the same source HashScan renders — rather than
 * trusting what the app believes it wrote.
 *
 * The topic carries several kinds of message (sales, compliance attestations,
 * and the Agent Kit hook's plain-text lines), so counting raw sequence numbers
 * says only that the topic grew. {@link countTopicEvents} answers the question
 * that actually matters: what was recorded.
 */

export const MIRROR_NODE =
  process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

export interface TopicMessage {
  sequenceNumber: number;
  /** Consensus timestamp as the mirror node reports it (`seconds.nanos`). */
  consensusTimestamp: string;
  /** Decoded message body. */
  text: string;
  /** Parsed body when it is JSON — the Agent Kit hook writes prose. */
  json?: Record<string, unknown>;
}

interface MirrorTopicMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string;
}

/**
 * Fetches the most recent messages on the topic, newest first.
 *
 * @param limit how many to read (the mirror node caps a page at 100)
 */
export async function fetchTopicMessages(
  limit = 100,
  topicId: string = requireAuditTopicId(),
): Promise<TopicMessage[]> {
  const response = await fetch(
    `${MIRROR_NODE}/api/v1/topics/${topicId}/messages?order=desc&limit=${limit}`,
    { signal: AbortSignal.timeout(20_000) },
  );

  if (!response.ok) {
    throw new Error(
      `Mirror node responded ${response.status} for topic ${topicId} — it may not have seen the topic yet.`,
    );
  }

  const body = (await response.json()) as { messages?: MirrorTopicMessage[] };

  return (body.messages ?? []).map((message) => {
    const text = Buffer.from(message.message, "base64").toString("utf8");
    let json: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") {
        json = parsed as Record<string, unknown>;
      }
    } catch {
      // Not ours — the Agent Kit's audit hook writes plain text.
    }
    return {
      sequenceNumber: message.sequence_number,
      consensusTimestamp: message.consensus_timestamp,
      text,
      json,
    };
  });
}

/** Highest sequence number on the topic, or 0 when it is empty. */
export async function topicSequence(
  topicId: string = requireAuditTopicId(),
): Promise<number> {
  const messages = await fetchTopicMessages(1, topicId);
  return messages[0]?.sequenceNumber ?? 0;
}

/**
 * Counts messages recording a given event.
 *
 * Use this rather than a sequence delta when asserting that something specific
 * was written: the topic now carries compliance attestations alongside sale
 * records, so "the topic grew by one" no longer means "one sale was recorded".
 *
 * Reads a window of recent messages rather than the whole topic history, which
 * is enough to measure a delta across a test run.
 */
export async function countTopicEvents(
  event: string,
  window = 100,
  topicId: string = requireAuditTopicId(),
): Promise<number> {
  const messages = await fetchTopicMessages(window, topicId);
  return messages.filter((message) => message.json?.["event"] === event).length;
}
