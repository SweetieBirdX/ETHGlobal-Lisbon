import "dotenv/config";
import type { Server } from "node:http";
import express from "express";
import { createSellerApp, SELLER_PORT } from "../src/a2a/seller-server.js";
import { sendNegotiationMessage } from "../src/a2a/buyer-client.js";
import { setPolicy, verifyBuyerIdentity } from "../src/a2a/seller-executor.js";
import { getSellerUaid } from "../src/identity/agent-ids.js";
import { deriveUaid, UAID_PROTO } from "../src/identity/uaid.js";
import {
  assertSufficientBalance,
  EndpointUnreachableError,
  InsufficientBalanceError,
  payAndFetch,
} from "../src/x402/pay.js";

/**
 * What happens when things go wrong.
 *
 * An agent that transacts unattended has to fail in ways its operator can
 * diagnose, and — more importantly — must not pay for anything it did not get.
 * Each case here forces a real failure rather than mocking one.
 *
 *   npx tsx scripts/test-error-cases.ts
 *
 * Pays for no licence: every scenario fails before a payment is signed. It is
 * not strictly free — the registered identities that reach gate 1 get a real
 * compliance attestation pair written to HCS. That is a fraction of a cent in
 * fees, not what a purchase costs.
 */

const LICENCE_POLICY = {
  allowedLicenceTypes: ["sync", "sampling"],
  minPricePerShareHbar: 0.0001,
  maxSharesPerLicence: 1_000_000,
  forbiddenUseCases: ["political-ad"],
};

const checks: [string, boolean, string][] = [];

