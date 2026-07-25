import {
  LICENCE_TYPES,
  TERRITORIES,
  USE_CASES,
  type AvailabilityResult,
  type LicenceGrant,
} from "../types/marketplace.js";
import { decryptField, getTrack, openDatabase, type LicenceRow } from "./db.js";

/**
 * Availability and pricing over the track catalogue. Replaces `aggregate.ts`.
 *
 * Gate 3 of the negotiation lives here: where the fitness version asked "is
 * this cohort large enough to report on without exposing anyone?", the music
 * version asks "does this track still have that many shares to license?". Same
 * position in the flow, same error-out-of-a-check shape, different question.
 */

/** Thrown when a track has fewer shares left than a licence asks for. */
export class InsufficientSharesError extends Error {
  constructor(
    readonly requested: number,
    readonly available: number,
    readonly trackId: number,
  ) {
    super(
      `Track ${trackId} has ${available} shares available but the licence asks for ${requested} — reduce the share count or pick another track.`,
    );
    this.name = "InsufficientSharesError";
  }
}

/** Thrown when a licence names a track the catalogue does not hold. */
export class UnknownTrackError extends Error {
  constructor(readonly trackId: number) {
    super(`Track ${trackId} is not in the catalogue.`);
    this.name = "UnknownTrackError";
  }
}

/** Thrown when a grant is asked for a licence that has not been paid for. */
export class LicenceNotGrantableError extends Error {
  constructor(
    readonly licenceId: number,
    readonly status: string,
  ) {
    super(
      `Licence ${licenceId} is '${status}' — a grant only exists for a licence that has been accepted and paid.`,
    );
    this.name = "LicenceNotGrantableError";
  }
}

/**
 * The whitelisted, normalised form of a licence request.
 *
 * `LicenceOffer` minus the price: the price is what gets negotiated, these
 * fields are what the x402 gate compares between the negotiated row and the
 * incoming request.
 */
export interface LicenceCriteria {
  trackId?: number;
  shares?: number;
  licenceType?: string;
  territory?: string;
  useCase?: string;
}

/**
 * Answers whether a track can still grant `shares`.
 *
 * Deliberately a report, not a verdict: `sufficient: false` comes back as data
 * so the seller can refuse with the numbers in hand ("only 800 of 10000 left"),
 * which is what makes the refusal demonstrable rather than a bare no.
 *
 * @throws {UnknownTrackError} when the track does not exist — that is a
 * different refusal from "not enough left", and gate 3 words them differently.
 */
export async function checkAvailability(
  trackId: number,
  shares: number,
  dbPath?: string,
): Promise<AvailabilityResult> {
  const db = openDatabase(dbPath);
  try {
    const track = getTrack(db, trackId);
    if (!track) throw new UnknownTrackError(trackId);

    return {
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      totalShares: track.total_shares,
      availableShares: track.available_shares,
      requestedShares: shares,
      sufficient: shares > 0 && shares <= track.available_shares,
    };
  } finally {
    db.close();
  }
}

/**
 * Prices a licence: `basePricePerShare × shares`, in HBAR.
 *
 * Rounded to 8 decimal places — one tinybar is 10⁻⁸ ℏ, so anything finer than
 * this cannot settle anyway, and unrounded float products (0.00082 × 500 =
 * 0.41000000000000003) would fail equality checks downstream.
 *
 * @throws {UnknownTrackError} when the track does not exist.
 */
export async function quotePrice(
  trackId: number,
  shares: number,
  dbPath?: string,
): Promise<number> {
  const db = openDatabase(dbPath);
  try {
    const track = getTrack(db, trackId);
    if (!track) throw new UnknownTrackError(trackId);
    return Number((track.base_price_per_share * shares).toFixed(8));
  } finally {
    db.close();
  }
}

/**
 * Builds the deliverable a buyer receives on HTTP 200 — the licence grant.
 *
 * This is the one place the master reference is ever decrypted, and it happens
 * in memory on the way into the response: the catalogue row keeps only the
 * ciphertext, nothing here writes the plaintext anywhere, and the function
 * refuses outright unless the licence has actually been accepted and paid for.
 * That is the project's original claim — the protected asset only exists for a
 * buyer post-payment — carried over intact from the fitness version.
 *
 * @throws {LicenceNotGrantableError} for a licence that is pending or declined.
 * @throws {UnknownTrackError} if the licence's track has gone missing.
 */
export async function buildLicenceGrant(
  licenceId: number,
  dbPath?: string,
): Promise<LicenceGrant> {
  const db = openDatabase(dbPath);
  try {
    const licence = db
      .prepare("SELECT * FROM licences WHERE id = ?")
      .get(licenceId) as LicenceRow | undefined;
    if (!licence) throw new LicenceNotGrantableError(licenceId, "missing");
    if (licence.status !== "accepted" && licence.status !== "completed") {
      throw new LicenceNotGrantableError(licenceId, licence.status);
    }

    const track = getTrack(db, licence.track_id);
    if (!track) throw new UnknownTrackError(licence.track_id);

    const grant: LicenceGrant = {
      licenceId: licence.id,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      shares: licence.shares,
      /** Basis points to whole percent: 500 shares of 10000 is 5%. */
      sharePercent: licence.shares / 100,
      licenceType: licence.licence_type,
      territory: licence.territory,
      useCase: licence.use_case,
      // The grant is minted at delivery time — this function runs once, on the
      // paid 200 — so "granted" is now, not when the request row was created.
      grantedAt: new Date().toISOString(),
      masterRef: decryptField(track.encrypted_master_ref, track.encryption_key_ref),
    };

    // The row stores the serial as TEXT (mirroring the old receipt_serial);
    // the frozen grant shape wants a number, so convert at this boundary.
    if (licence.certificate_serial !== null) {
      const serial = Number(licence.certificate_serial);
      if (Number.isFinite(serial)) grant.certificateSerial = serial;
    }

    return grant;
  } finally {
    db.close();
  }
}

/** Parses a positive integer out of an untrusted query value, else undefined. */
function parsePositiveInt(value: unknown): number | undefined {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Lowercases and trims a string value, keeping it only if the whitelist has it. */
function parseEnumValue(value: unknown, allowed: readonly string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalised = value.trim().toLowerCase();
  return allowed.includes(normalised) ? normalised : undefined;
}

/**
 * Reads licence criteria out of untrusted query parameters.
 *
 * Strictly whitelist-shaped: the five known fields are taken, everything else
 * is ignored, and a value outside the frozen vocabularies is dropped rather
 * than passed through. The x402 binding gate compares the negotiated criteria
 * against the requested ones as whole objects, so **both sides must normalise
 * identically** — same lowercasing, same trimming, same drops — or the same
 * licence written two ways would look like a mismatch.
 */
export function parseLicenceCriteria(query: Record<string, unknown>): LicenceCriteria {
  const criteria: LicenceCriteria = {};

  const trackId = parsePositiveInt(query["trackId"]);
  if (trackId !== undefined) criteria.trackId = trackId;

  const shares = parsePositiveInt(query["shares"]);
  if (shares !== undefined) criteria.shares = shares;

  const licenceType = parseEnumValue(query["licenceType"], LICENCE_TYPES);
  if (licenceType !== undefined) criteria.licenceType = licenceType;

  const territory = parseEnumValue(query["territory"], TERRITORIES);
  if (territory !== undefined) criteria.territory = territory;

  const useCase = parseEnumValue(query["useCase"], USE_CASES);
  if (useCase !== undefined) criteria.useCase = useCase;

  return criteria;
}
