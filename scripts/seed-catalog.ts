import {
  DEFAULT_DB_PATH,
  TOTAL_SHARES,
  decryptField,
  getTrack,
  insertTrack,
  listTracks,
  openDatabase,
  reserveShares,
} from "../src/data/db.js";

/**
 * Fills the rights holder's catalogue with a small set of fictional tracks.
 *
 * Every title and artist here is invented — nothing in this file refers to a
 * real release, a real performer, or a real master recording. The master
 * references are fake URLs; their only job is to be something that stays
 * encrypted until a licence is paid for.
 *
 *   npx tsx scripts/seed-catalog.ts
 *
 * Replaces `scripts/seed-data.ts` from the fitness version. There is no
 * migration: the old database is gone and this one is created fresh.
 */

/**
 * Shares are basis points, so a track's full licensing capacity is 10000 and a
 * 5% licence is 500 shares.
 */
const DEMO_LICENCE_SHARES = 500;

/**
 * Price per basis point, in HBAR.
 *
 * Chosen so the canonical 5% licence lands between 0.25 and 1 ℏ — the band the
 * x402 payment path and the buyer agent's budgets are already built around.
 * Read as whole percentages instead, this is 0.05-0.2 ℏ per percent, which is
 * how the owner's policy sentence phrases it.
 */
const PRICE_PER_SHARE_MIN = 0.0005;
const PRICE_PER_SHARE_MAX = 0.002;

interface CatalogueEntry {
  title: string;
  artist: string;
  /** Fake object-store URL — stored encrypted, never shown before payment. */
  masterRef: string;
  /**
   * Capacity still licensable, out of 10000. Anything below the full amount is
   * seeded as capacity already sold to earlier buyers.
   */
  availableShares: number;
}

/**
 * The catalogue is written out rather than generated, because these numbers are
 * the demo: the near-exhausted track is what makes the availability refusal
 * happen on camera, and a randomly drawn catalogue could quietly stop producing
 * it. Only the prices are drawn, and those come from the seeded PRNG below.
 */
const CATALOGUE: CatalogueEntry[] = [
  {
    title: "Harbour Lights, Slower",
    artist: "Mira Kestrel",
    masterRef: "s3://masters/harbour-lights-slower.wav#sha256:4c1f9ab2",
    availableShares: TOTAL_SHARES,
  },
  {
    title: "Copper Rain",
    artist: "Mira Kestrel",
    masterRef: "s3://masters/copper-rain.wav#sha256:8de3170c",
    availableShares: 7500,
  },
  {
    /** The demo's availability refusal: 8% left, so anything larger is refused. */
    title: "Tramline Nocturne",
    artist: "The Vellum Hours",
    masterRef: "s3://masters/tramline-nocturne.wav#sha256:b70a5e94",
    availableShares: 800,
  },
  {
    title: "Paper Astronauts",
    artist: "The Vellum Hours",
    masterRef: "s3://masters/paper-astronauts.wav#sha256:2f66c8d1",
    availableShares: 4000,
  },
  {
    title: "Saltwater Ledger",
    artist: "Ines Bramante",
    masterRef: "s3://masters/saltwater-ledger.wav#sha256:e91b4477",
    availableShares: 9200,
  },
  {
    title: "Neon Cassava",
    artist: "Kwame Adjei-Bloom",
    masterRef: "s3://masters/neon-cassava.wav#sha256:5a02d3fe",
    availableShares: 6000,
  },
  {
    title: "Static Cathedral",
    artist: "Kwame Adjei-Bloom",
    masterRef: "s3://masters/static-cathedral.wav#sha256:c38f61b0",
    availableShares: 2500,
  },
];

/**
 * Deterministic PRNG (mulberry32) so every run seeds the same catalogue —
 * a demo that shows different numbers each time is hard to talk over. Same
 * seed as the fitness store it replaces.
 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(20260725);

/** Draws a per-share price, rounded to a figure a person can read aloud. */
function drawPricePerShare(): number {
  return Number(
    (PRICE_PER_SHARE_MIN + random() * (PRICE_PER_SHARE_MAX - PRICE_PER_SHARE_MIN)).toFixed(5),
  );
}

function main(): void {
  const db = openDatabase();

  try {
    const existing = listTracks(db);
    if (existing.length > 0 && process.env.FORCE !== "1") {
      console.log(
        `${DEFAULT_DB_PATH} already holds ${existing.length} tracks — not reseeding.\n` +
          `Set FORCE=1 to append the catalogue again.\n`,
      );
      return;
    }

    const ids: number[] = [];
    for (const entry of CATALOGUE) {
      const id = insertTrack(db, {
        title: entry.title,
        artist: entry.artist,
        masterRef: entry.masterRef,
        basePricePerShare: drawPricePerShare(),
      });
      ids.push(id);

      // A track starts with its full capacity; capacity already licensed is
      // taken out through the same path a real sale uses, so the seeded state
      // is one the application could actually have reached.
      const alreadyLicensed = TOTAL_SHARES - entry.availableShares;
      if (alreadyLicensed > 0 && !reserveShares(db, id, alreadyLicensed)) {
        throw new Error(`Could not reserve ${alreadyLicensed} shares of "${entry.title}"`);
      }
    }

    console.log(`Seeded ${ids.length} tracks into ${DEFAULT_DB_PATH}\n`);

    console.log("  #  track                        artist              ℏ/share    5% licence  available");
    for (const track of listTracks(db)) {
      const fivePercent = (track.base_price_per_share * DEMO_LICENCE_SHARES).toFixed(3);
      const percentLeft = ((track.available_shares / track.total_shares) * 100).toFixed(0);
      console.log(
        `  ${String(track.id).padEnd(2)} ${track.title.padEnd(28)} ${track.artist.padEnd(19)} ` +
          `${track.base_price_per_share.toFixed(5)}    ${fivePercent.padStart(6)} ℏ    ` +
          `${String(track.available_shares).padStart(5)}/${track.total_shares} (${percentLeft}%)`,
      );
    }

    // Show that what landed on disk is ciphertext and still decrypts.
    const sample = getTrack(db, ids[0]!)!;
    console.log(`\nstored (track ${sample.id}): ${sample.encrypted_master_ref.slice(0, 64)}…`);
    console.log(
      `decrypted:            ${decryptField(sample.encrypted_master_ref, sample.encryption_key_ref)}`,
    );

    const scarcest = listTracks(db).reduce((a, b) =>
      a.available_shares <= b.available_shares ? a : b,
    );
    console.log(
      `\nnear-exhausted: "${scarcest.title}" has ${scarcest.available_shares} shares left ` +
        `(${((scarcest.available_shares / scarcest.total_shares) * 100).toFixed(0)}%) — ` +
        `a larger request is refused at gate 3.`,
    );
  } finally {
    db.close();
  }
}

main();
