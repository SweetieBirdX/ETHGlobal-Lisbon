import SectionHeading from './SectionHeading';
import { useLiveStats, type DeclineReason } from '../hooks/useLiveStats';
import { ROYALTY_PERCENT, CERTIFICATE_TOKEN, tokenUrl } from '../lib/chain';

/**
 * Live Numbers.
 *
 * Every figure here is read from the running demo panel at request time. There
 * are no defaults and no sample data: when the panel is not running the section
 * says so rather than showing numbers nobody earned.
 */

/** Plain-language labels for the refusal codes the policy gate emits. */
const REASON_LABELS: Record<string, string> = {
  price_too_low: 'Price below the floor',
  use_case_forbidden: 'Forbidden use',
  share_cap_exceeded: 'Over the share cap',
  insufficient_shares: 'Not enough capacity',
  identity_unverified: 'Identity not verified',
  licence_type_not_permitted: 'Licence type not permitted',
  offer_incomplete: 'Incomplete offer',
};

function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="liquid-glass rounded-2xl border border-accent/20 bg-accent/[0.04] p-6">
      <p className="font-instrument-serif text-4xl leading-none text-accent-teal sm:text-5xl">
        {value}
      </p>
      <p className="font-mono mt-3 text-xs tracking-[0.1em] text-white/60 uppercase">{label}</p>
      {hint && <p className="mt-2 text-xs leading-relaxed text-white/45">{hint}</p>}
    </div>
  );
}

function ReasonChart({ reasons, sampleSize }: { reasons: DeclineReason[]; sampleSize: number }) {
  if (reasons.length === 0) {
    return (
      <p className="text-sm text-white/55">
        No refusals recorded yet on this instance — send a forbidden-use or below-floor offer in
        the panel and this chart fills in.
      </p>
    );
  }

  const max = Math.max(...reasons.map((r) => r.count));

  return (
    <>
      <div className="flex flex-col gap-4">
        {reasons.map((entry) => (
          <div key={entry.reason}>
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <span className="text-sm text-white/85">
                {REASON_LABELS[entry.reason] ?? entry.reason}
              </span>
              <span className="font-mono text-xs text-accent-teal">
                {entry.count}
                <span className="ml-2 text-white/35">{entry.reason}</span>
              </span>
            </div>
            {/* Plain CSS bar — no charting library for five numbers. */}
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-pink"
                style={{ width: `${Math.round((entry.count / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs leading-relaxed text-white/45">
        Counted from the {sampleSize} most recent refusal record{sampleSize === 1 ? '' : 's'} the
        panel returns. Reasons that have not occurred are left out rather than shown as zero — and
        only refusals the policy gate recorded appear at all.
      </p>
    </>
  );
}

export default function LiveNumbers() {
  const state = useLiveStats();

  return (
    <section
      id="numbers"
      className="relative overflow-hidden border-t border-accent/15 bg-[#0D0B27] py-20 sm:py-28 md:py-32"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 440px at 25% -10%, rgba(0,206,201,0.12), transparent 65%), radial-gradient(800px 400px at 90% 20%, rgba(110,86,207,0.18), transparent 65%)',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="Live Numbers"
          title="Read from the running system, not from a slide."
          intro="These come straight out of the demo panel's own ledger endpoint while you are looking at the page. If the panel is not running, this section tells you that instead of inventing figures."
        />

        {state.status === 'loading' && (
          <p className="font-mono mt-14 text-sm text-white/50">Reading the panel…</p>
        )}

        {state.status === 'offline' && (
          <div className="mt-14 rounded-2xl border border-accent-pink/30 border-l-2 border-l-accent-pink bg-accent-pink/[0.07] p-6">
            <p className="font-mono mb-2 text-xs tracking-[0.1em] text-accent-pink uppercase">
              Panel offline
            </p>
            <p className="text-sm leading-relaxed text-white/75">
              No numbers are shown because none could be read — {state.message}. Start the backend
              with <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono">npm run dev</code>{' '}
              in the repository root and reload. The links further down this page stay verifiable
              either way; they point at Hedera, not at us.
            </p>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                value={`${state.stats.totalEarnedHbar} ℏ`}
                label="Settled to the rights holder"
                hint="What the endpoint actually charged, not what buyers offered."
              />
              <Stat value={String(state.stats.completedCount)} label="Licences completed" />
              <Stat
                value={String(state.stats.declinedCount)}
                label="Offers declined"
                hint="Refusals the agent made on the artist's behalf."
              />
              <Stat
                value={`${ROYALTY_PERCENT}%`}
                label="Royalty on resale"
                hint="Baked into the certificate collection at creation; it cannot be changed."
              />
            </div>

            <div className="mt-8 rounded-2xl border border-accent/20 bg-accent/[0.04] p-7">
              <h3 className="font-instrument-serif mb-1 text-xl text-white sm:text-2xl">
                Why offers were turned down
              </h3>
              <p className="mb-7 max-w-xl text-sm text-white/60">
                The refusal is the product working. Each bar is a real decision the policy gate
                made.
              </p>
              <ReasonChart
                reasons={state.stats.declineReasons}
                sampleSize={state.stats.reasonSampleSize}
              />
            </div>
          </>
        )}

        <p className="mt-6 text-xs text-white/45">
          The {ROYALTY_PERCENT}% royalty is a property of collection{' '}
          <a
            href={tokenUrl(CERTIFICATE_TOKEN)}
            target="_blank"
            rel="noopener"
            className="font-mono text-accent-teal hover:underline"
          >
            {CERTIFICATE_TOKEN}
          </a>{' '}
          and is checkable on HashScan independently of this page.
        </p>
      </div>
    </section>
  );
}
