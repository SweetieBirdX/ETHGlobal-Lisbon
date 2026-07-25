import "dotenv/config";
import type { Server } from "node:http";
import type { Task } from "@a2a-js/sdk";
import { createSellerApp, SELLER_PORT } from "../src/a2a/seller-server.js";
import { setPolicy } from "../src/a2a/seller-executor.js";
import {
  counterOffer,
  negotiateWithStrategy,
  sendNegotiationRequest,
  type LicenceCriteria,
  type PaymentInstruction,
} from "../src/a2a/buyer-client.js";
import { getTrack, openDatabase } from "../src/data/db.js";
import { payAndFetch } from "../src/x402/pay.js";
import { startX402Server } from "../src/x402/server.js";

/**
 * Multi-round licence negotiation over one real A2A task.
 *
 * The session-45 audit proved two things live: the seller's replies carried a
 * `taskId` the server itself could not resume ("Task not found"), and a
 * counter-offer was processed as a brand-new negotiation with no memory of the
 * round before. This test replays that exact story and requires the opposite
 * outcome at every step:
 *
 *   round 1: lowball offer  → declined, floor disclosed, task left OPEN
 *   round 2: counter-offer  → SAME task, reply acknowledges round 1, accepted
 *   round 3: reopen attempt → refused: a completed negotiation stays closed
 *
 * The policy itself stays deterministic — the same terms always get the same
 * verdict. What this verifies is that the two rounds are one conversation, not
 * strangers.
 *
 * Part 2 hands the same haggle to the buyer's own strategy: it must counter at
 * the seller's stated floor when the refusal is about price, and walk away
 * immediately — no counter at all — when it is not, or when the floor is above
 * its budget.
 *
 *   npm run test:rounds
 *
 * Costs real (testnet) HBAR: the manual round-2 acceptance and the strategy's
 * autonomous deal are both genuinely paid, so nothing dangles. Each settles one
 * licence at the track's own quote, and each takes SHARES out of its capacity.
 */

// Proto enum values (TASK_STATE_*): 3 = COMPLETED, 6 = INPUT_REQUIRED.
const COMPLETED = 3;
const INPUT_REQUIRED = 6;

/** Injected rather than parsed, so the suite never depends on an LLM call. */
const POLICY = {
  allowedLicenceTypes: ["sync", "sampling"],
  minPricePerShareHbar: 0.001,
  maxSharesPerLicence: 5_000,
  forbiddenUseCases: ["political-ad"],
};

const TRACK_ID = 1;
const SHARES = 500;

/** What the policy demands for this licence: per-share floor × shares. */
const FLOOR_HBAR = Number((POLICY.minPricePerShareHbar * SHARES).toFixed(8));
/** Well under the floor, so round 1 can only be a price refusal. */
const LOWBALL_HBAR = 0.1;

/** The licence under negotiation — everything except the price, which is the thing haggled. */
const CRITERIA: LicenceCriteria = {
  trackId: TRACK_ID,
  shares: SHARES,
  licenceType: "sync",
  territory: "eu",
  useCase: "film",
};

/** The same licence for a use the rights holder forbids outright. */
const FORBIDDEN_CRITERIA: LicenceCriteria = { ...CRITERIA, useCase: "political-ad" };

const checks: [string, boolean, string][] = [];

function record(label: string, passed: boolean, detail = ""): void {
  checks.push([label, passed, detail]);
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`       ${detail}`);
}

const taskState = (raw: unknown): number | undefined =>
  (raw as Task).status?.state as number | undefined;

