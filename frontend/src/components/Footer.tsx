import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="border-t border-accent/15 bg-[#0D0B27] py-10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo className="h-6 w-6" />
          <span className="font-instrument-serif text-lg text-white">Kinora</span>
        </a>
        <div className="flex flex-wrap items-center gap-6">
          <a
            href="https://github.com/SweetieBirdX/Kinora"
            target="_blank"
            rel="noopener"
            className="text-sm text-white/65 transition-colors hover:text-accent-teal"
          >
            GitHub ↗
          </a>
          <a href="#architecture" className="text-sm text-white/50 transition-colors hover:text-white">
            Hedera · AI &amp; Agentic Payments
          </a>
        </div>
        <p className="font-mono text-xs text-white/30">
          ETHGlobal Lisbon 2026 · Hedera testnet prototype
        </p>
      </div>
    </footer>
  );
}
