# CLAUDE.md

This file provides shared context for every Claude session working on this repo (different accounts, different people). **Read this file and `PLAN.md` before starting any work.** When you finish a piece of work, check off the relevant item in `PLAN.md` and add a handoff note (details inside `PLAN.md`).

---

## Project Summary

**Personal Health/Fitness Data Agent Marketplace** — ETHGlobal Lisbon 2026, Hedera track ("AI & Agentic Payments on Hedera", $6,000).

One-sentence concept: Users retain ownership of their own fitness/performance data. When a research company wants access to that data, the user's personal AI agent negotiates autonomously with the company's AI agent over the A2A protocol, identity/trust is verified via ERC-8004, and if accepted, an instant micropayment settles on Hedera testnet via x402 — no human approves any individual transaction.

The exact inverse of the web2 data-broker model (where user data is collected and sold to third parties with no cut going back to the user): both the seller and buyer are autonomous agents, the user sets policy once in natural language, and revenue flows directly to the user.

**Why the project is scoped this way (brief decision history):** The Graph track was originally also targeted, but relying on our own contract as the data source and meeting the "AI actually reasons over Graph data" requirement without forcing it was judged too risky within the hackathon timeframe — the project now focuses **only on the Hedera track**. Using ERC-8004 isn't forced either: since both the buyer and seller are genuinely autonomous agents (no human approval step), agent identity + the validation registry serve a real need here.

---

## Reference Files (outside this repo, in the project folder)

These files hold the full decision history and technical detail for the project — refer to them as needed:

- `ethglobal-lisbon-proje-fikri.md` — full rationale for the project concept, architecture, risk notes (Turkish)
- `tech-stack-detay.md` — exact package names, code samples, and deployed contract addresses for every component (Hedera Agent Kit, x402, A2A, ERC-8004) (Turkish)
- `roadmap.md` — shift-based work split and block order for two people (Turkish)
- `prompt-list.md` — **the most important one**: the atomic prompt list that takes the project from scratch to a finished demo, each ending in a commit (Phase 0 → Phase 10). Follow this file's order exactly when writing code.

---

## Architecture (summary)

```
User (natural-language policy)
        │
        ▼
  Seller Agent (A2A server, its own ERC-8004 identity)
        │  negotiation (A2A protocol)
        ▼
  Buyer Agent (research company, its own ERC-8004 identity)
        │
        ├─ Seller agent: verifies buyer identity via ERC-8004 IdentityRegistry
        ├─ Seller agent: compares offer against user policy (category, min price)
        ├─ Accept → routes to x402-protected endpoint
        ├─ Buyer agent: triggers x402 payment autonomously (Hedera testnet, HBAR)
        ├─ Post-payment: audit log to HCS, feedback to ReputationRegistry
        └─ Backend: returns cohort aggregate from encrypted off-chain DB (raw data never leaves)
```

Raw user data **always stays off-chain and encrypted**. The only things that go on-chain: payment (x402/HBAR transfer), identity (ERC-8004 NFT + metadata), and proof of the event (HCS message). This is a deliberate architectural decision — see the "Notes/Risks" section of `ethglobal-lisbon-proje-fikri.md`.

---

## Tech Stack (package names — full list in `tech-stack-detay.md`)

- **Hedera SDK:** `@hiero-ledger/sdk` (client setup, transfers)
- **Hedera Agent Kit:** `@hashgraph/hedera-agent-kit` + `@hashgraph/hedera-agent-kit-langchain` (LangChain adapter, `AgentMode.AUTONOMOUS`, `HCSAuditTrailHook`)
- **x402:** middleware pattern, facilitator = blocky402 (supports Hedera testnet), asset = native HBAR (`0.0.0`)
- **A2A:** `@a2a-js/sdk` (AgentCard, AgentExecutor, ClientFactory)
- **ERC-8004:** already deployed on Hedera Testnet — do NOT deploy your own contract:
  - IdentityRegistry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
  - ReputationRegistry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
  - ABIs: from the [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) repo
- **Off-chain data:** `better-sqlite3`, field-level AES-256-GCM encryption (`node:crypto`)
- **Policy parsing:** `@langchain/openai` for natural language → structured JSON

---

## Repo Structure

```
src/hedera/      → client setup, agent kit, HCS audit log helpers
src/x402/        → payment middleware, server
src/a2a/         → seller executor/server, buyer client
src/erc8004/     → contract connections, registration, feedback
src/data/        → encrypted DB, cohort aggregation
src/policy/      → natural-language policy parser
src/web/         → frontend (demo panel)
scripts/         → manual test/demo scripts
docs/            → demo script, architecture notes
```

---

## Environment Variables

Full list in `.env.example`. The critical ones: `SELLER_ACCOUNT_ID` / `SELLER_PRIVATE_KEY`, `BUYER_ACCOUNT_ID` / `BUYER_PRIVATE_KEY` (two separate Hedera testnet accounts — [portal.hedera.com/dashboard](https://portal.hedera.com/dashboard)), `X402_FACILITATOR_URL`, `X402_PAY_TO_ACCOUNT`, `HCS_AUDIT_TOPIC_ID` (generated by script in Phase 1.3), `ERC8004_IDENTITY_REGISTRY` / `ERC8004_REPUTATION_REGISTRY` (fixed addresses above).

**Never commit `.env`** — confirm it's in `.gitignore` at the start of every session.

---

## Working Rules (for every Claude session)

1. Before starting work, read `PLAN.md` — see which phase we're on and the last handoff note.
2. Don't skip ahead in `prompt-list.md`. Don't move to the next phase before the current one is done (there's a dependency chain).
3. Commit immediately after finishing each atomic step — commit message format is given under every prompt in `prompt-list.md` (`feat:`, `test:`, `fix:`, `docs:`, `chore:` prefixes).
4. If you get stuck on a step, don't just stop — commit a simplified (mock/fixed-value) version anyway, and note in `PLAN.md` "simplified, needs improvement."
5. When you finish your work (end of session or end of phase), **you must update `PLAN.md`**: check off the completed phase/prompt, add a handoff note (which files changed, what the next person/session should do, known issues).
6. Never share real private keys or `.env` contents in code blocks or commit messages.
7. Sensitive health data categories (medication, menstrual cycle tracking) are out of scope for the demo — work only with fitness/performance data (see `ethglobal-lisbon-proje-fikri.md`).

---

## Quick Commands

```bash
npm install                          # install dependencies
npx tsx scripts/check-balance.ts     # verify Hedera testnet connection
npx tsx scripts/full-e2e-test.ts     # test the full end-to-end flow
npm run dev                          # (after Phase 8) start frontend + backend
```
