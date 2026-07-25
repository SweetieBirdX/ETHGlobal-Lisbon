import { getUserData, openDatabase, type UserRow } from "./db.js";

/**
 * Cohort aggregation over the owner's encrypted store.
 *
 * This is the one place raw records are ever decrypted, and nothing here
 * returns them. A buyer pays for a *statistic about a group* — the individual
 * rows are read in memory, reduced to counts and means, and dropped. That is
 * what makes the project's central claim true rather than merely stated.
 */

/** Direction of the cohort relative to the whole population. */
export type CohortTrend = "up" | "flat" | "down";

/** Aggregate returned for a cohort — never raw per-user data. */
export interface CohortInsight {
  /** How many users' records went into the aggregate. */
  participantCount: number;
  /** Mean training sessions per week across the cohort. */
  avgSessionCount: number;
  /** Mean performance score across the cohort, 0-100. */
  avgPerformanceScore: number;
  /** How this cohort compares with the population as a whole. */
  trend: CohortTrend;
}

export interface CohortCriteria {
  ageRange?: string;
  activityType?: string;
}

/**
 * Smallest cohort that may be reported on.
 *
 * An "average" over one person is that person's record with a different label,
 * and over two it is trivially separable if you know one of them. Refusing
 * below this is the difference between selling statistics and selling people.
 */
export const MIN_COHORT_SIZE = 3;

/** Thrown when a cohort is too small to report on without exposing individuals. */
export class CohortTooSmallError extends Error {
  constructor(
    readonly matched: number,
    readonly minimum: number = MIN_COHORT_SIZE,
  ) {
    super(
      `Cohort of ${matched} is below the minimum of ${minimum} — reporting it would expose individual records. Broaden the criteria.`,
    );
    this.name = "CohortTooSmallError";
  }
}

interface AggregatableRecord {
  ageRange: string;
  activityType: string;
  weeklySessionCount: number;
  performanceScore: number;
}

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

function matches(record: AggregatableRecord, criteria: CohortCriteria): boolean {
  if (criteria.ageRange && record.ageRange !== criteria.ageRange) return false;
  if (criteria.activityType && record.activityType !== criteria.activityType) {
    return false;
  }
  return true;
}

/**
 * Computes an aggregate over the users matching `criteria`.
 *
 * @throws {CohortTooSmallError} when fewer than {@link MIN_COHORT_SIZE} match.
 */
export async function getCohortInsight(
  criteria: CohortCriteria = {},
  dbPath?: string,
): Promise<CohortInsight> {
  const db = openDatabase(dbPath);

  try {
    const rows = db.prepare("SELECT id FROM users").all() as Pick<UserRow, "id">[];
    const population = rows
      .map((row) => getUserData<AggregatableRecord>(db, row.id))
      .filter((record): record is AggregatableRecord => record !== undefined);

    const cohort = population.filter((record) => matches(record, criteria));

    if (cohort.length < MIN_COHORT_SIZE) {
      throw new CohortTooSmallError(cohort.length);
    }

    const cohortScore = mean(cohort.map((r) => r.performanceScore));
    const populationScore = mean(population.map((r) => r.performanceScore));
    const difference = cohortScore - populationScore;

    return {
      participantCount: cohort.length,
      avgSessionCount: roundTo(mean(cohort.map((r) => r.weeklySessionCount)), 1),
      avgPerformanceScore: roundTo(cohortScore, 1),
      // Nothing here is a time series, so "trend" is this cohort against the
      // population — a ±2 point band counts as flat.
      trend: difference > 2 ? "up" : difference < -2 ? "down" : "flat",
    };
  } finally {
    db.close();
  }
}

/**
 * Reads cohort criteria out of untrusted query parameters, ignoring anything
 * that is not a recognised filter.
 */
export function parseCriteria(query: Record<string, unknown>): CohortCriteria {
  const criteria: CohortCriteria = {};
  if (typeof query["ageRange"] === "string") criteria.ageRange = query["ageRange"];
  if (typeof query["activityType"] === "string") {
    criteria.activityType = query["activityType"];
  }
  return criteria;
}
