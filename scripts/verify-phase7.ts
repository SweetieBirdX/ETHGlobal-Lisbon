import "dotenv/config";
import { spawn } from "node:child_process";
import type { Server } from "node:http";
import express from "express";
import { openDatabase, type QueryRow } from "../src/data/db.js";
import { getBuyerAgentId } from "../src/erc8004/agent-ids.js";
import { reputationRegistry } from "../src/erc8004/contracts.js";
import { FEEDBACK_TAG } from "../src/erc8004/feedback.js";
import { createSellerWallet } from "../src/erc8004/wallets.js";
import { verifyBuyerIdentity } from "../src/a2a/seller-executor.js";
import { parsePolicy } from "../src/policy/parser.js";
import { COHORT_INSIGHT_PATH, X402_BASE_URL } from "../src/x402/config.js";
import { startX402Server } from "../src/x402/server.js";
import {
  assertSufficientBalance,
  EndpointUnreachableError,
  InsufficientBalanceError,
  payAndFetch,
} from "../src/x402/pay.js";

/**
 * End-of-phase checkpoint for Phase 7.
 *
 * Two questions that the individual phase tests cannot answer on their own:
 *
 *  1. Does the full flow work *repeatedly*? A single passing run can hide state
 *     that only accumulates correctly once — a counter that is set rather than
 *     incremented, an id that is reused, a row that is overwritten instead of
 *     appended. So the whole end-to-end test runs twice and this script checks
 *     independently, from Hedera and the ledger, that every count went **up**
 *     both times. Flat is a failure here, not a pass.
 *
 *  2. Do the Phase 7.5 failure modes still fail *safely*? Each error scenario
 *     is triggered in turn and has to come back with a diagnosable message
 *     rather than taking the process down. Reaching the report at all is part
 *     of what is being tested.
 *
 *   npx tsx scripts/verify-phase7.ts
 *
 * Costs 1 HBAR: two real purchases. The error scenarios are free — every one of
 * them fails before a payment is signed.
 */

const E2E_SCRIPT = "scripts/full-e2e-test.ts";

/** How long to keep asking the mirror node before calling a delta missing. */
const DELTA_TIMEOUT_MS = 60_000;
const DELTA_POLL_MS = 5_000;

interface Check {
  group: string;
  label: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(group: string, label: string, passed: boolean, detail = ""): void {
  checks.push({ group, label, passed, detail });
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`       ${detail}`);
}

const sellerWallet = createSellerWallet();
const buyerAgentId = getBuyerAgentId();
const topicId = process.env.HCS_AUDIT_TOPIC_ID;

/* ------------------------------------------------------------------ counters */

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

function countCompleted(): number {
  const db = openDatabase();
  try {
    return (
      db
        .prepare("SELECT COUNT(*) AS n FROM queries WHERE status = 'completed'")
        .get() as { n: number }
    ).n;
  } finally {
    db.close();
  }
}

function latestCompleted(): QueryRow | undefined {
  const db = openDatabase();
  try {
    return db
      .prepare("SELECT * FROM queries WHERE status = 'completed' ORDER BY id DESC LIMIT 1")
      .get() as QueryRow | undefined;
  } finally {
    db.close();
  }
}

interface Snapshot {
  completed: number;
  hcs: number;
  feedback: number;
}

async function snapshot(): Promise<Snapshot> {
  return {
    completed: countCompleted(),
    hcs: await hcsSequence(),
    feedback: await feedbackCount(),
  };
}

/**
 * Polls until a counter exceeds `from`, or gives up.
 *
 * The audit and reputation writes are fire-and-forget Hedera transactions and
 * the mirror node lags consensus, so a value that has not moved yet is not the
 * same as one that never will. Polling distinguishes "slow" from "absent";
 * a fixed sleep would report the first as the second.
 */
async function waitForIncrease(
  read: () => Promise<number> | number,
  from: number,
): Promise<number> {
  const deadline = Date.now() + DELTA_TIMEOUT_MS;
  let current = await read();

  while (current <= from && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, DELTA_POLL_MS));
    current = await read();
  }

  return current;
}

/* ------------------------------------------------- part 1: repeated e2e runs */

/** Runs the end-to-end suite as its own process and reports how it exited. */
function runE2E(run: number): Promise<{ code: number; summary: string }> {
  return new Promise((resolve) => {
    console.log(`\n  --- ${E2E_SCRIPT} (run ${run}) ---`);

    // Its own process on purpose: it binds ports 4000 and 4021, so this script
    // must not be holding them, and a crash in it cannot take the checkpoint
    // down with it.
    const child = spawn("npx", ["tsx", E2E_SCRIPT], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("close", (code) => {
      const summary =
        output
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => /checks passed/.test(line))
          .pop() ?? "(no summary line)";
      console.log(`  ${E2E_SCRIPT} exited ${code} — ${summary}`);
      resolve({ code: code ?? -1, summary });
    });
  });
}

