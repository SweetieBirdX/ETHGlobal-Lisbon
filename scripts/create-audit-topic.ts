import { TopicCreateTransaction } from "@hiero-ledger/sdk";
import { createSellerClient } from "../src/hedera/clients.js";

/**
 * Creates the HCS topic that every negotiation/payment event is logged to.
 *
 * Run this once per environment; the printed topic id has to be written back
 * into `.env` as HCS_AUDIT_TOPIC_ID, because every later phase submits its
 * audit messages to that existing topic instead of creating a new one.
 *
 *   npx tsx scripts/create-audit-topic.ts
 */

const TOPIC_MEMO = "Data Marketplace Audit Trail";

async function main(): Promise<void> {
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

    console.log(`HCS audit topic created: ${topicId.toString()}`);
    console.log(`Memo: ${TOPIC_MEMO}`);
    console.log(`HashScan: https://hashscan.io/testnet/topic/${topicId.toString()}`);
    console.log("");
    console.log("Add this line to your .env:");
    console.log(`HCS_AUDIT_TOPIC_ID=${topicId.toString()}`);
  } finally {
    seller.close();
  }
}

main().catch((error) => {
  console.error("Audit topic creation failed:", error);
  process.exit(1);
});
