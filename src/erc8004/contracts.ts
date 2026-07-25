import "dotenv/config";
import { Contract, JsonRpcProvider, getAddress } from "ethers";
import identityRegistryAbi from "./abis/IdentityRegistry.json" with { type: "json" };
import reputationRegistryAbi from "./abis/ReputationRegistry.json" with { type: "json" };

/**
 * Connections to the ERC-8004 registries already deployed on Hedera Testnet.
 *
 * These are what make the two agents accountable to each other: the buyer's
 * claim to be a research company is an on-chain identity the seller can check
 * (Phase 5.4), and the outcome of a deal is feedback anyone can read back
 * (Phase 5.5). We do not deploy our own copies — the addresses are fixed.
 *
 * Hedera exposes an Ethereum JSON-RPC relay, so plain `ethers` works against it
 * unchanged; these contracts are EVM contracts living on Hedera testnet.
 */

/** Hashio is Hedera's public JSON-RPC relay for testnet. */
export const HEDERA_JSON_RPC_URL =
  process.env.HEDERA_JSON_RPC_URL ?? "https://testnet.hashio.io/api";

function requireAddress(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name} — copy it from .env.example (the ERC-8004 addresses are fixed, not per-user).`,
    );
  }
  // Normalises casing and rejects a malformed address here rather than at the
  // first failed call, where it would look like a network problem.
  return getAddress(value);
}

export const IDENTITY_REGISTRY_ADDRESS = requireAddress(
  "ERC8004_IDENTITY_REGISTRY",
);
export const REPUTATION_REGISTRY_ADDRESS = requireAddress(
  "ERC8004_REPUTATION_REGISTRY",
);

/** Shared read-only provider. Writes get a wallet attached in Phase 5.3. */
export const provider = new JsonRpcProvider(HEDERA_JSON_RPC_URL);

/**
 * ERC-8004 IdentityRegistry — an ERC-721 where each token is an agent identity
 * and its metadata says who operates it.
 */
export const identityRegistry = new Contract(
  IDENTITY_REGISTRY_ADDRESS,
  identityRegistryAbi,
  provider,
);

/** ERC-8004 ReputationRegistry — feedback left by one agent about another. */
export const reputationRegistry = new Contract(
  REPUTATION_REGISTRY_ADDRESS,
  reputationRegistryAbi,
  provider,
);
