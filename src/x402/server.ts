import "dotenv/config";
import express from "express";
import { Hbar } from "@hiero-ledger/sdk";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import {
  CohortTooSmallError,
  getCohortInsight,
  parseCriteria,
} from "../data/aggregate.js";

/**
 * The seller's data server — the endpoint a buyer agent is routed to once a
 * negotiation is accepted.
 *
 * `GET /data/cohort-insight` is wrapped in x402: an unpaid request comes back
 * as HTTP 402 with the payment requirements, the buyer agent pays and retries,
 * and the same request then returns the data. `/catalog` deliberately stays
 * free — a buyer agent has to be able to discover what is on offer and at what
 * price *before* it can decide to pay.
 *
 * The server holds **no Hedera key**: verification and settlement are done by
 * the facilitator, so the seller only ever declares where the money should go.
 * Structure follows matevszm/x402-hedera-example (Hono there, Express here).
 */

export const PORT = 4021;

/** Price of one cohort insight. Advertised in HBAR, charged in tinybars. */
export const COHORT_INSIGHT_PRICE_HBAR = "0.5";
export const COHORT_INSIGHT_PRICE_TINYBAR = Hbar.fromString(
  COHORT_INSIGHT_PRICE_HBAR,
).toTinybars().toString();

/** Native HBAR. Hedera's own token has no contract address — it is asset 0.0.0. */
const HBAR_ASSET_ID = "0.0.0";

const NETWORK: Network = "hedera:testnet";

const COHORT_INSIGHT_PATH = "/data/cohort-insight";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name} — copy .env.example to .env and fill it in (see CLAUDE.md).`,
    );
  }
  return value;
}

const facilitatorUrl = requireEnv("X402_FACILITATOR_URL");
const payToAccount = requireEnv("X402_PAY_TO_ACCOUNT");

/**
 * The resource server delegates verification/settlement to the facilitator and
 * knows how to price a Hedera "exact" payment. `hedera:*` registers the scheme
 * for every Hedera network, so mainnet would need no code change.
 */
const x402Server = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: facilitatorUrl }),
).register("hedera:*", new ExactHederaScheme());

const routes: RoutesConfig = {
  [`GET ${COHORT_INSIGHT_PATH}`]: {
    description:
      "Aggregate fitness/performance statistics over the cohort matching the given criteria. Never returns raw per-user records.",
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: payToAccount,
      price: {
        asset: HBAR_ASSET_ID,
        amount: COHORT_INSIGHT_PRICE_TINYBAR,
      },
      // Generous window: the buyer agent has to sign and submit a real Hedera
      // transaction between receiving the 402 and retrying.
      maxTimeoutSeconds: 180,
    },
  },
};

export const app = express();

/** Public price list — free, so a buyer agent can discover the offer. */
app.get("/catalog", (_req, res) => {
  res.json({
    endpoints: [
      {
        path: COHORT_INSIGHT_PATH,
        description:
          "Aggregate fitness/performance statistics over the cohort matching the given criteria. Never returns raw per-user records.",
        price: COHORT_INSIGHT_PRICE_HBAR,
        priceAtomic: COHORT_INSIGHT_PRICE_TINYBAR,
        asset: HBAR_ASSET_ID,
        network: NETWORK,
        payTo: payToAccount,
        params: ["ageRange", "activityType"],
      },
    ],
  });
});

// Only paths present in `routes` are charged; everything else passes through.
app.use(paymentMiddleware(routes, x402Server));

app.get(COHORT_INSIGHT_PATH, async (req, res) => {
  // Reaching this handler means the facilitator has verified the payment.
  // Query params become the cohort filter; the records themselves are decrypted
  // in memory and reduced to statistics, so nothing per-user leaves here.
  try {
    res.json(await getCohortInsight(parseCriteria(req.query)));
  } catch (error) {
    if (error instanceof CohortTooSmallError) {
      // 422: the request was well-formed and paid for, but answering it would
      // expose an individual. The negotiation should catch this before payment
      // (Phase 7.1) so a buyer is never charged for a cohort we cannot report.
      res.status(422).json({
        error: "cohort_too_small",
        message: error.message,
        matched: error.matched,
        minimum: error.minimum,
      });
      return;
    }
    throw error;
  }
});

app.listen(PORT, () => {
  console.log(`x402 data server listening on http://localhost:${PORT}`);
  console.log(`  facilitator: ${facilitatorUrl}`);
  console.log(`  pay to:      ${payToAccount} (${NETWORK})`);
  console.log(`  GET /catalog              (free)`);
  console.log(
    `  GET ${COHORT_INSIGHT_PATH} (${COHORT_INSIGHT_PRICE_HBAR} HBAR = ${COHORT_INSIGHT_PRICE_TINYBAR} tinybar, asset ${HBAR_ASSET_ID})`,
  );
});
