import "dotenv/config";
import type { Server } from "node:http";
import { createSellerApp, SELLER_PORT } from "../src/a2a/seller-server.js";
import { negotiateAndPurchase } from "../src/a2a/buyer-client.js";
import { recordCompletedSale } from "../src/a2a/seller-executor.js";
import { openDatabase, type QueryRow } from "../src/data/db.js";
import { receiptTokenId, type ReceiptMetadata } from "../src/hedera/receipt.js";
import { createWebApp } from "../src/web/server.js";
import { startX402Server } from "../src/x402/server.js";

/**
 * The receipt NFT: minted once per completed sale, into the payer's account.
 *
 * Three claims, each checked against state we do not control:
 *
 *  1. After a real purchase, the buyer's account holds a new NFT from the
 *     receipt collection — confirmed via the mirror node, not our ledger — and
 *     its on-chain metadata points back at the negotiation, the HCS audit
 *     entry and the compliance attestation.
 *  2. Replaying the settlement mints nothing: the completed-guard covers the
 *     mint exactly as it covers the HCS and reputation writes.
 *  3. The earnings panel exposes the serial and a HashScan link.
 *
 *   npx tsx scripts/test-receipt-nft.ts
 *
 * Costs 0.5 HBAR (one real purchase) plus sub-cent HTS fees.
 */

const MIRROR = "https://testnet.mirrornode.hedera.com";
const WEB_TEST_PORT = 4199;

/** The whole post-payment chain plus mirror-node lag. */
const COMPLETION_TIMEOUT_MS = 90_000;
const POLL_MS = 5_000;

const checks: [string, boolean, string][] = [];

function record(label: string, passed: boolean, detail = ""): void {
  checks.push([label, passed, detail]);
  console.log(`  ${passed ? "OK  " : "FAIL"} ${label}`);
  if (detail) console.log(`       ${detail}`);
}

interface MirrorNft {
  serial_number: number;
  token_id: string;
  metadata: string;
}

