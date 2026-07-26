import SectionHeading from './SectionHeading';

const TODAY_STEPS = [
  'Email the rights holder and wait',
  'Negotiate terms by hand',
  'Draft and review a contract',
  'Wire the payment separately',
  "Weeks pass before it's usable",
];

const KINORA_STEPS = [
  'Buyer agent sends a structured offer',
  'Seller agent checks 3 fail-closed gates',
  'Accept returns an x402 payment URL',
  'HBAR settles on Hedera testnet',
  'A licence certificate mints, instantly',
];

export default function Problem() {
  return (
    <section
      id="problem"
      className="relative overflow-hidden border-t border-accent/15 bg-[#0D0B27] py-20 sm:py-28 md:py-32"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 420px at 15% -10%, rgba(110,86,207,0.22), transparent 65%)',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="The Problem"
          title="Licensing music at micro scale is slow, manual, and lawyer-heavy."
          intro="Clearing rights today doesn't scale down. Small creators can't license legally, and rights holders lose long-tail revenue on the deals too small to be worth a lawyer's time."
        />

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
          <div className="liquid-glass rounded-2xl border border-accent/15 bg-accent/[0.03] p-7">
            <p className="font-mono mb-5 text-xs tracking-[0.1em] text-white/55 uppercase">
              Licensing today
            </p>
            <ol className="flex flex-col gap-3.5">
              {TODAY_STEPS.map((step, i) => (
                <li key={step} className="flex items-start gap-3 text-sm text-white/70">
                  <span className="font-mono mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-white/20 text-[10px] text-white/55">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <div className="hidden items-center justify-center text-accent/50 md:flex">→</div>

          <div className="liquid-glass rounded-2xl border border-accent/50 bg-accent/15 p-7 shadow-[0_0_50px_-20px_rgba(110,86,207,0.9)]">
            <p className="font-mono mb-5 text-xs tracking-[0.1em] text-accent-teal uppercase">
              With Kinora
            </p>
            <ol className="flex flex-col gap-3.5">
              {KINORA_STEPS.map((step, i) => (
                <li key={step} className="flex items-start gap-3 text-sm text-white/95">
                  <span className="font-mono mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-accent/60 text-[10px] text-accent-teal">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
