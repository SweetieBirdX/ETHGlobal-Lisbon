# Personal Health/Fitness Data Agent Marketplace

Users keep ownership of their own fitness data: a personal AI agent negotiates access with a research company's agent over the A2A protocol, identity is verified via ERC-8004, and accepted deals settle instantly as HBAR micropayments on Hedera testnet via x402 — with no human approving any individual transaction.

Built for **ETHGlobal Lisbon 2026**, Hedera track (*AI & Agentic Payments on Hedera*).

---

## The idea

The web2 data-broker model collects your data, sells it to third parties, and returns nothing to you. This project inverts it:

- **You keep the data.** Raw records never leave an encrypted local store. Buyers receive cohort *aggregates*, computed in memory and discarded.
- **You set the rules once, in your own words.** "Sell my running and cycling data, minimum 0.4 HBAR, never my heart rate." An LLM turns that into a policy object the agent applies to every offer.
- **Both sides are agents.** A research company's agent discovers yours, opens a negotiation, and pays — no human approves any individual transaction on either side. The buyer even haggles on its own: a price refusal discloses the owner's floor, and the buyer counters exactly there if its budget reaches — or walks away when the refusal is about *what* is asked rather than what it costs.
- **The money comes to you.** Payment settles directly to the data owner's Hedera account.

Because nobody is watching each deal, trust has to be structural: the buyer proves who it is on-chain, the payment settles before data is released, and every completed exchange leaves a public record anyone can check.

---

