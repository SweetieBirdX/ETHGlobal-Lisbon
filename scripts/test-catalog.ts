import "dotenv/config";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import {
  InsufficientSharesError,
  LicenceNotGrantableError,
  buildLicenceGrant,
  checkAvailability,
  parseLicenceCriteria,
  quotePrice,
} from "../src/data/catalog.js";
import {
  getTrack,
  insertLicence,
  openDatabase,
  updateLicenceStatus,
} from "../src/data/db.js";
import { parsePolicy } from "../src/policy/parser.js";
import type { AvailabilityResult } from "../src/types/marketplace.js";

/**
 * The catalogue test suite: availability, pricing, grants and policy parsing.
 *
 *   npm run test:catalog
 *
 * Spends no HBAR and touches no Hedera network — everything runs against a
 * throwaway database seeded by the real seeder, plus three live Groq calls for
 * the policy parser (free tier). The demo catalogue is untouched.
 */

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const DB = "test-catalog.db";
/** Track 3 ("Tramline Nocturne") is seeded near-exhausted at 800/10000. */
const SCARCE_TRACK = 3;
const SEEDED_MASTER_REF = "s3://masters/harbour-lights-slower.wav#sha256:4c1f9ab2";

/** Gate 3 as block 3 wires it: report → throw when insufficient. */
async function requireShares(trackId: number, shares: number): Promise<AvailabilityResult> {
  const availability = await checkAvailability(trackId, shares, DB);
  if (!availability.sufficient) {
    throw new InsufficientSharesError(shares, availability.availableShares, trackId);
  }
  return availability;
}

