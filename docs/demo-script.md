# Demo script — WORKING DRAFT

> **Status: draft, not the finished Phase 9.3 deliverable.** Created in session 46
> because the multi-round negotiation needed a documented demo beat. 9.3 should
> tighten the timings, add the spoken lines, and decide what gets cut for the
> video length. Everything below runs against the live stack: `npm run dev`,
> panel at http://localhost:4100.

## The one-sentence pitch

You own your fitness data; your agent sells access to *statistics about a
crowd you're part of* — on your rules, to verified buyers, for real money,
with no human approving any sale.

## Beats, in order

### 1. The policy — say it once, in your own words (~30s)
Type into the policy form: *"You can sell aggregated statistics from my
running and cycling data — performance scores and session counts only —
minimum 0.4 HBAR. Never any health or medication data."* Save. Show the
parsed JSON: the sentence became machine-checkable rules.

### 2. A sale, end to end (~60s)
Send offer: running @ 0.5 ℏ. Watch the log: identity attested on Hedera →
policy check → cohort check → 402 → the buyer's agent signs a real transfer →
200 with the aggregate → audit + reputation + **receipt NFT** land on-chain.
Open the HashScan links as they appear. Point at the earnings row: payment tx
and receipt serial, side by side.

### 3. The refusals — the agent saying no is the product (~45s)
- Swimming @ 0.9 ℏ → refused: category not permitted. **More money than the
  accepted offer, still no.**
- Tick "also request cycle-tracking data" → refused: *"that is health data,
  and the owner's policy does not permit selling any health data. This is not
  a matter of price."*

### 4. Multi-round negotiation — two agents actually haggling (~45s)
Run `npm run test:rounds` in a visible terminal (or narrate its output):
- Buyer opens at **0.1 ℏ** → seller declines (`price_too_low`) and leaves the
  task **open** (`input-required`) — a genuine invitation.
- Buyer counter-offers **0.5 ℏ** *into the same task* → seller: **"Round 2 of
  our negotiation — last round you offered 0.1 HBAR and I declined
  (price_too_low). Offer accepted…"** Same taskId, on screen.
- Payment settles; a third attempt to reopen is refused by the protocol
  itself: *"task is in a terminal state"*. A closed deal stays closed.

### 5. The sceptic's minute (~30s)
Audit panel: entries read from the **mirror node**, not our app. Open the
topic on HashScan. Open the buyer's account: it holds the receipt NFTs —
the buyer's own portable proof of every purchase.

## Things NOT to do on camera
- Don't lean on "Send offer" while rehearsing — every accepted offer spends a
  real 0.5 ℏ.
- Don't film across midnight: earnings timestamps render as HH:MM.
- Clear stray ledger rows before the take (`status='accepted'` leftovers show
  in no panel, but declines show in the refusals line — check it reads well).
