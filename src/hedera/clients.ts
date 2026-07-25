import "dotenv/config";
import { Client, PrivateKey } from "@hiero-ledger/sdk";

/**
 * Hedera testnet clients for the two autonomous agents.
 *
 * The seller agent (the user's personal data agent) and the buyer agent (the
 * research company) each act from their own Hedera testnet account, so every
 * payment in the demo is a real transfer between two distinct accounts.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name} — copy .env.example to .env and fill it in (see CLAUDE.md).`,
    );
  }
  return value;
}

function createTestnetClient(accountIdVar: string, privateKeyVar: string): Client {
  const accountId = requireEnv(accountIdVar);
  const privateKey = requireEnv(privateKeyVar);

  return Client.forTestnet().setOperator(
    accountId,
    PrivateKey.fromStringECDSA(privateKey),
  );
}

/** Client operating as the seller agent (the data owner / user side). */
export function createSellerClient(): Client {
  return createTestnetClient("SELLER_ACCOUNT_ID", "SELLER_PRIVATE_KEY");
}

/** Client operating as the buyer agent (the research company side). */
export function createBuyerClient(): Client {
  return createTestnetClient("BUYER_ACCOUNT_ID", "BUYER_PRIVATE_KEY");
}
