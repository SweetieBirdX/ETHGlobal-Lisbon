import "dotenv/config";
import type { Server } from "node:http";
import { createSellerApp, SELLER_PORT } from "../src/a2a/seller-server.js";
import {
  negotiateAndPurchase,
  sendNegotiationRequest,
} from "../src/a2a/buyer-client.js";
import { recordCompletedSale } from "../src/a2a/seller-executor.js";
import { openDatabase, type QueryRow } from "../src/data/db.js";
import { getBuyerAgentId } from "../src/erc8004/agent-ids.js";
import { reputationRegistry } from "../src/erc8004/contracts.js";
import { FEEDBACK_TAG } from "../src/erc8004/feedback.js";
import { createSellerWallet } from "../src/erc8004/wallets.js";
import { startX402Server } from "../src/x402/server.js";

/**
 * The paid endpoint only serves what a negotiation authorised, once.
 *
 * Two separate claims are checked here. First, that the seller's three gates
 * are not bypassable with a direct request: before this binding existed,
 * `GET /data/cohort-insight?activityType=swimming` was quoted a price even
 * though the owner's policy forbids swimming. Second, that a settled
 * negotiation cannot be replayed — neither of the Hedera writes that follow a
 * sale is idempotent, so a second run would rate the buyer twice for one
 * payment.
 *
 *   npx tsx scripts/test-payment-binding.ts
 *
 * Costs 0.5 HBAR: one legitimate purchase. Every refusal is free, because each
 * one happens before a payment is signed.
 */

const CHAIN_SETTLE_WAIT_MS = 30_000;

const checks: [string, boolean, string][] = [];

function record(label: string, passed: boolean, detail = ""): void {
  checks.push([label, passed, detail]);
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`       ${detail}`);
}

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

function readQuery(queryId: number): QueryRow | undefined {
  const db = openDatabase();
  try {
    return db.prepare("SELECT * FROM queries WHERE id = ?").get(queryId) as
      | QueryRow
      | undefined;
  } finally {
    db.close();
  }
}

/** Status and body of a plain unpaid GET — no signing, so it costs nothing. */
async function probe(url: string): Promise<{ status: number; error?: string }> {
  const response = await fetch(url);
  if (response.status === 402) return { status: 402 };
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return { status: response.status, error: body.error };
}

/**
 * Part A — a request no negotiation authorised is refused, and is refused
 * *before* the payment middleware, so it is never even quoted a price.
 */
async function gateRefusesUnnegotiatedRequests(paymentUrl: string): Promise<void> {
  console.log("\n=== Part A: the endpoint refuses what was not negotiated ===\n");

  const url = new URL(paymentUrl);
  const queryId = url.searchParams.get("queryId")!;
  const base = `${url.origin}${url.pathname}`;

  const noId = await probe(`${base}?activityType=running`);
  record(
    "a request with no queryId is refused, unpriced",
    noId.status === 403 && noId.error === "negotiation_required",
    `HTTP ${noId.status} ${noId.error ?? ""}`,
  );

  const unknown = await probe(`${base}?activityType=running&queryId=999999`);
  record(
    "an unknown queryId is refused",
    unknown.status === 403 && unknown.error === "unknown_negotiation",
    `HTTP ${unknown.status} ${unknown.error ?? ""}`,
  );

  // The heart of it: a real, open negotiation for running, redirected at a
  // category the owner's policy forbids.
  const swapped = await probe(`${base}?activityType=swimming&queryId=${queryId}`);
  record(
    "a forbidden category on a valid queryId is refused",
    swapped.status === 403 && swapped.error === "criteria_mismatch",
    `HTTP ${swapped.status} ${swapped.error ?? ""}`,
  );

  const narrowed = await probe(
    `${base}?activityType=running&ageRange=25-34&queryId=${queryId}`,
  );
  record(
    "an age filter that was not negotiated is refused",
    narrowed.status === 403 && narrowed.error === "criteria_mismatch",
    `HTTP ${narrowed.status} ${narrowed.error ?? ""}`,
  );

  // The seller's own URL, untouched, must still reach the payment layer —
  // a gate that refuses everything would pass the four checks above for free.
  const legitimate = await probe(paymentUrl);
  record(
    "the seller's own payment URL still reaches the 402",
    legitimate.status === 402,
    `HTTP ${legitimate.status}`,
  );
}

