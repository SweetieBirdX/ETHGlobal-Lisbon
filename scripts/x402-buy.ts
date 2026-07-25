import "dotenv/config";
import { insertQuery, openDatabase } from "../src/data/db.js";
import { getBuyerAgentId } from "../src/erc8004/agent-ids.js";
import {
  COHORT_INSIGHT_PATH,
  COHORT_INSIGHT_PRICE_HBAR,
  X402_BASE_URL,
} from "../src/x402/config.js";
import { payAndFetch } from "../src/x402/pay.js";

/**
 * The x402 round trip on its own, without an A2A negotiation in front of it:
 *
 *   1. GET the protected endpoint            → 402 + `payment-required` header
 *   2. decode the payment requirements       → price, asset, recipient, network
 *   3. sign a Hedera transfer for that exact amount
 *   4. retry the same GET with `payment-signature` → 200 + the data
 *
 * The endpoint no longer serves a request no negotiation authorised, so this
 * script records an accepted negotiation of its own first — it runs on the
 * seller's machine against the seller's own ledger, which is where an
 * acceptance would have been written anyway. What it still tests in isolation
 * is the *payment* layer: no seller agent, no buyer agent, no policy.
 *
 * The full agent-to-agent flow lives in `negotiateAndPurchase` and is exercised
 * by `scripts/full-e2e-test.ts`; the binding this script has to satisfy is
 * tested by `scripts/test-payment-binding.ts`.
 *
 * Start the server first (`npx tsx src/x402/server.ts`), then:
 *
 *   npx tsx scripts/x402-buy.ts
 */

// Broad enough to clear the minimum cohort size — an age range *and* an
// activity together match a single person in the seeded population, which the
// aggregator refuses to report on.
const CRITERIA = { activityType: "running" };

/** Writes the acceptance the endpoint will check this request against. */
function recordAcceptedNegotiation(): number {
  const db = openDatabase();
  try {
    return insertQuery(
      db,
      getBuyerAgentId(),
      CRITERIA,
      Number(COHORT_INSIGHT_PRICE_HBAR),
      "accepted",
    );
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const queryId = recordAcceptedNegotiation();
  console.log(`negotiation ${queryId} recorded as accepted (${JSON.stringify(CRITERIA)})\n`);

  const params = new URLSearchParams({ ...CRITERIA, queryId: String(queryId) });
  const url = `${X402_BASE_URL}${COHORT_INSIGHT_PATH}?${params}`;

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
