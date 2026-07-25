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
 * Counts messages recording a given event with a sequence number > `afterSequence`.
 *
 * This is the only sound way to assert "N of these were written during my
 * run". Counting within a fixed window of recent messages looked equivalent
 * until the topic outgrew the window: every new message then pushes an old one
 * out, so the windowed count of an event can go *down* while the topic only
 * ever appends — which made "+1 sale" assertions fail with deltas like -4.
 * A sequence baseline cannot slide.
 */
export async function countTopicEventsSince(
  event: string,
  afterSequence: number,
  topicId: string = requireAuditTopicId(),
): Promise<number> {
  let count = 0;
  let url = `${MIRROR_NODE}/api/v1/topics/${topicId}/messages?order=desc&limit=100`;

  // A test run writes ~10 messages, so one page is the norm; the loop is a
  // guard against a busy topic, not an expectation.
  for (let page = 0; page < 5; page += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      throw new Error(`Mirror node responded ${response.status} for topic ${topicId}.`);
    }
    const body = (await response.json()) as {
      messages?: MirrorTopicMessage[];
      links?: { next?: string | null };
    };
    const messages = body.messages ?? [];

    for (const message of messages) {
      if (message.sequence_number <= afterSequence) return count;
      const text = Buffer.from(message.message, "base64").toString("utf8");
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (parsed["event"] === event) count += 1;
      } catch {
        /* the Agent Kit hook writes prose — never an event */
      }
    }

    if (!body.links?.next || messages.length === 0) return count;
    url = `${MIRROR_NODE}${body.links.next}`;
  }

  return count;
}
