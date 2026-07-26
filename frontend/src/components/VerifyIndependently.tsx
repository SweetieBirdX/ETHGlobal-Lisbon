import SectionHeading from './SectionHeading';
import { CHAIN_ARTEFACTS } from '../lib/chain';

/**
 * The sceptic's section.
 *
 * Everything above this point is the project describing itself. These seven
 * links are the part that does not depend on us: they open HashScan, which
 * reads the same mirror node the app does. Ids live in ../lib/chain.ts and were
 * each confirmed against the mirror node before shipping.
 */
export default function VerifyIndependently() {
  return (
    <section
      id="verify"
      className="relative overflow-hidden border-t border-accent/15 bg-[#0D0B27] py-20 sm:py-28 md:py-32"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(1000px 500px at 50% -15%, rgba(0,206,201,0.13), transparent 65%)',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="Verify Independently"
          title="Don't take the page's word for any of it."
          intro="Every link below opens HashScan on Hedera testnet — the same ledger the app writes to and reads from. None of it is served by us."
        />

        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-accent/20 bg-accent/15 md:grid-cols-2">
          {CHAIN_ARTEFACTS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              target="_blank"
              rel="noopener"
              className="group flex flex-col bg-[#0D0B27] p-6 transition-colors hover:bg-accent/[0.08]"
            >
              <p className="mb-2 flex items-center gap-2 text-xs text-white/55">
                {item.label}
                <span className="text-accent-teal opacity-0 transition-opacity group-hover:opacity-100">
                  ↗
                </span>
              </p>
              <p className="font-mono text-[13px] break-all text-accent-teal group-hover:underline">
                {item.value}
              </p>
              <p className="mt-2.5 text-xs leading-relaxed text-white/50">{item.note}</p>
            </a>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-accent/25 border-l-2 border-l-accent bg-accent/[0.08] p-5">
          <p className="text-sm leading-relaxed text-white/75">
            <strong className="text-white/95">What these do not prove:</strong> the compliance
            attestation on the identity topic is issued by the seller agent about the buyer — a
            real, public, tamper-evident record, but not third-party verification. And this is a
            hackathon prototype on testnet: no real revenue, users, or licensing partners are
            implied.
          </p>
        </div>
      </div>
    </section>
  );
}
