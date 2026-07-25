import "dotenv/config";
import {
  AccountCreateTransaction,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { createBuyerClient, createSellerClient } from "../src/hedera/clients.js";
import { certificateTokenId, mintCertificate } from "../src/hedera/certificate.js";
import { toHashScanTransactionId } from "../src/x402/pay.js";

/**
 * Proves the certificate collection's 5% royalty actually fires.
 *
 * Two transfers, and the contrast between them is the whole point:
 *
 *   1. **Delivery** — the seller mints a certificate and hands it to the buyer,
 *      exactly as a completed licence does. No fungible value rides along
 *      (the licence was paid for separately over x402), and the collection has
 *      no fallback fee, so **no royalty is charged**. Delivery stays free.
 *   2. **Resale** — the buyer sells that same certificate onward to a third
 *      account for real HBAR, in a single CryptoTransfer signed by both sides.
 *      Fungible value is now exchanged for the NFT, so the ledger assesses the
 *      royalty and pays it to the rights holder — who is not a party to that
 *      trade at all.
 *
 * A third account is created for step 2 on purpose. Selling the certificate
 * back to the rights holder would also assess the fee, but the rights holder
 * would then be paying the HBAR the royalty is taken from — proving the
 * mechanism while muddying the claim. An unrelated buyer is the real story:
 * the artist keeps earning on a resale they had no part in.
 *
 *   npx tsx scripts/verify-royalty.ts
 *
 * Costs a few testnet HBAR: one account creation, one association, one sale.
 */

const SALE_PRICE_HBAR = 10;
const EXPECTED_ROYALTY_TINYBAR = (SALE_PRICE_HBAR * 100_000_000 * 5) / 100;
/** Funds the third account: the sale price plus room for fees. */
const SECONDARY_FUNDING_HBAR = 25;

const MIRROR_NODE = "https://testnet.mirrornode.hedera.com";

const checks: [string, boolean, string][] = [];

function record(label: string, passed: boolean, detail = ""): void {
  checks.push([label, passed, detail]);
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`       ${detail}`);
}

interface AssessedFee {
  amount: number;
  collector_account_id: string;
  effective_payer_account_ids?: string[];
  token_id: string | null;
}

interface MirrorTransfer {
  account: string;
  amount: number;
}

interface MirrorTransaction {
  assessed_custom_fees?: AssessedFee[];
  transfers?: MirrorTransfer[];
}

/** A transaction as the mirror node recorded it — fees assessed and money moved. */
async function mirrorTransaction(transactionId: string): Promise<MirrorTransaction> {
  const mirrorId = toHashScanTransactionId(transactionId);
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch(`${MIRROR_NODE}/api/v1/transactions/${mirrorId}`);
    if (!response.ok) continue;
    const body = (await response.json()) as { transactions?: MirrorTransaction[] };
    const transaction = body.transactions?.[0];
    if (transaction) return transaction;
  }
  throw new Error(`Transaction ${transactionId} never appeared on the mirror node`);
}

