# CLAUDE.md

This file provides shared context for every Claude session working on this repo (different accounts, different people). **Read this file and `PLAN.md` before starting any work.** When you finish a piece of work, check off the relevant item in `PLAN.md` and add a handoff note (details inside `PLAN.md`).

---

## ⛔ STOP — Read This First: Sync Before You Touch Anything

**Two people work this repo in parallel, from two different machines and two different Claude
accounts.** The working copy goes stale within minutes. Editing or committing on top of a stale
copy is what creates merge conflicts — so the sync check below is **mandatory at two separate
moments in every session, every single time. It is never optional and never "probably fine."**

**Moment 1 — before your first edit of the session (and again after any long pause):**

```bash
git fetch --quiet && git status -sb    # "[behind N]" → STOP, pull before anything else
git pull --rebase                      # run this if behind
```

**Moment 2 — immediately before every `git commit`** (the other person may have pushed while you
were working — this is the check people skip and it is the one that causes conflicts):

```bash
git fetch --quiet && git status -sb
git pull --rebase                      # run this if behind, THEN commit
git push                               # push right after committing, never batch commits up
```

Non-negotiables that follow from this:

- **Never** edit a file, and **never** commit, without having run the check in that same session phase.
- If the pull brings in changes to a file you were about to edit or had already read,
  **re-read that file** before continuing — your mental model of it is out of date.
- If a rebase conflicts, **resolve the conflict first**, before writing any new code — never
  work around it or write new code alongside an unresolved conflict.
- Push straight after each commit. Unpushed local commits are invisible to the other person and
  turn into conflicts the longer they sit.
- Never use `git push --force` on `main`; it will destroy the other person's work.

---

## General Rule: At the End of Every Prompt

Never commit before confirming the code runs and produces the expected output. In order: (1) apply the prompt, (2) run and test it, (3) confirm the expected result, (4) commit with the step's specific commit message, (5) move to the next prompt. If you get stuck on a prompt, don't simplify it without asking and informing the user.

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
- **Policy parsing:** `@langchain/groq` (`ChatGroq`, model `llama-3.3-70b-versatile`) for natural language → structured JSON — chosen over OpenAI because Groq's free tier needs no card, removing billing risk during the hackathon

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

Full list in `.env.example`. The critical ones: `SELLER_ACCOUNT_ID` / `SELLER_PRIVATE_KEY`, `BUYER_ACCOUNT_ID` / `BUYER_PRIVATE_KEY` (two separate Hedera testnet accounts, both ECDSA — [portal.hedera.com/dashboard](https://portal.hedera.com/dashboard)), `GROQ_API_KEY` ([console.groq.com/keys](https://console.groq.com/keys), free, no card), `X402_FACILITATOR_URL` (fixed: `https://api.testnet.blocky402.com`, no signup needed), `X402_PAY_TO_ACCOUNT` (= `SELLER_ACCOUNT_ID`), `HCS_AUDIT_TOPIC_ID` (generated by script in Phase 1.3), `ERC8004_IDENTITY_REGISTRY` / `ERC8004_REPUTATION_REGISTRY` (fixed addresses above).

**Never commit `.env`** — confirm it's in `.gitignore` at the start of every session.

---

## Working Rules (for every Claude session)

**Rule 0 — sync with the remote before touching anything, and again before every commit.**
See **"⛔ STOP — Read This First"** at the top of this file. That check is mandatory at both
moments in every session; nothing below overrides it.

1. Before starting work, read `PLAN.md` — see which phase we're on and the last handoff note.
2. Don't skip ahead in `prompt-list.md`. Don't move to the next phase before the current one is done (there's a dependency chain).
3. Commit immediately after finishing each atomic step — commit message format is given under every prompt in `prompt-list.md` (`feat:`, `test:`, `fix:`, `docs:`, `chore:` prefixes). **Re-run the Rule 0 check first** (someone may have pushed while you were working), and push straight after committing so the other lane is never more than one step behind. If the step also changes `package.json`, commit that file **alone and first** — see `PIVOT-PROMPTS.md` Rule 5.
4. If you get stuck on a step, don't just stop — commit a simplified (mock/fixed-value) version anyway, and note in `PLAN.md` "simplified, needs improvement."
5. When you finish your work (end of session or end of phase), **you must update `PLAN.md`**: check off the completed phase/prompt, add a handoff note (which files changed, what the next person/session should do, known issues).
6. Never share real private keys or `.env` contents in code blocks or commit messages.
7. Sensitive health data is handled deliberately, not avoided. **(Amended in session 44 — the original rule excluded it entirely.)** The store carries two clearly-synthetic health-bucket fields (`cycleTracking` flag, `medicationCount` 0-2) that exist *specifically so the policy gate can refuse a health request demonstrably* — a refusal against data that doesn't exist proves nothing. Rules that still hold: the demo owner's policy never permits health data; the fields stay coarse flags/counts, never conditions, drug names, or anything readable as real PII; and health data is only ever sellable as a cohort aggregate under a policy that names it explicitly.

---

## Quick Commands

```bash
npm install                          # install dependencies
npx tsx scripts/check-balance.ts     # verify Hedera testnet connection
npx tsx scripts/full-e2e-test.ts     # test the full end-to-end flow
npm run dev                          # (after Phase 8) start frontend + backend
```
