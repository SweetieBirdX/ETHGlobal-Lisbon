import "dotenv/config";
import type { Server } from "node:http";
import { createSellerApp, SELLER_PORT } from "../src/a2a/seller-server.js";
import { setPolicy } from "../src/a2a/seller-executor.js";
import {
  negotiateAndPurchase,
  negotiateWithStrategy,
  sendNegotiationRequest,
} from "../src/a2a/buyer-client.js";
import { app as x402App, PORT as X402_PORT } from "../src/x402/server.js";
import { getTrack, openDatabase, type LicenceRow } from "../src/data/db.js";
import { countTopicEventsSince, topicSequence } from "../src/hedera/mirror.js";
import { requireIdentityTopicId } from "../src/identity/registry.js";
import type { LicenceGrant } from "../src/types/marketplace.js";

/**
 * The whole story, end to end, against live Hedera testnet:
 *
 *   1. a permitted sync licence settles — HCS audit entry, reputation
 *      feedback, certificate NFT, and the track's capacity drops;
 *   2. a political-ad request at a generous price is refused — money cannot
 *      buy a forbidden use, and nothing is paid;
 *   3. an over-capacity request is refused before any payment instruction;
 *   4. a lowball is declined with the floor disclosed, the buyer counters at
 *      exactly that floor autonomously, and the second round settles.
 *
 *   npm run test:e2e
 *
 * Costs real (testnet) HBAR: scenarios 1 and 4 each settle a licence.
 * Every "N events were written" assertion uses countTopicEventsSince with a
 * topicSequence() baseline — never a windowed count, which can slide.
 */

const checks: [string, boolean, string][] = [];

function record(label: string, passed: boolean, detail = ""): void {
  checks.push([label, passed, detail]);
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`       ${detail}`);
}

/** The mirror node lags consensus by a few seconds. */
const MIRROR_LAG_MS = 10_000;

const POLICY = {
  allowedLicenceTypes: ["sync", "sampling"],
  minPricePerShareHbar: 0.001,
  maxSharesPerLicence: 5_000,
  forbiddenUseCases: ["political-ad"],
};

function trackShares(trackId: number): number {
  const db = openDatabase();
  try {
    const track = getTrack(db, trackId);
    if (!track) throw new Error(`track ${trackId} missing — run scripts/seed-catalog.ts`);
    return track.available_shares;
  } finally {
    db.close();
  }
}

function licenceRow(id: number): LicenceRow | undefined {
  const db = openDatabase();
  try {
    return db.prepare("SELECT * FROM licences WHERE id = ?").get(id) as LicenceRow | undefined;
  } finally {
    db.close();
  }
}

function licenceIdOf(paymentUrl: string): number {
  return Number(new URL(paymentUrl).searchParams.get("licenceId"));
}

/** Completion runs after the response flushes — poll the row until it lands. */
async function awaitCompletion(licenceId: number): Promise<LicenceRow> {
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const row = licenceRow(licenceId);
    if (row?.status === "completed" && row.certificate_serial !== null) return row;
  }
  throw new Error(`licence ${licenceId} never completed`);
}

/** 1. The happy path: negotiate, pay, and collect every artefact of the sale. */
async function permittedLicenceSettles(): Promise<void> {
  console.log("\n=== 1. A permitted sync licence settles ===\n");

  const trackId = 1;
  const shares = 150;
  const sharesBefore = trackShares(trackId);

  const outcome = await negotiateAndPurchase(
    { trackId, shares, licenceType: "sync", territory: "worldwide", useCase: "film" },
    0.5,
    { onStep: (message) => console.log(`       ${message}`) },
  );

  record("the offer is accepted", outcome.negotiation.decision === "accept");
  record("the payment settled", outcome.purchase?.settlement?.success === true);

  const grant = outcome.purchase?.data as LicenceGrant | undefined;
  record(
    "the grant carries the decrypted master reference",
    typeof grant?.masterRef === "string" && grant.masterRef.length > 0,
    grant?.masterRef ? `${grant.masterRef.slice(0, 44)}…` : "absent",
  );

  const licenceId = licenceIdOf(outcome.negotiation.payment!.url);
  const row = await awaitCompletion(licenceId);
  record("the licence completed with the payment tx", Boolean(row.tx_hash), row.tx_hash ?? "");
  record(
    "a certificate NFT was minted for it",
    row.certificate_serial !== null,
    `serial ${row.certificate_serial}`,
  );
  record(
    "the attestation that admitted the buyer rides on the row",
    typeof row.attestation_hash === "string" && row.attestation_hash.startsWith("0x"),
  );

  const sharesAfter = trackShares(trackId);
  record(
    "the track's capacity dropped by exactly the granted shares",
    sharesAfter === sharesBefore - shares,
    `${sharesBefore} → ${sharesAfter} (−${shares})`,
  );
}