/** Serials from the receipt collection sitting in the buyer's account. */
async function buyerReceiptSerials(tokenId: string, account: string): Promise<MirrorNft[]> {
  const response = await fetch(
    `${MIRROR}/api/v1/tokens/${tokenId}/nfts?account.id=${account}&limit=100`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { nfts?: MirrorNft[] };
  return body.nfts ?? [];
}

async function tokenSupply(tokenId: string): Promise<number> {
  const response = await fetch(`${MIRROR}/api/v1/tokens/${tokenId}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json()) as { total_supply?: string };
  return Number(body.total_supply ?? 0);
}

function readQuery(queryId: number): QueryRow | undefined {
  const db = openDatabase();
  try {
    return db.prepare("SELECT * FROM queries WHERE id = ?").get(queryId) as
      | QueryRow
      | undefined;
  } finally {
    db.close();
  }
}

async function waitForReceipt(queryId: number): Promise<QueryRow | undefined> {
  const deadline = Date.now() + COMPLETION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const row = readQuery(queryId);
    if (row?.status === "completed" && row.receipt_serial) return row;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return readQuery(queryId);
}

async function main(): Promise<void> {
  console.log("HTS receipt NFT — one per sale, in the payer's own account");
  console.log("==========================================================");

  const tokenId = receiptTokenId();
  if (!tokenId) {
    throw new Error(
      "HTS_RECEIPT_TOKEN_ID is not set — run `npx tsx scripts/create-receipt-token.ts` first.",
    );
  }
  const buyerAccount = process.env.BUYER_ACCOUNT_ID!;
  console.log(`\ncollection ${tokenId}, buyer account ${buyerAccount}\n`);

  const servers: Server[] = [];
  try {
    servers.push(createSellerApp().listen(SELLER_PORT));
    servers.push(startX402Server());
    servers.push(createWebApp().listen(WEB_TEST_PORT));
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const supplyBefore = await tokenSupply(tokenId);
    const heldBefore = await buyerReceiptSerials(tokenId, buyerAccount);
    console.log(
      `baseline: total supply ${supplyBefore}, buyer holds ${heldBefore.length}\n`,
    );

    // --- one real purchase -------------------------------------------------
    const result = await negotiateAndPurchase({ category: "running performance" }, 0.5, {
      onStep: (message) => console.log(`  ${message}`),
    });
    console.log("");
    record(
      "the purchase itself settled",
      result.purchase?.settlement?.success === true,
      String(result.purchase?.settlement?.transaction),
    );

    const queryId = Number(
      new URL(result.negotiation.payment!.url).searchParams.get("queryId"),
    );

    console.log("\n  waiting for the post-payment chain and the mirror node...\n");
    const row = await waitForReceipt(queryId);

    record(
      "the sale completed and recorded a receipt serial",
      row?.status === "completed" && Boolean(row?.receipt_serial),
      `query #${queryId} status=${row?.status} receipt_serial=${row?.receipt_serial}`,
    );

    // --- the NFT is really in the buyer's account, per the mirror node -----
    let held = await buyerReceiptSerials(tokenId, buyerAccount);
    const deadline = Date.now() + 30_000;
    while (held.length <= heldBefore.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      held = await buyerReceiptSerials(tokenId, buyerAccount);
    }

    const minted = held.find((nft) => String(nft.serial_number) === row?.receipt_serial);
    record(
      "the buyer's account holds the new receipt (mirror node)",
      minted !== undefined,
      `buyer now holds ${held.length} (was ${heldBefore.length}); looking for serial ${row?.receipt_serial}`,
    );

    // --- and its on-chain metadata points back at the right proofs ---------
    let metadata: ReceiptMetadata | undefined;
    try {
      metadata = JSON.parse(
        Buffer.from(minted?.metadata ?? "", "base64").toString("utf8"),
      ) as ReceiptMetadata;
    } catch {
      /* record below */
    }

    record(
      "on-chain metadata names this negotiation",
      metadata?.q === queryId,
      `metadata=${JSON.stringify(metadata)}`,
    );

    const attestationHash = (JSON.parse(row?.criteria ?? "{}") as { attestation?: string })
      .attestation;
    record(
      "on-chain metadata prefixes the attestation hash",
      Boolean(metadata?.att) &&
        Boolean(attestationHash) &&
        attestationHash!.startsWith(metadata!.att!),
      `att=${metadata?.att} vs ${attestationHash?.slice(0, 20)}…`,
    );
    record(
      "on-chain metadata references the HCS audit entry",
      typeof metadata?.hcs === "number" && metadata.hcs > 0,
      `hcs seq ${metadata?.hcs}`,
    );

    // --- replay mints nothing ----------------------------------------------
    const supplyAfter = await tokenSupply(tokenId);
    const replay = await recordCompletedSale(queryId, "0.0.9999999@1.2", buyerAccount);
    record(
      "replaying the settlement is refused by the completed-guard",
      replay.alreadyCompleted === true && replay.receipt === undefined,
      `alreadyCompleted=${replay.alreadyCompleted}`,
    );

    await new Promise((resolve) => setTimeout(resolve, 8_000));
    record(
      "total supply did not move on the replay",
      (await tokenSupply(tokenId)) === supplyAfter,
      `supply ${supplyAfter}`,
    );
    record(
      "the recorded serial is unchanged",
      readQuery(queryId)?.receipt_serial === row?.receipt_serial,
    );

    // --- the panel shows it -------------------------------------------------
    const earnings = (await (
      await fetch(`http://localhost:${WEB_TEST_PORT}/api/earnings`)
    ).json()) as {
      sales?: { id: number; receiptSerial?: string; receiptUrl?: string }[];
    };
    const panelRow = earnings.sales?.find((sale) => sale.id === queryId);
    record(
      "the earnings panel exposes the serial and a HashScan link",
      panelRow?.receiptSerial === row?.receipt_serial &&
        Boolean(panelRow?.receiptUrl?.includes(`/token/${tokenId}/`)),
      `${panelRow?.receiptUrl}`,
    );
  } finally {
    for (const server of servers) server.close();
  }

  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\n==========================================================`);
  console.log(`${passed}/${checks.length} checks passed`);
  for (const [label, ok, detail] of checks) {
    if (!ok) console.log(`  FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  }

  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nReceipt NFT test failed:", error);
  process.exit(1);
});
