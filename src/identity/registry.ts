/**
 * The HCS identity registry: publish agent profiles, resolve them back. Owner: P1.
 *
 * HCS-14 mandates no registry topic; we publish profiles to our own so that
 * identity is independently verifiable — anyone can read the topic through the
 * public mirror node and recompute the hashes. Newest message wins per UAID,
 * which is how an agent gets updated or retired (republish with active=false).
 */

import "dotenv/config";
import type { Client } from "@hiero-ledger/sdk";
import { logAuditEvent, type AuditLogResult } from "../hedera/audit.js";
import { fetchTopicMessages } from "../hedera/mirror.js";
import { createSellerClient } from "../hedera/clients.js";
import { profileHash, type AgentProfile } from "./profile.js";

export function requireIdentityTopicId(): string {
  const topicId = process.env.HCS_IDENTITY_TOPIC_ID;
  if (!topicId) {
    throw new Error(
      "Missing environment variable HCS_IDENTITY_TOPIC_ID — run `npx tsx scripts/create-identity-topic.ts` and paste the printed id into .env.",
    );
  }
  return topicId;
}

/** A profile as read back off the registry topic, with its published hash. */
export interface ResolvedProfile {
  uaid: string;
  profile: AgentProfile;
  profileHash: string;
  sequenceNumber: number;
  consensusTimestamp: string;
}

/**
 * Publishes a profile to the identity registry topic.
 *
 * Any funded client may pay for the submission — the identity claim lives in
 * the message body, not in who signed the transaction. When no client is
 * given, a seller client is created for the call and closed afterwards.
 */
export async function publishProfile(
  profile: AgentProfile,
  client?: Client,
): Promise<AuditLogResult> {
  const message = {
    event: "agent_profile",
    uaid: profile.uaid,
    profile,
    profileHash: profileHash(profile),
  };

  if (client) {
    return logAuditEvent(client, message, requireIdentityTopicId());
  }
  const ownClient = createSellerClient();
  try {
    return await logAuditEvent(ownClient, message, requireIdentityTopicId());
  } finally {
    ownClient.close();
  }
}

/**
 * Resolves the newest profile published for `uaid`, or `undefined` when the
 * registry has never seen it. Reads through the mirror node — the same source
 * a third party would use — not from anything the app remembers writing.
 */
export async function resolveProfile(
  uaid: string,
): Promise<ResolvedProfile | undefined> {
  const resolved = await resolveAll();
  return resolved.find((entry) => entry.uaid === uaid);
}

/** Every distinct UAID on the registry topic with its current (newest) profile. */
export async function resolveAll(): Promise<ResolvedProfile[]> {
  const messages = await fetchTopicMessages(100, requireIdentityTopicId());

  const byUaid = new Map<string, ResolvedProfile>();
  // fetchTopicMessages returns newest first, so the first entry per UAID is
  // the current one; later (older) messages for the same UAID are superseded.
  for (const message of messages) {
    const json = message.json;
    if (!json || json["event"] !== "agent_profile") continue;
    const uaid = json["uaid"];
    const profile = json["profile"];
    const publishedHash = json["profileHash"];
    if (typeof uaid !== "string" || !profile || typeof publishedHash !== "string") {
      continue;
    }
    if (byUaid.has(uaid)) continue;
    byUaid.set(uaid, {
      uaid,
      profile: profile as AgentProfile,
      profileHash: publishedHash,
      sequenceNumber: message.sequenceNumber,
      consensusTimestamp: message.consensusTimestamp,
    });
  }

  return [...byUaid.values()];
}