/** 2. Money cannot buy a forbidden use. */
async function forbiddenUseIsRefused(): Promise<void> {
  console.log("\n=== 2. A political ad is refused at any price ===\n");

  const reply = await sendNegotiationRequest(
    { trackId: 2, shares: 100, licenceType: "sync", territory: "worldwide", useCase: "political-ad" },
    1_000,
  );

  record(
    "the generous political-ad offer is refused",
    reply.decision === "decline" && reply.reason === "use_case_forbidden",
    reply.reply.slice(0, 130),
  );
  record("the refusal names the use, not the price", reply.reply.includes("political advertising"));
  record("no payment instruction is issued", reply.payment === undefined);
  record(
    "the floor is not disclosed — this is not a haggling position",
    reply.sellerMinimumHbar === undefined,
  );
}

/** 3. A licence the catalogue could not grant is refused before payment. */
async function overCapacityIsRefused(): Promise<void> {
  console.log("\n=== 3. An over-capacity request is refused before payment ===\n");

  const trackId = 3;
  const available = trackShares(trackId);
  const reply = await sendNegotiationRequest(
    // Above what is left but under the policy cap, so gate 3 gives the verdict.
    {
      trackId,
      shares: Math.min(available + 100, 5_000),
      licenceType: "sync",
      territory: "worldwide",
      useCase: "film",
    },
    50,
  );

  record(
    "the over-capacity request is refused",
    reply.decision === "decline" && reply.reason === "insufficient_shares",
    reply.reply.slice(0, 130),
  );
  record(
    "the refusal names both percentages",
    /asked for [\d.]+% but only [\d.]+%/.test(reply.reply),
  );
  record("no payment instruction is issued", reply.payment === undefined);
  record("nothing was reserved", trackShares(trackId) === available);
}

/** 4. The autonomous haggle: lowball → counter at the disclosed floor → settle. */
async function lowballCounterSettles(): Promise<void> {
  console.log("\n=== 4. Lowball, counter at the floor, settle ===\n");

  const trackId = 5;
  const shares = 200;
  const floor = POLICY.minPricePerShareHbar * shares;

  const result = await negotiateWithStrategy(
    { trackId, shares, licenceType: "sync", territory: "worldwide", useCase: "documentary" },
    0.05, // lowball, well under the floor
    1.5, // budget comfortably above both floor and quote
    { onStep: (message) => console.log(`       ${message}`) },
  );

  record("round 1 is declined as price_too_low", result.rounds[0]?.reason === "price_too_low");
  record(
    `the counter is exactly the disclosed floor (${floor} ℏ)`,
    result.rounds[1]?.offeredPriceHbar === floor,
    `countered at ${result.rounds[1]?.offeredPriceHbar} ℏ`,
  );
  record("round 2 is accepted", result.rounds[1]?.decision === "accept");
  record("the accepted round settled", result.purchase?.settlement?.success === true);

  const licenceId = licenceIdOf(result.negotiation.payment!.url);
  const row = await awaitCompletion(licenceId);
  record("the haggled licence completed", row.status === "completed", `tx ${row.tx_hash}`);
}

async function main(): Promise<void> {
  console.log("End-to-end: negotiation, refusals and settlement");
  console.log("================================================");

  // Baselines before anything is written, so each run's counters are its own.
  const auditBaseline = await topicSequence();
  const identityTopic = requireIdentityTopicId();
  const identityBaseline = await topicSequence(identityTopic);
  console.log(
    `\naudit topic baseline seq ${auditBaseline}, identity topic baseline seq ${identityBaseline}`,
  );

  setPolicy(POLICY);
  const sellerServer: Server = createSellerApp().listen(SELLER_PORT);
  const x402Server: Server = x402App.listen(X402_PORT);

  try {
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    await permittedLicenceSettles();
    await forbiddenUseIsRefused();
    await overCapacityIsRefused();
    await lowballCounterSettles();

    console.log(`\n  waiting ${MIRROR_LAG_MS / 1000}s for the mirror node...\n`);
    await new Promise((resolve) => setTimeout(resolve, MIRROR_LAG_MS));

    console.log("=== HCS event counts since this run's baselines ===\n");
    const completed = await countTopicEventsSince("licence_completed", auditBaseline);
    record(
      "exactly the two settled licences wrote licence_completed events",
      completed === 2,
      `licence_completed +${completed}`,
    );
    const feedback = await countTopicEventsSince("agent_feedback", identityBaseline, identityTopic);
    record(
      "exactly two reputation feedbacks were recorded",
      feedback === 2,
      `agent_feedback +${feedback}`,
    );
  } finally {
    setPolicy(null);
    sellerServer.close();
    x402Server.close();
  }

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n================================================`);
  console.log(`${passed}/${checks.length} checks passed`);
  for (const [label, ok, detail] of checks) {
    if (!ok) console.log(`  FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  }

  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nEnd-to-end suite failed:", error);
  process.exit(1);
});
