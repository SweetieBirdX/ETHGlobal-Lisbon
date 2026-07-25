# PIVOT PLAN — Music Rights Marketplace, No-EVM

**Decision (session 48):** health/fitness data → **music licensing**. ERC-8004 → **HCS-14**.
Target: **two bounties at once** — AI & Agentic Payments ($6k) + No Solidity ($3k).
Budget: ~12 hours, 2 people.

---

## 1. Why this pivot is cheap — ~70% of the infrastructure does not change

The mentors are right: the infrastructure is the asset, the idea is portable. Concretely,
these files are **not touched at all**:

- `src/a2a/` — A2A protocol, AgentCard discovery, **multi-round negotiation**, Task lifecycle,
  the buyer's autonomous counter-offer strategy
- `src/x402/` — the 402 → sign → 200 flow, payment-to-negotiation binding, idempotency
- `src/hedera/audit.ts`, `mirror.ts`, `clients.ts` — HCS writes, mirror-node reads
- `src/policy/parser.ts` — natural language → policy via LLM (only the vocabulary changes)

**Exactly two things change:** *what is being sold* (cohort statistic → licence grant) and
*who issues identity* (ERC-8004 → HCS-14).

---

## 2. The new domain model

**What is sold:** a **percentage of a track's licensing capacity**, for a defined use.
Not a transfer of ownership — a **usage right**. Legally clean, easy to narrate.

```
Track   { id, title, artist, totalShares = 10000 (basis points),
          availableShares, basePricePerShare, encryptedMasterRef }
Licence { id, trackId, buyerUaid, shares, licenceType, territory,
          priceHbar, status, txHash, certificateSerial }
```

**The three gates — same structure, new meaning:**

| Gate | Old (data) | New (music) |
|---|---|---|
| 1. Identity | ERC-8004 registry | **HCS-14 UAID** + HCS profile |
| 2. Policy | category / dataType / price | **licence type / share cap / price / forbidden uses** |
| 3. Availability | cohort ≥ 3 | **requested shares ≤ remaining shares** |

**Example policy sentence (the LLM parses this):**
> "Sell sync licences for my tracks, at least 0.05 HBAR per share, never more than 50% in
> total, and never for political advertising."

**On-camera refusals (all work with the existing mechanism):**
- Political-ad request → policy refusal (the exact analogue of the old health-data refusal)
- 60% requested but only 40% left → availability refusal
- Lowball → **multi-round negotiation**, the buyer agent reads the floor and raises on its
  own ✅ *already working, no changes needed*

**The HTS NFT is no longer a side-receipt — it is THE product:** the licence certificate.
Metadata (100-byte cap, pattern already solved): `{"t":3,"sh":500,"l":"sync","hcs":44}`

---

## 3. HCS-14 identity design (spec verified)

Confirmed from the spec:
- Format: `did:uaid:{id};{parameters}` — e.g.
  `did:uaid:z6Mkh...;proto=hcs-10;nativeId=hedera:testnet:0.0.123456;uid=0`
- UAID **computes no new hash**; the id is the sanitised method-specific part of an existing W3C DID
- **No mandatory registry topic**, no central authority
- Resolution returns a DID Document

**Our implementation:**
1. Derive a UAID per agent with `nativeId=hedera:testnet:{accountId}` — the Hedera account is
   part of the identity
2. Publish the agent profile (DID-Document-like) to **our own HCS registry topic** — the spec
   does not mandate a registry, we use one so identity is independently verifiable
3. Verification = read the profile back through the mirror node, check it is active
4. Reputation = an HCS message (the existing `validation.ts` pattern applies directly)

Honest sentence for the README: *"HCS-14 UAIDs, with profiles published to an HCS registry
topic — the standard does not mandate a registry; we use one so identity can be verified
independently."*

---

## 4. WORK SPLIT — conflict-free file ownership

> **Golden rule: nobody edits somebody else's file.** There is exactly one shared touch point
> (`seller-executor.ts`) and it has a single owner: **A**.

