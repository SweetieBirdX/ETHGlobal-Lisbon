import SectionHeading from './SectionHeading';

/**
 * The claim that the domain is a module, not the product.
 *
 * This is not a hypothetical: the repository's own history is the evidence —
 * the project changed domain entirely and the four core layers were carried
 * across rather than rewritten.
 */

const CORE_PARTS = [
  { name: 'Negotiation', detail: 'A2A tasks, multi-round, counter-offers' },
  { name: 'Payment binding', detail: 'x402, bound to the agreed terms' },
  { name: 'Identity', detail: 'HCS-14 UAIDs, attestation, reputation' },
  { name: 'Audit', detail: 'HCS entries, read back via mirror node' },
];

const SWAPPABLE = ['Music licensing', 'Data access', 'Compute time', 'Any metered right'];

export default function Reusable() {
  return (
    <section
      id="reusable"
      className="relative overflow-hidden border-t border-accent/15 bg-[#0D0B27] py-20 sm:py-28 md:py-32"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(1000px 480px at 70% -10%, rgba(232,67,147,0.13), transparent 65%), radial-gradient(700px 400px at 10% 30%, rgba(110,86,207,0.16), transparent 65%)',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading eyebrow="Built to Be Reused" title="Not just music." />

        <p className="font-instrument-serif mt-10 max-w-4xl text-2xl leading-[1.25] text-white sm:text-3xl md:text-4xl">
          The negotiation, payment, identity, and audit layer doesn&rsquo;t know it&rsquo;s
          licensing music.
        </p>

        <div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1.4fr] lg:items-center">
          {/* The swappable domain module, sitting on top of the engine */}
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs tracking-[0.1em] text-white/45 uppercase">
              Domain module — swappable
            </p>
            <div className="rounded-2xl border border-accent-pink/45 bg-accent-pink/[0.10] p-6 shadow-[0_0_50px_-22px_rgba(232,67,147,0.9)]">
              <p className="font-instrument-serif text-2xl text-white">Music Licensing</p>
              <p className="mt-1.5 text-sm text-white/65">
                Catalogue, share maths, licence terms, certificate metadata.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SWAPPABLE.slice(1).map((item) => (
                <span
                  key={item}
                  className="font-mono rounded-md border border-dashed border-white/15 px-3 py-1.5 text-[12px] text-white/40"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div
            className="flex items-center justify-center py-2 text-2xl text-accent/60 lg:px-4"
            aria-hidden="true"
          >
            <span className="lg:hidden">↓</span>
            <span className="hidden lg:inline">→</span>
          </div>

          {/* The engine underneath */}
          <div className="rounded-2xl border border-accent/45 bg-accent/[0.10] p-7 shadow-[0_0_60px_-25px_rgba(110,86,207,0.9)]">
            <p className="font-mono mb-1 text-xs tracking-[0.1em] text-accent-teal uppercase">
              Core engine — unchanged
            </p>
            <p className="font-instrument-serif mb-6 text-2xl text-white">
              Domain-agnostic by construction
            </p>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-accent/25 bg-accent/20 sm:grid-cols-2">
              {CORE_PARTS.map((part) => (
                <div key={part.name} className="bg-[#0D0B27] p-4">
                  <p className="text-sm font-semibold text-white">{part.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/60">{part.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-10 max-w-4xl text-base leading-relaxed text-white/70 sm:text-lg">
          Swap the catalogue for compute, data, or any other priced resource — the same identity
          checks, policy enforcement, payment binding, and audit trail carry over unchanged.
        </p>
      </div>
    </section>
  );
}