async function repeatedRuns(): Promise<void> {
  console.log("\n=== Part 1: the full flow works twice in a row ===");
  console.log("\n  Every counter must INCREASE on both runs. Flat is a failure:");
  console.log("  it would mean the second sale overwrote the first rather than");
  console.log("  being appended alongside it.\n");

  let before = await snapshot();
  console.log(
    `  baseline: completed=${before.completed} hcsSeq=${before.hcs} feedback=${before.feedback}`,
  );

  for (const run of [1, 2]) {
    const group = `run ${run}`;
    const { code, summary } = await runE2E(run);

    record(group, `${E2E_SCRIPT} exited cleanly (run ${run})`, code === 0, summary);

    const completed = await waitForIncrease(countCompleted, before.completed);
    const hcs = await waitForIncrease(hcsSequence, before.hcs);
    const feedback = await waitForIncrease(feedbackCount, before.feedback);

    record(
      group,
      `a new completed sale was appended (run ${run})`,
      completed > before.completed,
      `completed ${before.completed} → ${completed}`,
    );
    record(
      group,
      `a new message landed on the HCS topic (run ${run})`,
      hcs > before.hcs,
      `sequence ${before.hcs} → ${hcs}`,
    );
    record(
      group,
      `new ReputationRegistry feedback appeared (run ${run})`,
      feedback > before.feedback,
      `count ${before.feedback} → ${feedback}`,
    );

    // Each run must produce exactly one of each, not a burst.
    record(
      group,
      `exactly one sale, one audit entry and one rating (run ${run})`,
      completed === before.completed + 1 &&
        hcs === before.hcs + 1 &&
        feedback === before.feedback + 1,
      `deltas: completed +${completed - before.completed}, hcs +${hcs - before.hcs}, feedback +${feedback - before.feedback}`,
    );

    const row = latestCompleted();
    record(
      group,
      `the newest sale carries its own payment transaction (run ${run})`,
      Boolean(row?.tx_hash) && row?.buyer_agent_id === buyerAgentId,
      `query #${row?.id} buyer ${row?.buyer_agent_id} tx ${row?.tx_hash}`,
    );

    before = { completed, hcs, feedback };
  }
}

/* ------------------------------------------- part 2: failure modes stay safe */

/** Accepts connections and never answers — for testing timeouts. */
function startBlackHoleServer(port: number): Server {
  const app = express();
  app.get("*splat", () => {
    /* deliberately never responds */
  });
  return app.listen(port);
}

