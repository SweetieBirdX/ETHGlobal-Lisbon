import "dotenv/config";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { paymentMiddleware } from "@x402/express";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { recordCompletedSale } from "../a2a/seller-executor.js";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { HTTPRequestContext, RoutesConfig } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import {
  HBAR_ASSET_ID,
  hbarToTinybar,
  LICENCE_GRANT_PATH,
  NETWORK,
  X402_PORT,
} from "./config.js";
import {
  buildLicenceGrant,
  LicenceNotGrantableError,
  parseLicenceCriteria,
  quotePrice,
} from "../data/catalog.js";
import { listTracks, openDatabase, type LicenceRow } from "../data/db.js";

/**
 * The seller's licence server — the endpoint a buyer agent is routed to once a
 * negotiation is accepted.
 *
 * `GET /licence/grant` is wrapped in x402: an unpaid request comes back as
 * HTTP 402 with the payment requirements, the buyer agent pays and retries,
 * and the same request then returns the licence grant. `/catalog` deliberately
 * stays free — a buyer agent has to be able to discover what is on offer and
 * at what price *before* it can decide to pay.
 *
 * **Each licence is priced per negotiation**: the 402 quotes `quotePrice`
 * (shares × the track's per-share rate) for the licence named in the request,
 * the same number the seller's acceptance advertised. The old fixed route
 * price — and with it the "negotiated price ≠ charged price" gap — is gone.
 *
 * The server holds **no Hedera key**: verification and settlement are done by
 * the facilitator, so the seller only ever declares where the money should go.
 * Structure follows matevszm/x402-hedera-example (Hono there, Express here).
 */

export { HBAR_ASSET_ID, LICENCE_GRANT_PATH, NETWORK } from "./config.js";

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

/** Reads the licence row a request names, or undefined. */
function licenceFor(id: number): LicenceRow | undefined {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const db = openDatabase();
  try {
    return db.prepare("SELECT * FROM licences WHERE id = ?").get(id) as LicenceRow | undefined;
  } finally {
    db.close();
  }
}

/**
 * Prices the request from its licence row — `quotePrice` over the negotiated
 * track and share count, never a constant. `requireAcceptedLicence` runs
 * before the payment middleware, so by the time this is called the licence is
 * known to exist and to be an open acceptance.
 */
async function licenceQuote(context: HTTPRequestContext) {
  const raw = context.adapter.getQueryParam?.("licenceId");
  const licence = licenceFor(Number(Array.isArray(raw) ? raw[0] : raw));
  if (!licence) {
    throw new Error("licenceQuote reached without a licence — guard ordering broken");
  }
  const priceHbar = await quotePrice(licence.track_id, licence.shares);
  return { asset: HBAR_ASSET_ID, amount: hbarToTinybar(priceHbar) };
}

const routes: RoutesConfig = {
  [`GET ${LICENCE_GRANT_PATH}`]: {
    description:
      "The licence grant for an accepted negotiation: fractional rights to a track, master reference included. Priced per licence.",
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: payToAccount,
      price: licenceQuote,
      // Generous window: the buyer agent has to sign and submit a real Hedera
      // transaction between receiving the 402 and retrying.
      maxTimeoutSeconds: 180,
    },
  },
};

export const app = express();

/** Public catalogue — free, so a buyer agent can discover the offer. */
app.get("/catalog", (_req, res) => {
  const db = openDatabase();
  try {
    res.json({
      tracks: listTracks(db).map((track) => ({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        totalShares: track.total_shares,
        availableShares: track.available_shares,
        basePricePerShareHbar: track.base_price_per_share,
      })),
      endpoint: {
        path: LICENCE_GRANT_PATH,
        pricing: "quotePrice: shares × the track's per-share rate, per negotiated licence",
        asset: HBAR_ASSET_ID,
        network: NETWORK,
        payTo: payToAccount,
        params: ["trackId", "shares", "licenceType", "territory", "useCase", "licenceId"],
      },
    });
  } finally {
    db.close();
  }
});

/**
 * Refuses any paid request that no negotiation authorised.
 *
 * Without this the three gates in the seller's agent are decorative: the policy
 * is applied during the A2A conversation, but the endpoint itself would grant a
 * forbidden licence to anyone holding the price. A request has to name the
 * licence it belongs to, that licence has to be an open acceptance, and the
 * terms have to be the ones that were agreed — otherwise the request is refused
 * *before* the payment middleware, so no price is ever quoted for it.
 */