function record(label: string, passed: boolean, detail = ""): void {
  checks.push([label, passed, detail]);
  console.log(`${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`     ${detail}`);
}

/** Accepts connections and never answers — for testing timeouts. */
function startBlackHoleServer(port: number): Server {
  const app = express();
  app.get("*splat", () => {
    /* deliberately never responds */
  });
  return app.listen(port);
}

async function networkErrors(): Promise<void> {
  console.log("\n=== Network errors ===\n");

  // The x402 endpoint is not running.
  try {
    await payAndFetch("http://localhost:4999/licence/grant?trackId=1&licenceId=1");
    record("unreachable x402 endpoint is reported", false, "no error thrown");
  } catch (error) {
    record(
      "unreachable x402 endpoint is reported",
      error instanceof EndpointUnreachableError,
      (error as Error).message.slice(0, 130),
    );
  }

  // The seller agent is not running.
  try {
    await sendNegotiationMessage("hello", undefined, "http://localhost:4998");
    record("unreachable seller agent is reported", false, "no error thrown");
  } catch (error) {
    record(
      "unreachable seller agent is reported",
      String(error).length > 0,
      String(error).slice(0, 130),
    );
  }
}

async function timeouts(): Promise<void> {
  console.log("\n=== Timeout ===\n");

  const blackHole = startBlackHoleServer(4997);
  try {
    await payAndFetch("http://localhost:4997/licence/grant", { timeoutMs: 2_000 });
    record("unresponsive endpoint times out", false, "no error thrown");
  } catch (error) {
    const message = (error as Error).message;
    record(
      "unresponsive endpoint times out",
      error instanceof EndpointUnreachableError && message.includes("Timed out"),
      message.slice(0, 130),
    );
  } finally {
    blackHole.close();
  }
}

async function insufficientBalance(): Promise<void> {
  console.log("\n=== Insufficient balance ===\n");

  const buyer = process.env.BUYER_ACCOUNT_ID!;

  // 10,000,000 HBAR — more than the account will ever hold on testnet.
  try {
    await assertSufficientBalance(buyer, "1000000000000000");
    record("insufficient balance is caught before signing", false, "no error thrown");
  } catch (error) {
    record(
      "insufficient balance is caught before signing",
      error instanceof InsufficientBalanceError,
      (error as Error).message.slice(0, 130),
    );
  }

  // The same check must not block a payment the buyer can afford.
  try {
    await assertSufficientBalance(buyer, "50000000"); // 0.5 HBAR
    record("an affordable payment is not blocked", true);
  } catch (error) {
    record("an affordable payment is not blocked", false, String(error).slice(0, 130));
  }

  // An account that does not exist must not silently pass as "rich enough"...
  // the mirror node 404s, and a check that cannot run must not block a payment.
  try {
    await assertSufficientBalance("0.0.99999999", "50000000");
    record("unknown account does not crash the check", true);
  } catch (error) {
    record("unknown account does not crash the check", false, String(error).slice(0, 130));
  }
}

async function invalidBuyerIds(): Promise<void> {
  console.log("\n=== Invalid buyer ids ===\n");

  const cases: [string, string][] = [
    ["999999999", "not a UAID"],
    ["did:uaid:", "empty id segment"],
    ["", "empty"],
    [deriveUaid("0.0.99999999", { proto: UAID_PROTO }), "valid shape, never registered"],
    [getSellerUaid(), "registered but not on the approved list (the seller's own UAID)"],
  ];

  for (const [uaid, description] of cases) {
    const result = await verifyBuyerIdentity(uaid);
    record(
      `buyer id "${uaid.slice(0, 34)}" (${description}) is refused`,
      result.verified === false,
      result.reason.slice(0, 120),
    );
  }
}

async function negotiationEdgeCases(): Promise<void> {
  console.log("\n=== Negotiation edge cases (live seller) ===\n");

  setPolicy(LICENCE_POLICY);
  const server = createSellerApp().listen(SELLER_PORT);
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  const terms = { trackId: 1, shares: 200, licenceType: "sync", useCase: "film" };

  try {
    // An impostor claiming an identity that was never registered. The buyer
    // client sends its own real UAID, so the raw path is used to forge one.
    const raw = await sendNegotiationMessage("We offer 5 HBAR for a sync licence.", {
      buyerUaid: deriveUaid("0.0.999999", { proto: UAID_PROTO }),
      offeredPriceHbar: 5,
      ...terms,
    });
    record(
      "unregistered agent cannot buy",
      raw.decision === "decline" && raw.reason === "identity_unverified",
      raw.reply.slice(0, 110),
    );
    record("no payment instruction for an unverified agent", raw.payment === undefined);

    // Absurd price, permitted terms: policy allows it, so it should accept.
    const generous = await sendNegotiationMessage("Offer attached.", {
      offeredPriceHbar: 1_000_000,
      ...terms,
    });
    record(
      "an absurdly generous offer is still handled",
      generous.decision === "accept",
      generous.reply.slice(0, 90),
    );

    // Negative and non-numeric prices must not be treated as valid offers.
    const negative = await sendNegotiationMessage("Offer attached.", {
      offeredPriceHbar: -5,
      ...terms,
    });
    record(
      "negative price is refused",
      negative.decision === "decline" && negative.reason === "price_too_low",
      negative.reply.slice(0, 90),
    );

    const nonNumeric = await sendNegotiationMessage("Offer attached.", {
      offeredPriceHbar: "free",
      ...terms,
    });
    record(
      "non-numeric price is refused",
      nonNumeric.decision === "decline" && nonNumeric.reason === "offer_incomplete",
      nonNumeric.reply.slice(0, 90),
    );

    // More shares than the track has ever had.
    const oversized = await sendNegotiationMessage("Offer attached.", {
      offeredPriceHbar: 100,
      ...terms,
      shares: 20_000,
    });
    record(
      "an over-capacity licence is refused, unpaid",
      oversized.decision === "decline" && oversized.reason === "insufficient_shares",
      oversized.reply.slice(0, 110),
    );

    // A track that does not exist.
    const phantom = await sendNegotiationMessage("Offer attached.", {
      offeredPriceHbar: 1,
      ...terms,
      trackId: 424242,
    });
    record(
      "an unknown track is refused, unpaid",
      phantom.decision === "decline" && phantom.reason === "unknown_track",
      phantom.reply.slice(0, 110),
    );
  } finally {
    setPolicy(null);
    server.close();
  }
}

async function main(): Promise<void> {
  console.log("Error handling and edge cases");
  console.log("=============================");

  await networkErrors();
  await timeouts();
  await insufficientBalance();
  await invalidBuyerIds();
  await negotiationEdgeCases();

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n=============================`);
  console.log(`${passed}/${checks.length} checks passed`);
  for (const [label, ok] of checks) {
    if (!ok) console.log(`  FAILED: ${label}`);
  }

  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nError-case suite itself failed:", error);
  process.exit(1);
});
