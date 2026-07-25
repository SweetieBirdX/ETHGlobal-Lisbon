import "dotenv/config";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
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
  type CohortCriteria,
} from "../data/aggregate.js";
import { openDatabase, type QueryRow } from "../data/db.js";

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

/**
 * Compares what the buyer is asking for against what was actually negotiated.
 *
 * Both directions matter: adding a filter narrows the cohort below what the
 * seller agreed to report on, and dropping one broadens it. Absent must equal
 * absent, so an omitted `ageRange` cannot silently become "any age".
 */
export function matchesNegotiatedCriteria(
  negotiated: CohortCriteria,
  requested: CohortCriteria,
): boolean {
  // Both sides pass through parseCriteria, which sorts and deduplicates the
  // data types — so a straight join comparison is order-independent. Absent
  // must equal absent here too: requesting health types that were never
  // negotiated is the same trick as widening the cohort filter.
  return (
    negotiated.activityType === requested.activityType &&
    negotiated.ageRange === requested.ageRange &&
    (negotiated.dataTypes ?? []).join(",") === (requested.dataTypes ?? []).join(",")
  );
}

/**
 * Refuses any paid request that no negotiation authorised.
 *
 * Without this the three gates in the seller's agent are decorative: the policy
 * is applied during the A2A conversation, but the endpoint itself would sell a
 * forbidden category to anyone holding the price. A request has to name the
 * negotiation it belongs to, that negotiation has to be open, and the criteria
 * have to be the ones that were agreed — otherwise the request is refused
 * *before* the payment middleware, so no price is ever quoted for it.
 */
function requireAcceptedNegotiation(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const queryId = Number(req.query["queryId"]);

  if (!Number.isInteger(queryId) || queryId <= 0) {
    res.status(403).json({
      error: "negotiation_required",
      message:
        "This endpoint only serves requests an agent negotiated for. Open a negotiation with the " +
        "seller agent first; the acceptance carries the URL to pay, queryId included.",
    });
    return;
  }

  const db = openDatabase();
  let negotiation: QueryRow | undefined;
  try {
    negotiation = db
      .prepare("SELECT * FROM queries WHERE id = ?")
      .get(queryId) as QueryRow | undefined;
  } finally {
    db.close();
  }

  if (!negotiation) {
    res.status(403).json({
      error: "unknown_negotiation",
      message: `No negotiation ${queryId} exists.`,
    });
    return;
  }

  if (negotiation.status !== "accepted") {
    // Covers a refused offer and, just as importantly, one already paid for:
    // a settled negotiation cannot be replayed to collect the data twice.
    res.status(403).json({
      error: "negotiation_not_open",
      message:
        `Negotiation ${queryId} is "${negotiation.status}", not an open acceptance. ` +
        "Each acceptance can be settled once.",
    });
    return;
  }

  // Deliberately does not echo the stored criteria back — a caller probing with
  // guesses should not be told what the right answer was.
  if (
    !matchesNegotiatedCriteria(
      parseCriteria(JSON.parse(negotiation.criteria) as Record<string, unknown>),
      parseCriteria(req.query),
    )
  ) {
    res.status(403).json({
      error: "criteria_mismatch",
      message:
        `The criteria in this request are not the ones negotiation ${queryId} agreed on. ` +
        "Request the cohort that was accepted, or negotiate again for a different one.",
    });
    return;
  }

  next();
}

// Ahead of the payment middleware on purpose: a request the seller never agreed
// to must not even be quoted a price, let alone be able to pay it.
app.get(COHORT_INSIGHT_PATH, requireAcceptedNegotiation);

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
    let payer: string | undefined;
    try {
      const settled = decodePaymentResponseHeader(String(header));
      transactionId = String(settled.transaction);
      // Who actually paid — the receipt NFT goes to this account, not to a
      // configured one, so a different payer would get its own receipt.
      payer = settled.payer ? String(settled.payer) : undefined;
    } catch (error) {
      console.error(`[settle] could not decode PAYMENT-RESPONSE:`, error);
      return;
    }

    // Deliberately not awaited: the buyer already has its data, and the audit
    // and reputation writes are Hedera transactions of their own.
    recordCompletedSale(queryId, transactionId, payer)
      .then((sale) => {
        console.log(
          sale.alreadyCompleted
            ? `[settle] query ${sale.queryId} was already completed — no second audit entry or feedback written`
            : `[settle] query ${sale.queryId} completed — buyer ${sale.buyerAgentId}, ` +
              `payment ${sale.transactionId}, HCS seq ${sale.auditSequenceNumber ?? "-"}, ` +
              `feedback #${sale.feedbackIndex ?? "-"}, receipt #${sale.receipt?.serial ?? "-"}`,
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

    // `requireAcceptedNegotiation` has already established that this id names an
    // open negotiation whose agreed criteria are the ones being requested.
    scheduleCompletion(res, Number(req.query["queryId"]));

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
