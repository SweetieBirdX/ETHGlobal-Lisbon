import "dotenv/config";
import { TopicCreateTransaction } from "@hiero-ledger/sdk";
import { createSellerClient } from "../src/hedera/clients.js";

/**
 * Creates the HCS topic that agent identity profiles are published to.
 *
 * Run this once per environment; the printed topic id has to be written back
 * into `.env` as HCS_IDENTITY_TOPIC_ID — verification resolves profiles from
 * that existing topic via the mirror node instead of creating a new one.
 *
 *   npx tsx scripts/create-identity-topic.ts
 *
 * Refuses to run when HCS_IDENTITY_TOPIC_ID is already set, because a second
 * topic would orphan every profile already published. Override with FORCE=1.
 */

const TOPIC_MEMO = "Agent Identity Registry (HCS-14)";

async function main(): Promise<void> {
  const existing = process.env.HCS_IDENTITY_TOPIC_ID;
  if (existing && process.env.FORCE !== "1") {
    console.error(
      `HCS_IDENTITY_TOPIC_ID is already set (${existing}) — refusing to create a second ` +
        "identity topic. Re-run with FORCE=1 if you really want a fresh one.",
    );
    process.exit(1);
  }

  const seller = createSellerClient();

  try {
    const response = await new TopicCreateTransaction()
      .setTopicMemo(TOPIC_MEMO)
      .execute(seller);

    const receipt = await response.getReceipt(seller);
    const topicId = receipt.topicId;

    if (!topicId) {
      throw new Error(
        `Topic creation returned no topicId (status: ${receipt.status.toString()}).`,
      );
    }

    console.log(`HCS identity registry topic created: ${topicId.toString()}`);
    console.log(`Memo: ${TOPIC_MEMO}`);
    console.log(`HashScan: https://hashscan.io/testnet/topic/${topicId.toString()}`);
    console.log("");
    console.log("Add this line to your .env:");
    console.log(`HCS_IDENTITY_TOPIC_ID=${topicId.toString()}`);
  } finally {
    seller.close();
  }
}

main().catch((error) => {
  console.error("Identity topic creation failed:", error);
  process.exit(1);
});
