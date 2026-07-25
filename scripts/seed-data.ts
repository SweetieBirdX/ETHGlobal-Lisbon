import {
  DEFAULT_DB_PATH,
  getUserData,
  insertUser,
  openDatabase,
} from "../src/data/db.js";

/**
 * Fills the owner's database with a small population of fitness records.
 *
 * A cohort aggregate is only meaningful over several people, so the demo needs
 * a population to aggregate — these stand in for the records a real user's
 * wearable would sync. Fitness and performance only: medication and cycle
 * tracking are deliberately out of scope for this project.
 *
 *   npx tsx scripts/seed-data.ts
 */

const USER_COUNT = 12;

const AGE_RANGES = ["18-24", "25-34", "35-44", "45-54"] as const;
const ACTIVITY_TYPES = ["running", "cycling", "swimming", "strength"] as const;

export interface FitnessRecord {
  ageRange: (typeof AGE_RANGES)[number];
  activityType: (typeof ACTIVITY_TYPES)[number];
  weeklyActiveMinutes: number;
  weeklyDistanceKm: number;
  restingHeartRate: number;
  vo2max: number;
  avgSleepHours: number;
  /** 0-100 composite the cohort aggregate reports on. */
  performanceScore: number;
}

/**
 * Deterministic PRNG (mulberry32) so every run seeds the same population —
 * a demo that shows different numbers each time is hard to talk over.
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

function between(min: number, max: number, decimals = 0): number {
  const value = min + random() * (max - min);
  return Number(value.toFixed(decimals));
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function generateRecord(): FitnessRecord {
  const activityType = pick(ACTIVITY_TYPES);
  const restingHeartRate = between(48, 72);
  const vo2max = between(32, 58, 1);

  return {
    ageRange: pick(AGE_RANGES),
    activityType,
    weeklyActiveMinutes: between(90, 480),
    // Distance means nothing for strength work.
    weeklyDistanceKm: activityType === "strength" ? 0 : between(8, 75, 1),
    restingHeartRate,
    vo2max,
    avgSleepHours: between(5.5, 8.5, 1),
    // Fitter athletes have higher VO2 max and lower resting heart rate, so the
    // aggregate reports something with a real shape rather than pure noise.
    performanceScore: Number(
      Math.min(100, Math.max(0, vo2max * 1.4 + (72 - restingHeartRate) * 0.8)).toFixed(1),
    ),
  };
}

function main(): void {
  const db = openDatabase();

  const existing = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (existing.n > 0 && process.env.FORCE !== "1") {
    console.log(
      `${DEFAULT_DB_PATH} already holds ${existing.n} users — nothing to do.\n` +
        `Set FORCE=1 to append another ${USER_COUNT} records.`,
    );
    db.close();
    return;
  }

  const ids: number[] = [];
  for (let i = 0; i < USER_COUNT; i += 1) {
    ids.push(insertUser(db, generateRecord()));
  }

  console.log(`Seeded ${ids.length} users into ${DEFAULT_DB_PATH}\n`);

  // Show that what landed on disk is ciphertext and still decrypts.
  const sample = db
    .prepare("SELECT id, encrypted_fitness_data FROM users ORDER BY id LIMIT 1")
    .get() as { id: number; encrypted_fitness_data: string };

  console.log(`stored (id ${sample.id}): ${sample.encrypted_fitness_data.slice(0, 64)}…`);
  console.log(`decrypted:               ${JSON.stringify(getUserData(db, sample.id))}`);

  const byActivity = db
    .prepare("SELECT COUNT(*) AS n FROM users")
    .get() as { n: number };
  console.log(`\ntotal users in database: ${byActivity.n}`);

  db.close();
}

main();
