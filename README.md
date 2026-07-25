# Your music, your terms

**A music rights marketplace where two AI agents negotiate a licence and settle it themselves — on Hedera, with no Solidity anywhere.**

A musician writes one sentence: *"Sell sync licences for my tracks, at least 0.05 HBAR per share, never more than 50% in total, and never for political advertising."* From then on their agent handles the business. When a film studio's agent wants 5% of a track, the two agents negotiate over A2A: the seller verifies who it is dealing with against an HCS identity registry, checks the offer against the musician's own words, checks the track still has that much capacity left, and — if all three pass — hands back an x402 payment instruction. The buyer's agent pays a real HBAR micropayment, receives the licence grant with the master reference decrypted, and walks away holding an HTS certificate NFT that proves it.

**No human approves any individual deal.** The musician set the terms once; everything after that is two agents and a ledger.

The refusals matter as much as the sales. Ask for a political-ad licence and the agent turns down the money on the artist's behalf, by name — *"You asked to use this track in political advertising. The rights holder's policy forbids that use. This is not a matter of price."*

Built at **ETHGlobal Lisbon 2026**.

---

## What this targets

| Bounty | What we bring |
|---|---|
| **AI & Agentic Payments on Hedera** | Two autonomous agents, real A2A protocol, real x402 micropayments on testnet, HCS-14 agent identity, HCS audit trail, HTS certificates, and a buyer that **haggles by itself** — counters at the seller's disclosed floor, walks away when money is not the problem |
| **No Solidity** | **Zero Solidity, zero contract calls.** Hedera-native services only: HCS (consensus), HTS (tokens), Mirror Node (reads). The identity layer that would normally be an ERC-8004 contract is HCS-14 on a consensus topic instead |

Requirement-by-requirement, with the command that proves each row — including what we deliberately did **not** build — is in [`docs/bounty-coverage.md`](docs/bounty-coverage.md). The five-minute demo is scripted in [`docs/demo-script.md`](docs/demo-script.md).

### The No-Solidity claim, and how to check it

There is no `.sol` file, no EVM contract deployment, no contract call, and no `ethers` in our dependency list. Run this over the whole codebase:

```bash
grep -rniE "solidity|\bethers\b|Contract(Execute|Call|Create)Transaction|ContractCallQuery|ContractFunctionParameters|\.sol\b" src scripts --include=*.ts --include=*.html
# exits 1 — no matches across all 41 source files
```

