# Requirement coverage — both bounties

What is genuinely wired up, what stands in for something else, and what is simply not done — with the file that implements it and the command that proves it.

> **On the source of these rows.** We do not have an official ETHGlobal scoring checklist. The requirements below are taken from the two bounty briefs as we read them, plus the component list in `CLAUDE.md`. If the real criteria differ, re-check these rows against them rather than trusting this table.

**Legend** — ✅ done and provable · ⚠️ real but with a stated caveat · ❌ not done

---

## Bounty 1 — No Solidity

| Requirement | Status | Where | Proof |
|---|---|---|---|
| No Solidity anywhere | ✅ | — | `grep -rniE "solidity\|\bethers\b\|Contract(Execute\|Call\|Create)Transaction\|ContractCallQuery\|ContractFunctionParameters\|\.sol\b" src scripts --include=*.ts --include=*.html` → **exits 1**, 41 files scanned |
| No EVM contract calls | ✅ | — | Same grep. The project *started* on ERC-8004 Solidity registries; the whole EVM layer was deleted — `git log --oneline --grep "remove the ERC-8004"` |
| `ethers` not a dependency of ours | ✅ | `package.json` | `node -e "console.log(Object.keys(require('./package.json').dependencies))"` — absent. It remains transitively inside the Hedera SDK's own tree; that is theirs, not ours |
| Hedera SDK | ✅ | `src/hedera/clients.ts` | `@hiero-ledger/sdk` — the same SDK as `@hashgraph/sdk` after Hedera donated it to the Linux Foundation's Hiero project |
| **Two or more native Hedera services** | ✅ **three** | below | HCS + HTS + Mirror Node |
| — HCS (Consensus) | ✅ | `src/hedera/audit.ts`, `src/identity/registry.ts`, `attestation.ts`, `reputation.ts` | `npm run test:identity` (33 checks); the panel's audit pane |
| — HTS (Token Service) | ✅ | `src/hedera/certificate.ts`, `scripts/create-licence-token.ts` | Collection created live; certificate NFTs confirmed in the buyer's account via mirror node |
| — Mirror Node | ✅ | `src/hedera/mirror.ts`, `src/web/api.ts` | Every identity resolution and every audit-panel row is a mirror-node read |
| Thoughtful security | ⚠️ | `src/data/db.ts` | Field-level AES-256-GCM on the master reference, decrypted **in memory only** on a paid response (`src/data/catalog.ts` → `buildLicenceGrant`). Tamper-evident: `npm run test:catalog` alters a ciphertext and the auth tag rejects it. Caveat: scrypt uses a fixed salt and the key comes from `.env`, not a KMS — `encryption_key_ref` is the seam where a real KMS would attach |
| Public repo | ✅ | — | This repository |
| Demo video | ❌ | — | Not yet filmed — see `docs/demo-script.md` |

---

## Bounty 2 — AI & Agentic Payments on Hedera

