/**
 * The on-chain artefacts this project actually produced on Hedera testnet.
 *
 * Every id and transaction below was confirmed against the mirror node before
 * being put on the page — accounts and topics return HTTP 200, both transactions
 * report CRYPTOTRANSFER / SUCCESS, and the certificate collection reports a
 * 5/100 royalty to the rights holder. Nothing here is illustrative.
 *
 * If the demo environment is ever rebuilt (new topics, new collection), these
 * are the values to update — they are deliberately in one file so the page can
 * never drift into showing an id that no longer resolves.
 */

const HASHSCAN = 'https://hashscan.io/testnet';

export const accountUrl = (id: string) => `${HASHSCAN}/account/${id}`;
export const topicUrl = (id: string) => `${HASHSCAN}/topic/${id}`;
export const tokenUrl = (id: string) => `${HASHSCAN}/token/${id}`;
/** HashScan wants `0.0.x-seconds-nanos`, not the `0.0.x@seconds.nanos` form. */
export const txUrl = (id: string) => `${HASHSCAN}/transaction/${id}`;

export const SELLER_ACCOUNT = '0.0.9696085';
export const BUYER_ACCOUNT = '0.0.9697053';
export const AUDIT_TOPIC = '0.0.9738154';
export const IDENTITY_TOPIC = '0.0.9749380';
export const CERTIFICATE_TOKEN = '0.0.9756726';

/** A licence the demo panel settled, end to end. */
export const SETTLED_PAYMENT_TX = '0.0.7162784-1785034665-514637216';
/** The resale that made the 5% royalty actually fire: 0.5 ℏ of a 10 ℏ trade. */
export const ROYALTY_PROOF_TX = '0.0.9697053-1785023666-767928814';

/** Numerator/denominator of the royalty baked into the collection at creation. */
export const ROYALTY_PERCENT = 5;

export interface ChainArtefact {
  label: string;
  value: string;
  href: string;
  note: string;
}

export const CHAIN_ARTEFACTS: ChainArtefact[] = [
  {
    label: 'Rights holder account',
    value: SELLER_ACCOUNT,
    href: accountUrl(SELLER_ACCOUNT),
    note: 'The seller agent. Treasury of the certificate collection and the royalty collector.',
  },
  {
    label: 'Buyer account',
    value: BUYER_ACCOUNT,
    href: accountUrl(BUYER_ACCOUNT),
    note: 'The buyer agent — a separate Hedera account, not a second key on the first.',
  },
  {
    label: 'Settled licence payment',
    value: SETTLED_PAYMENT_TX,
    href: txUrl(SETTLED_PAYMENT_TX),
    note: 'One x402 settlement: 402 → signed → 200, with no human approving it.',
  },
  {
    label: 'HCS audit topic',
    value: AUDIT_TOPIC,
    href: topicUrl(AUDIT_TOPIC),
    note: 'Every completed licence writes an entry here. Read it without trusting us.',
  },
  {
    label: 'HCS identity topic',
    value: IDENTITY_TOPIC,
    href: topicUrl(IDENTITY_TOPIC),
    note: 'HCS-14 agent profiles plus the compliance attestation written per negotiation.',
  },
  {
    label: 'HTS certificate collection',
    value: CERTIFICATE_TOKEN,
    href: tokenUrl(CERTIFICATE_TOKEN),
    note: `Licence certificates, minted to whoever paid. Carries the ${ROYALTY_PERCENT}% royalty, no fallback fee.`,
  },
  {
    label: 'Royalty proof',
    value: ROYALTY_PROOF_TX,
    href: txUrl(ROYALTY_PROOF_TX),
    note: `A 10 ℏ resale routed ${ROYALTY_PERCENT}% — 0.5 ℏ — to the rights holder, who was not a party to that trade.`,
  },
];
