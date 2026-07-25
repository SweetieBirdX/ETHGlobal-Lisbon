import "dotenv/config";
import type { Server } from "node:http";
import { createSellerApp, SELLER_PORT } from "../src/a2a/seller-server.js";
import {
  negotiateAndPurchase,
  type PurchaseResult,
} from "../src/a2a/buyer-client.js";
import { openDatabase, type QueryRow } from "../src/data/db.js";
import { getBuyerAgentId } from "../src/erc8004/agent-ids.js";
import { reputationRegistry } from "../src/erc8004/contracts.js";
import { FEEDBACK_TAG } from "../src/erc8004/feedback.js";
import { createSellerWallet } from "../src/erc8004/wallets.js";
import { parsePolicy } from "../src/policy/parser.js";
import { setPolicy } from "../src/a2a/seller-executor.js";
import { startX402Server } from "../src/x402/server.js";

/**
 * The whole system, end to end, in one run.
 *
 * Starts both servers, sets the owner's policy from a plain-language sentence,
 * and then puts two offers to the seller agent: one the policy permits and one
 * it does not. The accepted offer must settle a real payment on Hedera and
 * leave a trail — an HCS audit entry, ERC-8004 feedback and a completed row —
 * while the rejected one must cost nothing and leave nothing behind.
 *
 *   npx tsx scripts/full-e2e-test.ts
 *
 * Costs 0.5 HBAR of testnet funds per run.
 */

/** What the owner types once, in their own words. */
const POLICY_STATEMENT =
  "You can sell aggregated statistics from my running and cycling data — performance scores and " +
  "session counts only — to verified research companies, minimum 0.4 HBAR per query. " +
  "Never share my heart rate, and never any health or medication data.";

/** The audit and reputation writes happen after the buyer has its data. */
const CHAIN_SETTLE_WAIT_MS = 30_000;

const checks: [string, boolean][] = [];
const record = (label: string, passed: boolean) => {
  checks.push([label, passed]);
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
};

const sellerWallet = createSellerWallet();
const buyerAgentId = getBuyerAgentId();
const topicId = process.env.HCS_AUDIT_TOPIC_ID;

async function hcsSequence(): Promise<number> {
  if (!topicId) throw new Error("HCS_AUDIT_TOPIC_ID is not set");
  const response = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/topics/${topicId}/messages?order=desc&limit=1`,
  );
  const body = (await response.json()) as { messages?: { sequence_number: number }[] };
  return body.messages?.[0]?.sequence_number ?? 0;
}

async function feedbackCount(): Promise<number> {
  const summary = await reputationRegistry.getSummary!(
    buyerAgentId,
    [sellerWallet.address],
    FEEDBACK_TAG,
    "",
  );
  return Number(summary[0]);
}

function latestQuery(): QueryRow | undefined {
  const db = openDatabase();
  try {
    return db
      .prepare("SELECT * FROM queries ORDER BY id DESC LIMIT 1")
      .get() as QueryRow | undefined;
  } finally {
    db.close();
  }
}

function countQueries(): number {
  const db = openDatabase();
  try {
    return (db.prepare("SELECT COUNT(*) AS n FROM queries").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

async function scenarioAccepted(): Promise<void> {
  console.log("\n=== Scenario 1: an offer the owner's policy permits ===\n");

  const beforeHcs = await hcsSequence();
  const beforeFeedback = await feedbackCount();
  console.log(`  baseline: HCS seq ${beforeHcs}, feedback count ${beforeFeedback}\n`);

  const result: PurchaseResult = await negotiateAndPurchase(
    { category: "running performance" },
    0.5,
    { onStep: (message) => console.log(`  ${message}`) },
  );

  console.log("");
  record("seller accepted the offer", result.negotiation.decision === "accept");
  record("payment settled", result.purchase?.settlement?.success === true);
  record("HTTP 200 with the aggregate", result.purchase?.status === 200);

  const data = result.purchase?.data as Record<string, unknown> | undefined;
  record("aggregate has a participant count", typeof data?.["participantCount"] === "number");
  record(
    "no raw per-user fields in the payload",
    !/vo2max|restingHeartRate|weeklyDistance/i.test(JSON.stringify(data ?? {})),
  );

  console.log(`\n  data: ${JSON.stringify(data)}`);
  console.log(`  payment: ${result.purchase?.settlement?.transaction}`);
  console.log(`  ${result.purchase?.settlement?.hashscanUrl}`);

  console.log(`\n  waiting ${CHAIN_SETTLE_WAIT_MS / 1000}s for the post-payment chain...`);
  await new Promise((resolve) => setTimeout(resolve, CHAIN_SETTLE_WAIT_MS));

  const afterHcs = await hcsSequence();
  const afterFeedback = await feedbackCount();
  const query = latestQuery();

  console.log(`  after: HCS seq ${afterHcs}, feedback count ${afterFeedback}\n`);
  record("HCS audit entry written", afterHcs === beforeHcs + 1);
  record("ERC-8004 feedback submitted", afterFeedback === beforeFeedback + 1);
  record("query marked completed", query?.status === "completed");
  record(
    "query carries the payment transaction",
    query?.tx_hash === result.purchase?.settlement?.transaction,
  );
  record("query attributed to the buyer agent", query?.buyer_agent_id === buyerAgentId);
}

async function scenarioRejected(): Promise<void> {
  console.log("\n=== Scenario 2: an offer the policy forbids, at double the price ===\n");

  const beforeHcs = await hcsSequence();
  const beforeFeedback = await feedbackCount();
  const beforeQueries = countQueries();

  const result = await negotiateAndPurchase({ category: "swimming" }, 0.9, {
    onStep: (message) => console.log(`  ${message}`),
  });

  console.log(`\n  reply: ${result.negotiation.reply.slice(0, 120)}\n`);
  record("seller declined", result.negotiation.decision === "decline");
  record("declined for category, not price", result.negotiation.reason === "category_mismatch");
  record("no payment was attempted", result.purchase === undefined);
  record("no payment instruction issued", result.negotiation.payment === undefined);

  // Nothing should have been written anywhere by a refusal.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  record("no new HCS audit entry", (await hcsSequence()) === beforeHcs);
  record("no new reputation feedback", (await feedbackCount()) === beforeFeedback);
  record("no new query row", countQueries() === beforeQueries);
}

async function main(): Promise<void> {
  console.log("Personal Fitness Data Marketplace — full end-to-end test");
  console.log("=======================================================");

  console.log(`\nOwner's policy, as typed:\n  "${POLICY_STATEMENT}"`);
  const policy = await parsePolicy(POLICY_STATEMENT);
  setPolicy(policy);
  console.log(`\nParsed to: ${JSON.stringify(policy)}`);

  const servers: Server[] = [];
  try {
    servers.push(createSellerApp().listen(SELLER_PORT));
    servers.push(startX402Server());
    // Let both finish binding before the buyer goes looking for them.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    await scenarioAccepted();
    await scenarioRejected();
  } finally {
    for (const server of servers) server.close();
  }

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n=======================================================`);
  console.log(`${passed}/${checks.length} checks passed`);
  for (const [label, ok] of checks) {
    if (!ok) console.log(`  FAILED: ${label}`);
  }

  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nEnd-to-end test failed:", error);
  process.exit(1);
});
