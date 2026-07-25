/** Track catalogue: availability + price calculation. Replaces aggregate.ts. Owner: P2. */

import type { AvailabilityResult } from "../types/marketplace.js";

export async function checkAvailability(
  trackId: number,
  shares: number,
): Promise<AvailabilityResult> {
  throw new Error("TODO(P2): not implemented");
}
