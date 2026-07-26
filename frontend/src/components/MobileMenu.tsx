import { useEffect, useState } from 'react';
import { NAV_ITEMS, CTA } from './Nav';

const EASING = 'cubic-bezier(0.77, 0, 0.18, 1)';

interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
}

export default function MobileMenu({ open, onClose }: MobileMenuProps) {
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setAnimateIn(true));
      return () => cancelAnimationFrame(raf);
    }
    setAnimateIn(false);
  }, [open]);

  return (
    <div
      className={`fixed inset-0 z-[55] flex flex-col bg-[#0D0B27] transition-opacity duration-300 ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      aria-hidden={!open}
    >
      <button
        onClick={onClose}
        aria-label="Close menu"
        className="liquid-glass absolute top-6 right-6 flex h-12 w-12 items-center justify-center rounded-full transition-transform duration-500"
        style={{
          transitionTimingFunction: EASING,
          transform: animateIn ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0.8)',
        }}
      >
        <span className="relative block h-5 w-5">
          <span className="absolute top-1/2 left-1/2 h-[1.5px] w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white" />
          <span className="absolute top-1/2 left-1/2 h-[1.5px] w-5 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-white" />
        </span>
      </button>

      <nav className="flex flex-1 flex-col items-center justify-center gap-1 overflow-y-auto py-20">
        {NAV_ITEMS.map((item, i) => (
          <a
            key={item.label}
            href={item.href}
            onClick={onClose}
            className="py-2 text-3xl font-medium text-white/90 transition-all duration-500 sm:text-4xl"
            style={{
              transitionTimingFunction: EASING,
              transitionDelay: `${100 + i * 60}ms`,
              opacity: animateIn ? 1 : 0,
              transform: animateIn ? 'translateY(0)' : 'translateY(24px)',
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="flex justify-center pb-10">
        <a
          href={CTA.href}
          target="_blank"
          rel="noopener"
          onClick={onClose}
          className="liquid-glass flex items-center gap-2.5 rounded-full px-6 py-3 transition-all duration-500"
          style={{
            transitionTimingFunction: EASING,
            transitionDelay: `${100 + NAV_ITEMS.length * 60}ms`,
            opacity: animateIn ? 1 : 0,
            transform: animateIn ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          <span className="h-2 w-2 rounded-full bg-green-400" />
          <span className="text-sm font-medium text-white">{CTA.label}</span>
        </a>
      </div>
    </div>
  );
}
