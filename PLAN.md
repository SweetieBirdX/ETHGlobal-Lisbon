# PLAN.md — Live Progress Tracker

**This file is the project's "memory."** Since different people and different Claude sessions/accounts will work on this repo, to avoid any loss of continuity: read this file at the start of every session, update it at the end of every session/phase. `CLAUDE.md` carries the fixed project context; this file carries the **current state**.

Phase/prompt numbers match `prompt-list.md` exactly. For full prompt text, refer there — this file only holds status and handoff notes.

---

## Current Status

**Active phase:** Phase 0 — Project Skeleton (in progress, 0.1 done)
**Last updated by:** Emre (Claude session)
**Last updated on:** 2026-07-25

---

## Progress Checklist

### Phase 0 — Project Skeleton
- [x] 0.1 Repo and base files
- [ ] 0.2 package.json and TypeScript setup
- [ ] 0.3 Install dependencies
- [ ] 0.4 Folder structure
- [ ] 0.5 .env.example
- [ ] Manual: two testnet accounts opened, `.env` filled in

### Phase 1 — Hedera Base Layer
- [ ] 1.1 Seller/buyer Hedera clients
- [ ] 1.2 Balance query test script
- [ ] 1.3 Create HCS audit topic (→ write `HCS_AUDIT_TOPIC_ID` to `.env`!)
- [ ] 1.4 HCS message submission helper function
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