function cleanup(): void {
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${DB}${suffix}`, { force: true });
}

async function main(): Promise<void> {
  console.log("— seeding a throwaway catalogue —");
  cleanup();
  execFileSync("npx", ["tsx", "scripts/seed-catalog.ts"], {
    encoding: "utf8",
    shell: true,
    env: { ...process.env, DATA_DB_PATH: DB },
  });
  const db = openDatabase(DB);
  check("throwaway catalogue seeded", getTrack(db, SCARCE_TRACK)?.available_shares === 800);

  console.log("\n— availability either side of the boundary —");
  check("799 of 800 → sufficient", (await checkAvailability(SCARCE_TRACK, 799, DB)).sufficient);
  check("exactly 800 of 800 → sufficient",
    (await checkAvailability(SCARCE_TRACK, 800, DB)).sufficient);
  check("801 of 800 → insufficient",
    !(await checkAvailability(SCARCE_TRACK, 801, DB)).sufficient);
  check("zero shares is not a grantable licence",
    !(await checkAvailability(SCARCE_TRACK, 0, DB)).sufficient);
  check("a full-capacity track grants what the scarce one refuses",
    (await checkAvailability(1, 6000, DB)).sufficient);

  console.log("\n— InsufficientSharesError on the exhausted track —");
  let gateError: unknown;
  try {
    await requireShares(SCARCE_TRACK, 6000);
  } catch (error) {
    gateError = error;
  }
  check("the gate throws InsufficientSharesError", gateError instanceof InsufficientSharesError);
  const insufficient = gateError as InsufficientSharesError;
  check("it carries requested / available / trackId",
    insufficient.requested === 6000 && insufficient.available === 800 &&
      insufficient.trackId === SCARCE_TRACK);
  check("the message names the numbers for the refusal",
    insufficient.message.includes("800") && insufficient.message.includes("6000"),
    insufficient.message);

  console.log("\n— pricing arithmetic —");
  const track1 = getTrack(db, 1)!;
  check("premise: track 1 priced at 0.00082 ℏ/share", track1.base_price_per_share === 0.00082);
  check("5% licence: 0.00082 × 500 = 0.41", (await quotePrice(1, 500, DB)) === 0.41);
  check("full capacity: 0.00082 × 10000 = 8.2", (await quotePrice(1, 10000, DB)) === 8.2);
  check("single share quotes clean at 8 dp", (await quotePrice(1, 1, DB)) === 0.00082);
  // The rounding is load-bearing: find a combination whose raw product carries
  // float noise and confirm the quote comes back clean.
  let noisy: { raw: number; quote: number } | undefined;
  outer: for (let id = 1; id <= 7; id += 1) {
    const track = getTrack(db, id)!;
    for (const shares of [3, 7, 333, 799, 4999]) {
      const raw = track.base_price_per_share * shares;
      if (raw !== Number(raw.toFixed(8))) {
        noisy = { raw, quote: await quotePrice(id, shares, DB) };
        break outer;
      }
    }
  }
  check("a noisy raw product is quoted clean at 8 dp",
    noisy !== undefined && noisy.quote === Number(noisy.raw.toFixed(8)),
    noisy ? `${noisy.raw} → ${noisy.quote}` : "no noisy combination found");

  console.log("\n— grant decryption —");
  const licenceId = insertLicence(db, {
    trackId: 1,
    buyerUaid: "did:uaid:z6MkhTestBuyer;nativeId=hedera:testnet:0.0.9697053",
    shares: 500,
    licenceType: "sync",
    territory: "eu",
    useCase: "film",
    price: 0.41,
  });
  let pendingRefused: unknown;
  try {
    await buildLicenceGrant(licenceId, DB);
  } catch (error) {
    pendingRefused = error;
  }
  check("a pending licence yields no grant",
    pendingRefused instanceof LicenceNotGrantableError &&
      pendingRefused.status === "pending");
  updateLicenceStatus(db, licenceId, "completed", "0.0.0@0.0");
  const grant = await buildLicenceGrant(licenceId, DB);
  check("the master ref decrypts to the seeded plaintext",
    grant.masterRef === SEEDED_MASTER_REF, grant.masterRef);
  check("the catalogue row itself still holds only ciphertext",
    !getTrack(db, 1)!.encrypted_master_ref.includes("harbour-lights"));
  check("sharePercent equals shares / 100", grant.sharePercent === 5,
    `${grant.shares} shares → ${grant.sharePercent}%`);
  check("track and licence fields carried onto the grant",
    grant.title === "Harbour Lights, Slower" && grant.licenceType === "sync" &&
      grant.territory === "eu" && grant.useCase === "film");

  console.log("\n— three policy parses (live Groq) —");
  const demo = await parsePolicy(
    "Sell sync licences for my tracks, at least 0.05 HBAR per share, never more than 50% in total, and never for political advertising.",
  );
  check("demo sentence → sync only, 0.05 ℏ floor, cap 5000, political-ad forbidden",
    JSON.stringify(demo) ===
      '{"allowedLicenceTypes":["sync"],"minPricePerShareHbar":0.05,"maxSharesPerLicence":5000,"forbiddenUseCases":["political-ad"]}',
    JSON.stringify(demo));
  const forbid = await parsePolicy(
    "License anything you like, but never for political advertising.",
  );
  check("a bare prohibition populates forbiddenUseCases",
    forbid.forbiddenUseCases.includes("political-ad") &&
      forbid.maxSharesPerLicence === 10000 && forbid.minPricePerShareHbar === 0,
    JSON.stringify(forbid));
  const invented = await parsePolicy(
    "Sell karaoke-remix licences and sync licences for my tracks at 0.1 HBAR per share.",
  );
  check("an invented licence type never reaches the policy",
    !invented.allowedLicenceTypes.some((t) => t.includes("karaoke")) &&
      invented.allowedLicenceTypes.includes("sync") &&
      invented.allowedLicenceTypes.every((t) =>
        ["sync", "mechanical", "sampling", "performance"].includes(t)),
    JSON.stringify(invented.allowedLicenceTypes));

  console.log("\n— parseLicenceCriteria whitelisting —");
  const parsed = parseLicenceCriteria({
    trackId: "3",
    shares: "500",
    licenceType: "SYNC",
    territory: " eu ",
    useCase: "Film",
    admin: "1",
    price: "0",
  });
  check("known fields normalised, unknown params dropped",
    JSON.stringify(parsed) ===
      '{"trackId":3,"shares":500,"licenceType":"sync","territory":"eu","useCase":"film"}',
    JSON.stringify(parsed));
  check("out-of-vocabulary and malformed values dropped entirely",
    JSON.stringify(parseLicenceCriteria({
      trackId: "-4",
      shares: "12.5",
      licenceType: "sync2",
      territory: "mars",
      useCase: ["film"],
    })) === "{}");
  const spellingA = parseLicenceCriteria({ trackId: "3", licenceType: "Sync", territory: "EU" });
  const spellingB = parseLicenceCriteria({ territory: "eu", licenceType: "sync", trackId: 3 });
  check("the same licence written two ways normalises to one form",
    JSON.stringify(spellingA) === JSON.stringify(spellingB));

  db.close();
  cleanup();

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("test-catalog failed:", error);
  cleanup();
  process.exit(1);
});
