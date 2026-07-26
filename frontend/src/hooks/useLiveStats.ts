import { useEffect, useState } from 'react';

/**
 * Reads the running demo panel's own numbers.
 *
 * The landing page has no database of its own, so everything in the Live
 * Numbers section comes from `/api/earnings` — the same endpoint the dashboard's
 * "Licences sold" pane reads. In development Vite proxies `/api` through to the
 * backend on port 4100 (see vite.config.ts).
 *
 * The one rule this hook exists to enforce: **if the backend is not reachable,
 * report that.** It never falls back to sample figures, because a landing page
 * that quietly shows invented totals next to real HashScan links is worse than
 * one that admits the panel is offline.
 */

/** Shape of the slice of /api/earnings this page uses. */
interface EarningsResponse {
  totalEarnedHbar: number;
  completedCount: number;
  declinedCount: number;
  refusals?: { reason?: string }[];
}

export interface DeclineReason {
  reason: string;
  count: number;
}

export interface LiveStats {
  totalEarnedHbar: number;
  completedCount: number;
  declinedCount: number;
  /** Counted from the refusals the endpoint returns, highest first. */
  declineReasons: DeclineReason[];
  /** How many refusal records the counts above are based on. */
  reasonSampleSize: number;
}

export type LiveStatsState =
  | { status: 'loading' }
  | { status: 'ready'; stats: LiveStats }
  | { status: 'offline'; message: string };

/**
 * A reason is only charted if it actually happened. The brief is explicit:
 * leave a reason out rather than padding it, so the bars mean something.
 */
function countReasons(refusals: { reason?: string }[]): DeclineReason[] {
  const tally = new Map<string, number>();
  for (const refusal of refusals) {
    const reason = refusal.reason?.trim();
    if (!reason) continue;
    tally.set(reason, (tally.get(reason) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function useLiveStats(): LiveStatsState {
  const [state, setState] = useState<LiveStatsState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch('/api/earnings', { signal: controller.signal });
        if (!response.ok) throw new Error(`the panel answered HTTP ${response.status}`);

        const data = (await response.json()) as EarningsResponse;
        const refusals = data.refusals ?? [];

        setState({
          status: 'ready',
          stats: {
            totalEarnedHbar: data.totalEarnedHbar ?? 0,
            completedCount: data.completedCount ?? 0,
            declinedCount: data.declinedCount ?? 0,
            declineReasons: countReasons(refusals),
            reasonSampleSize: refusals.length,
          },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: 'offline',
          message: error instanceof Error ? error.message : 'the panel could not be reached',
        });
      }
    })();

    return () => controller.abort();
  }, []);

  return state;
}