async function main(): Promise<void> {
  const tokenId = certificateTokenId();
  if (!tokenId) {
    throw new Error("HTS_LICENCE_TOKEN_ID is not set — run scripts/create-licence-token.ts.");
  }

  console.log("Royalty fee on licence certificates");
  console.log("===================================");
  console.log(`\nCollection ${tokenId}, 5% royalty to the rights holder, no fallback fee.`);

  const seller = createSellerClient();
  const buyer = createBuyerClient();
  const sellerId = seller.operatorAccountId!.toString();
  const buyerId = buyer.operatorAccountId!.toString();

  try {
    // ---- 1. Delivery: mint → treasury → buyer, no fungible value ----------
    console.log("\n=== 1. Delivering a certificate (no value alongside) ===\n");

    const minted = await mintCertificate({
      tokenId,
      trackId: 1,
      shares: 500,
      licenceType: "sync",
      buyerAccountId: buyerId,
    });
    console.log(`       minted serial ${minted.serial}, delivered to ${buyerId}`);
    console.log(`       transfer tx ${minted.transferTransactionId}`);

    const deliveryFees =
      (await mirrorTransaction(minted.transferTransactionId)).assessed_custom_fees ?? [];
    record(
      "delivery charges no royalty — the buyer is not billed twice",
      deliveryFees.length === 0,
      deliveryFees.length === 0
        ? "no assessed custom fees, as intended with no fallback fee"
        : `unexpected: ${JSON.stringify(deliveryFees)}`,
    );

    // ---- 2. Resale: NFT for HBAR, in one transfer, to a third party -------
    console.log("\n=== 2. Reselling that certificate to a third account ===\n");

    const secondaryKey = PrivateKey.generateECDSA();
    const createResponse = await new AccountCreateTransaction()
      .setKeyWithoutAlias(secondaryKey.publicKey)
      .setInitialBalance(new Hbar(SECONDARY_FUNDING_HBAR))
      .execute(seller);
    const secondaryId = (await createResponse.getReceipt(seller)).accountId!;
    console.log(`       secondary buyer created: ${secondaryId.toString()}`);

    const associate = await new TokenAssociateTransaction()
      .setAccountId(secondaryId)
      .setTokenIds([tokenId])
      .freezeWith(seller)
      .sign(secondaryKey);
    await (await associate.execute(seller)).getReceipt(seller);
    console.log(`       associated with ${tokenId}`);

    // One CryptoTransfer carrying both legs: the certificate one way, the
    // payment the other. The royalty is only assessed when the ledger can see
    // both in the same transaction — split them and it collects nothing.
    const sale = await new TransferTransaction()
      .addNftTransfer(tokenId, minted.serial, buyerId, secondaryId)
      .addHbarTransfer(secondaryId, new Hbar(-SALE_PRICE_HBAR))
      .addHbarTransfer(buyerId, new Hbar(SALE_PRICE_HBAR))
      .freezeWith(buyer)
      .sign(secondaryKey);

    const saleResponse = await sale.execute(buyer);
    const saleReceipt = await saleResponse.getReceipt(buyer);
    const saleTxId = saleResponse.transactionId.toString();
    console.log(`       sold for ${SALE_PRICE_HBAR} ℏ — ${saleReceipt.status.toString()}`);
    console.log(`       sale tx ${saleTxId}`);
    console.log(
      `       HashScan: https://hashscan.io/testnet/transaction/${toHashScanTransactionId(saleTxId)}`,
    );

    const saleRecord = await mirrorTransaction(saleTxId);
    const saleFees = saleRecord.assessed_custom_fees ?? [];
    const royalty = saleFees.find((fee) => fee.collector_account_id === sellerId);

    record(
      "the ledger assessed a royalty on the resale",
      royalty !== undefined,
      saleFees.length ? JSON.stringify(saleFees) : "no assessed custom fees at all",
    );
    record(
      `the royalty is 5% of the ${SALE_PRICE_HBAR} ℏ paid (${EXPECTED_ROYALTY_TINYBAR} tinybar)`,
      royalty?.amount === EXPECTED_ROYALTY_TINYBAR,
      `assessed ${royalty?.amount} tinybar`,
    );
    record(
      "it was collected by the rights holder, who was not party to the sale",
      royalty?.collector_account_id === sellerId,
      `collector ${royalty?.collector_account_id} (rights holder ${sellerId}); ` +
        `sale was ${buyerId} → ${secondaryId.toString()}`,
    );
    record(
      "it was charged to the account that received the payment",
      royalty?.effective_payer_account_ids?.includes(buyerId) === true,
      `effective payer ${JSON.stringify(royalty?.effective_payer_account_ids)}`,
    );

    // The money moving is the plainest confirmation, and reading it off the
    // sale transaction's own transfer list keeps it exact: a raw before/after
    // balance would also pick up the account-creation and association fees
    // this script pays, which have nothing to do with the royalty.
    const collectorCredit = (saleRecord.transfers ?? []).find(
      (transfer) => transfer.account === sellerId,
    );
    record(
      "the rights holder was actually credited in that transaction",
      collectorCredit?.amount === EXPECTED_ROYALTY_TINYBAR,
      `transfer list credits ${sellerId} with ${collectorCredit?.amount} tinybar`,
    );

    const sellerNet = (saleRecord.transfers ?? [])
      .filter((transfer) => transfer.account === buyerId)
      .reduce((sum, transfer) => sum + transfer.amount, 0);
    record(
      "the reseller received the sale price minus the royalty",
      sellerNet > 0 && sellerNet <= SALE_PRICE_HBAR * 100_000_000 - EXPECTED_ROYALTY_TINYBAR,
      `${buyerId} netted ${sellerNet} tinybar of the ${SALE_PRICE_HBAR * 100_000_000} paid`,
    );

    console.log(`\n  Proof: https://hashscan.io/testnet/transaction/${toHashScanTransactionId(saleTxId)}`);
  } finally {
    seller.close();
    buyer.close();
  }

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n===================================`);
  console.log(`${passed}/${checks.length} checks passed`);
  for (const [label, ok, detail] of checks) {
    if (!ok) console.log(`  FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  }
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nRoyalty verification failed:", error);
  process.exit(1);
});
