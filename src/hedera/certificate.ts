import "dotenv/config";
import { TokenMintTransaction, TransferTransaction } from "@hiero-ledger/sdk";
import { createSellerClient } from "./clients.js";

/**
 * Licence certificate NFTs — the product itself, minted to the account that paid.
 *
 * In the fitness version this token was a side-receipt; here it *is* the
 * deliverable's on-chain half: the buyer's proof of holding a fractional
 * licence to a track. The grant (P2.4) carries the decrypted master reference
 * off-chain; the certificate ties the deal to a token in the buyer's own
 * account, so the buyer walks away holding the evidence rather than having to
 * trust the seller's records.
 *
 * The collection is created once by `scripts/create-licence-token.ts`; the
 * seller is its treasury and sole supply key, so only the rights holder's
 * agent can issue certificates.
 */

/**
 * Hedera caps NFT metadata at 100 bytes, so the certificate carries the deal's
 * compact facts, not documents:
 *
 *   `{"t":3,"sh":500,"l":"sync","hcs":44}`
 *
 * `t` is the track id, `sh` the licensed shares in basis points, `l` the
 * licence type, and `hcs` the sale's audit sequence number on the topic —
 * where the full record of the deal lives.
 */
export interface CertificateMetadata {
  t: number;
  sh: number;
  l: string;
  hcs?: number;
}

const METADATA_BYTE_CAP = 100;

export interface MintedCertificate {
  tokenId: string;
  serial: number;
  metadata: CertificateMetadata;
  mintTransactionId: string;
  transferTransactionId: string;
  /** The token's own page — the certificate as the buyer would show it. */
  hashscanUrl: string;
}

/** The collection id, when the one-time setup has been run. */
export function certificateTokenId(): string | undefined {
  return process.env.HTS_LICENCE_TOKEN_ID || undefined;
}

export function buildCertificateMetadata(
  trackId: number,
  shares: number,
  licenceType: string,
  auditSequenceNumber?: number,
): CertificateMetadata {
  return {
    t: trackId,
    sh: shares,
    l: licenceType,
    ...(auditSequenceNumber !== undefined ? { hcs: auditSequenceNumber } : {}),
  };
}

/**
 * Mints one certificate and hands it to the buyer.
 *
 * Two transactions: the mint (an NFT is always born in the treasury), then the
 * transfer to the payer. The buyer must already be associated with the
 * collection — `scripts/create-licence-token.ts` does that for the demo buyer.
 */
export async function mintCertificate(options: {
  tokenId: string;
  trackId: number;
  shares: number;
  licenceType: string;
  buyerAccountId: string;
  auditSequenceNumber?: number;
}): Promise<MintedCertificate> {
  const metadata = buildCertificateMetadata(
    options.trackId,
    options.shares,
    options.licenceType,
    options.auditSequenceNumber,
  );

  const encoded = Buffer.from(JSON.stringify(metadata), "utf8");
  if (encoded.length > METADATA_BYTE_CAP) {
    // Should be unreachable with the compact shape; better an explicit error
    // than a mint the network rejects with an opaque status.
    throw new Error(
      `Certificate metadata is ${encoded.length} bytes — Hedera caps NFT metadata at ${METADATA_BYTE_CAP}.`,
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