## Architecture

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  Owner types a policy in plain language, once                    │
  │  "running and cycling, min 0.4 ℏ, never my heart rate"           │
  └───────────────────────────────┬─────────────────────────────────┘
                                  │  ChatGroq → { allowedCategories, minPrice, allowedDataTypes }
                                  ▼
  ┌──────────────────────┐   A2A JSON-RPC    ┌──────────────────────┐
  │  SELLER AGENT        │◄──────────────────│  BUYER AGENT         │
  │  (the owner's)       │   offer / reply   │  (research company)  │
  │  agentId 103         │──────────────────►│  agentId 104         │
  └──────────┬───────────┘                   └──────────┬───────────┘
             │                                          │
   ┌─────────┴──────────┐                               │
   │ Gate 1  identity   │──► ERC-8004 IdentityRegistry  │
   │ Gate 2  policy     │                               │
   │ Gate 3  cohort ≥ 3 │                               │
   └─────────┬──────────┘                               │
             │ accept → { url, price, asset, network }  │
             └─────────────────────────────────────────►│
                                                        │ signs a real transfer
  ┌──────────────────────┐        402 → 200             │
  │  x402 DATA ENDPOINT  │◄─────────────────────────────┘
  │  /data/cohort-insight│  payment settles on Hedera
  └──────────┬───────────┘
             │ aggregate only: { participantCount, avgSessionCount, avgPerformanceScore, trend }
             ▼
  ┌──────────────────────┐     ┌────────────────────────────────────┐
  │ Encrypted SQLite     │     │ After settlement, in order:        │
  │ AES-256-GCM per field│     │  1. HCS audit entry (public proof) │
  │ raw data never sent  │     │  2. ERC-8004 reputation feedback   │
  └──────────────────────┘     │  3. local ledger → "completed"     │
                               └────────────────────────────────────┘
```

**What goes on-chain:** the payment, the agent identities, the reputation feedback, and a proof-of-event message. **What never does:** a single user's record.

---

## Where each Hedera component is used

| Component | Where | What it actually does |
|---|---|---|
| **Hedera SDK** (`@hiero-ledger/sdk`) | `src/hedera/clients.ts` | Seller and buyer operate from two separate testnet accounts, so every payment is a real transfer between distinct parties. |
| **Hedera Agent Kit** | `src/hedera/agentkit.ts` | `HederaLangchainToolkit` in `AgentMode.AUTONOMOUS` — the agent signs and submits with the operator key instead of returning bytes for a human to approve. `allCorePlugins` exposes 43 tools; the agent picks the one it needs. |
| **HCS** (Consensus Service) | `src/hedera/audit.ts`, `HcsAuditTrailHook` | Every completed exchange is written to a single audit topic as JSON. The Agent Kit's own hook also logs tool executions to the same topic, so the trail covers both what the agent *did* and what it *sold*. |
| **x402** | `src/x402/server.ts`, `src/x402/pay.ts` | The data endpoint is payment-gated: an unpaid `GET` returns **402** with the terms in a header; the buyer agent signs a Hedera transfer and retries; the same request then returns the data. A request must also name the negotiation that authorised it, so the endpoint cannot be used to buy around the policy. Facilitator: blocky402. Asset: native HBAR (`0.0.0`). |
| **HTS** (Token Service) | `src/hedera/receipt.ts` | After every completed sale, one NFT from the "Data Access Receipt" collection is minted **to the account that paid** (read from the x402 settlement, not from config). Its on-chain metadata — capped by Hedera at 100 bytes, hence a truncated hash — references the negotiation id, the HCS audit entry and the compliance attestation, so the buyer holds one token linking all three proofs. The seller is treasury and sole supply key: only the data owner's agent can issue receipts. |
| **A2A** (`@a2a-js/sdk`) | `src/a2a/` | The seller publishes an AgentCard at `/.well-known/agent-card.json`; the buyer discovers the endpoint from it and negotiates over JSON-RPC. Each negotiation is a real A2A **Task** with a lifecycle: a policy decline leaves it `input-required` (an open invitation to counter-offer), acceptance closes it `completed`, an unverified buyer gets `failed`. A counter-offer lands in the **same task** and the seller's reply acknowledges the round — "last round you offered 0.1 ℏ and I declined". A completed task cannot be reopened; the protocol itself refuses. |
| **ERC-8004** | `src/erc8004/` | Identity: both agents hold registry NFTs whose `tokenURI` is their registration file. Reputation: after each sale the seller publishes feedback citing the payment transaction, so the rating is checkable rather than asserted. Compliance: attested per negotiation — recorded on HCS rather than the ValidationRegistry, for the reason below. |

**Deployed contracts used (Hedera Testnet, not ours):**
- IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`

### Which ERC-8004 registries we use, and why one is missing

The Identity and Reputation registries are used through **real on-chain calls** to the deployed ERC-8004 contracts above — `register`, `getAgentWallet`, `tokenURI`, `giveFeedback`, `getSummary`.

The **ValidationRegistry is not used, because it does not exist to be used.** The official ERC-8004 deployment list covers only the Identity and Reputation registries across every chain it targets, Hedera Testnet included; the validation section of the spec is still under active revision with the TEE community, and there is **no live deployment on any chain**. The interface is in `src/erc8004/abis/ValidationRegistry.json` for the day that changes, but it has no bytecode and no address behind it.

So the compliance attestation is recorded on **Hedera Consensus Service** instead (`src/erc8004/validation.ts`). One `validation_request` / `validation_response` pair is written per negotiation, deliberately using the registry's own vocabulary — `validatorAddress`, `agentId`, `requestURI`, `requestHash`, `response`, `responseURI`, `responseHash`, `tag` — so the record is a faithful stand-in and adopting the real registry later is a change of substrate, not a redesign. Both verdicts are written: a refused agent's score of 0 is on the topic just as publicly as an approved agent's 100.

**The validator is the seller itself.** There is no independent auditor — that is out of scope for a hackathon — so an attestation here proves *that the check ran and what it decided*, and is retrievable by anyone through the mirror node. It is **not** third-party verification, and nothing in this project should be read as claiming otherwise.

---

## The three gates

An offer is only accepted if it passes all three, in order. Each can only narrow the outcome.

1. **Identity** — `getAgentWallet(agentId)` on the IdentityRegistry, then the registration file is decoded and checked for `active: true`, then a compliance attestation is written to Hedera and the verdict decides. Being registered is not the same as being approved: the seller's own agent 103 is registered, active — and refused with a score-0 attestation anyone can read back.
2. **Policy** — three checks, each refusing with its own reason: the category must be permitted, every requested **data type** must be in the owner's `allowedDataTypes`, and the price must meet the minimum. Data types come in two buckets — *performance* (scores, session counts, distance, …) and *health* (`cycleTracking`, `medicationCount`) — and a buyer asking for health data against a policy that forbids it is told exactly that: *"that is health data, and the owner's policy does not permit selling any health data. This is not a matter of price."* An offer of 1000 HBAR changes neither answer; money does not override the policy. An offer naming no types is asking for the standard aggregate, which exposes `performanceScore` + `sessionCount` — so a policy narrower than that pair correctly refuses default offers too.
3. **Cohort size** — a cohort below `MIN_COHORT_SIZE` (3) is refused. An "average" over one person is that person's record with a different label.

A refusal costs the buyer nothing — no payment is ever signed. It is not silent, though: any agent that reaches gate 1 gets a compliance attestation written to Hedera whichever way the verdict goes, and a policy refusal is recorded in the owner's own ledger. What a refusal never produces is a charge, a sale record, or a reputation rating.

**The gates are not bypassable by paying directly.** They would be decorative if the endpoint served anyone holding the price, so a paid request has to name the negotiation that authorised it: the id must belong to an acceptance that is still open, and the criteria must be exactly the ones agreed. A request for a forbidden category, or one with no negotiation behind it, is refused with **403** *before* the payment layer — it is never even quoted a price. And because an acceptance closes once it settles, the same negotiation cannot be paid twice to collect a second audit entry and a second reputation rating.

---

## Setup

Requires **Node 22+** (developed on 24) and two Hedera testnet accounts.

```bash
git clone <this repo> && cd ETHGlobal-Lisbon
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to get it |
|---|---|
| `SELLER_ACCOUNT_ID` / `SELLER_PRIVATE_KEY` | [portal.hedera.com](https://portal.hedera.com/dashboard) — **ECDSA** account |
| `BUYER_ACCOUNT_ID` / `BUYER_PRIVATE_KEY` | a second ECDSA account |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) — free, no card |
| `X402_FACILITATOR_URL` | `https://api.testnet.blocky402.com` |
| `X402_PAY_TO_ACCOUNT` | same as `SELLER_ACCOUNT_ID` |
| `DATA_ENCRYPTION_KEY` | any passphrase; it never leaves your machine |
| `ERC8004_*` | already filled in — fixed addresses |
| `HCS_AUDIT_TOPIC_ID` / `HTS_RECEIPT_TOKEN_ID` | printed by the two create-scripts below |

Then, in order:

```bash
npx tsx scripts/check-balance.ts        # confirm both accounts are funded
npx tsx scripts/create-audit-topic.ts   # → paste HCS_AUDIT_TOPIC_ID into .env
npx tsx scripts/create-receipt-token.ts # → paste HTS_RECEIPT_TOKEN_ID into .env (also associates the buyer)
npx tsx scripts/register-agents.ts      # mints both ERC-8004 identities → agent-ids.json
npx tsx scripts/seed-data.ts            # 12 encrypted fitness records
npm run dev                             # → http://localhost:4100
```

> `create-audit-topic.ts` and `register-agents.ts` are **not idempotent** — each run creates new on-chain objects. They refuse to run twice unless `FORCE=1`.

Run the demo with **`npm run dev`**, not three separate terminals: the policy lives in the seller agent's memory, so the panel has to be in the same process to change what the agent does.

---

## Verifying it end to end

```bash
npm test               # = test:e2e — needs a funded account, so it costs 0.5 ℏ
npm run test:e2e       # full flow, both an accepted and a refused offer  (costs 0.5 ℏ)
npm run test:errors    # network failure, timeout, insufficient balance, bad agent ids  (HCS fees only)
npm run test:validation # compliance attestations land on Hedera and read back  (HCS fees only)
npm run test:receipt   # receipt NFT lands in the buyer's account, replay mints nothing  (costs 0.5 ℏ)
npm run test:rounds    # multi-round: manual counter-offer + the buyer's autonomous strategy  (costs 1 ℏ)
npm run test:binding   # the endpoint serves only what was negotiated, once  (costs 0.5 ℏ)
npm run verify:phase7  # runs the full flow twice, then every failure mode  (costs 1 ℏ)
```

`verify:phase7` is the checkpoint that a single passing run cannot substitute for: it runs the whole end-to-end suite **twice** and confirms independently — from the mirror node, the ReputationRegistry and the ledger — that the completed-sale count, the HCS sequence and the feedback count each go up by exactly one per run. A counter that stays flat fails, because it would mean the second sale overwrote the first instead of being appended.

`test:e2e` asserts on real state: the payment settles, the HCS topic sequence increases by one, the reputation count increases by one, and the ledger row becomes `completed` — while the refused offer leaves **no** payment, **no** HCS entry, **no** feedback and **no** ledger row.

Individual pieces:

| Script | Checks |
|---|---|
| `scripts/test-transfer.ts` | plain HBAR transfer between the two accounts |
| `scripts/test-audit-log.ts` | an HCS message lands on the topic |
| `scripts/test-agent-kit.ts` | the agent answers a balance question by calling a tool |
| `scripts/x402-buy.ts` | the 402 → sign → 200 round trip on its own (records its own acceptance first, since the endpoint refuses un-negotiated requests) |
| `scripts/test-negotiation.ts` | A2A negotiation, accept and reject |

---

## Ports

| Port | Service |
|---|---|
| 4000 | Seller agent (A2A JSON-RPC + agent card) |
| 4021 | x402-protected data endpoint |
| 4100 | Demo panel |

---

## Repo layout

```
src/hedera/      Hedera clients, Agent Kit toolkit, HCS audit helper
src/x402/        payment-gated data server, buyer-side payment, shared config
src/a2a/         agent card, seller executor (the three gates), server, buyer client
src/erc8004/     registry connections, registration files, identity check, feedback
src/data/        encrypted SQLite store, cohort aggregation
src/policy/      natural-language → policy object
src/web/         demo panel (single-file, no build step)
scripts/         setup and verification scripts
```

---

## Requirement coverage

What is genuinely wired up, what stands in for something, and the command that proves each claim. Rows marked **stand-in** are not doing what their name suggests — read the note.

| Requirement | Status | Where | Proof |
|---|---|---|---|
| Autonomous agent-to-agent negotiation (A2A) | real | `src/a2a/` | `scripts/test-negotiation.ts` |
| Multi-round negotiation with Task lifecycle | real | `publishReply` + `counterOffer` | `npm run test:rounds` — decline → counter → accept in one task |
| Autonomous buyer strategy (counter within budget, walk otherwise) | real, rule-based — no model call | `negotiateWithStrategy` in `src/a2a/buyer-client.ts` | `npm run test:rounds` — counters a price refusal at the stated floor; walks away from a category refusal even with 10× the budget |
| No human approves any individual payment | real | `src/a2a/buyer-client.ts` → `src/x402/pay.ts` | `npm run test:e2e` |
| x402 payment-gated resource on Hedera | real, 402 → sign → 200 | `src/x402/server.ts` | `npm run test:e2e`, `scripts/x402-buy.ts` |
| Native HBAR micropayment, settled on testnet | real | facilitator blocky402, asset `0.0.0` | HashScan tx in every run |
| Policy enforced at the point of payment | real | `requireAcceptedNegotiation` | `npm run test:binding` |
| Hedera Agent Kit, `AgentMode.AUTONOMOUS` | real | `src/hedera/agentkit.ts` | `scripts/test-agent-kit.ts` |
| HTS receipt NFT per sale, to the payer | real | `src/hedera/receipt.ts` | `npm run test:receipt` (mirror node confirms the buyer holds it; replay mints nothing) |
| HCS audit trail | real | `src/hedera/audit.ts` | panel's audit view, read from the mirror node |
| ERC-8004 IdentityRegistry | real on-chain calls | `src/erc8004/contracts.ts` | agent ids 103/104, `scripts/register-agents.ts` |
| ERC-8004 ReputationRegistry | real on-chain calls | `src/erc8004/feedback.ts` | `npm run verify:phase7` (count increases per sale) |
| ERC-8004 ValidationRegistry | **not used — no deployment exists** | — | see the ERC-8004 section above |
| Compliance attestation | real record, **stand-in substrate**: HCS, not the ValidationRegistry | `src/erc8004/validation.ts` | `npm run test:validation` |
| Independent third-party validator | **stand-in**: the seller self-attests | — | stated plainly above; out of scope |
| Natural-language policy, set once | real | `src/policy/parser.ts` | panel policy form |
| Data-type taxonomy (performance / health) enforced at the gate | real | `evaluateOffer` in `src/a2a/seller-executor.ts` | `npm run test:e2e` scenario 3 — a health request is refused by name |
| Raw data never leaves the owner's store | real | `src/data/` (AES-256-GCM, min cohort 3) | `npm run test:e2e` asserts no raw fields in the payload |
| Repeatability under load | verified twice over | — | `npm run verify:phase7` (24/24) |

Two rows are deliberately not green, and both are named rather than buried: there is no ValidationRegistry to call, and the validator is not independent.

## Notes and limits

- Everything runs on **Hedera testnet**. No real funds.
- The compliance attestation is a **real, publicly readable record on Hedera**, but the validator is the seller itself and the decision rule behind it is still the owner's vetted-id list. It is not independent verification, and it is not the ValidationRegistry — which has no deployment on any chain. That remains the one mocked trust component.
- `trend` compares a cohort against the whole population — there is no time series in the data, so it is not change over time.
- The seeded population is synthetic and generated from a fixed seed, so the demo numbers are reproducible.
- The store includes two **clearly synthetic** health-bucket fields (a cycle-tracking flag and a medication count — never conditions or drug names). They exist so the policy gate can refuse a health request against data that actually exists. Health data is sellable **only** under a policy that permits it explicitly, always as a cohort aggregate (a rate and a mean); the demo owner's policy forbids the entire bucket, and the parser maps "never sell health data" to exactly that.
- The endpoint price is fixed at 0.5 ℏ while the policy minimum is a floor — an accepted offer below the endpoint price would be quoted the endpoint's price, and the buyer's own guard refuses to overpay.
- The receipt NFT goes to whichever account settled the payment, but a recipient must have **associated** with the collection first — `create-receipt-token.ts` associates the demo buyer; any additional buyer would need its own association before it could receive receipts. Sales from before the collection existed show `—` in the panel's Receipt column.

## License

Apache-2.0
