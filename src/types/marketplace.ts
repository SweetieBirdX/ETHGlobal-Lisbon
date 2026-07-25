/**
 * Shared marketplace contract for the music-licensing pivot.
 *
 * FROZEN after the initial commit — both lanes compile against these types.
 * Changing anything here requires agreement from both people.
 */

/** Basis points: 10000 = 100% of a track's licensing capacity. */
export type BasisPoints = number;

export const LICENCE_TYPES = ['sync', 'mechanical', 'sampling', 'performance'] as const;
export const TERRITORIES = ['worldwide', 'eu', 'us', 'uk', 'jp'] as const;
export const USE_CASES = ['film', 'game', 'advertising', 'political-ad', 'documentary'] as const;

/** What a buyer asks for. Read off A2A message metadata by the seller. */
export interface LicenceOffer {
  trackId?: number;
  shares?: BasisPoints;
  licenceType?: string;      // sync | mechanical | sampling | performance
  territory?: string;        // worldwide | eu | us | uk | jp
  useCase?: string;          // film | game | advertising | political-ad | documentary
  priceHbar?: number;
}

/** The rights holder's rules, parsed from one plain-language sentence. */
export interface LicencePolicy {
  allowedLicenceTypes: string[];
  minPricePerShareHbar: number;
  maxSharesPerLicence: BasisPoints;
  forbiddenUseCases: string[];
}

/** Gate 3 result: can this many shares still be granted? */
export interface AvailabilityResult {
  trackId: number;
  title: string;
  artist: string;
  totalShares: BasisPoints;
  availableShares: BasisPoints;
  requestedShares: BasisPoints;
  sufficient: boolean;
}

/** Gate 1 result. Mirrors the old ERC-8004 shape so call sites barely change. */
export interface IdentityCheck {
  verified: boolean;
  reason: string;
  /** Hedera account behind the UAID, e.g. "hedera:testnet:0.0.9697053". */
  nativeId?: string;
  name?: string;
  attestation?: ComplianceAttestation;
}

export interface ComplianceAttestation {
  requestHash: string;
  response: number;
  compliant: boolean;
  requestTransactionId: string;
  responseTransactionId: string;
  hashscanUrl: string;
}

/** What the buyer receives after paying — the licence grant itself. */
export interface LicenceGrant {
  licenceId: number;
  trackId: number;
  title: string;
  artist: string;
  shares: BasisPoints;
  sharePercent: number;
  licenceType: string;
  territory: string;
  useCase: string;
  grantedAt: string;
  /** Decrypted only after payment — the "protected asset stays encrypted" story, kept. */
  masterRef: string;
  certificateSerial?: number;
}
