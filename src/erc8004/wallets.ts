import "dotenv/config";
import { PrivateKey } from "@hiero-ledger/sdk";
import { Wallet } from "ethers";
import { provider } from "./contracts.js";

/**
 * EVM-side wallets for the two agents.
 *
 * The same Hedera accounts that pay for HCS messages and HBAR transfers also
 * act on the ERC-8004 registries — Hedera gives every ECDSA account an EVM
 * alias, so it is one identity seen through two APIs.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name} — see .env.example.`);
  }
  return value;
}

/**
 * Hedera hands out ECDSA keys in DER form while ethers wants the raw 32 bytes;
 * the Hedera SDK is the reliable way to normalise whichever form is in `.env`.
 */
function walletFromHederaKey(privateKeyVar: string): Wallet {
  const raw = PrivateKey.fromStringECDSA(requireEnv(privateKeyVar)).toStringRaw();
  return new Wallet(`0x${raw}`, provider);
}

export function createSellerWallet(): Wallet {
  return walletFromHederaKey("SELLER_PRIVATE_KEY");
}

export function createBuyerWallet(): Wallet {
  return walletFromHederaKey("BUYER_PRIVATE_KEY");
}
