import "dotenv/config";
import type { Server } from "node:http";
import { createSellerApp, SELLER_PORT } from "../src/a2a/seller-server.js";
import { sendNegotiationMessage } from "../src/a2a/buyer-client.js";
import { verifyBuyerIdentity } from "../src/a2a/seller-executor.js";
import { getBuyerAgentId, getSellerAgentId } from "../src/erc8004/agent-ids.js";
import {
  SCORE_COMPLIANT,
  SCORE_NON_COMPLIANT,
  VALIDATION_TAG,
  validatorAddress,
} from "../src/erc8004/validation.js";
import { countTopicEventsSince, fetchTopicMessages, topicSequence } from "../src/hedera/mirror.js";

/**
 * Compliance attestations are real records, not a local list check.
 *
 * The claim being tested is narrow and worth stating precisely: for every agent
 * that reaches gate 1, a request/response pair is written to Hedera, the verdict
 * is derived from the data owner's vetted list, and **the record can be read
 * back by a third party** through the mirror node. That last part is the whole
 * point — a verdict only the seller can see is not an attestation.
 *
 * What this does **not** test, because it is not true: that the attestation is
 * independent. The seller is its own validator. See src/erc8004/validation.ts.
 *
 *   npx tsx scripts/test-validation.ts
 *
 * Buys no data, so it costs HCS fees only — a fraction of a cent.
 */

const REQUEST_EVENT = "validation_request";
const RESPONSE_EVENT = "validation_response";

const checks: [string, boolean, string][] = [];

function record(label: string, passed: boolean, detail = ""): void {
  checks.push([label, passed, detail]);
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`       ${detail}`);
}

/** The mirror node lags consensus by a few seconds. */
const MIRROR_LAG_MS = 8_000;

/** Request/response pairs written after a topic-sequence baseline. */
async function pairsSince(seq: number): Promise<{ requests: number; responses: number }> {
  return {
    requests: await countTopicEventsSince(REQUEST_EVENT, seq),
    responses: await countTopicEventsSince(RESPONSE_EVENT, seq),
  };
}

/** Finds the attestation messages carrying a given requestHash. */
async function findAttestation(requestHash: string) {
  const messages = await fetchTopicMessages(50);
  const matching = messages.filter((m) => m.json?.["requestHash"] === requestHash);
  return {
    request: matching.find((m) => m.json?.["event"] === REQUEST_EVENT)?.json,
    response: matching.find((m) => m.json?.["event"] === RESPONSE_EVENT)?.json,
  };
}

/** The approved buyer: attested 100, and allowed through to the policy gate. */
async function approvedAgentIsAttested(): Promise<void> {
  console.log("\n=== The demo buyer is attested, and the record is public ===\n");

  const buyerAgentId = getBuyerAgentId();
  const seqBefore = await topicSequence();

  const identity = await verifyBuyerIdentity(buyerAgentId);

  record(
    `agent ${buyerAgentId} passes gate 1`,
    identity.verified === true,
    identity.reason.slice(0, 130),
  );
  record(
    "an attestation was produced, not a local list lookup",
    identity.attestation !== undefined,
  );
  record(
    "the verdict is a compliant score",
    identity.attestation?.response === SCORE_COMPLIANT,
    `response=${identity.attestation?.response}`,
  );
  record(
    "both halves carry a Hedera transaction id",
    Boolean(identity.attestation?.requestTransactionId) &&
      Boolean(identity.attestation?.responseTransactionId) &&
      identity.attestation?.requestTransactionId !==
        identity.attestation?.responseTransactionId,
    `request ${identity.attestation?.requestTransactionId}\n       response ${identity.attestation?.responseTransactionId}`,
  );
  console.log(`       ${identity.attestation?.hashscanUrl}`);

  console.log(`\n  waiting ${MIRROR_LAG_MS / 1000}s for the mirror node...\n`);
  await new Promise((resolve) => setTimeout(resolve, MIRROR_LAG_MS));

  const delta = await pairsSince(seqBefore);
  record(
    "exactly one request and one response were written",
    delta.requests === 1 && delta.responses === 1,
    `requests +${delta.requests}, responses +${delta.responses}`,
  );

  // The decisive check: read the record back the way anyone else would.
  const hash = identity.attestation!.requestHash;
  const { request, response } = await findAttestation(hash);

  record("the request is readable off the mirror node", request !== undefined);
  record("the response is readable off the mirror node", response !== undefined);
  record(
    "the response is tied to its request by requestHash",
    request?.["requestHash"] === hash && response?.["requestHash"] === hash,
    hash,
  );
  record(
    "the record uses the ValidationRegistry's field names",
    request?.["validatorAddress"] !== undefined &&
      request?.["agentId"] !== undefined &&
      request?.["requestURI"] !== undefined &&
      response?.["responseURI"] !== undefined &&
      response?.["responseHash"] !== undefined &&
      response?.["tag"] === VALIDATION_TAG,
    `tag=${response?.["tag"]} validator=${request?.["validatorAddress"]}`,
  );
  record(
    "the validator on record is the seller's own address",
    request?.["validatorAddress"] === validatorAddress(),
    "self-attested: this proves the check ran, not that a third party verified it",
  );
  record(
    "the score on the topic matches the verdict returned",
    response?.["response"] === SCORE_COMPLIANT,
    `on-topic response=${response?.["response"]}`,
  );
}

