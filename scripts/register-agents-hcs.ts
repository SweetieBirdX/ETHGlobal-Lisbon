import "dotenv/config";
import { existsSync, writeFileSync } from "node:fs";
import { createBuyerClient, createSellerClient } from "../src/hedera/clients.js";
import { buyerProfile, sellerProfile, type AgentProfile } from "../src/identity/profile.js";
import { publishProfile, requireIdentityTopicId } from "../src/identity/registry.js";

/**
 * Publishes both agents' profiles to the HCS identity registry topic.
 *
 * From here on the two agents are accountable to each other: the seller
 * resolves a buyer's profile off the topic before releasing anything, and
 * reputation feedback attaches to these UAIDs.
 *
 *   npx tsx scripts/register-agents-hcs.ts
 *
 * Each agent signs its own submission, so the registry entry is backed by the
 * key of the account the UAID claims.
 */

const OUTPUT_FILE = "agent-uaids.json";

interface RegisteredAgent {
  uaid: string;
  accountId: string;
  transactionId: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

async function main(): Promise<void> {
  if (existsSync(OUTPUT_FILE) && process.env.FORCE !== "1") {
    console.log(
      `${OUTPUT_FILE} already exists — the agents are registered.\n` +
        `Unlike the old NFT minting, re-registering here is cheap and non-destructive:\n` +
        `the registry is newest-wins, so a re-run just supersedes the previous profiles.\n` +
        `Set FORCE=1 to do that.`,
    );
    return;
  }

  const topicId = requireIdentityTopicId();
  const sellerId = requireEnv("SELLER_ACCOUNT_ID");
  const buyerId = requireEnv("BUYER_ACCOUNT_ID");

  const agents: RegisteredAgent[] = [];
  for (const [label, accountId, profile, makeClient] of [
    ["Seller agent", sellerId, sellerProfile(sellerId), createSellerClient],
    ["Buyer agent", buyerId, buyerProfile(buyerId), createBuyerClient],
  ] as const satisfies ReadonlyArray<
    readonly [string, string, AgentProfile, () => ReturnType<typeof createSellerClient>]
  >) {
    console.log(`\n=== ${label} ===`);
    console.log(`account: ${accountId}`);
    console.log(`uaid:    ${profile.uaid}`);

    const client = makeClient();
    try {
      const result = await publishProfile(profile, client);
      console.log(`published: topic ${result.topicId} seq ${result.sequenceNumber}`);
      console.log(`tx: https://hashscan.io/testnet/transaction/${result.transactionId}`);
      agents.push({ uaid: profile.uaid, accountId, transactionId: result.transactionId });
    } finally {
      client.close();
    }
  }

  const [seller, buyer] = agents;
  writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({ seller, buyer, registeredAt: new Date().toISOString() }, null, 2)}\n`,
  );

  console.log(`\nWrote ${OUTPUT_FILE}`);
  console.log(`Registry topic: https://hashscan.io/testnet/topic/${topicId}`);
}

main().catch((error) => {
  console.error("Agent registration failed:", error);
  process.exit(1);
});