### Person A — Identity + Integration
**Owns:**
- `src/identity/uaid.ts` *(new)* — UAID derivation, profile document
- `src/identity/registry.ts` *(new)* — publish profile to HCS / resolve from mirror node
- `src/identity/reputation.ts` *(new)* — HCS port of `feedback.ts`
- `src/identity/attestation.ts` — **moved** from `erc8004/validation.ts` (already HCS, code unchanged)
- `scripts/register-agents-hcs.ts` *(new)*
- **`src/a2a/seller-executor.ts`** ← sole owner of the integration point
- **LAST STEP:** delete `src/erc8004/`, drop the `ethers` dependency

### Person B — Music domain
**Owns:**
- `src/data/db.ts` — schema: `tracks` + `licences`
- `src/data/catalog.ts` *(new, replaces `aggregate.ts`)* — availability + price calculation
- `scripts/seed-catalog.ts` *(new)*
- `src/policy/parser.ts` — licensing vocabulary
- `src/hedera/receipt.ts` → licence-certificate metadata
- `src/web/index.html` + `src/web/api.ts` — panel copy
- **never touches `seller-executor.ts`**

### First 20 minutes: write the contract together
Freeze these signatures and everything else runs in parallel:

```ts
// B delivers, A calls:
export function evaluateOffer(offer: LicenceOffer, policy: LicencePolicy): NegotiationResult
export async function checkAvailability(trackId: number, shares: number): Promise<AvailabilityResult>

// A delivers and consumes:
export async function verifyBuyerIdentity(uaid: string): Promise<IdentityCheck>
```

After agreeing, **both commit empty stubs** so imports compile and neither person is blocked.

---

## 5. Timeline

| Hour | Person A | Person B |
|---|---|---|
| 0:00–0:20 | **Together:** contract + stubs | |
| 0:20–4:00 | UAID + registry + reputation | schema + catalog + seed + policy |
| 4:00–4:30 | **🎥 CHECKPOINT: fallback video** — film whatever works right now | |
| 4:30–6:30 | seller-executor integration | receipt → certificate, panel copy |
| 6:30–8:00 | delete erc8004, drop ethers | get `test:e2e` + `test:rounds` green |
| 8:00–9:30 | README (aimed at both bounties) | update demo script |
| 9:30–11:00 | **Together: the real video** | |
| 11:00–12:00 | Submit to both bounties | |

**The 4:30 checkpoint is not negotiable.** Film whatever is working at that moment. Going
past the halfway mark with no submittable recording is the only true disaster scenario in a
12-hour budget.

---

## 6. Deliberately CUT

Time pressure is real. Do **not** start these:
- HTS custom fees / royalty schedules — nice, but optional points and non-trivial risk
- Scheduled Transactions — same
- UCP discovery — same
- `test:binding`, `test:validation`, `test:receipt`, `verify:phase7` — these will break during
  the pivot. **Keep only `test:e2e` + `test:rounds` green** (the money path + negotiation).
  Fix the rest after submission; record the debt in PLAN.md.
- Encryption: keep the `encryptedMasterRef` field (cheap win for No Solidity's "thoughtful
  security" point), but catalogue metadata can be plaintext.

---

## 7. Bounty compliance check

**No Solidity:** ✅ ethers gone, Hedera SDK only · ✅ HTS + HCS + Mirror Node (the "two native
services" bar, exceeded) · ✅ public repo · ⚠️ video
> ⚠️ The brief says `@hashgraph/sdk`; we use `@hiero-ledger/sdk` (the same SDK after its move
> to the Linux Foundation). **Explain this in one sentence in the README.**

**AI & Agentic:** ✅ multi-agent, real payments · ✅ x402 + A2A + Agent Kit + SDK · ✅ HCS-14
identity (replacing ERC-8004 — the criterion explicitly accepts it) · ✅ HCS audit trail ·
✅ HTS token creation · ⚠️ video

---

## 8. Risks, stated honestly

1. **The video is still unfilmed** — the only hard blocker for either bounty. The 4:30
   checkpoint is the insurance policy.
2. **12 hours is aggressive.** The domain pivot alone is comfortable; the identity migration
   alone is comfortable; both plus a video is tight. Stick to the cut list (§6).
3. **Test debt.** 4 of 6 suites will be temporarily broken. That is a deliberate trade — but
   write it into PLAN.md so the next session knows.
4. **HCS-14 is Draft status** (Sept 2025). State plainly in the README which subset you
   implement; do not claim full conformance.
