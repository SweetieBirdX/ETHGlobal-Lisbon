import "dotenv/config";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import {
  createClientHederaSigner,
  PrivateKey as HederaPrivateKey,
} from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { Hbar } from "@hiero-ledger/sdk";

/**
 * The buyer agent paying for a cohort insight — the x402 round trip, done by
 * hand so every step of it is visible:
 *
 *   1. GET the protected endpoint            → 402 + `payment-required` header
 *   2. decode the payment requirements       → price, asset, recipient, network
 *   3. sign a Hedera transfer for that exact amount
 *   4. retry the same GET with `payment-signature` → 200 + the data
 *
 * No human approves the payment: the agent sees a price it is willing to pay
 * and settles it. `@x402/fetch`'s `wrapFetchWithPayment` would collapse all of
 * this into one call, but the point here is to show the protocol, not hide it.
 *
 * Start the server first (`npx tsx src/x402/server.ts`), then:
 *
 *   npx tsx scripts/x402-buy.ts
 */

const SERVER_URL = process.env.X402_SERVER_URL ?? "http://localhost:4021";
const NETWORK = "hedera:testnet";
// Broad enough to clear the minimum cohort size — an age range *and* an
// activity together match a single person in the seeded population, which the
// aggregator refuses to report on.
const CRITERIA = { activityType: "running" };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name} — copy .env.example to .env and fill it in (see CLAUDE.md).`,
    );
  }
  return value;
}

/** `0.0.1234@1700000000.000000000` → `0.0.1234-1700000000-000000000` (HashScan URL form). */
function toHashScanTransactionId(transactionId: string): string {
  const [accountId, validStart] = transactionId.split("@");
  return validStart ? `${accountId}-${validStart.replace(".", "-")}` : transactionId;
}

/**
 * Builds the buyer's signer. The private key is read here and handed straight
 * to the signer — it is never logged, never put in a URL, and never passed to
 * the LLM-driven parts of the agent.
 */
function createBuyerSigner() {
  return createClientHederaSigner(
    requireEnv("BUYER_ACCOUNT_ID"),
    HederaPrivateKey.fromStringECDSA(requireEnv("BUYER_PRIVATE_KEY")),
    { network: NETWORK },
  );
}

async function main(): Promise<void> {
  const url = `${SERVER_URL}/data/cohort-insight?${new URLSearchParams(CRITERIA)}`;

  // 1. Unpaid request — expected to be rejected with 402.
  console.log(`-> GET ${url}`);
  const unpaid = await fetch(url);
  console.log(`<- HTTP ${unpaid.status}`);

  if (unpaid.status !== 402) {
    throw new Error(
      `Expected HTTP 402 Payment Required, got ${unpaid.status}. Is the x402 middleware wired up?`,
    );
  }

  // 2. The 402 carries the terms of the deal in a header, not the body.
  const header = unpaid.headers.get("payment-required");
  if (!header) {
    throw new Error("402 response carried no `payment-required` header");
  }

  const paymentRequired = decodePaymentRequiredHeader(header);
  for (const requirement of paymentRequired.accepts) {
    console.log(
      `   asking ${Hbar.fromTinybars(requirement.amount).toString()}` +
        ` (${requirement.amount} tinybar, asset ${requirement.asset})` +
        ` to ${requirement.payTo} on ${requirement.network}`,
    );
  }

  // 3. Sign a payment matching those requirements.
  const client = new x402Client().register(
    "hedera:*",
    new ExactHederaScheme(createBuyerSigner()),
  );
  const payload = await client.createPaymentPayload(paymentRequired);
  console.log(`   signed by ${requireEnv("BUYER_ACCOUNT_ID")} — retrying with payment`);

  // 4. Same request, now carrying the signed payment.
  const paid = await fetch(url, {
    headers: { "payment-signature": encodePaymentSignatureHeader(payload) },
  });
  console.log(`-> GET ${url} (with payment-signature)`);
  console.log(`<- HTTP ${paid.status}`);

  const body = await paid.json();
  console.log(`\ndata: ${JSON.stringify(body, null, 2)}`);

  if (!paid.ok) {
    throw new Error(`Payment was rejected: HTTP ${paid.status}`);
  }

  // The facilitator reports the settled Hedera transaction back in a header.
  const settlement = new x402HTTPClient(client).getPaymentSettleResponse((name) =>
    paid.headers.get(name),
  );

  if (settlement) {
    console.log(
      `\nsettlement: success=${settlement.success} payer=${settlement.payer}`,
    );
    console.log(`transaction: ${settlement.transaction}`);
    console.log(
      `HashScan: https://hashscan.io/testnet/transaction/${toHashScanTransactionId(String(settlement.transaction))}`,
    );
  } else {
    console.log("\nno settlement header on the response");
  }
}

main().catch((error) => {
  console.error("x402 purchase failed:", error);
  process.exit(1);
});