function requireAcceptedLicence(req: Request, res: Response, next: NextFunction): void {
  const licenceId = Number(req.query["licenceId"]);

  if (!Number.isInteger(licenceId) || licenceId <= 0) {
    res.status(403).json({
      error: "negotiation_required",
      message:
        "This endpoint only serves licences an agent negotiated for. Open a negotiation with the " +
        "seller agent first; the acceptance carries the URL to pay, licenceId included.",
    });
    return;
  }

  const licence = licenceFor(licenceId);

  if (!licence) {
    res.status(403).json({
      error: "unknown_negotiation",
      message: `No licence ${licenceId} exists.`,
    });
    return;
  }

  if (licence.status !== "accepted") {
    // Covers a refused offer and, just as importantly, one already paid for:
    // a settled licence cannot be replayed to collect the grant twice.
    res.status(403).json({
      error: "negotiation_not_open",
      message:
        `Licence ${licenceId} is "${licence.status}", not an open acceptance. ` +
        "Each acceptance can be settled once.",
    });
    return;
  }

  // Deliberately does not echo the stored terms back — a caller probing with
  // guesses should not be told what the right answer was. Both sides pass
  // through parseLicenceCriteria, so normalisation is identical.
  const requested = parseLicenceCriteria(req.query);
  const matches =
    requested.trackId === licence.track_id &&
    requested.shares === licence.shares &&
    requested.licenceType === licence.licence_type &&
    (requested.territory ?? "worldwide") === licence.territory &&
    requested.useCase === licence.use_case;

  if (!matches) {
    res.status(403).json({
      error: "criteria_mismatch",
      message:
        `The terms in this request are not the ones licence ${licenceId} agreed on. ` +
        "Request the licence that was accepted, or negotiate again for a different one.",
    });
    return;
  }

  next();
}

// Ahead of the payment middleware on purpose: a request the seller never agreed
// to must not even be quoted a price, let alone be able to pay it.
app.get(LICENCE_GRANT_PATH, requireAcceptedLicence);

// Only paths present in `routes` are charged; everything else passes through.
app.use(paymentMiddleware(routes, x402Server));

/**
 * Runs the seller's post-payment chain once the response is on its way out.
 *
 * The middleware settles *after* the handler has produced its body, so the
 * transaction id only exists at that point — it arrives in the `PAYMENT-RESPONSE`
 * header, which is set just before the response is flushed.
 */
function scheduleCompletion(res: Response, licenceId: number): void {
  res.on("finish", () => {
    if (res.statusCode !== 200) return;

    const header = res.getHeader("payment-response") ?? res.getHeader("x-payment-response");
    if (!header) {
      console.warn(`[settle] no PAYMENT-RESPONSE header; licence ${licenceId} left open`);
      return;
    }

    let transactionId: string;
    let payer: string | undefined;
    try {
      const settled = decodePaymentResponseHeader(String(header));
      transactionId = String(settled.transaction);
      // Who actually paid — the certificate NFT goes to this account, not to a
      // configured one, so a different payer would get its own certificate.
      payer = settled.payer ? String(settled.payer) : undefined;
    } catch (error) {
      console.error(`[settle] could not decode PAYMENT-RESPONSE:`, error);
      return;
    }

    // Deliberately not awaited: the buyer already has its grant, and the audit
    // and reputation writes are Hedera transactions of their own.
    recordCompletedSale(licenceId, transactionId, payer)
      .then((sale) => {
        console.log(
          sale.alreadyCompleted
            ? `[settle] licence ${sale.licenceId} was already completed — no second audit entry or feedback written`
            : `[settle] licence ${sale.licenceId} completed — buyer ${sale.buyerUaid}, ` +
              `payment ${sale.transactionId}, HCS seq ${sale.auditSequenceNumber ?? "-"}, ` +
              `feedback #${sale.feedbackIndex ?? "-"}, certificate #${sale.certificate?.serial ?? "-"}`,
        );
        for (const problem of sale.errors) console.error(`[settle] ${problem}`);
      })
      .catch((error) => console.error("[settle] post-payment chain failed:", error));
  });
}

app.get(LICENCE_GRANT_PATH, async (req, res) => {
  // Reaching this handler means the facilitator has verified the payment.
  // The grant decrypts the master reference in memory on the way into the
  // response — the catalogue row itself only ever holds ciphertext.
  const licenceId = Number(req.query["licenceId"]);
  try {
    const grant = await buildLicenceGrant(licenceId);

    // `requireAcceptedLicence` has already established that this id names an
    // open acceptance whose agreed terms are the ones being requested.
    scheduleCompletion(res, licenceId);

    res.json(grant);
  } catch (error) {
    if (error instanceof LicenceNotGrantableError) {
      // 409: the request was well-formed and paid for, but the licence moved
      // out from under it between the guard and the grant.
      res.status(409).json({
        error: "licence_not_grantable",
        message: error.message,
      });
      return;
    }
    throw error;
  }
});

export function startX402Server(port: number = PORT) {
  return app.listen(port, () => {
    console.log(`x402 licence server listening on http://localhost:${port}`);
    console.log(`  facilitator: ${facilitatorUrl}`);
    console.log(`  pay to:      ${payToAccount} (${NETWORK})`);
    console.log(`  GET /catalog        (free)`);
    console.log(
      `  GET ${LICENCE_GRANT_PATH} (priced per licence via quotePrice, asset ${HBAR_ASSET_ID})`,
    );
  });
}

// Only start listening when run directly, so a test can own the lifecycle.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startX402Server();
}
