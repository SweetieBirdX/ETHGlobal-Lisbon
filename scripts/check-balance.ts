import { AccountBalanceQuery, type Client } from "@hiero-ledger/sdk";
import { createBuyerClient, createSellerClient } from "../src/hedera/clients.js";

/**
 * Sanity check for the Hedera testnet connection: queries the HBAR balance of
 * both agent accounts. Run it whenever a machine is set up for the first time
 * or after `.env` changes.
 *
 *   npx tsx scripts/check-balance.ts
 */

async function printBalance(label: string, client: Client): Promise<void> {
  const accountId = client.operatorAccountId!;
  const balance = await new AccountBalanceQuery()
    .setAccountId(accountId)
    .execute(client);

  console.log(`${label} (${accountId.toString()}): ${balance.hbars.toString()}`);
}

async function main(): Promise<void> {
  const seller = createSellerClient();
  const buyer = createBuyerClient();

  console.log("Hedera testnet balances");
  console.log("-----------------------");

  try {
    await printBalance("Seller agent", seller);
    await printBalance("Buyer agent ", buyer);
  } finally {
    seller.close();
    buyer.close();
  }
}

main().catch((error) => {
  console.error("Balance check failed:", error);
  process.exit(1);
});
