import "dotenv/config";
import { fileURLToPath } from "node:url";
import express, { type Response } from "express";
import { paymentMiddleware } from "@x402/express";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { recordCompletedSale } from "../a2a/seller-executor.js";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import {
  COHORT_INSIGHT_PATH,
  COHORT_INSIGHT_PRICE_HBAR,
  COHORT_INSIGHT_PRICE_TINYBAR,
  HBAR_ASSET_ID,
  NETWORK,
  X402_PORT,
} from "./config.js";
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

export {
  COHORT_INSIGHT_PATH,
  COHORT_INSIGHT_PRICE_HBAR,
  COHORT_INSIGHT_PRICE_TINYBAR,
  HBAR_ASSET_ID,
  NETWORK,
} from "./config.js";

export const PORT = X402_PORT;

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

/**
 * Runs the seller's post-payment chain once the response is on its way out.
 *
 * The middleware settles *after* the handler has produced its body, so the
 * transaction id only exists at that point — it arrives in the `PAYMENT-RESPONSE`
 * header, which is set just before the response is flushed.
 */
function scheduleCompletion(res: Response, queryId: number): void {
  res.on("finish", () => {
    if (res.statusCode !== 200) return;

    const header = res.getHeader("payment-response") ?? res.getHeader("x-payment-response");
    if (!header) {
      console.warn(`[settle] no PAYMENT-RESPONSE header; queryId ${queryId} left open`);
      return;
    }

    let transactionId: string;
    try {
      transactionId = String(decodePaymentResponseHeader(String(header)).transaction);
    } catch (error) {
      console.error(`[settle] could not decode PAYMENT-RESPONSE:`, error);
      return;
    }

    // Deliberately not awaited: the buyer already has its data, and the audit
    // and reputation writes are Hedera transactions of their own.
    recordCompletedSale(queryId, transactionId)
      .then((sale) => {
        console.log(
          `[settle] query ${sale.queryId} completed — buyer ${sale.buyerAgentId}, ` +
            `payment ${sale.transactionId}, HCS seq ${sale.auditSequenceNumber ?? "-"}, ` +
            `feedback #${sale.feedbackIndex ?? "-"}`,
        );
        for (const problem of sale.errors) console.error(`[settle] ${problem}`);
      })
      .catch((error) => console.error("[settle] post-payment chain failed:", error));
  });
}

app.get(COHORT_INSIGHT_PATH, async (req, res) => {
  // Reaching this handler means the facilitator has verified the payment.
  // Query params become the cohort filter; the records themselves are decrypted
  // in memory and reduced to statistics, so nothing per-user leaves here.
  try {
    const insight = await getCohortInsight(parseCriteria(req.query));

    const queryId = Number(req.query["queryId"]);
    if (Number.isInteger(queryId) && queryId > 0) {
      scheduleCompletion(res, queryId);
    }

    res.json(insight);
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

export function startX402Server(port: number = PORT) {
  return app.listen(port, () => {
    console.log(`x402 data server listening on http://localhost:${port}`);
    console.log(`  facilitator: ${facilitatorUrl}`);
    console.log(`  pay to:      ${payToAccount} (${NETWORK})`);
    console.log(`  GET /catalog              (free)`);
    console.log(
      `  GET ${COHORT_INSIGHT_PATH} (${COHORT_INSIGHT_PRICE_HBAR} HBAR = ${COHORT_INSIGHT_PRICE_TINYBAR} tinybar, asset ${HBAR_ASSET_ID})`,
    );
  });
}

// Only start listening when run directly, so a test can own the lifecycle.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startX402Server();
}