/** What the endpoint will actually charge — the track's own rate, not the offer. */
function quotedPrice(): number {
  const db = openDatabase();
  try {
    const track = getTrack(db, TRACK_ID);
    if (!track) throw new Error(`track ${TRACK_ID} missing — run scripts/seed-catalog.ts`);
    if (track.available_shares < SHARES * 2) {
      throw new Error(
        `track ${TRACK_ID} has only ${track.available_shares} shares left; this suite settles two ${SHARES}-share licences`,
      );
    }
    return Number((track.base_price_per_share * SHARES).toFixed(8));
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  console.log("Multi-round licence negotiation — one task, several rounds");
  console.log("==========================================================");

  const quote = quotedPrice();
  console.log(
    `\ntrack ${TRACK_ID}, ${SHARES} shares (${SHARES / 100}%) — policy floor ${FLOOR_HBAR} ℏ, endpoint quote ${quote} ℏ\n`,
  );

  setPolicy(POLICY);

  const servers: Server[] = [];
  try {
    servers.push(createSellerApp().listen(SELLER_PORT));
    servers.push(startX402Server());
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    // --- Round 1: a lowball the policy must refuse -------------------------
    console.log(`\n=== Round 1: sync licence @ ${LOWBALL_HBAR} ℏ (below the ${FLOOR_HBAR} floor) ===\n`);
    const round1 = await sendNegotiationRequest(CRITERIA, LOWBALL_HBAR);
    console.log(`  reply: ${round1.reply.slice(0, 110)}\n`);

    record(
      "round 1 declined for price",
      round1.decision === "decline" && round1.reason === "price_too_low",
      `reason=${round1.reason}`,
    );
    record(
      "the refusal discloses the owner's floor",
      round1.sellerMinimumHbar === FLOOR_HBAR,
      `minPriceHbar=${round1.sellerMinimumHbar}`,
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
    console.log(`\n=== Round 2: counter-offer @ ${FLOOR_HBAR} ℏ in the same task ===\n`);
    const round2 = await counterOffer(round1, CRITERIA, FLOOR_HBAR);
    console.log(`  reply: ${round2.reply.slice(0, 160)}\n`);

    record(
      "round 2 landed in the SAME task",
      round2.taskId === round1.taskId && round2.contextId === round1.contextId,
      `taskId ${round2.taskId}`,
    );
    record("round 2 accepted", round2.decision === "accept", `decision=${round2.decision}`);
    record(
      "the reply acknowledges the previous round",
      /round 2/i.test(round2.reply) &&
        round2.reply.includes(String(LOWBALL_HBAR)) &&
        /declined/i.test(round2.reply),
      round2.reply.slice(0, 120),
    );
    record(
      "acceptance closes the task (completed)",
      taskState(round2.raw) === COMPLETED,
      `status.state=${taskState(round2.raw)}`,
    );
    record(
      "the payment instruction carries the negotiated licence",
      round2.payment?.url.includes(`trackId=${TRACK_ID}`) === true &&
        round2.payment?.url.includes(`shares=${SHARES}`) === true &&
        round2.payment?.url.includes("licenceId=") === true,
      round2.payment?.url ?? "(none)",
    );
    record(
      "…and is priced at the track's quote, not the offer",
      Number(round2.payment?.priceHbar) === quote,
      `quoted ${round2.payment?.priceHbar} ℏ against an accepted offer of ${FLOOR_HBAR} ℏ`,
    );

    // --- The accepted round is paid, so nothing dangles ---------------------
    console.log(`\n=== Settling round 2's acceptance (${quote} ℏ) ===\n`);
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
      const round3 = await counterOffer(round2, CRITERIA, FLOOR_HBAR + 0.1);
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

    // ======================= Part 2: the buyer's own strategy ================

    // A refusal money cannot fix: the strategy must walk, not counter. The
    // budget being ample is the point — a naive raiser would keep bidding.
    console.log("\n=== Strategy 1: political-ad @ 0.3, budget 5 — must walk, not bid ===\n");
    const walked = await negotiateWithStrategy(FORBIDDEN_CRITERIA, 0.3, 5, {
      onStep: (message) => console.log(`  ${message}`),
    });
    record(
      "a forbidden-use refusal is never countered, whatever the budget",
      walked.rounds.length === 1 && walked.walkedAwayBecause !== undefined,
      walked.walkedAwayBecause ?? "",
    );
    record(
      "the walk-away names the reason, not a price",
      /use_case_forbidden/.test(walked.walkedAwayBecause ?? ""),
      walked.rounds[0]?.reason ?? "",
    );
    record("nothing was paid on the walk-away", walked.purchase === undefined);

    // The floor is above the budget: walk without a second offer.
    console.log(
      `\n=== Strategy 2: @ ${LOWBALL_HBAR}, budget 0.3 — floor ${FLOOR_HBAR} is out of reach ===\n`,
    );
    const priced = await negotiateWithStrategy(CRITERIA, LOWBALL_HBAR, 0.3, {
      onStep: (message) => console.log(`  ${message}`),
    });
    record(
      "a floor above budget ends it in one round",
      priced.rounds.length === 1 &&
        new RegExp(`floor is ${FLOOR_HBAR}`).test(priced.walkedAwayBecause ?? ""),
      priced.walkedAwayBecause ?? "",
    );

    // The full autonomous haggle: lowball → read the floor → counter exactly
    // there → accepted → settled, all inside one task, no human anywhere.
    console.log(`\n=== Strategy 3: @ ${LOWBALL_HBAR}, budget 0.6 — haggle to a deal ===\n`);
    const deal = await negotiateWithStrategy(CRITERIA, LOWBALL_HBAR, 0.6, {
      onStep: (message) => console.log(`  ${message}`),
    });
    record(
      "round 1 lowball was declined for price",
      deal.rounds[0]?.decision === "decline" && deal.rounds[0]?.reason === "price_too_low",
    );
    record(
      "the counter was exactly the owner's stated floor",
      deal.rounds[1]?.offeredPriceHbar === FLOOR_HBAR,
      `countered at ${deal.rounds[1]?.offeredPriceHbar} ℏ against a floor of ${FLOOR_HBAR} ℏ`,
    );
    record("the floor offer was accepted", deal.rounds[1]?.decision === "accept");
    record(
      "the whole haggle stayed in one task",
      deal.negotiation.taskId.length > 0 && /round 2/i.test(deal.negotiation.reply),
      deal.negotiation.reply.slice(0, 110),
    );
    record(
      "the autonomous deal settled on-chain",
      deal.purchase?.status === 200 && deal.purchase?.settlement?.success === true,
      String(deal.purchase?.settlement?.transaction),
    );
  } finally {
    for (const server of servers) server.close();
  }

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n==========================================================`);
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