| Requirement | Status | Where | Proof |
|---|---|---|---|
| Two autonomous agents, not one program | ✅ | `src/a2a/seller-executor.ts`, `buyer-client.ts` | Separate Hedera accounts, separate identities, discovery via AgentCard — the buyer knows only a base URL |
| A2A protocol | ✅ | `src/a2a/` | `@a2a-js/sdk`; card served at `/.well-known/agent-card.json` on `:4000` |
| Real Task lifecycle | ✅ | `publishReply` in `seller-executor.ts` | Accept → `completed`, policy refusal → `input-required` (the task stays open for a counter), identity failure → `failed` |
| Multi-round negotiation | ✅ | `priorRound` + `counterOffer` | A counter-offer lands in the **same task**; the reply opens *"Round 2 of our negotiation — last round you offered…"* |
| Autonomous buyer strategy | ⚠️ rule-based | `negotiateWithStrategy` in `buyer-client.ts` | Three rules, **no model call in the loop**: counter only on a price refusal, counter at the seller's disclosed floor, budget is a hard wall. Sold as light strategy, not AI bargaining |
| x402 payments | ✅ | `src/x402/server.ts`, `pay.ts` | 402 → sign → 200 against the blocky402 testnet facilitator |
| Real HBAR settlement | ✅ | asset `0.0.0` | Every accepted run produces a HashScan transaction |
| **No human approves any payment** | ✅ | `negotiateAndPurchase` | The buyer reads price and endpoint off the acceptance metadata and signs unattended — `npm run test:e2e` |
| Per-licence pricing | ✅ | `licenceQuote` in `x402/server.ts` | The 402 quotes `quotePrice(track, shares)` from the licence row, not a flat route price |
| Payment bound to the negotiation | ✅ | `requireAcceptedLicence` | An unnegotiated or altered request is refused **403 before any price is quoted**; a settled acceptance cannot be replayed |
| Agent identity | ⚠️ partial HCS-14 | `src/identity/uaid.ts`, `registry.ts` | UAID format, sanitisation rule and `nativeId` binding are implemented; the id is **self-derived** rather than carried from an existing W3C DID — see README's limits |
| Reputation | ✅ | `src/identity/reputation.ts` | Feedback written to the identity topic after settlement, citing the payment transaction |
| HCS audit trail | ✅ | `src/hedera/audit.ts` | Panel's audit pane reads it back off the mirror node |
| HTS token creation | ✅ | `scripts/create-licence-token.ts` | "Music Licence Certificate" (MLIC), seller treasury + sole supply key, **no admin key — immutable** |
| Hedera Agent Kit, autonomous mode | ✅ | `src/hedera/agentkit.ts` | `AgentMode.AUTONOMOUS` + HCS audit-trail hook — `npx tsx scripts/test-agent-kit.ts` |
| Natural-language policy | ✅ | `src/policy/parser.ts` | Groq `llama-3.3-70b-versatile`, `temperature: 0`, structured output, plus a whitelist filter so a hallucinated licence type can never widen what is sold |
| Demo video | ❌ | — | Not yet filmed |

---

## Deliberately not done

Cut for time under a 12-hour budget. Named here rather than left for a judge to discover.

| Enhancement | Status | Why, and what it would take |
|---|---|---|
| **UCP (Universal Commerce Protocol) discovery** | ❌ not attempted | Discovery today is the A2A AgentCard only. UCP would be a second discovery surface on top of a working one — additive points, non-trivial integration |
| **Scheduled Transactions** | ❌ not attempted | Every payment here settles immediately, which is the whole point of the x402 flow. Scheduled transactions would suit a *deferred* or multi-signature licence settlement — a different product beat, not this one |
| **HTS custom fee schedules / royalty fees** | ❌ not attempted | The natural fit: a royalty fee on the certificate NFT so the artist earns on secondary transfers. Genuinely attractive for a music project, and the honest reason it is absent is time plus the risk of a mis-set immutable fee schedule on a token we cannot change afterwards |
| **Third-party validation** | ❌ by necessity, then by choice | The ERC-8004 ValidationRegistry **has no deployment on any chain** — the spec section is still under revision, so there was nothing to call. Our attestation is therefore **self-issued**: the seller attests the buyer against its own allow-list and writes the result to HCS using the registry's own field names. A real, public, tamper-evident record — but not independent verification |
| **Multi-round negotiation suite** | ❌ not migrated | `npm run test:rounds` still speaks the pre-pivot offer shape and does not compile. The behaviour is exercised through the panel's auto-haggle field instead. It is the only red thing in the repo |
| **Persistent negotiations** | ❌ | `InMemoryTaskStore`: sessions do not survive a restart. Fine for a demo; a counter-offer to a restarted seller gets "Task not found" |

---

## Rough edges as of this commit

Both are live and a fresh reviewer will hit them. Delete this section once they are fixed.

| Edge | Effect |
|---|---|
| `DEFAULT_POLICY_STATEMENT` is still the pre-pivot sentence | A fresh `npm run dev` starts with a policy that refuses everything. Save terms in the panel first (the demo script does this in beat 1 anyway) |
| Policy floor is per basis point; the sentence reads as per percent | Written as "0.05 HBAR per share" the floor becomes 25 ℏ for a 5% licence while the track quote is 0.41 ℏ. The demo script works around it by stating the floor in per-share units (`0.0008`), which lines the two numbers up at 0.4 vs 0.41 |
