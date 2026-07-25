import {
  SELLER_BASE_URL,
  sendNegotiationMessage,
  sendNegotiationRequest,
  type NegotiationResponse,
} from "../src/a2a/buyer-client.js";

/**
 * End-to-end check of the A2A negotiation: a buyer agent that knows only the
 * seller's base URL discovers it from the agent card and negotiates over
 * JSON-RPC, in both directions — an offer that gets accepted and an enquiry
 * that gets turned down.
 *
 * Start the seller first, in another terminal:
 *   npx tsx src/a2a/seller-server.ts
 *   npx tsx scripts/test-negotiation.ts
 */

async function assertSellerIsUp(): Promise<void> {
  try {
    const res = await fetch(`${SELLER_BASE_URL}/.well-known/agent-card.json`);
    if (!res.ok) throw new Error(`agent card responded ${res.status}`);
  } catch (error) {
    throw new Error(
      `Seller agent is not reachable at ${SELLER_BASE_URL} — start it with ` +
        `\`npx tsx src/a2a/seller-server.ts\` and run this again. (${String(error)})`,
    );
  }
}

function report(
  label: string,
  expected: string,
  response: NegotiationResponse,
): boolean {
  const ok = response.decision === expected && response.reply.length > 0;
  console.log(`\n${ok ? "OK  " : "FAIL"} ${label}`);
  console.log(`     expected decision: ${expected}`);
  console.log(`     actual decision:   ${response.decision ?? "(none returned)"}`);
  console.log(`     seller replied:    ${response.reply || "(empty)"}`);
  return ok;
}

async function main(): Promise<void> {
  await assertSellerIsUp();
  console.log(`Negotiating with the seller agent at ${SELLER_BASE_URL}`);

  const results: boolean[] = [];

  // Scenario 1 — a complete offer: category, cohort and a price in HBAR.
  results.push(
    report(
      "accept: priced offer for a running-performance cohort",
      "accept",
      await sendNegotiationRequest(
        { category: "running performance", ageRange: "25-34", cohortSize: 400 },
        0.5,
      ),
    ),
  );

  // Scenario 2 — an enquiry with no price attached, which the seller should
  // turn down and ask to have completed.
  results.push(
    report(
      "reject: enquiry with no price attached",
      "decline",
      await sendNegotiationMessage(
        "Hello, we are a research lab. What fitness data categories can you give us access to?",
      ),
    ),
  );

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} scenarios passed`);

  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Negotiation test failed:", error);
  process.exit(1);
});
