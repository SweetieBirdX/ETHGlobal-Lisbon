import "dotenv/config";
import express from "express";
import { MockDataProvider } from "../data/provider.js";

/**
 * The seller's data server — the endpoint a buyer agent is routed to once a
 * negotiation is accepted.
 *
 * At this step both routes are open. Phase 3.3 puts the x402 middleware in
 * front of `/data/*` so that reaching it costs the advertised price in HBAR;
 * `/catalog` deliberately stays free, because a buyer agent has to be able to
 * discover what is on offer and at what price *before* it can decide to pay.
 */

export const PORT = 4021;

/** Price of one cohort insight, in HBAR. Phase 3.3 feeds this to the middleware. */
export const COHORT_INSIGHT_PRICE_HBAR = "0.5";

const COHORT_INSIGHT_PATH = "/data/cohort-insight";

const provider = new MockDataProvider();

export const app = express();

/**
 * Public price list. `asset: "0.0.0"` is native HBAR — the same asset the x402
 * payment will settle in.
 */
app.get("/catalog", (_req, res) => {
  res.json({
    endpoints: [
      {
        path: COHORT_INSIGHT_PATH,
        description:
          "Aggregate fitness/performance statistics over the cohort matching the given criteria. Never returns raw per-user records.",
        price: COHORT_INSIGHT_PRICE_HBAR,
        asset: "0.0.0",
        network: "hedera-testnet",
        params: ["ageRange", "activityType"],
      },
    ],
  });
});

app.get(COHORT_INSIGHT_PATH, async (req, res) => {
  // Query params are passed straight through as the cohort criteria; the mock
  // provider ignores them until the real aggregation lands in Phase 6.3.
  const insight = await provider.getCohortInsight(req.query);
  res.json(insight);
});

app.listen(PORT, () => {
  console.log(`x402 data server listening on http://localhost:${PORT}`);
  console.log(`  GET /catalog              (free)`);
  console.log(
    `  GET ${COHORT_INSIGHT_PATH} (${COHORT_INSIGHT_PRICE_HBAR} HBAR from Phase 3.3 on)`,
  );
});
