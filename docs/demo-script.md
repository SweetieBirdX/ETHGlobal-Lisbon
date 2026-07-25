# Demo script — ≤5 minutes

Everything below runs against the live stack. One terminal, one browser tab.

```bash
npm run dev          # panel at http://localhost:4100
```

**Every number in this script was verified against the real policy engine** — the sentence in beat 1 parses to a 0.4 ℏ floor for a 500-share licence, and each beat's offer was run through `evaluateOffer` to confirm the verdict it claims.

---

## Before you hit record

| Check | Why |
|---|---|
| `npx tsx scripts/seed-catalog.ts` has run and track 1 has capacity left | Beat 2 and beat 4 each consume 500 shares of "Harbour Lights, Slower" |
| Buyer balance ≥ 5 ℏ — `npx tsx scripts/check-balance.ts` | Two real settlements at 0.41 ℏ, plus fees |
| The refusals line under the earnings table reads cleanly | Old declines from rehearsals show up there |
| Browser zoom ~125%, log pane visible without scrolling | The log is the film |
| Second tab open on HashScan, logged out | Beat 5 |

**Do not lean on "Send offer" while rehearsing** — every acceptance spends real HBAR and permanently reduces the track's capacity.

---

## Beat 1 — The terms, in your own words · 0:00–0:45

**Do:** Panel is open. Point at the header: *rights holder* and *buyer*, two Hedera accounts. Click into the **Your terms** box, clear it, and type (or paste):

> Sell sync licences for my tracks, at least 0.0008 HBAR per share, never more than 50% in total, and never for political advertising.

Click **Save terms**.

**Say:**
> "This is a musician. Not a developer — they write one sentence about what they'll license, in their own words. Eight ten-thousandths of a HBAR per share is eight HBAR if you wanted the whole track."

**Do:** Point at the parsed JSON that appears underneath.

**Say:**
> "That sentence just became machine-checkable rules. Sync only. A price floor. A cap at fifty percent. And political advertising, forbidden. From here on, nobody asks this person anything."

*Screen shows:* `{"allowedLicenceTypes":["sync"],"minPricePerShareHbar":0.0008,"maxSharesPerLicence":5000,"forbiddenUseCases":["political-ad"]}`

---

## Beat 2 — A licence sold, end to end · 0:45–2:00

**Do:** In the negotiation form set exactly:

| Field | Value |
|---|---|
| Track | **Harbour Lights, Slower — Mira Kestrel** |
| Shares | **500** |
| Licence type | **sync** |
| Use case | **film** |
| Offers (ℏ) | **0.5** |
| Auto-haggle up to | *leave empty* |

Point at the hint line under the form before clicking.

**Say:**
> "A film studio's agent wants five percent of this track. The endpoint will charge 0.41 — that's this track's own price, shares times its per-share rate. Not a flat fee."

**Do:** Click **Send offer**. Let the log run. Do not narrate over it — let the sequence land, then walk back through it.

**Say, pointing line by line:**
> "Identity checked against a Hedera consensus topic. Policy applied. Capacity checked. Then 402 — payment required. The buyer's agent read the price, signed a real Hedera transaction, and retried. 200. It has the licence, and the master reference just got decrypted for the first time.
>
> Nobody approved that payment. There is no approve button in this interface."

**Do:** Scroll to **Licences sold**. Point at the new row: track, licence, **Paid 0.41 ℏ**, a HashScan payment link, and a certificate serial.

**Say:**
> "Money in. And the buyer walked away holding an NFT that says what it bought."

---

## Beat 3 — The agent says no · 2:00–2:40

**Do:** Change **exactly one field**: Use case → **political-ad**. Leave everything else — same track, same 500 shares, same 0.5 ℏ. Click **Send offer**.

**Say, while it runs:**
> "Same track. Same shares. Same money. One thing different."

**Do:** Let the refusal land. Read it off the screen verbatim.

