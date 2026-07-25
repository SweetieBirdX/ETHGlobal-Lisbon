# PLAN.md — Live Progress Tracker

**This file is the project's "memory."** Since different people and different Claude sessions/accounts will work on this repo, to avoid any loss of continuity: read this file at the start of every session, update it at the end of every session/phase. `CLAUDE.md` carries the fixed project context; this file carries the **current state**.

Phase/prompt numbers match `prompt-list.md` exactly. For full prompt text, refer there — this file only holds status and handoff notes.

---

## Current Status

**Active phase:** Phase 1 — Hedera Base Layer (1.1-1.4 done; next: 1.5 simple HBAR transfer test)
**Last updated by:** Emre (Claude session)
**Last updated on:** 2026-07-25

---

## Progress Checklist

### Phase 0 — Project Skeleton
- [x] 0.1 Repo and base files
- [x] 0.2 package.json and TypeScript setup
- [x] 0.3 Install dependencies
- [x] 0.4 Folder structure
- [x] 0.5 .env.example
- [x] Manual: two testnet accounts opened, `.env` filled in

### Phase 1 — Hedera Base Layer
- [x] 1.1 Seller/buyer Hedera clients
- [x] 1.2 Balance query test script
- [x] 1.3 Create HCS audit topic (→ write `HCS_AUDIT_TOPIC_ID` to `.env`!)
- [x] 1.4 HCS message submission helper function
- [ ] 1.5 Simple HBAR transfer test

### Phase 2 — Hedera Agent Kit
- [ ] 2.1 Agent Kit toolkit setup
- [ ] 2.2 Test agent: balance query
- [ ] 2.3 HCSAuditTrailHook integration

### Phase 3 — x402 Payment Layer
- [ ] 3.1 Mock data provider
- [ ] 3.2 Express server skeleton
- [ ] 3.3 x402 middleware integration
- [ ] 3.4 Buyer-side payment script
- [ ] 3.5 End-to-end payment test

### Phase 4 — A2A Agent Skeleton
- [ ] 4.1 Seller AgentCard
- [ ] 4.2 Seller executor (basic version)
- [ ] 4.3 Seller agent server
- [ ] 4.4 Buyer agent client
- [ ] 4.5 End-to-end negotiation test

### Phase 5 — ERC-8004
- [ ] 5.1 Contract connections
- [ ] 5.2 Agent registration files
- [ ] 5.3 Register the agents (→ produces `agent-ids.json`)
- [ ] 5.4 Identity verification added to seller executor
- [ ] 5.5 Reputation feedback submission

### Phase 6 — Off-chain Data + Policy Engine
- [ ] 6.1 Encrypted database schema
- [ ] 6.2 Mock user data
- [ ] 6.3 Cohort aggregation function
- [ ] 6.4 Natural-language policy parser
- [ ] 6.5 Policy wired into seller executor

### Phase 7 — Full Integration
- [ ] 7.1 Accept → x402 routing
- [ ] 7.2 Buyer agent autonomous payment trigger
- [ ] 7.3 Post-payment audit log + reputation chain
- [ ] 7.4 Full end-to-end test script
- [ ] 7.5 Error handling and edge cases

### Phase 8 — Frontend
- [ ] 8.1 Frontend skeleton
- [ ] 8.2 Policy input form
- [ ] 8.3 Live negotiation log (SSE)
- [ ] 8.4 Earnings panel
- [ ] 8.5 HCS audit trail view

### Phase 9 — Documentation and Demo
- [ ] 9.1 README architecture section
- [ ] 9.2 Bonus requirement coverage table
- [ ] 9.3 Demo script
- [ ] 9.4 Clean-environment setup test
- [ ] Manual: demo video filmed
- [ ] 9.5 Video link added to README

### Phase 10 — Submission
- [ ] 10.1 Final checklist
- [ ] 10.2 ETHGlobal submission form submitted

---

## Handoff Log

Add an entry here at the end of every session/work block (newest on top). Format:

```
### [Date/Time] — [Name] — [Claude account/session short tag]
**Completed:** Phase X.Y - X.Z
**Files changed:** ...
**Verification:** (did you run it, what did you test, what was the output)
**What the next person should do:** ...
**Known issues / things to watch for:** ...
```

