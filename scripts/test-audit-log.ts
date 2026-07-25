import "dotenv/config";
import { TopicInfoQuery } from "@hiero-ledger/sdk";
import { createSellerClient } from "../src/hedera/clients.js";
import { logAuditEvent } from "../src/hedera/audit.js";

/**
 * Writes one sample audit event to the HCS topic and shows that the topic's
 * message count went up by one.
 *
 *   npx tsx scripts/test-audit-log.ts
 */

async function main(): Promise<void> {
  const topicId = process.env.HCS_AUDIT_TOPIC_ID;
  if (!topicId) {
    throw new Error(
      "Missing HCS_AUDIT_TOPIC_ID — run `npx tsx scripts/create-audit-topic.ts` first.",
    );
  }

  const seller = createSellerClient();

  try {
    const before = await new TopicInfoQuery()
      .setTopicId(topicId)
      .execute(seller);
    console.log(`Messages before: ${before.sequenceNumber.toString()}`);

    const result = await logAuditEvent(seller, {
      event: "audit_log_test",
      note: "Phase 1.4 verification",
    });
    console.log(
      `Submitted (sequence ${result.sequenceNumber}, tx ${result.transactionId})`,
    );

    const after = await new TopicInfoQuery().setTopicId(topicId).execute(seller);
    console.log(`Messages after:  ${after.sequenceNumber.toString()}`);

    const increased = after.sequenceNumber.toNumber() === before.sequenceNumber.toNumber() + 1;
    console.log(increased ? "OK — message count increased by 1" : "FAILED — count did not increase by 1");
    console.log(`HashScan: https://hashscan.io/testnet/topic/${topicId}`);

    if (!increased) {
      process.exitCode = 1;
    }
  } finally {
    seller.close();
  }
}

main().catch((error) => {
  console.error("Audit log test failed:", error);
  process.exit(1);
});