This project began on ERC-8004 (Solidity registries on Hedera's EVM) and the entire EVM layer was **deleted**, not merely bypassed — see `git log` for `refactor: remove the ERC-8004 and EVM layer entirely`. `ethers` still exists transitively *inside* the Hedera SDK's own dependency tree; it is gone from ours, and nothing we wrote imports it.

> **On `@hiero-ledger/sdk`:** the No-Solidity brief names `@hashgraph/sdk`. `@hiero-ledger/sdk` **is that same SDK**, renamed after Hedera donated it to the Linux Foundation's Hiero project — same maintainers, same API, same transactions. We are on the current package name, not a different SDK.

---

## Architecture

```
   Rights holder                                          Film studio / buyer
   (one sentence, once)                                   (its own agent)
        │                                                        │
        ▼                                                        │
  ┌─────────────────────────────┐                                │
  │  Policy parser (Groq LLM)   │                                │
  │  plain language → rules     │                                │
  └──────────────┬──────────────┘                                │
                 ▼                                               ▼
  ┌──────────────────────────────┐    A2A protocol     ┌────────────────────┐
  │      SELLER AGENT            │◄───────────────────►│    BUYER AGENT     │
  │      (A2A server :4000)      │  offer / counter /  │  autonomous        │
  │                              │  accept / refuse    │  haggle strategy   │
  │  ┌────────────────────────┐  │   (multi-round)     └─────────┬──────────┘
  │  │ GATE 1  identity       │──┼──► HCS-14 UAID +              │
  │  │ GATE 2  policy         │  │    registry topic             │
  │  │ GATE 3  availability   │  │                               │
  │  └───────────┬────────────┘  │                               │
  └──────────────┼───────────────┘                               │
                 │ accept → payment instruction                  │
                 ▼                                               │
  ┌──────────────────────────────┐      HTTP 402                 │
  │   x402 LICENCE ENDPOINT      │◄──────────────────────────────┘
  │   (:4021, priced per licence)│      sign & retry
  │   binding gate: terms must   │──────────────────────────────►│
  │   match the negotiated row   │      HTTP 200 + grant         │
  └──────────────┬───────────────┘                               │
                 │                                               ▼
                 │ post-payment chain                  ┌────────────────────┐
                 ├──► HCS   audit entry                │  Licence grant     │
                 ├──► HCS   reputation feedback        │  + master ref      │
                 ├──► DB    reserve shares             │  + certificate NFT │
                 └──► HTS   mint certificate → buyer   └────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────┐
  │  Encrypted catalogue (SQLite, AES-256-GCM)                           │
  │  Master references NEVER leave in plaintext until a licence is paid  │
  └──────────────────────────────────────────────────────────────────────┘
```

**What goes on-chain:** the payment, the agent identities and their profiles, the compliance attestation, the audit entry, the reputation feedback, and the licence certificate. **What never does:** the master recording reference, which stays AES-256-GCM encrypted in the rights holder's own store and is decrypted in memory only, on the way into a paid response.

---

## The three gates

Every offer passes through three checks, in order. Each one can only ever *narrow* what happens next, and each refusal says why in a sentence a person can read.

| # | Gate | Question | Refusal codes |
|---|---|---|---|
| **1** | **Identity** | Is this buyer who it says it is? Four checks against the HCS identity registry: the UAID parses, the registry holds a profile, that profile is active, and a compliance attestation scores 100. Each fails closed — *"the registry says no"* and *"the registry is unreachable"* are deliberately different answers, so an outage can never masquerade as a verdict. | `identity_unverified` |
| **2** | **Policy** | Does the rights holder's own sentence permit this deal? Licence type, forbidden use, share cap, price floor. | `offer_incomplete`, `licence_type_not_permitted`, `use_case_forbidden`, `share_cap_exceeded`, `price_too_low` |
| **3** | **Availability** | Does the track still have that many shares to give? Checked **before** any payment instruction is issued, so nobody pays for a licence the catalogue could not grant. | `insufficient_shares`, `unknown_track` |

A fourth gate sits at the money: the x402 endpoint refuses any request that no negotiation authorised — a missing or unknown `licenceId`, terms that differ from the accepted row in *either* direction, or an acceptance that has already been settled. Without it the three gates above would be decorative, because the endpoint would sell to anyone holding the price.

**Only a price refusal discloses the floor.** A licence-type or use-case refusal says *"this is not a matter of price"* and reveals nothing further — so an agent cannot map the catalogue by probing with bids.

---

## What each Hedera piece actually does

| Service | Where | What it does here |
|---|---|---|
| **HCS — consensus** | `src/hedera/audit.ts` | Every completed licence writes a public, tamper-evident entry: buyer UAID, track, shares, licence type, use case, price, payment transaction |
| **HCS — identity registry** | `src/identity/registry.ts`, `profile.ts` | Agent profiles (DID-Document-shaped) published to a topic; gate 1 resolves them back through the mirror node |
| **HCS — attestation** | `src/identity/attestation.ts` | A `validation_request` / `validation_response` pair per negotiation, using the ERC-8004 ValidationRegistry's own field names on a consensus topic instead of a contract |
| **HCS — reputation** | `src/identity/reputation.ts` | After a settled payment, feedback about the buyer, citing the transaction so the claim is checkable |
| **HTS — tokens** | `src/hedera/certificate.ts` | The licence certificate NFT — **the product's on-chain half**, minted to whoever actually paid. Metadata `{"t":1,"sh":500,"l":"sync","hcs":376}` (36 bytes of a 100-byte cap) |
| **Mirror Node** | `src/hedera/mirror.ts`, `src/web/api.ts` | Every read: identity resolution, the audit panel, test assertions. The panel shows what Hedera recorded, not what the app believes happened |
| **x402** | `src/x402/server.ts`, `pay.ts` | 402 → sign → 200. Priced **per licence** (`shares × the track's per-share rate`), never a flat route price |
| **A2A** | `src/a2a/` | AgentCard discovery, real Task lifecycle, multi-round negotiation — a declined offer leaves the task `input-required`, so a counter-offer lands in the *same* conversation |
| **Hedera Agent Kit** | `src/hedera/agentkit.ts` | `AgentMode.AUTONOMOUS` toolkit with the HCS audit-trail hook |

---

## Setup

In dependency order — each step produces something the next one needs.

**1. Install and configure**

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Where it comes from |
|---|---|
| `SELLER_ACCOUNT_ID` / `SELLER_PRIVATE_KEY` | [portal.hedera.com](https://portal.hedera.com/dashboard) — testnet account, **ECDSA** |
| `BUYER_ACCOUNT_ID` / `BUYER_PRIVATE_KEY` | A **second** testnet account — the two agents must be genuinely separate parties |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) — free, no card |
| `X402_FACILITATOR_URL` | `https://api.testnet.blocky402.com` — no signup |
| `X402_PAY_TO_ACCOUNT` | Same as `SELLER_ACCOUNT_ID` |
| `DATA_ENCRYPTION_KEY` | Any passphrase; it never leaves your machine |

**2. Confirm the network is reachable**

```bash
npx tsx scripts/check-balance.ts
```

**3. Create the on-chain resources** — each prints a line to paste into `.env`

```bash
npx tsx scripts/create-audit-topic.ts       # → HCS_AUDIT_TOPIC_ID
npx tsx scripts/create-identity-topic.ts    # → HCS_IDENTITY_TOPIC_ID
npx tsx scripts/create-licence-token.ts     # → HTS_LICENCE_TOKEN_ID (and associates the buyer)
```

**4. Register the agent identities** — needs the identity topic from step 3

```bash
npx tsx scripts/register-agents-hcs.ts      # → agent-uaids.json
```

**5. Seed the catalogue** — needs `DATA_ENCRYPTION_KEY` from step 1

```bash
npx tsx scripts/seed-catalog.ts             # → catalogue.db, 7 fictional tracks
```

**6. Run it**

```bash
npm run dev                                 # panel at http://localhost:4100
```

> Run the demo with `npm run dev`, **not** three separate terminals. The policy you save in the panel lives in the seller agent's memory, so the panel and the agent have to be the same process for a saved policy to actually change what the agent does.

### Ports

| Port | What |
|---|---|
| `4000` | Seller agent — A2A server, serves `/.well-known/agent-card.json` |
| `4021` | x402 licence endpoint — `GET /licence/grant` (paid), `GET /catalog` (free) |
| `4100` | Demo panel |

---

## Verifying it

```bash
npm run test:catalog     # availability, pricing, grants, policy parsing — 25 checks, buys nothing
npm run test:errors      # failure modes: bad ids, unreachable endpoints, empty policy — 18 checks
npm run test:identity    # the four identity checks against the live registry — 33 checks, HCS fees only
npm run test:e2e         # full negotiation → payment → grant → chain — 22 checks, spends real HBAR
npm run test:rounds      # multi-round haggle in one A2A task — 22 checks, spends real HBAR
```

All five counts were confirmed by running the suites. `test:e2e` and `test:rounds` make real testnet payments and append real HCS entries, so they are neither free nor idempotent — that is rather the point of them; each also takes shares out of a track's capacity permanently. `test:identity` writes real attestations (HCS fees, fractions of a cent) but buys nothing; `test:catalog` and `test:errors` spend nothing at all.

The most convincing check is the panel's fourth pane: it lists the audit trail pulled from the **mirror node**, the same source HashScan renders. Every entry can be verified independently of anything this app claims.

---

## Repo layout

```
src/a2a/          seller agent card, executor (the three gates), A2A server, buyer client + haggle strategy
src/identity/     HCS-14 UAIDs, agent profiles, registry publish/resolve, attestation, reputation, gate 1
src/data/         encrypted catalogue (db.ts), availability + pricing + licence grants (catalog.ts)
src/policy/       plain language → LicencePolicy, via Groq
src/hedera/       clients, HCS audit log, mirror-node reads, HTS certificates, Agent Kit toolkit
src/x402/         paid licence endpoint, payment binding gate, buyer-side payment
src/web/          demo panel (API + single-page UI)
src/types/        the marketplace contract both halves compile against
scripts/          one-time setup, seeding, and the test suites
```

---

## Honest limits

Stated plainly, because a judge who knows these standards will ask.

- **HCS-14 conformance is partial, and here is the exact subset.** We implement the UAID **format** (`did:uaid:{id};proto=…;nativeId=hedera:testnet:{account};uid=…`), the **id sanitisation rule** (everything from the first `;`, `?` or `#` onwards is stripped), the `nativeId` binding to a real Hedera account, and parse/serialise round-tripping. What we do **not** do: HCS-14 says the id segment is the sanitised method-specific identifier of an **existing W3C DID**, and that the standard computes no new hash. Our agents have no pre-existing `did:key`, so we derive the id from `sha256("hedera:testnet:" + accountId)` in base64url. It is deterministic and collision-free for our purposes, but it is **self-derived, not carried over from another DID method** — so this is HCS-14-shaped, not HCS-14-conformant. HCS-14 is itself still a Draft (Sept 2025).
- **The registry topic is our choice, not the standard's.** HCS-14 mandates no registry. We publish agent profiles to one anyway, so identity can be checked by a third party through the mirror node rather than taken on our word.
- **The compliance attestation is self-issued.** The seller attests the buyer against its own allow-list and writes the result to a consensus topic. That is a real, public, tamper-evident record — but it is **not third-party verification**. A production system would read an attestation signed by an independent audit body. We use the ERC-8004 ValidationRegistry's field names so swapping the substrate would be a migration, not a redesign.
- **The ERC-8004 ValidationRegistry has no deployment on any chain** — that spec section is still under revision. It is *why* the attestation lives on HCS: there was no contract to call, on Hedera or anywhere else.
- **The catalogue is fictional.** All seven tracks, all five artists, and every master reference in `scripts/seed-catalog.ts` are invented. No real recording, performer, or release is represented, and the "master references" are fake URLs whose only job is to be something that stays encrypted until a licence is paid for.
- **The buyer's haggle is rule-based, not an LLM.** Three rules: counter only when the refusal is about price, counter at the seller's disclosed floor, treat the budget as a hard wall. It is light strategy, deliberately — there is no model call inside the negotiation loop.
- **Everything runs on Hedera testnet.** No real funds move.
- **The task store is in-memory.** Negotiations do not survive a server restart; a counter-offer to a restarted seller gets "Task not found".
- **A buyer must associate with the certificate collection before it can receive one.** `create-licence-token.ts` associates the demo buyer; any additional buyer would need its own association first, and a sale without a certificate shows `—` in the panel.
- **The policy floor and the track quote are two separate knobs.** The floor comes from the rights holder's sentence (`minPricePerShareHbar × shares`); the price charged is the track's own rate (`quotePrice`). With the shipped defaults a 5% licence has a 0.5 ℏ floor and a 0.41 ℏ quote, so an accepted offer reads "offers 0.5 ℏ … pays 0.41 ℏ". Nothing is mischarged — the buyer always pays the quote, and the panel reports the charged figure — but the two numbers are not the same number, by design.

---

## Demo video

*To be added before submission.*

---

Apache-2.0.