> *"You asked to use this track in political advertising. The rights holder's policy forbids that use. This is not a matter of price."*

**Say:**
> "That last sentence is deliberate. The agent isn't haggling — it's telling the buyer not to come back with more money. Nothing was paid, nothing went on-chain, and the artist was never asked. They'd already answered, in beat one, in a sentence."

---

## Beat 4 — The buyer haggles, on its own · 2:40–3:50

**Do:** Set:

| Field | Value |
|---|---|
| Use case | back to **film** |
| Offers (ℏ) | **0.1** |
| Auto-haggle up to | **0.6** |

**Say before clicking:**
> "Now the buyer lowballs — 0.1, well under the floor. And I'm giving its agent a budget of 0.6 to work with. Watch what it does without me."

**Do:** Click **Send offer**.

**The log shows, in order:**
- `round 1: offered 0.1 ℏ → decline (price_too_low)`
- `countering at 0.4 ℏ (the owner's stated floor), budget 0.6 ℏ`
- `round 2: offered 0.4 ℏ → accept` — reply opens *"Round 2 of our negotiation — last round you offered 0.1 HBAR and I declined (price_too_low)…"*
- payment settles

**Say:**
> "The seller refused and disclosed its floor — 0.4. The buyer countered at exactly 0.4. Not 0.45, not its whole budget. Its floor, and not a tinybar more.
>
> And the seller remembered: 'Round 2 of our negotiation.' Same task, same conversation — this is the A2A task lifecycle, not two unrelated messages."

**Say (this is the line that matters):**
> "But it only haggles when money is the problem. Send it back at political advertising with a hundred HBAR budget and it doesn't bid at all — it walks away, because no amount of money fixes a refusal that was never about price. Knowing the difference is the intelligence here."

---

## Beat 5 — The sceptic's minute · 3:50–4:50

**Say:**
> "Everything I've shown you is this app telling you what it did. Here's the part that doesn't rely on me."

**Do — three things, in this order:**

1. **Audit trail pane.** Click **Refresh**. Point at the newest entry: `licence_completed — 0.0.9697053 · track 1 · 500 shares (5%) · sync · film`.
   > "This isn't our database. This is read back from Hedera's mirror node — the same source HashScan reads."

2. **Click the topic link** (`topic 0.0.… ↗`). HashScan opens on the consensus topic, showing the same messages.
   > "Anyone can open this. We're not in the loop."

3. **The buyer's account on HashScan** → its **Tokens** tab, showing the Music Licence Certificate NFTs.
   > "And this is the buyer's wallet. Not ours. It holds the certificates for what it licensed — track, shares, licence type, and a pointer to the consensus record. The artist keeps the master; the buyer keeps proof of exactly what it was sold."

**Close:**
> "One sentence from a musician. Two agents. Real money on Hedera, no human in the loop, and no Solidity anywhere in it."

---

## Optional cut-in, if you land under 4:30

**The availability gate** (~15s). Set Track → **Tramline Nocturne** (8% left), Shares → **900**. The hint under the form warns you before you even send. Send anyway:

> *"You asked for 9% but only 8% of this track's capacity is still available. Reduce the share count and I will reconsider — you have not been charged."*

**Say:** *"You can't oversell a track. The agent checks capacity before it ever quotes a price."*

---

## Things not to do on camera

- **Don't rehearse with "Send offer".** Every acceptance spends real HBAR *and* permanently reduces track 1's capacity — rehearse enough times and beat 2's track runs out mid-take.
- **Don't film across midnight.** Earnings timestamps render as `HH:MM` only.
- **Don't skip beat 1.** The panel's built-in default policy is stale (see `docs/bounty-coverage.md`), so the agent refuses everything until terms are saved. Beat 1 does that naturally — but if you re-record beats out of order, save the terms first.
- **Don't read the parsed JSON aloud field by field.** Point at it; the sentence above it is the story.