### 2026-07-25 — Emre — Claude Code session (8b)
**Completed:** Phase 1.4
**Files changed:** `src/hedera/audit.ts` (new) — `logAuditEvent(client, message, topicId?)` JSON-stringifies the object (adding an ISO `timestamp` unless the caller supplies one), submits it with `TopicMessageSubmitTransaction`, and returns `{ topicId, sequenceNumber, transactionId }`; topic id defaults to `HCS_AUDIT_TOPIC_ID` and throws pointing at `scripts/create-audit-topic.ts` when unset. `scripts/test-audit-log.ts` (new) — `TopicInfoQuery` before/after around one write, asserts the count went up by exactly 1 (sets exit code 1 otherwise) and prints the HashScan link.
**Verification:** `npx tsc --noEmit` clean. `npx tsx scripts/test-audit-log.ts` against real testnet: `Messages before: 0` → sequence 1, tx `0.0.9696085@1784945187.799581596` → `Messages after: 1`, "OK — message count increased by 1". Content confirmed independently through the mirror node (what HashScan reads): `GET /api/v1/topics/0.0.9738154/messages` returned sequence 1 = `{"timestamp":"2026-07-25T02:06:32.654Z","event":"audit_log_test","note":"Phase 1.4 verification"}`.
**What the next person should do:** Phase 1.5 — simple HBAR transfer test (buyer → seller) with `TransferTransaction`.
**Known issues / things to watch for:** **Phases 1.3 and 1.4 are not committed yet** — the 1.3 commit was declined and 1.4 was written on top of it, so `scripts/create-audit-topic.ts`, `src/hedera/audit.ts`, `scripts/test-audit-log.ts` and this PLAN update are all still working-tree changes. `logAuditEvent` reads `HCS_AUDIT_TOPIC_ID` at call time via a default parameter, so `dotenv` must already be loaded (it is — `src/hedera/audit.ts` imports `dotenv/config` itself). Topic sequence numbers are cumulative, so later phases' tests keep appending to the same topic.

### 2026-07-25 — Emre — Claude Code session (8)
**Completed:** Phase 1.3
**Files changed:** `scripts/create-audit-topic.ts` (new) — seller client + `TopicCreateTransaction().setTopicMemo("Data Marketplace Audit Trail")`, reads `topicId` off the receipt (throws with the receipt status if it is null), prints the id, a HashScan link and the ready-to-paste `.env` line; `seller.close()` in a `finally`. `.env` updated (not committed) with the resulting topic id.
**Verification:** `npx tsc --noEmit` clean. `npx tsx scripts/create-audit-topic.ts` against real testnet created **topic `0.0.9738154`** → https://hashscan.io/testnet/topic/0.0.9738154. `HCS_AUDIT_TOPIC_ID=0.0.9738154` written into `.env` (single occurrence, verified). A throwaway `scripts/_topiccheck.ts` then read the id back from `.env` and ran a real `TopicInfoQuery`: `topic: 0.0.9738154 | memo: Data Marketplace Audit Trail`. Throwaway deleted.
**What the next person should do:** Phase 1.4 — the HCS message submission helper in `src/hedera/` (`TopicMessageSubmitTransaction` against `HCS_AUDIT_TOPIC_ID`).
**Known issues / things to watch for:** The script creates a **new** topic on every run — it is not idempotent, so don't re-run it casually or `.env` will point at a topic while older audit messages live on the previous one. Anyone setting up a fresh machine runs it once and pastes the id. Throwaway scripts must live inside the repo (not the system temp dir): `package.json` has `"type": "module"`, so a `.ts` file outside the project is transformed as CJS by tsx and top-level `await` fails.

