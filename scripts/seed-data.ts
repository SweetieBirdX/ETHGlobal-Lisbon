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

/** Typical VO2 max for an average adult in each band, before fitness is applied. */
const VO2MAX_BASELINE: Record<(typeof AGE_RANGES)[number], number> = {
  "18-24": 45,
  "25-34": 43,
  "35-44": 40,
  "45-54": 37,
};

/**
 * Realistic sustained speeds in km/h, used to derive weekly distance from the
 * time actually spent training. Drawing distance independently produced
 * runners averaging 35 km/h.
 */
const SPEED_KMH: Record<(typeof ACTIVITY_TYPES)[number], [number, number]> = {
  running: [8.5, 13.5],
  cycling: [20, 31],
  swimming: [2.4, 3.6],
  strength: [0, 0],
};

export interface FitnessRecord {
  ageRange: (typeof AGE_RANGES)[number];
  activityType: (typeof ACTIVITY_TYPES)[number];
  /** Training sessions logged in a week. */
  weeklySessionCount: number;
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

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Builds one record around a single latent fitness level.
 *
 * Every physiological field derives from that one variable, so a person with a
 * high VO2 max also has a low resting heart rate and trains more — drawing the
 * fields independently produced people who were simultaneously very fit and
 * very unfit.
 */
function generateRecord(
  ageRange: (typeof AGE_RANGES)[number],
  activityType: (typeof ACTIVITY_TYPES)[number],
): FitnessRecord {
  /** 0 = sedentary, 1 = highly trained. */
  const fitness = random();

  const vo2max = Number(
    clamp(VO2MAX_BASELINE[ageRange] + fitness * 16 - 6 + random() * 3, 28, 62).toFixed(1),
  );
  // Resting heart rate falls as fitness rises; ±3 bpm of individual variation.
  const restingHeartRate = Math.round(
    clamp(74 - fitness * 24 + (random() * 6 - 3), 42, 80),
  );

  const weeklyActiveMinutes = Math.round(clamp(80 + fitness * 340 + random() * 60, 60, 600));

  // Distance follows from time spent and a plausible speed for the sport.
  const [minSpeed, maxSpeed] = SPEED_KMH[activityType];
  const speed = minSpeed + fitness * (maxSpeed - minSpeed);
  const weeklyDistanceKm = Number(((weeklyActiveMinutes / 60) * speed).toFixed(1));

  // Fitter people train more often, and a session lands in a believable range
  // (roughly 30-90 minutes) rather than one weekly four-hour epic.
  const weeklySessionCount = Math.round(clamp(2 + fitness * 5 + random() * 2, 2, 10));

  return {
    ageRange,
    activityType,
    weeklySessionCount,
    weeklyActiveMinutes,
    weeklyDistanceKm,
    restingHeartRate,
    vo2max,
    avgSleepHours: Number(clamp(6 + fitness * 1.8 + (random() * 0.8 - 0.4), 5, 9).toFixed(1)),
    // Fitter athletes have higher VO2 max and lower resting heart rate, so the
    // aggregate reports something with a real shape rather than pure noise.
    performanceScore: Number(
      clamp(vo2max * 1.4 + (72 - restingHeartRate) * 0.8, 0, 100).toFixed(1),
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

  // Cycling through both dimensions guarantees every age range and every
  // activity is represented — a buyer asking for a band nobody happens to fall
  // into would otherwise get an empty cohort mid-demo. The activity index is
  // offset so the two do not advance in lockstep, which would make every
  // 18-24-year-old a runner and every 45-54-year-old a lifter.
  const ids: number[] = [];
  for (let i = 0; i < USER_COUNT; i += 1) {
    const ageRange = AGE_RANGES[i % AGE_RANGES.length]!;
    const activityType =
      ACTIVITY_TYPES[(i + Math.floor(i / AGE_RANGES.length)) % ACTIVITY_TYPES.length]!;
    ids.push(insertUser(db, generateRecord(ageRange, activityType)));
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
