/**
 * The data side of the marketplace.
 *
 * A buyer never receives raw records — it pays for a *cohort insight*, an
 * aggregate computed over the users who match its criteria. Keeping that behind
 * an interface means the x402-protected endpoint can be built and demoed now
 * against `MockDataProvider`, and swapped for the encrypted-database
 * implementation in Phase 6 without the payment layer changing at all.
 */

/** Direction of the cohort's performance trend over the reporting window. */
export type CohortTrend = "up" | "flat" | "down";

/** Aggregate returned for a cohort — never raw per-user data. */
export interface CohortInsight {
  /** How many users' records went into the aggregate. */
  participantCount: number;
  /** Mean performance score across the cohort, 0-100. */
  avgPerformanceScore: number;
  trend: CohortTrend;
}

export interface DataProvider {
  getCohortInsight(criteria: object): Promise<object>;
}

const TRENDS: CohortTrend[] = ["up", "flat", "down"];

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Stand-in provider for the phases before the encrypted database exists.
 *
 * The numbers are randomised within realistic ranges rather than fixed, so a
 * demo run visibly returns fresh data for the payment that was just settled
 * instead of a constant that could just as well have been hard-coded in the
 * client. `criteria` is accepted and ignored — filtering arrives with the real
 * implementation in Phase 6.3.
 */
export class MockDataProvider implements DataProvider {
  async getCohortInsight(_criteria: object): Promise<CohortInsight> {
    return {
      participantCount: randomInt(120, 480),
      avgPerformanceScore: roundTo(randomInt(6200, 9100) / 100, 1),
      trend: TRENDS[randomInt(0, TRENDS.length - 1)]!,
    };
  }
}