/** The unapproved agent: a real score-0 attestation, then a refusal. */
async function unapprovedAgentGetsZero(): Promise<void> {
  console.log("\n=== An unapproved agent gets a real score-0 attestation ===\n");

  // The seller's own id: registered and active, but not on the vetted list.
  const sellerAgentId = getSellerAgentId();
  const seqBefore = await topicSequence();

  const identity = await verifyBuyerIdentity(sellerAgentId);

  record(
    `agent ${sellerAgentId} is refused at gate 1`,
    identity.verified === false,
    identity.reason.slice(0, 130),
  );
  record(
    "the refusal is backed by a written attestation, not just a list miss",
    identity.attestation !== undefined,
  );
  record(
    "the verdict is a non-compliant score",
    identity.attestation?.response === SCORE_NON_COMPLIANT,
    `response=${identity.attestation?.response}`,
  );

  console.log(`\n  waiting ${MIRROR_LAG_MS / 1000}s for the mirror node...\n`);
  await new Promise((resolve) => setTimeout(resolve, MIRROR_LAG_MS));

  const delta = await pairsSince(seqBefore);
  record(
    "the failing case is recorded too, both halves",
    delta.requests === 1 && delta.responses === 1,
    `requests +${delta.requests}, responses +${delta.responses}`,
  );

  const { response } = await findAttestation(identity.attestation!.requestHash);
  record(
    "the zero score is on the topic for anyone to read",
    response?.["response"] === SCORE_NON_COMPLIANT,
    `on-topic response=${response?.["response"]}`,
  );
}

/** An id that was never minted must not produce a verdict about nothing. */
async function unregisteredAgentWritesNothing(): Promise<void> {
  console.log("\n=== An unregistered agent is refused without writing ===\n");

  const seqBefore = await topicSequence();
  const identity = await verifyBuyerIdentity("999999999");

  record(
    "an unminted agent id is refused",
    identity.verified === false,
    identity.reason.slice(0, 130),
  );
  record("no attestation was produced for it", identity.attestation === undefined);

  await new Promise((resolve) => setTimeout(resolve, MIRROR_LAG_MS));
  const delta = await pairsSince(seqBefore);
  record(
    "nothing was written to the topic",
    delta.requests === 0 && delta.responses === 0,
    "the attestation sits behind the existence check, so garbage ids stay free",
  );
}

/** The attestation reaches the buyer, so it can check the verdict itself. */
async function attestationIsReportedToTheBuyer(): Promise<void> {
  console.log("\n=== The buyer is told which attestation decided its offer ===\n");

  const server: Server = createSellerApp().listen(SELLER_PORT);
  try {
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const reply = await sendNegotiationMessage("Offer attached.", {
      offeredPriceHbar: 0.5,
      category: "running",
    });

    const metadata = (reply.raw as { status?: { message?: { metadata?: Record<string, unknown> } } })
      .status?.message?.metadata ??
      (reply.raw as { metadata?: Record<string, unknown> }).metadata ??
      {};
    const attestation = metadata["attestation"] as Record<string, unknown> | undefined;

    record("the negotiation was accepted", reply.decision === "accept");
    record(
      "the reply carries the attestation",
      attestation !== undefined,
      attestation ? JSON.stringify(attestation).slice(0, 130) : "absent",
    );
    record(
      "it carries the hash and score the buyer needs to verify it",
      typeof attestation?.["requestHash"] === "string" &&
        attestation?.["response"] === SCORE_COMPLIANT &&
        typeof attestation?.["responseTransactionId"] === "string",
    );
  } finally {
    server.close();
  }
}

async function main(): Promise<void> {
  console.log("Compliance attestations on Hedera");
  console.log("=================================");
  console.log(`\nValidator (self-attesting): ${validatorAddress()}`);
  console.log(`Tag: ${VALIDATION_TAG}`);

  await approvedAgentIsAttested();
  await unapprovedAgentGetsZero();
  await unregisteredAgentWritesNothing();
  await attestationIsReportedToTheBuyer();

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n=================================`);
  console.log(`${passed}/${checks.length} checks passed`);
  for (const [label, ok, detail] of checks) {
    if (!ok) console.log(`  FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  }

  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nValidation test failed:", error);
  process.exit(1);
});