### 2026-07-25 — Emre — Claude Code session (7)
**Completed:** Phase 1.2
**Files changed:** `scripts/check-balance.ts` (new) — builds both clients via `createSellerClient()`/`createBuyerClient()`, reads each account id off `client.operatorAccountId`, runs `AccountBalanceQuery` and prints `balance.hbars`; closes both clients in a `finally` (without `client.close()` the process hangs on the SDK's open gRPC connections), and `main().catch()` exits 1 on failure.
**Verification:** `npx tsc --noEmit` clean. `npx tsx scripts/check-balance.ts` against real testnet printed:
```
Hedera testnet balances
-----------------------
Seller agent (0.0.9696085): 1000 ℏ
Buyer agent  (0.0.9697053): 1000 ℏ
```
**What the next person should do:** Phase 1.3 — create the HCS audit topic and **write the returned `HCS_AUDIT_TOPIC_ID` back into `.env`** (it is currently empty).
**Known issues / things to watch for:** Imports use the `.js` extension (`../src/hedera/clients.js`) — required by NodeNext resolution even though the source is `.ts`; keep that pattern in every new script. The `.env`/`GROQ_API_KEY` and `@langchain/openai` items from session (6) are still open.

### 2026-07-25 — Emre — Claude Code session (6)
**Completed:** Phase 1.1 (and the Phase 0 manual step is now done — `.env` is filled in with two real ECDSA testnet accounts)
**Files changed:** `src/hedera/clients.ts` (new) — `createSellerClient()` / `createBuyerClient()`, both `Client.forTestnet().setOperator(accountId, PrivateKey.fromStringECDSA(key))`, `dotenv/config` imported at module top, missing env vars throw a message pointing at `.env.example`.
**Verification:** `npm install` had to be run first (`node_modules/` was absent on this machine). `npx tsc --noEmit` clean — TS18003 from 0.4 is now gone, as predicted. A throwaway `scripts/_clientcheck.ts` built both clients and ran a real `AccountBalanceQuery` against testnet: seller `0.0.9696085` and buyer `0.0.9697053`, 14 network nodes each, **1000 ℏ** balance each. A second throwaway confirmed the missing-env path throws instead of building a half-configured client. Both throwaway scripts deleted.
**What the next person should do:** Phase 1.2 — `scripts/check-balance.ts` (the real, committed balance script; the throwaway above is a good starting point). Then 1.3, which generates `HCS_AUDIT_TOPIC_ID` and must be written back into `.env`.
**Known issues / things to watch for:**
- `.env` still has `GROQ_API_KEY` empty, and `.env.example` predates the OpenAI→Groq switch in `CLAUDE.md` (it still lists `OPENAI_API_KEY`). Needs fixing before Phase 6.4; `package.json` likewise still has `@langchain/openai` rather than `@langchain/groq`.
- `npm install` rewrote `package-lock.json` (only stripping `libc` fields from optional esbuild platform packages — a plain npm-version difference). Reverted so it stayed out of the commit; expect it to reappear on other machines and revert it the same way.
- `prompt-list.md` is still missing from `ProjectFiles/`, so the commit message for this step was written by hand (`feat: hedera seller and buyer testnet clients`).

### 2026-07-25 — Emre — Claude Code session (5)
**Completed:** Phase 0.5 — Phase 0 code prompts are now all done
**Files changed:** `.env.example` (new)
**Verification:** Copied it to `.env` and parsed it with `dotenv`: all 10 expected keys present, no extras, the 8 secret/config values empty, and the two ERC-8004 addresses matching `CLAUDE.md` exactly. `git check-ignore -v .env` → matched by `.gitignore:2`, and `.env` never appeared in `git status` (`.env.example` is not affected — the rule is an exact match on `.env`). Temporary `.env` deleted afterwards.
**What the next person should do:** **Manual step first** — open two Hedera testnet accounts at portal.hedera.com/dashboard, `cp .env.example .env`, fill in the seller/buyer IDs + keys and `OPENAI_API_KEY`. Then Phase 1.1 (Hedera clients). `HCS_AUDIT_TOPIC_ID` stays empty until 1.3 generates it; the x402 values until Phase 3.
**Known issues / things to watch for:** none for this step. TS18003 from 0.4 still applies until the first `.ts` file exists.

### 2026-07-25 — Emre — Claude Code session (4)
**Completed:** Phase 0.4
**Files changed:** added empty `.gitkeep` in `src/hedera/`, `src/x402/`, `src/a2a/`, `src/erc8004/`, `src/data/`, `src/policy/`, `src/web/`, `scripts/`, `docs/`
**Verification:** All 9 directories exist, all 9 `.gitkeep` files are 0 bytes, all 9 staged by git (git does not track empty directories, so the `.gitkeep` files are what make the structure survive a clone).
**What the next person should do:** Phase 0.5 — `.env.example`.
**Known issues / things to watch for:** `npx tsc --noEmit` (and `npm run build`) currently fails with **TS18003 "No inputs were found"** — expected, because `tsconfig.json` includes `src/**/*.ts` + `scripts/**/*.ts` and no `.ts` file exists yet. This fixes itself in Phase 1.1 when the first real source file lands; do not "fix" tsconfig for it.

### 2026-07-25 — Emre — Claude Code session (3)
**Completed:** Phase 0.3
**Files changed:** `package.json`, `package-lock.json`
**Installed (runtime):** `@hiero-ledger/sdk@2.86.2`, `@hashgraph/hedera-agent-kit@4.0.0`, `@hashgraph/hedera-agent-kit-langchain@1.0.0`, `@a2a-js/sdk@1.0.0`, `express@5.2.1`, `langchain@1.5.4`, `@langchain/openai@1.5.5`, `dotenv@17.4.2`, `ethers@6.17.0`. **(dev):** `vitest@4.1.10`, `@types/express` (needed because express 5 ships no bundled types). Also added npm scripts `test` → `vitest run`, `build` → `tsc`.
**Verification:** Throwaway `scripts/_depcheck.ts` imported all nine runtime packages under ESM/NodeNext and asserted a real export from each (`Client.forTestnet`, `HederaLangchainToolkit`, `createAgent`, `ChatOpenAI`, `ethers.getAddress`, …) — all OK. `npx tsc --noEmit` clean. `npx vitest run` passed a smoke test building a Hedera testnet client (1/1). All throwaway files deleted.
**What the next person should do:** Phase 0.4 — folder structure (`src/hedera`, `src/x402`, `src/a2a`, `src/erc8004`, `src/data`, `src/policy`, `src/web`, `scripts`, `docs`).
**Known issues / things to watch for:**
- `npm install -D` spuriously wrote `esbuild` and `undici-types` into `dependencies`; removed via `npm pkg delete` and re-installed. If they reappear after a future install, delete them again — they are transitive deps of vitest/@types/node, not direct ones.
- `npm audit` reports 13 vulns (9 moderate / 4 high), all inside pinned transitive deps of `@hiero-ledger/sdk` and `@hashgraph/hedera-agent-kit` (`ws`, older `ethers`, `uuid`). **No fix available** and `npm audit fix --force` would downgrade/break the Hedera SDKs — leave them alone for the hackathon; testnet-only, no real funds.
- x402 packages are deliberately not installed yet — they come in Phase 3.

### 2026-07-25 — Emre — Claude Code session (2)
**Completed:** Phase 0.2
**Files changed:** `package.json` (new, `"type": "module"`, license Apache-2.0), `package-lock.json`, `tsconfig.json` (new: target ES2022, module+moduleResolution NodeNext, strict, outDir `dist`, includes `src/**/*.ts` and `scripts/**/*.ts`)
**Verification:** Wrote a throwaway `scripts/_tscheck.ts` using a `node:os` import + typed function. `npx tsc --noEmit` → no errors; `npx tsc` → emitted `dist/scripts/_tscheck.js`; `npx tsx scripts/_tscheck.ts` and `node dist/scripts/_tscheck.js` both printed `TS setup OK on DESKTOP-RCUP6QS`. Throwaway file and `dist/` deleted afterwards.
**What the next person should do:** Phase 0.3 — install runtime dependencies (see `tech-stack-detay.md` for exact package names).
**Known issues / things to watch for:** Installed TypeScript resolves to 7.x and Node is v24 — `tsc` and `tsx` both work with NodeNext here, but if a later dependency's types misbehave, pinning `typescript@^5` is the fallback.

### 2026-07-25 — Emre — Claude Code session
**Completed:** Phase 0.1
**Files changed:** `.gitignore` (was empty — filled with node_modules/, .env, dist/, *.log, .DS_Store), `LICENSE` (Apache-2.0, new), `README.md` (project name + one-sentence description + "Setup (coming soon)"), `PLAN.md`
**Verification:** Created throwaway `node_modules/x.js`, `dist/y.js`, `.env`, `test.log`, `.DS_Store` — none appeared in `git status`; `git check-ignore -v` matched each to its rule. Files removed afterwards.
**What the next person should do:** Phase 0.2 — `package.json` + TypeScript setup.
**Known issues / things to watch for:**
- `ProjectFiles/` is **tracked** in git (3 files) even though commit 8f39dd6 was titled "exclude ProjectFiles" — the `.gitignore` was actually committed empty. Decide whether the reference docs should stay in the repo; if not, they need `git rm --cached` + a `.gitignore` entry (an entry alone won't untrack them).
- `prompt-list.md` is referenced by `CLAUDE.md` but is not present in `ProjectFiles/` — commit messages per step can't be looked up until it's added.

---

## Known Decisions / Points Not to Re-litigate

These were discussed and decided — read `ethglobal-lisbon-proje-fikri.md` before reopening them:

- The project is **Hedera track only** — The Graph, ENS, World, and other tracks were deliberately left out.
- Raw user data is **never put on-chain or in a public store** — only off-chain encrypted DB + on-chain proof/payment.
- Demo scope is **fitness/performance data only** — health data (medication, menstrual cycle) is mentioned in the concept but not used in the live demo.
- ERC-8004 contracts are **already deployed on Hedera Testnet**, we are not deploying our own (addresses in `CLAUDE.md`).
- The "compliance attestation" in the Validation Registry is **simulated** for the hackathon demo (simple approved list); real audit-body integration is out of scope.

---

## Emergency: Cut-Order If Time Runs Short

Same as the critical-path summary in `roadmap.md`: first cut Phase 8 (frontend polish — a console log may be enough), then the validation attestation in Phase 5 (already simulated), then Phase 6.4 (fixed JSON instead of natural-language policy). **Never cut:** Phases 1-2-3-4 (without payment + negotiation the project doesn't meet the Hedera track) and the Phase 9.4/demo video.
