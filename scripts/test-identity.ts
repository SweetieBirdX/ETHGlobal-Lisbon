import "dotenv/config";
import { getBuyerUaid, getSellerUaid } from "../src/identity/agent-ids.js";
import {
  SCORE_COMPLIANT,
  SCORE_NON_COMPLIANT,
  VALIDATION_TAG,
  validatorUaid,
} from "../src/identity/attestation.js";
import { profileHash, sellerProfile } from "../src/identity/profile.js";
import { publishProfile, requireIdentityTopicId, resolveProfile } from "../src/identity/registry.js";
import { readReputation, SCORE_SUCCESS, submitFeedback } from "../src/identity/reputation.js";
import { accountIdFromUaid, deriveUaid, parseUaid, UAID_PROTO } from "../src/identity/uaid.js";
import { verifyBuyerIdentity } from "../src/identity/verify.js";
import { countTopicEventsSince, fetchTopicMessages, topicSequence } from "../src/hedera/mirror.js";

/**
 * The HCS identity stack end to end: UAIDs, the registry, the gate,
 * attestations and reputation.
 *
 * The claim being tested is narrow and worth stating precisely: identity lives
 * on a public HCS topic, every gate verdict about a *registered* agent is
 * backed by an attestation pair written to Hedera, and **all of it can be read
 * back by a third party** through the mirror node. What this does **not**
 * test, because it is not true: that any of it is independently audited. The
 * seller is its own validator. See src/identity/attestation.ts.
 *
 *   npm run test:identity
 *
 * Buys nothing, so it costs HCS fees only — a fraction of a cent, no HBAR
 * purchases.
 *
 * Every "N were written" assertion uses a topic-sequence baseline via
 * countTopicEventsSince — never a windowed count, which can slide backwards
 * as the topic grows (see the countTopicEventsSince docstring).
 */

const REQUEST_EVENT = "validation_request";
const RESPONSE_EVENT = "validation_response";
const FEEDBACK_EVENT = "agent_feedback";

const checks: [string, boolean, string][] = [];

function record(label: string, passed: boolean, detail = ""): void {
  checks.push([label, passed, detail]);
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`       ${detail}`);
}

/** The mirror node lags consensus by a few seconds. */
const MIRROR_LAG_MS = 8_000;

async function waitForMirror(): Promise<void> {
  console.log(`\n  waiting ${MIRROR_LAG_MS / 1000}s for the mirror node...\n`);
  await new Promise((resolve) => setTimeout(resolve, MIRROR_LAG_MS));
}

/** Request/response pairs written to the audit topic after a baseline. */
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

/** Deriving a UAID is pure: same account in, same identity out, no network. */
function uaidIsDeterministic(): void {
  console.log("\n=== UAID derivation is deterministic ===\n");

  const account = "0.0.9697053";
  const first = deriveUaid(account, { proto: UAID_PROTO });
  const second = deriveUaid(account, { proto: UAID_PROTO });

  record("same account derives the identical UAID twice", first === second, first);
  record(
    "different accounts derive different UAIDs",
    deriveUaid("0.0.1", { proto: UAID_PROTO }) !== first,
  );

  const parts = parseUaid(first);
  record(
    "the UAID round-trips through parseUaid",
    parts.proto === UAID_PROTO && parts.nativeId === `hedera:testnet:${account}`,
  );
  record("the Hedera account comes back out", accountIdFromUaid(first) === account);
}

/** A published profile must come back, hash-intact, off the mirror node. */
async function publishResolveRoundTrip(): Promise<void> {
  console.log("\n=== Publish → resolve round trip through the registry ===\n");

  const accountId = process.env.SELLER_ACCOUNT_ID!;
  const profile = sellerProfile(accountId);
  const write = await publishProfile(profile);
  record(
    "the profile was published to the identity topic",
    write.sequenceNumber > 0,
    `topic ${write.topicId} seq ${write.sequenceNumber}`,
  );

  await waitForMirror();

  const resolved = await resolveProfile(profile.uaid);
  record("the profile resolves back off the mirror node", resolved !== undefined);
  record(
    "newest-wins: the resolved profile is the one just published",
    resolved?.sequenceNumber === write.sequenceNumber,
    `resolved seq ${resolved?.sequenceNumber}`,
  );
  record(
    "the published hash matches a locally recomputed one",
    resolved !== undefined && resolved.profileHash === profileHash(resolved.profile),
    resolved?.profileHash ?? "",
  );
}

/** Gate outcome 1 — the approved buyer: attested 100, exactly one pair written. */
async function approvedBuyerIsAttested(): Promise<void> {
  console.log("\n=== The demo buyer is attested, and the record is public ===\n");

  const buyerUaid = getBuyerUaid();
  const seqBefore = await topicSequence();

  const identity = await verifyBuyerIdentity(buyerUaid);

  record("the buyer passes the gate", identity.verified === true, identity.reason.slice(0, 130));
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
      identity.attestation?.requestTransactionId !== identity.attestation?.responseTransactionId,
    `request ${identity.attestation?.requestTransactionId}\n       response ${identity.attestation?.responseTransactionId}`,
  );
  console.log(`       ${identity.attestation?.hashscanUrl}`);

  await waitForMirror();

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
    "the record keeps the ValidationRegistry vocabulary, keyed by UAID",
    request?.["validatorUaid"] !== undefined &&
      request?.["agentUaid"] !== undefined &&
      request?.["requestURI"] !== undefined &&
      response?.["responseURI"] !== undefined &&
      response?.["responseHash"] !== undefined &&
      response?.["tag"] === VALIDATION_TAG,
    `tag=${response?.["tag"]}`,
  );
  record(
    "the validator on record is the seller's own UAID",
    request?.["validatorUaid"] === validatorUaid(),
    "self-attested: this proves the check ran, not that a third party verified it",
  );
  record(
    "the score on the topic matches the verdict returned",
    response?.["response"] === SCORE_COMPLIANT,
    `on-topic response=${response?.["response"]}`,
  );
}

