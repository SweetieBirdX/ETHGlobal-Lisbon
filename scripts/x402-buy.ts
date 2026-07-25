import "dotenv/config";
import { COHORT_INSIGHT_PATH, X402_BASE_URL } from "../src/x402/config.js";
import { payAndFetch } from "../src/x402/pay.js";

/**
 * The x402 round trip on its own, without a negotiation in front of it:
 *
 *   1. GET the protected endpoint            → 402 + `payment-required` header
 *   2. decode the payment requirements       → price, asset, recipient, network
 *   3. sign a Hedera transfer for that exact amount
 *   4. retry the same GET with `payment-signature` → 200 + the data
 *
 * Useful for testing the payment layer in isolation. The full agent-to-agent
 * flow (negotiate, then pay the endpoint the seller hands back) lives in
 * `negotiateAndPurchase` and is exercised by `scripts/full-e2e-test.ts`.
 *
 * Start the server first (`npx tsx src/x402/server.ts`), then:
 *
 *   npx tsx scripts/x402-buy.ts
 */

// Broad enough to clear the minimum cohort size — an age range *and* an
// activity together match a single person in the seeded population, which the
// aggregator refuses to report on.
const CRITERIA = { activityType: "running" };

async function main(): Promise<void> {
  const url = `${X402_BASE_URL}${COHORT_INSIGHT_PATH}?${new URLSearchParams(CRITERIA)}`;

  const result = await payAndFetch(url, { onStep: (message) => console.log(message) });

  console.log(`\ndata: ${JSON.stringify(result.data, null, 2)}`);

  if (result.settlement) {
    console.log(`\nHashScan: ${result.settlement.hashscanUrl}`);
  } else {
    console.log("\nno settlement header on the response");
  }
}

main().catch((error) => {
  console.error("x402 purchase failed:", error);
  process.exit(1);
});
