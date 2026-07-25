import "dotenv/config";
import { existsSync, writeFileSync } from "node:fs";
import {
  formatEther,
  type Contract,
  type Log,
  type LogDescription,
  type Wallet,
} from "ethers";
import { identityRegistry, provider } from "../src/erc8004/contracts.js";
import { createBuyerWallet, createSellerWallet } from "../src/erc8004/wallets.js";
import {
  buyerRegistrationFile,
  sellerRegistrationFile,
  toDataUri,
  type RegistrationFile,
} from "../src/erc8004/registration-files.js";

/**
 * Gives each agent its own ERC-8004 identity on Hedera testnet.
 *
 * From here on the two agents are accountable to each other: the seller can
 * check that a buyer is a registered agent before releasing anything, and
 * feedback about a deal (Phase 5.5) attaches to these ids.
 *
 *   npx tsx scripts/register-agents.ts
 *
 * Registration is permanent and every run mints a NEW identity, so the script
 * refuses to run twice unless FORCE=1 is set.
 */

const OUTPUT_FILE = "agent-ids.json";

/** Registration is a small call, but Hedera's relay does not always estimate it. */
const GAS_LIMIT = 1_000_000n;

interface RegisteredAgent {
  agentId: string;
  owner: string;
  transactionHash: string;
  agentURI: string;
}

async function register(
  label: string,
  wallet: Wallet,
  file: RegistrationFile,
): Promise<RegisteredAgent> {
  const agentURI = toDataUri(file);
  const balance = await provider.getBalance(wallet.address);

  console.log(`\n=== ${label} ===`);
  console.log(`wallet:  ${wallet.address}`);
  console.log(`balance: ${formatEther(balance)} HBAR`);
  console.log(`uri:     ${agentURI.slice(0, 60)}… (${agentURI.length} chars)`);

  if (balance === 0n) {
    throw new Error(
      `${label} wallet ${wallet.address} has no balance on the EVM side — ` +
        `the account's EVM alias must be funded before it can send transactions.`,
    );
  }

  // `register` has three overloads; the signature disambiguates which one.
  const registry = identityRegistry.connect(wallet) as Contract;
  const tx = await registry["register(string)"]!(agentURI, {
    gasLimit: GAS_LIMIT,
  });
  console.log(`tx sent: ${tx.hash}`);

  const receipt = await tx.wait();
  if (!receipt) throw new Error(`${label}: transaction produced no receipt`);

  // register() returns the id, but a transaction cannot hand back a return
  // value — the Registered event is where the id actually arrives.
  const event = receipt.logs
    .map((log: Log): LogDescription | null => {
      try {
        return identityRegistry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: LogDescription | null) => parsed?.name === "Registered");

  if (!event) {
    throw new Error(
      `${label}: no Registered event in transaction ${tx.hash} (status ${receipt.status})`,
    );
  }

  const agentId = String(event.args["agentId"]);
  console.log(`agentId: ${agentId} (block ${receipt.blockNumber})`);

  return {
    agentId,
    owner: wallet.address,
    transactionHash: tx.hash,
    agentURI,
  };
}

async function main(): Promise<void> {
  if (existsSync(OUTPUT_FILE) && process.env.FORCE !== "1") {
    console.log(
      `${OUTPUT_FILE} already exists — the agents are registered.\n` +
        `Registering again would mint new identities and orphan the old ones.\n` +
        `Set FORCE=1 if that is genuinely what you want.`,
    );
    return;
  }

  const seller = await register(
    "Seller agent",
    createSellerWallet(),
    sellerRegistrationFile,
  );
  const buyer = await register(
    "Buyer agent",
    createBuyerWallet(),
    buyerRegistrationFile,
  );

  writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({ seller, buyer, registeredAt: new Date().toISOString() }, null, 2)}\n`,
  );

  console.log(`\nWrote ${OUTPUT_FILE}`);
  console.log(`  seller agentId ${seller.agentId}`);
  console.log(`  buyer  agentId ${buyer.agentId}`);
}

main().catch((error) => {
  console.error("Agent registration failed:", error);
  process.exit(1);
});
