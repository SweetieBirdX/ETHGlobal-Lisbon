import {
  AccountBalanceQuery,
  Hbar,
  TransferTransaction,
  type AccountId,
  type Client,
} from "@hiero-ledger/sdk";
import { createBuyerClient, createSellerClient } from "../src/hedera/clients.js";

/**
 * Proves that value can actually move between the two agent accounts before any
 * of the payment machinery (x402) sits on top of it: sends 0.01 HBAR from the
 * buyer agent to the seller agent and checks the seller's balance grew by
 * exactly that amount.
 *
 *   npx tsx scripts/test-transfer.ts
 */

const TRANSFER_AMOUNT = Hbar.fromString("0.01");

/**
 * Turns the SDK's `0.0.1234@1700000000.000000000` into the
 * `0.0.1234-1700000000-000000000` form HashScan uses in its URLs.
 */
function toHashScanTransactionId(transactionId: string): string {
  const [accountId, validStart] = transactionId.split("@");
  return `${accountId}-${validStart.replace(".", "-")}`;
}

async function getBalance(client: Client, accountId: AccountId): Promise<Hbar> {
  const balance = await new AccountBalanceQuery()
    .setAccountId(accountId)
    .execute(client);
  return balance.hbars;
}

async function main(): Promise<void> {
  const buyer = createBuyerClient();
  const seller = createSellerClient();

  const buyerId = buyer.operatorAccountId!;
  const sellerId = seller.operatorAccountId!;

  try {
    const buyerBefore = await getBalance(buyer, buyerId);
    const sellerBefore = await getBalance(buyer, sellerId);

    console.log(`Sending ${TRANSFER_AMOUNT.toString()} from buyer to seller`);
    console.log(`  buyer  ${buyerId.toString()}: ${buyerBefore.toString()}`);
    console.log(`  seller ${sellerId.toString()}: ${sellerBefore.toString()}`);

    // The buyer is this client's operator, so the SDK signs for the debited
    // account automatically — no human approves the transfer.
    const response = await new TransferTransaction()
      .addHbarTransfer(buyerId, TRANSFER_AMOUNT.negated())
      .addHbarTransfer(sellerId, TRANSFER_AMOUNT)
      .setTransactionMemo("Phase 1.5 transfer test")
      .execute(buyer);

    const receipt = await response.getReceipt(buyer);
    const transactionId = response.transactionId.toString();

    console.log(`\nStatus: ${receipt.status.toString()}`);
    console.log(`Transaction id: ${transactionId}`);
    console.log(
      `HashScan: https://hashscan.io/testnet/transaction/${toHashScanTransactionId(transactionId)}`,
    );

    const buyerAfter = await getBalance(buyer, buyerId);
    const sellerAfter = await getBalance(buyer, sellerId);

    console.log(`\n  buyer  ${buyerId.toString()}: ${buyerAfter.toString()}`);
    console.log(`  seller ${sellerId.toString()}: ${sellerAfter.toString()}`);

    // Compared in tinybars: the seller receives exactly the transferred amount,
    // while the buyer additionally pays the network fee.
    const sellerGain =
      sellerAfter.toTinybars().toNumber() - sellerBefore.toTinybars().toNumber();
    const buyerCost =
      buyerBefore.toTinybars().toNumber() - buyerAfter.toTinybars().toNumber();
    const expected = TRANSFER_AMOUNT.toTinybars().toNumber();

    console.log(
      `\nSeller received: ${Hbar.fromTinybars(sellerGain).toString()}` +
        ` | buyer paid (incl. fee): ${Hbar.fromTinybars(buyerCost).toString()}`,
    );

    if (sellerGain === expected) {
      console.log("OK — seller balance increased by exactly 0.01 ℏ");
    } else {
      console.log(
        `FAILED — expected the seller to gain ${expected} tinybars, got ${sellerGain}`,
      );
      process.exitCode = 1;
    }
  } finally {
    buyer.close();
    seller.close();
  }
}

main().catch((error) => {
  console.error("Transfer test failed:", error);
  process.exit(1);
});