/** Gate outcome 2 — an unapproved agent: a real score-0 attestation, then a refusal. */
async function unapprovedAgentGetsZero(): Promise<void> {
  console.log("\n=== An unapproved agent gets a real score-0 attestation ===\n");

  // The seller's own UAID: registered and active, but not on the vetted list.
  const sellerUaid = getSellerUaid();
  const seqBefore = await topicSequence();

  const identity = await verifyBuyerIdentity(sellerUaid);

  record("the unapproved agent is refused", identity.verified === false, identity.reason.slice(0, 130));
  record(
    "the refusal is backed by a written attestation, not just a list miss",
    identity.attestation !== undefined,
  );
  record(
    "the verdict is a non-compliant score",
    identity.attestation?.response === SCORE_NON_COMPLIANT,
    `response=${identity.attestation?.response}`,
  );

  await waitForMirror();

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

/** Gate outcomes 3 and 4 — no verdicts about nothing, no network for garbage. */
async function unknownAgentsWriteNothing(): Promise<void> {
  console.log("\n=== Unregistered and malformed ids are refused without writing ===\n");

  const seqBefore = await topicSequence();

  const unregistered = await verifyBuyerIdentity(
    deriveUaid("0.0.777777", { proto: UAID_PROTO }),
  );
  record(
    "a valid but unregistered UAID is refused",
    unregistered.verified === false &&
      unregistered.reason.includes("not registered in the identity registry"),
    unregistered.reason.slice(0, 130),
  );
  record("no attestation was produced for it", unregistered.attestation === undefined);

  const garbage = await verifyBuyerIdentity("not-a-uaid-at-all");
  record(
    "garbage is refused before any network call",
    garbage.verified === false && garbage.reason.includes("not a valid UAID"),
    garbage.reason.slice(0, 130),
  );
  record("no attestation was produced for garbage either", garbage.attestation === undefined);

  await waitForMirror();
  const delta = await pairsSince(seqBefore);
  record(
    "nothing was written to the topic for either",
    delta.requests === 0 && delta.responses === 0,
    "the attestation sits behind the registry check, so unknown ids stay free",
  );
}

/** Reputation grows by exactly one entry per submission, citing a real payment. */
async function reputationGrowsByOne(): Promise<void> {
  console.log("\n=== Reputation +1 per submission, citing a real payment ===\n");

  const buyerUaid = getBuyerUaid();
  const identityTopic = requireIdentityTopicId();

  // A real past payment: the buyer's most recent successful transfer.
  const txResponse = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${process.env.BUYER_ACCOUNT_ID}&transactiontype=cryptotransfer&result=success&order=desc&limit=1`,
    { signal: AbortSignal.timeout(20_000) },
  );
  const txBody = (await txResponse.json()) as { transactions?: { transaction_id: string }[] };
  const paymentTxId = txBody.transactions?.[0]?.transaction_id;
  record("a real past payment exists to cite", Boolean(paymentTxId), paymentTxId ?? "none found");
  if (!paymentTxId) return;

  const before = await readReputation(buyerUaid);
  const seqBefore = await topicSequence(identityTopic);

  await submitFeedback(buyerUaid, SCORE_SUCCESS, paymentTxId);

  await waitForMirror();

  const after = await readReputation(buyerUaid);
  record(
    "the reputation count went up by exactly one",
    after.count === before.count + 1,
    `count ${before.count} → ${after.count}, average ${after.averageScore}`,
  );
  record(
    "exactly one feedback event was written",
    (await countTopicEventsSince(FEEDBACK_EVENT, seqBefore, identityTopic)) === 1,
  );
  record(
    "the newest entry cites the payment transaction",
    after.entries[0]?.paymentTxId === paymentTxId,
    paymentTxId,
  );
}

async function main(): Promise<void> {
  console.log("HCS identity registry, attestation and reputation");
  console.log("=================================================");
  console.log(`\nValidator (self-attesting): ${validatorUaid()}`);
  console.log(`Tag: ${VALIDATION_TAG}`);
  console.log(`Identity topic: ${requireIdentityTopicId()}`);

  uaidIsDeterministic();
  await publishResolveRoundTrip();
  await approvedBuyerIsAttested();
  await unapprovedAgentGetsZero();
  await unknownAgentsWriteNothing();
  await reputationGrowsByOne();

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n=================================================`);
  console.log(`${passed}/${checks.length} checks passed — HCS fees only, no HBAR purchases`);
  for (const [label, ok, detail] of checks) {
    if (!ok) console.log(`  FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  }

  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nIdentity test failed:", error);
  process.exit(1);
});