/** A message is only useful if it says what went wrong and what to do. */
function isMeaningful(message: string): boolean {
  return (
    message.trim().length >= 25 &&
    !/^\[object|^undefined|^null$|^Error$/i.test(message.trim())
  );
}

/**
 * Runs one failure scenario. The scenario is expected to *reject* — this
 * captures the rejection, checks it is the right kind and readable, and above
 * all keeps the process alive so the next scenario still runs.
 */
async function expectFailure(
  label: string,
  expected: new (...args: never[]) => Error,
  scenario: () => Promise<unknown>,
): Promise<void> {
  try {
    await scenario();
    record("errors", label, false, "no error was thrown — the failure went unnoticed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(
      "errors",
      label,
      error instanceof expected && isMeaningful(message),
      message.slice(0, 150),
    );
  }
}

/** Same, for a scenario that must NOT throw. */
async function expectNoFailure(label: string, scenario: () => Promise<unknown>): Promise<void> {
  try {
    await scenario();
    record("errors", label, true);
  } catch (error) {
    record("errors", label, false, String(error).slice(0, 150));
  }
}

async function failureModes(): Promise<void> {
  console.log("\n=== Part 2: every Phase 7.5 failure mode fails safely ===");
  console.log("\n  Each scenario is triggered for real. None may take the process");
  console.log("  down, and each has to explain itself.\n");

  // --- invalid agent ids: a verdict, never an exception -------------------
  for (const [agentId, description] of [
    ["999999999", "never minted"],
    ["not-a-number", "not numeric"],
    ["", "empty"],
    ["103", "registered but unattested"],
  ] as [string, string][]) {
    try {
      const identity = await verifyBuyerIdentity(agentId);
      record(
        "errors",
        `invalid agentId "${agentId}" (${description}) is refused with a reason`,
        identity.verified === false && isMeaningful(identity.reason),
        identity.reason.slice(0, 130),
      );
    } catch (error) {
      record(
        "errors",
        `invalid agentId "${agentId}" (${description}) is refused with a reason`,
        false,
        `threw instead of returning a verdict: ${String(error).slice(0, 110)}`,
      );
    }
  }

  // --- money ---------------------------------------------------------------
  const buyer = process.env.BUYER_ACCOUNT_ID!;
  await expectFailure(
    "insufficient balance is caught before anything is signed",
    InsufficientBalanceError,
    () => assertSufficientBalance(buyer, "1000000000000000"),
  );
  await expectNoFailure("an affordable payment is not blocked", () =>
    assertSufficientBalance(buyer, "50000000"),
  );
  await expectNoFailure("a balance check for an unknown account does not crash", () =>
    assertSufficientBalance("0.0.99999999", "50000000"),
  );

  // --- network -------------------------------------------------------------
  await expectFailure(
    "an unreachable data endpoint is reported, not retried blindly",
    EndpointUnreachableError,
    () => payAndFetch("http://localhost:4999/data/cohort-insight?activityType=running"),
  );

  const blackHole = startBlackHoleServer(4997);
  try {
    await expectFailure(
      "an endpoint that accepts and never answers times out",
      EndpointUnreachableError,
      () => payAndFetch("http://localhost:4997/data/cohort-insight", { timeoutMs: 2_000 }),
    );
  } finally {
    blackHole.close();
  }

  // --- policy --------------------------------------------------------------
  await expectFailure(
    "an empty policy statement is rejected before any model call",
    Error,
    () => parsePolicy("   "),
  );

  // --- the paid endpoint refuses what was never negotiated -----------------
  // Uses the sale the two runs above just completed, so the replay is against
  // real settled state rather than a fixture.
  const server = startX402Server();
  try {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const sale = latestCompleted();
    const criteria = JSON.parse(sale?.criteria ?? "{}") as { activityType?: string };
    const base = `${X402_BASE_URL}${COHORT_INSIGHT_PATH}`;

    for (const [label, url] of [
      [
        "a direct request with no negotiation behind it is refused",
        `${base}?activityType=running`,
      ],
      [
        "replaying an already-settled negotiation is refused",
        `${base}?activityType=${criteria.activityType}&queryId=${sale?.id}`,
      ],
    ] as [string, string][]) {
      try {
        const response = await fetch(url);
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        record(
          "errors",
          label,
          response.status === 403 && isMeaningful(body.message ?? ""),
          `HTTP ${response.status} ${body.error ?? ""} — ${(body.message ?? "").slice(0, 90)}`,
        );
      } catch (error) {
        record("errors", label, false, String(error).slice(0, 130));
      }
    }
  } finally {
    server.close();
  }
}

/* ------------------------------------------------------------------- report */

function report(): void {
  const groups = [...new Set(checks.map((check) => check.group))];

  console.log("\n\n=========================================================");
  console.log("  PHASE 7 END-OF-PHASE VERIFICATION");
  console.log("=========================================================\n");

  for (const group of groups) {
    const inGroup = checks.filter((check) => check.group === group);
    const passed = inGroup.filter((check) => check.passed).length;
    console.log(`  ${group}: ${passed}/${inGroup.length}`);
    for (const check of inGroup) {
      console.log(`    ${check.passed ? "PASS" : "FAIL"}  ${check.label}`);
    }
    console.log("");
  }

  const failures = checks.filter((check) => !check.passed);
  const passed = checks.length - failures.length;

  console.log("---------------------------------------------------------");
  console.log(`  TOTAL: ${passed}/${checks.length} passed`);

  if (failures.length > 0) {
    console.log(`\n  ${failures.length} FAILED:`);
    for (const failure of failures) {
      console.log(`    - [${failure.group}] ${failure.label}`);
      if (failure.detail) console.log(`      ${failure.detail}`);
    }
    console.log("\n  PHASE 7 IS NOT VERIFIED.");
  } else {
    console.log("\n  Phase 7 verified: the flow is repeatable and every");
    console.log("  failure mode is survivable.");
  }
  console.log("---------------------------------------------------------\n");

  if (failures.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  console.log("Phase 7 verification — repeatability and failure safety");
  console.log("======================================================");
  console.log("\nCosts 1 HBAR (two real purchases). Takes a few minutes:");
  console.log("each end-to-end run waits for its Hedera writes to appear.");

  await repeatedRuns();
  await failureModes();

  // Reaching this line is itself the headline result of part 2.
  console.log("\n  (the process survived every failure scenario)");

  report();
}

main().catch((error) => {
  console.error("\nThe verification script itself failed:", error);
  process.exit(1);
});
