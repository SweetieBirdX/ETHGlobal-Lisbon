import "dotenv/config";
import { Hbar } from "@hiero-ledger/sdk";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import {
  createClientHederaSigner,
  PrivateKey as HederaPrivateKey,
} from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { NETWORK } from "./config.js";

/**
 * The buyer side of x402, as a function the agent can call.
 *
 *   1. GET the protected URL                       → 402 + `payment-required`
 *   2. decode the requirements                     → price, asset, recipient
 *   3. sign a Hedera transfer for that exact amount
 *   4. retry the same GET with `payment-signature` → 200 + the data
 *
 * No human approves the payment: the agent is given a price it already agreed
 * to during the negotiation and settles it. `@x402/fetch`'s
 * `wrapFetchWithPayment` would collapse these into one call, but keeping the
 * steps visible is the point — this is the part the demo is about.
 */

export interface PaymentSettlement {
  success: boolean;
  payer: string;
  /** Hedera transaction id, e.g. `0.0.x@seconds.nanos`. */
  transaction: string;
  hashscanUrl: string;
}

export interface PayAndFetchResult<T = unknown> {
  status: number;
  data: T;
  settlement?: PaymentSettlement;
  /** What the endpoint asked for, before paying. */
  quoted: { amountTinybar: string; asset: string; payTo: string; network: string }[];
}

/** `0.0.1234@1700000000.000000000` → `0.0.1234-1700000000-000000000` (HashScan URL form). */
export function toHashScanTransactionId(transactionId: string): string {
  const [accountId, validStart] = transactionId.split("@");
  return validStart ? `${accountId}-${validStart.replace(".", "-")}` : transactionId;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name} — copy .env.example to .env and fill it in (see CLAUDE.md).`,
    );
  }
  return value;
}

/**
 * Builds the buyer's signer. The private key is read here and handed straight
 * to the signer — it is never logged, never put in a URL, and never passed to
 * the LLM-driven parts of the agent.
 */
function createBuyerSigner() {
  return createClientHederaSigner(
    requireEnv("BUYER_ACCOUNT_ID"),
    HederaPrivateKey.fromStringECDSA(requireEnv("BUYER_PRIVATE_KEY")),
    { network: NETWORK },
  );
}

export interface PayAndFetchOptions {
  /** Refuse to pay more than this, in tinybar. Guards against a bad quote. */
  maxAmountTinybar?: string;
  /** Called with each step, so a caller can show the protocol as it happens. */
  onStep?: (message: string) => void;
}

/**
 * Pays for and retrieves an x402-protected resource.
 *
 * @param url the endpoint, including any query parameters that were negotiated
 */
export async function payAndFetch<T = unknown>(
  url: string,
  options: PayAndFetchOptions = {},
): Promise<PayAndFetchResult<T>> {
  const log = options.onStep ?? (() => {});

  // 1. Unpaid request — expected to be rejected with 402.
  log(`-> GET ${url}`);
  const unpaid = await fetch(url);
  log(`<- HTTP ${unpaid.status}`);

  if (unpaid.status !== 402) {
    throw new Error(
      `Expected HTTP 402 Payment Required, got ${unpaid.status}. Is the x402 middleware wired up?`,
    );
  }

  // 2. The 402 carries the terms of the deal in a header, not the body.
  const header = unpaid.headers.get("payment-required");
  if (!header) {
    throw new Error("402 response carried no `payment-required` header");
  }

  const paymentRequired = decodePaymentRequiredHeader(header);
  const quoted = paymentRequired.accepts.map((requirement) => ({
    amountTinybar: String(requirement.amount),
    asset: String(requirement.asset),
    payTo: String(requirement.payTo),
    network: String(requirement.network),
  }));

  for (const requirement of quoted) {
    log(
      `   asking ${Hbar.fromTinybars(requirement.amountTinybar).toString()}` +
        ` (${requirement.amountTinybar} tinybar, asset ${requirement.asset})` +
        ` to ${requirement.payTo} on ${requirement.network}`,
    );
  }

  // An autonomous agent must not sign whatever it is handed: a server that
  // quotes more than the negotiation agreed gets nothing.
  if (options.maxAmountTinybar !== undefined) {
    const overpriced = quoted.find(
      (requirement) => BigInt(requirement.amountTinybar) > BigInt(options.maxAmountTinybar!),
    );
    if (overpriced) {
      throw new Error(
        `Endpoint quoted ${overpriced.amountTinybar} tinybar, above the agreed maximum of ${options.maxAmountTinybar} — refusing to pay.`,
      );
    }
  }

  // 3. Sign a payment matching those requirements.
  const client = new x402Client().register(
    "hedera:*",
    new ExactHederaScheme(createBuyerSigner()),
  );
  const payload = await client.createPaymentPayload(paymentRequired);
  log(`   signed by ${requireEnv("BUYER_ACCOUNT_ID")} — retrying with payment`);

  // 4. Same request, now carrying the signed payment.
  const paid = await fetch(url, {
    headers: { "payment-signature": encodePaymentSignatureHeader(payload) },
  });
  log(`-> GET ${url} (with payment-signature)`);
  log(`<- HTTP ${paid.status}`);

  const data = (await paid.json()) as T;

  if (!paid.ok) {
    const error = new Error(`Payment was rejected: HTTP ${paid.status}`);
    (error as Error & { body?: unknown }).body = data;
    throw error;
  }

  // The facilitator reports the settled Hedera transaction back in a header.
  const raw = new x402HTTPClient(client).getPaymentSettleResponse((name) =>
    paid.headers.get(name),
  );

  const settlement = raw
    ? {
        success: Boolean(raw.success),
        payer: String(raw.payer),
        transaction: String(raw.transaction),
        hashscanUrl: `https://hashscan.io/testnet/transaction/${toHashScanTransactionId(String(raw.transaction))}`,
      }
    : undefined;

  if (settlement) {
    log(`settlement: success=${settlement.success} payer=${settlement.payer}`);
    log(`transaction: ${settlement.transaction}`);
  }

  return { status: paid.status, data, settlement, quoted };
}
