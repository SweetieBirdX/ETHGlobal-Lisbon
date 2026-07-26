import SectionHeading from './SectionHeading';

const codeChip = (text: string, key?: string) => (
  <code
    key={key ?? text}
    className="rounded bg-accent/20 px-1.5 py-0.5 font-mono text-[13px] text-accent-teal"
  >
    {text}
  </code>
);

const GATES = [
  {
    num: 'Gate 01',
    title: 'Identity',
    checks: [
      'UAID parses correctly',
      'Profile exists in the HCS registry, read from the mirror node',
      <>Profile status is {codeChip('active')}</>,
      'Compliance attestation scores 100',
    ],
    note: 'Attestation is written to HCS on both accept and reject. If the mirror node is unreachable, the answer is "cannot verify right now" — never "not registered."',
  },
  {
    num: 'Gate 02',
    title: 'Policy',
    checks: [
      'offer_incomplete',
      'licence_type_not_permitted',
      'use_case_forbidden',
      'share_cap_exceeded',
      'price_too_low',
    ].map((code) => codeChip(code)),
    note: (
      <>
        Pure, synchronous, checked in this order. The floor price is disclosed in the rejection
        text and in {codeChip('minPriceHbar')} metadata, so the buyer's autonomous counter-offer
        is grounded, not a guess.
      </>
    ),
  },
  {
    num: 'Gate 03',
    title: 'Availability',
    checks: [
      'Enough remaining capacity on the track?',
      <>If not: reject with {codeChip('insufficient_shares')}</>,
      'Response states the exact percentages requested vs. remaining',
    ],
    note: "Capacity itself doesn't move here — it only drops once payment actually completes.",
  },
];

/** The whole path, end to end, before the gates are broken down individually. */
const FLOW = [
  {
    step: '01',
    title: 'Policy, in plain language',
    detail: 'One sentence from the rights holder becomes machine-checkable rules.',
  },
  {
    step: '02',
    title: 'Offer submitted',
    detail: "A buyer agent sends track, shares, licence type, territory, use case and price.",
  },
  {
    step: '03',
    title: 'Three gates',
    detail: 'Identity, then policy, then availability. Any failure rejects the offer.',
  },
  {
    step: '04',
    title: 'x402 payment',
    detail: 'Bound to the negotiated terms — a different request is refused before it is priced.',
  },
  {
    step: '05',
    title: 'Certificate + audit',
    detail: 'An HTS certificate NFT to the payer, and an HCS entry anyone can read back.',
  },
];

const CHAIN_STEPS = [
  'HCS audit log',
  'HCS reputation',
  'reserveShares',
  'mintCertificate (HTS NFT)',
  'licence: completed',
];

export default function HowItWorks() {
  return (
    <section
      id="how"
      className="relative overflow-hidden border-t border-accent/15 bg-[#0D0B27] py-20 sm:py-28 md:py-32"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 460px at 85% -10%, rgba(232,67,147,0.14), transparent 65%), radial-gradient(700px 380px at 0% 40%, rgba(110,86,207,0.16), transparent 65%)',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="How It Works"
          title="Three fail-closed gates. Any failure rejects the offer."
          intro="A buyer agent sends a licence offer — track, shares, licence type, territory, use case, price. The seller agent runs it through three checks, in order. Any failure rejects; nothing partially succeeds."
        />

        {/* The five-step path. Horizontal on desktop, stacked on mobile — the
            arrows are decorative, so they drop out rather than rotate. */}
        <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,1fr)] lg:gap-0">
          {FLOW.map((item, i) => (
            <div key={item.step} className="relative flex lg:items-stretch">
              <div className="liquid-glass w-full rounded-2xl border border-accent/20 bg-accent/[0.04] p-5 lg:rounded-none lg:border-r-0 lg:first:rounded-l-2xl lg:last:rounded-r-2xl lg:last:border-r">
                <p className="font-mono text-xs font-semibold tracking-[0.1em] text-accent-teal">
                  {item.step}
                </p>
                <h3 className="mt-2 text-sm font-semibold text-white">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-white/60">{item.detail}</p>
              </div>
              {i < FLOW.length - 1 && (
                <span
                  className="pointer-events-none absolute top-1/2 -right-2 z-10 hidden -translate-y-1/2 text-accent/70 lg:block"
                  aria-hidden="true"
                >
                  →
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
          {GATES.map((gate) => (
            <div
              key={gate.num}
              className="liquid-glass rounded-2xl border border-accent/20 bg-accent/[0.04] p-6 transition-colors hover:border-accent/50"
            >
              <p className="font-mono text-xs font-semibold tracking-[0.1em] text-accent-teal">
                {gate.num}
              </p>
              <h3 className="font-instrument-serif mt-1.5 mb-4 text-2xl text-white">
                {gate.title}
              </h3>
              <ul className="flex flex-col gap-2.5">
                {gate.checks.map((check, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-white/75">
                    <span className="text-accent/60">→</span>
                    <span>{check}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-dashed border-accent/20 pt-4 text-xs leading-relaxed text-white/55">
                {gate.note}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <div className="font-mono flex items-center gap-2 rounded-full border border-accent-teal/40 bg-accent-teal/15 px-4 py-2.5 text-[13px] text-accent-teal">
            Accept → x402-protected{' '}
            <code className="rounded bg-white/10 px-1.5 py-0.5">/licence/grant</code> URL
          </div>
          <div className="font-mono flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.06] px-4 py-2.5 text-[13px] text-white/70">
            Price = shares × the track's per-share rate — no fixed endpoint price
          </div>
        </div>

        <div className="mt-16">
          <h3 className="font-instrument-serif mb-2 text-xl text-white sm:text-2xl">
            After payment
          </h3>
          <p className="mb-6 max-w-lg text-sm text-white/65">
            Idempotent — a completed-guard runs first, so each step below executes exactly once,
            even on retry.
          </p>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-3">
            {CHAIN_STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-1">
                <span className="font-mono rounded-lg border border-accent/25 bg-accent/[0.06] px-3.5 py-2.5 text-[13px] text-white/90">
                  {step}
                </span>
                {i < CHAIN_STEPS.length - 1 && <span className="px-2 text-accent/50">→</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16">
          <h3 className="font-instrument-serif mb-5 text-xl text-white sm:text-2xl">
            A real rejection, end to end
          </h3>
          <div className="max-w-xl overflow-hidden rounded-2xl border border-accent/25 bg-black/40">
            <div className="font-mono flex flex-col gap-2.5 p-6 text-[13px] leading-relaxed">
              <p className="text-white/80">buyer_agent → seller_agent · offer.licence</p>
              <p className="pl-4 text-white/50">
                {'{ useCase: "political_ad", price: "1000 ℏ" }'}
              </p>
              <p className="flex items-center gap-2.5">
                <span className="rounded bg-accent-pink/25 px-1.5 py-0.5 text-[11px] font-bold text-accent-pink">
                  FAIL
                </span>
                <span className="text-white/80">
                  policy gate · <code className="text-accent-pink">use_case_forbidden</code>
                </span>
              </p>
              <p className="text-white/80">seller_agent → buyer_agent · reject.licence</p>
              <p className="text-white/50">↳ compliance attestation still written to HCS</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
