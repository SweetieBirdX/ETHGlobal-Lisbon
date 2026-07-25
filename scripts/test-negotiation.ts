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

  // Scenario 1 — a complete offer the owner's policy permits. No age filter:
  // an age range *and* an activity together match a single person in the
  // seeded population, which the aggregator refuses to report on.
  results.push(
    report(
      "accept: priced offer for a running-performance cohort",
      "accept",
      await sendNegotiationRequest({ category: "running performance" }, 0.5),
    ),
  );

  // Scenario 2 — a well-formed, generously priced offer for a category the
  // owner did not permit. Money does not override the policy.
  results.push(
    report(
      "reject: category the policy does not allow, at double the price",
      "decline",
      await sendNegotiationRequest({ category: "swimming" }, 0.9),
    ),
  );

  // Scenario 3 — an enquiry with no offer attached.
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
