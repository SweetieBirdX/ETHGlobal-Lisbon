import { useRef } from 'react';
import Nav, { CTA } from './Nav';
import { useHeroInteractions } from '../hooks/useHeroInteractions';

export default function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const maskTargetRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useHeroInteractions({ sectionRef, gridRef, maskTargetRef, canvasRef });

  return (
    <>
      <Nav />
      <section
        id="top"
        ref={sectionRef}
        className="font-helvetica-neue relative h-[100vh] w-full overflow-hidden bg-black"
      >
        {/* Layer 1 — grid background, subtly parallaxed by the cursor */}
        <div ref={gridRef} className="absolute -inset-4 z-0 opacity-10" aria-hidden="true">
          <svg width="100%" height="100%">
            <defs>
              <pattern id="measured-grid" width="48" height="48" patternUnits="userSpaceOnUse">
                <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#64748b" strokeWidth={0.6} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#measured-grid)" />
          </svg>
        </div>

        {/* Layer 2 — background image */}
        <div
          className="absolute inset-0 z-10 scale-105 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: "url('/assets/11back.jpg')",
            filter: 'blur(6px) brightness(0.8) saturate(1.1)',
          }}
        />
        <div className="absolute inset-0 z-10 bg-gradient-to-b from-black/15 via-black/10 to-black/70" />

        {/* Layer 3 — hero text + primary CTA, nudged right of center on desktop */}
        <div className="absolute inset-x-0 top-20 z-20 flex flex-col items-center px-4 sm:top-28 sm:px-8 md:top-32 md:items-start md:pl-10 lg:pl-20">
          {/* Live badge — the dot pulses, so it reads as a status, not a label. */}
          <span className="font-mono mb-4 inline-flex items-center gap-2 rounded-full border border-accent-teal/40 bg-accent-teal/10 px-3.5 py-1.5 text-[11px] tracking-[0.12em] text-accent-teal uppercase backdrop-blur-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-teal opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-teal" />
            </span>
            Live on Hedera Testnet
          </span>

          <h1 className="font-instrument-serif xs:text-[5.5rem] text-center text-[4.5rem] leading-[0.9] tracking-tight text-white md:text-left sm:text-[10rem] md:text-[13rem] lg:text-[16rem]">
            Kinora
          </h1>

          <p className="font-instrument-serif mt-1 text-center text-2xl text-white/90 md:text-left sm:text-3xl md:text-4xl">
            Your music, your terms.
          </p>

          <p className="mt-4 max-w-xl text-center text-sm leading-relaxed text-white/70 md:text-left sm:text-base">
            Autonomous agents negotiate the licence, pay for it, and settle it on Hedera — identity
            checked on the consensus service, HBAR moved over x402, a certificate NFT issued at the
            end. No human approves any of it.
          </p>

          <a
            href={CTA.href}
            target="_blank"
            rel="noopener"
            className="group relative mt-6 flex items-center gap-3 rounded-full bg-[length:200%_100%] bg-[position:0%_0%] bg-gradient-to-r from-accent via-accent-pink to-accent p-1.5 pl-6 shadow-[0_0_45px_-10px_rgba(110,86,207,0.9)] ring-1 ring-white/15 transition-[background-position,transform,box-shadow] duration-500 hover:scale-[1.03] hover:bg-[position:100%_0%] hover:shadow-[0_0_60px_-8px_rgba(232,67,147,0.7)] md:mt-8"
          >
            <span className="text-sm font-semibold tracking-wide text-white sm:text-base">
              {CTA.label}
            </span>
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white transition-transform duration-300 group-hover:rotate-45 sm:h-10 sm:w-10">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M5 13L13 5M13 5H6M13 5V12"
                  stroke="#15121F"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </a>
        </div>

        {/* The track line that used to sit here moved into the block above, next
            to the wordmark — two taglines in one viewport read as a mistake, and
            the taller heading stack would have collided with it on short screens. */}
        <div className="absolute inset-x-0 bottom-10 z-20 px-5 sm:px-8">
          <p className="font-mono text-xs tracking-[0.15em] text-white/40 uppercase">
            Hedera · AI &amp; Agentic Payments · No Solidity
          </p>
        </div>

        {/* Layer 4 — overlay image: the crisp instrument cutout, always visible */}
        <img
          src="/assets/111front.png"
          alt="Saxophone"
          className="pointer-events-none absolute inset-0 z-[25] h-full w-full object-contain object-right-bottom sm:object-right"
        />

        {/* Layer 5 — spotlight reveal: the glowing variant, only under the cursor,
            covering the full hero so the reveal also works over the neck/mouthpiece */}
        <div
          ref={maskTargetRef}
          className="pointer-events-none absolute inset-0 z-[30]"
          aria-hidden="true"
        >
          <div className="h-full w-full bg-[url('/assets/sax-flame.png')] bg-contain bg-right-bottom bg-no-repeat sm:bg-right" />
        </div>

        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      </section>
    </>
  );
}
