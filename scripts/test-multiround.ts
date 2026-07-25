import "dotenv/config";
import type { Server } from "node:http";
import type { Task } from "@a2a-js/sdk";
import { createSellerApp, SELLER_PORT } from "../src/a2a/seller-server.js";
import {
  counterOffer,
  sendNegotiationRequest,
  type PaymentInstruction,
} from "../src/a2a/buyer-client.js";
import { payAndFetch } from "../src/x402/pay.js";
import { startX402Server } from "../src/x402/server.js";

/**
 * Multi-round negotiation over one real A2A task.
 *
 * The session-45 audit proved two things live: the seller's replies carried a
 * `taskId` the server itself could not resume ("Task not found"), and a
 * counter-offer was processed as a brand-new negotiation with no memory of the
 * round before. This test replays that exact story and requires the opposite
 * outcome at every step:
 *
 *   round 1: lowball offer  → declined, task left OPEN (input-required)
 *   round 2: counter-offer  → SAME task, reply acknowledges round 1, accepted
 *   round 3: reopen attempt → refused: a completed negotiation stays closed
 *
 * The policy itself stays deterministic — 0.1 ℏ is refused and 0.5 ℏ accepted
 * exactly as they would be in separate negotiations. What this verifies is
 * that the two rounds are one conversation, not strangers.
 *
 *   npx tsx scripts/test-multiround.ts
 *
 * Costs 0.5 HBAR: round 2's acceptance is genuinely paid, so the test leaves a
 * completed sale rather than a dangling open acceptance.
 */

// Proto enum values (TASK_STATE_*): 3 = COMPLETED, 6 = INPUT_REQUIRED.
const COMPLETED = 3;
const INPUT_REQUIRED = 6;

const checks: [string, boolean, string][] = [];

function record(label: string, passed: boolean, detail = ""): void {
  checks.push([label, passed, detail]);
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`       ${detail}`);
}

const taskState = (raw: unknown): number | undefined =>
  (raw as Task).status?.state as number | undefined;

async function main(): Promise<void> {
  console.log("Multi-round negotiation — one task, several rounds");
  console.log("==================================================");

  const servers: Server[] = [];
  try {
    servers.push(createSellerApp().listen(SELLER_PORT));
    servers.push(startX402Server());
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    // --- Round 1: a lowball the policy must refuse -------------------------
    console.log("\n=== Round 1: running @ 0.1 ℏ (below the 0.4 minimum) ===\n");
    const round1 = await sendNegotiationRequest({ category: "running" }, 0.1);
    console.log(`  reply: ${round1.reply.slice(0, 110)}\n`);

    record(
      "round 1 declined for price",
      round1.decision === "decline" && round1.reason === "price_too_low",
    );
    record(
      "the reply is a real Task, not a bare message",
      "status" in (round1.raw as object),
      `top-level keys: ${Object.keys(round1.raw as object).join(", ")}`,
    );
    record(
      "the task is left open for a counter-offer (input-required)",
      taskState(round1.raw) === INPUT_REQUIRED,
      `status.state=${taskState(round1.raw)}`,
    );
    record("the reply carries a non-empty taskId", round1.taskId.length > 0, round1.taskId);

    // --- Round 2: the counter-offer, into the SAME task --------------------
    console.log("\n=== Round 2: counter-offer @ 0.5 ℏ in the same task ===\n");
    const round2 = await counterOffer(round1, { category: "running" }, 0.5);
    console.log(`  reply: ${round2.reply.slice(0, 160)}\n`);

    record(
      "round 2 landed in the SAME task",
      round2.taskId === round1.taskId && round2.contextId === round1.contextId,
      `taskId ${round2.taskId}`,
    );
    record("round 2 accepted", round2.decision === "accept");
    record(
      "the reply acknowledges the previous round",
      /round 2/i.test(round2.reply) && round2.reply.includes("0.1") && /declined/i.test(round2.reply),
      round2.reply.slice(0, 120),
    );
    record(
      "acceptance closes the task (completed)",
      taskState(round2.raw) === COMPLETED,
      `status.state=${taskState(round2.raw)}`,
    );

    // --- The accepted round is paid, so nothing dangles ---------------------
    console.log("\n=== Settling round 2's acceptance (0.5 ℏ) ===\n");
    const payment = round2.payment as PaymentInstruction;
    const purchase = await payAndFetch(payment.url, {
      maxAmountTinybar: payment.priceTinybar,
      onStep: (message) => console.log(`  ${message}`),
    });
    record(
      "…and the negotiated payment settles as ever",
      purchase.status === 200 && purchase.settlement?.success === true,
      String(purchase.settlement?.transaction),
    );

    // --- Round 3: a completed negotiation cannot be reopened ----------------
    console.log("\n=== Round 3: trying to reopen the completed task ===\n");
    try {
      const round3 = await counterOffer(round2, { category: "running" }, 0.6);
      // If the SDK lets the message through, the executor must NOT have
      // produced a fresh acceptance inside the closed task.
      record(
        "a completed task is not silently renegotiated",
        round3.taskId !== round1.taskId || round3.decision !== "accept",
        `decision=${round3.decision} taskId=${round3.taskId}`,
      );
    } catch (error) {
      record(
        "reopening a completed negotiation is refused",
        /terminal|completed|not found|invalid/i.test(String(error)),
        String(error).slice(0, 140),
      );
    }
  } finally {
    for (const server of servers) server.close();
  }

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n==================================================`);
  console.log(`${passed}/${checks.length} checks passed`);
  for (const [label, ok, detail] of checks) {
    if (!ok) console.log(`  FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  }
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nMulti-round test failed:", error);
  process.exit(1);
});
