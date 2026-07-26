import { useEffect, useState } from 'react';
import Logo from './Logo';
import MobileMenu from './MobileMenu';

export const NAV_ITEMS = [
  { label: 'The Problem', href: '#problem' },
  { label: 'How It Works', href: '#how' },
  { label: 'Architecture', href: '#architecture' },
];

/**
 * The primary call to action, rendered by both the hero and the mobile menu.
 *
 * It points at the running demo panel, which is served by the backend on
 * port 4100 — so `npm run dev` in the repo root has to be up for this link to
 * land anywhere.
 */
export const CTA = {
  label: 'Dive In Action',
  href: 'http://localhost:4100/',
};

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('menu-open', menuOpen);
    return () => document.body.classList.remove('menu-open');
  }, [menuOpen]);

  useEffect(() => {
    const onScroll = () => setPastHero(window.scrollY > 80);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="relative flex items-center justify-between px-5 py-5 sm:px-8">
          <a href="#top" aria-label="Kinora home" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-instrument-serif text-xl text-white">Kinora</span>
          </a>

          <nav
            className={`liquid-glass absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full px-2 py-2 transition-all duration-300 md:flex ${
              pastHero ? 'pointer-events-none -translate-y-3 opacity-0' : 'opacity-100'
            }`}
          >
            {NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap text-white/70 transition-colors hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="liquid-glass flex h-11 w-11 flex-col items-center justify-center gap-1.5 rounded-full md:hidden"
          >
            <span className="h-[1.5px] w-5 bg-white" />
            <span className="h-[1.5px] w-3.5 bg-white" />
          </button>
        </div>
      </header>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