/** Part B — the legitimate, negotiated purchase still completes. */
async function legitimatePurchase(): Promise<{
  queryId: number;
  paymentUrl: string;
  transactionId: string;
  hcsAfter: number;
  feedbackAfter: number;
}> {
  console.log("\n=== Part B: the negotiated purchase completes (0.5 HBAR) ===\n");

  const hcsBefore = await hcsSequence();
  const feedbackBefore = await feedbackCount();
  console.log(`  baseline: HCS seq ${hcsBefore}, feedback count ${feedbackBefore}\n`);

  const result = await negotiateAndPurchase({ category: "running performance" }, 0.5, {
    onStep: (message) => console.log(`  ${message}`),
  });

  console.log("");
  record("seller accepted and the payment settled", result.purchase?.settlement?.success === true);
  record("HTTP 200 with the aggregate", result.purchase?.status === 200);

  const paymentUrl = result.negotiation.payment!.url;
  const queryId = Number(new URL(paymentUrl).searchParams.get("queryId"));
  const transactionId = result.purchase!.settlement!.transaction;

  console.log(`\n  waiting ${CHAIN_SETTLE_WAIT_MS / 1000}s for the post-payment chain...`);
  await new Promise((resolve) => setTimeout(resolve, CHAIN_SETTLE_WAIT_MS));

  const hcsAfter = await hcsSequence();
  const feedbackAfter = await feedbackCount();
  console.log(`  after: HCS seq ${hcsAfter}, feedback count ${feedbackAfter}\n`);

  record("one HCS audit entry written", hcsAfter === hcsBefore + 1);
  record("one ERC-8004 feedback written", feedbackAfter === feedbackBefore + 1);
  record("negotiation marked completed", readQuery(queryId)?.status === "completed");

  return { queryId, paymentUrl, transactionId, hcsAfter, feedbackAfter };
}

/**
 * Part C — the same negotiation cannot be settled a second time, at either
 * layer: the endpoint refuses the replay, and the completion chain refuses to
 * write again even when called directly.
 */
async function replayWritesNothing(sale: {
  queryId: number;
  paymentUrl: string;
  transactionId: string;
  hcsAfter: number;
  feedbackAfter: number;
}): Promise<void> {
  console.log("\n=== Part C: a settled negotiation cannot be replayed ===\n");

  const replay = await probe(sale.paymentUrl);
  record(
    "paying the same negotiation twice is refused",
    replay.status === 403 && replay.error === "negotiation_not_open",
    `HTTP ${replay.status} ${replay.error ?? ""}`,
  );

  // The 403 above would hide a broken guard, so the completion chain is called
  // directly — the path a duplicated `finish` event or a concurrent second
  // paid request would take.
  const second = await recordCompletedSale(sale.queryId, "0.0.9999999@1.2");
  record(
    "recordCompletedSale reports the sale as already recorded",
    second.alreadyCompleted === true && second.errors.length === 0,
    `alreadyCompleted=${second.alreadyCompleted} errors=${second.errors.length}`,
  );
  record(
    "no second audit entry was even attempted",
    second.auditSequenceNumber === undefined,
  );
  record("no second feedback was even attempted", second.feedbackIndex === undefined);

  const row = readQuery(sale.queryId);
  record(
    "the original payment transaction is untouched",
    row?.tx_hash === sale.transactionId,
    `tx_hash=${row?.tx_hash}`,
  );

  await new Promise((resolve) => setTimeout(resolve, 10_000));
  record("HCS sequence did not move", (await hcsSequence()) === sale.hcsAfter);
  record("reputation feedback count did not move", (await feedbackCount()) === sale.feedbackAfter);
}

async function main(): Promise<void> {
  console.log("Payment binding — the endpoint serves only what was negotiated, once");
  console.log("===================================================================");

  const servers: Server[] = [];
  try {
    servers.push(createSellerApp().listen(SELLER_PORT));
    servers.push(startX402Server());
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    // Part A needs a genuine open acceptance to tamper with — the tampering is
    // the point, so a fabricated row would prove nothing. Negotiating without
    // paying leaves exactly that: an acceptance the buyer has not taken up.
    const opened = await sendNegotiationRequest({ category: "running performance" }, 0.5);
    if (!opened.payment?.url) {
      throw new Error(
        `Seller did not accept the setup offer (${opened.decision}: ${opened.reason}) — ` +
          "Part A needs an open acceptance to probe against.",
      );
    }
    await gateRefusesUnnegotiatedRequests(opened.payment.url);

    const sale = await legitimatePurchase();
    await replayWritesNothing(sale);
  } finally {
    for (const server of servers) server.close();
  }

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n===================================================================`);
  console.log(`${passed}/${checks.length} checks passed`);
  for (const [label, ok] of checks) {
    if (!ok) console.log(`  FAILED: ${label}`);
  }

  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nPayment binding test failed:", error);
  process.exit(1);
});
