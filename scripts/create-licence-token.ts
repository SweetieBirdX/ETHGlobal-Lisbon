import "dotenv/config";
import {
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenType,
} from "@hiero-ledger/sdk";
import { createBuyerClient, createSellerClient } from "../src/hedera/clients.js";

/**
 * Creates the "Music Licence Certificate" NFT collection, once per environment.
 *
 * After every completed sale the seller mints one NFT from this collection to
 * the account that paid — the on-chain half of the licence itself, with
 * metadata naming the track, the licensed shares, the licence type and the
 * HCS audit entry. This script is the one-time setup behind that: create the
 * collection, associate the demo buyer so it can receive from it, print the
 * id for `.env`.
 *
 *   npx tsx scripts/create-licence-token.ts
 *
 * Unlike a topic, an NFT collection is not disposable — every run mints a NEW
 * collection and orphans the old one's certificates — so the script refuses to
 * run when HTS_LICENCE_TOKEN_ID is already set, unless FORCE=1.
 */

const TOKEN_NAME = "Music Licence Certificate";
const TOKEN_SYMBOL = "MLIC";

async function main(): Promise<void> {
  if (process.env.HTS_LICENCE_TOKEN_ID && process.env.FORCE !== "1") {
    console.log(
      `HTS_LICENCE_TOKEN_ID is already set (${process.env.HTS_LICENCE_TOKEN_ID}) — the collection exists.\n` +
        `Running again would create a second collection and orphan the certificates in this one.\n` +
        `Set FORCE=1 if that is genuinely what you want.`,
    );
    return;
  }

  const seller = createSellerClient();
  const buyer = createBuyerClient();

  try {
    // The seller is treasury and holds the supply key: only the rights
    // holder's agent can issue certificates. No admin key — the collection is
    // immutable.
    const createResponse = await new TokenCreateTransaction()
      .setTokenName(TOKEN_NAME)
      .setTokenSymbol(TOKEN_SYMBOL)
      .setTokenType(TokenType.NonFungibleUnique)
      .setTreasuryAccountId(seller.operatorAccountId!)
      .setSupplyKey(seller.operatorPublicKey!)
      .execute(seller);

    const createReceipt = await createResponse.getReceipt(seller);
    const tokenId = createReceipt.tokenId;
    if (!tokenId) {
      throw new Error(
        `Token creation returned no tokenId (status: ${createReceipt.status.toString()}).`,
      );
    }

    console.log(`NFT collection created: ${tokenId.toString()} ("${TOKEN_NAME}" / ${TOKEN_SYMBOL})`);
    console.log(`Treasury / supply key:  ${seller.operatorAccountId!.toString()} (seller)`);
    console.log(`HashScan: https://hashscan.io/testnet/token/${tokenId.toString()}`);

    // Hedera accounts only hold tokens they have associated with, so the buyer
    // opts in here — without this, the post-sale transfer would fail.
    const associateResponse = await new TokenAssociateTransaction()
      .setAccountId(buyer.operatorAccountId!)
      .setTokenIds([tokenId])
      .execute(buyer);
    const associateReceipt = await associateResponse.getReceipt(buyer);

    console.log(
      `Buyer ${buyer.operatorAccountId!.toString()} associated: ${associateReceipt.status.toString()}`,
    );
    console.log("");
    console.log("Add this line to your .env:");
    console.log(`HTS_LICENCE_TOKEN_ID=${tokenId.toString()}`);
  } finally {
    seller.close();
    buyer.close();
  }
}

main().catch((error) => {
  console.error("Licence collection setup failed:", error);
  process.exit(1);
});
