import "dotenv/config";
import { TokenMintTransaction, TransferTransaction } from "@hiero-ledger/sdk";
import { createSellerClient } from "./clients.js";

/**
 * Receipt NFTs — one per completed sale, minted to the account that paid.
 *
 * A sale already leaves three proofs in three places: the payment transaction,
 * the HCS audit entry, and the gate-1 compliance attestation. The receipt ties
 * them to a single HTS token *in the buyer's own account*, so the buyer walks
 * away holding the evidence rather than having to trust the seller's records.
 *
 * The collection is created once by `scripts/create-receipt-token.ts`; the
 * seller is its treasury and sole supply key, so only the data owner's agent
 * can issue receipts.
 */

/**
 * Hedera caps NFT metadata at 100 bytes, so the receipt carries compact
 * *references* to the proofs, not the proofs themselves:
 *
 *   `{"q":14,"hcs":16,"att":"0xc6f2cc2107ac"}`
 *
 * `q` is the negotiation id, `hcs` the sale's audit sequence number on the
 * topic, and `att` the attestation's requestHash truncated to fit — the full
 * hash lives in the HCS attestation message that `att` prefixes.
 */
export interface ReceiptMetadata {
  q: number;
  hcs?: number;
  att?: string;
}

/** Longest `att` prefix that keeps the whole document under the 100-byte cap. */
const ATTESTATION_PREFIX_LENGTH = 14;
const METADATA_BYTE_CAP = 100;

export interface MintedReceipt {
  tokenId: string;
  serial: number;
  metadata: ReceiptMetadata;
  mintTransactionId: string;
  transferTransactionId: string;
  /** The token's own page — the receipt as the buyer would show it. */
  hashscanUrl: string;
}

/** The collection id, when the one-time setup has been run. */
export function receiptTokenId(): string | undefined {
  return process.env.HTS_RECEIPT_TOKEN_ID || undefined;
}

export function buildReceiptMetadata(
  queryId: number,
  auditSequenceNumber?: number,
  attestationHash?: string,
): ReceiptMetadata {
  return {
    q: queryId,
    ...(auditSequenceNumber !== undefined ? { hcs: auditSequenceNumber } : {}),
    ...(attestationHash
      ? { att: attestationHash.slice(0, ATTESTATION_PREFIX_LENGTH) }
      : {}),
  };
}

/**
 * Mints one receipt and hands it to the buyer.
 *
 * Two transactions: the mint (an NFT is always born in the treasury), then the
 * transfer to the payer. The buyer must already be associated with the
 * collection — `scripts/create-receipt-token.ts` does that for the demo buyer.
 */
export async function mintReceipt(options: {
  tokenId: string;
  queryId: number;
  buyerAccountId: string;
  auditSequenceNumber?: number;
  attestationHash?: string;
}): Promise<MintedReceipt> {
  const metadata = buildReceiptMetadata(
    options.queryId,
    options.auditSequenceNumber,
    options.attestationHash,
  );

  const encoded = Buffer.from(JSON.stringify(metadata), "utf8");
  if (encoded.length > METADATA_BYTE_CAP) {
    // Should be unreachable with the compact shape; better an explicit error
    // than a mint the network rejects with an opaque status.
    throw new Error(
      `Receipt metadata is ${encoded.length} bytes — Hedera caps NFT metadata at ${METADATA_BYTE_CAP}.`,
    );
  }

  const seller = createSellerClient();

  try {
    const mintResponse = await new TokenMintTransaction()
      .setTokenId(options.tokenId)
      .setMetadata([encoded])
      .execute(seller);
    const mintReceiptStatus = await mintResponse.getReceipt(seller);

    const serial = mintReceiptStatus.serials[0]?.toNumber();
    if (serial === undefined) {
      throw new Error(
        `Mint returned no serial (status: ${mintReceiptStatus.status.toString()}).`,
      );
    }

    const transferResponse = await new TransferTransaction()
      .addNftTransfer(
        options.tokenId,
        serial,
        seller.operatorAccountId!,
        options.buyerAccountId,
      )
      .execute(seller);
    await transferResponse.getReceipt(seller);

    return {
      tokenId: options.tokenId,
      serial,
      metadata,
      mintTransactionId: mintResponse.transactionId.toString(),
      transferTransactionId: transferResponse.transactionId.toString(),
      hashscanUrl: `https://hashscan.io/testnet/token/${options.tokenId}/${serial}`,
    };
  } finally {
    seller.close();
  }
}
