import { useEffect, type RefObject } from 'react';

interface HeroInteractionRefs {
  sectionRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
  maskTargetRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

const SPOTLIGHT_RADIUS = 160;
const GRID_STRENGTH = 16;
const GRID_LERP = 0.06;
const SPOTLIGHT_LERP = 0.1;

/**
 * Drives two cursor-reactive effects on the hero in a single rAF loop:
 * a subtle parallax shift on the grid background, and a canvas-painted
 * radial mask that reveals the flame layer only under the cursor.
 * Styles are written straight to the DOM via refs (not React state) so
 * a 60fps loop doesn't trigger a re-render every frame.
 */
export function useHeroInteractions({
  sectionRef,
  gridRef,
  maskTargetRef,
  canvasRef,
}: HeroInteractionRefs) {
  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    if (!section || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rect = section.getBoundingClientRect();
    const resize = () => {
      rect = section.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();
    window.addEventListener('resize', resize);

    const pointer = { x: rect.width / 2, y: rect.height / 2 };
    const gridTarget = { x: 0, y: 0 };
    const gridSmooth = { x: 0, y: 0 };
    const spotSmooth = { x: -9999, y: -9999 };
    let hasPointer = false;

    const handleMove = (e: MouseEvent) => {
      rect = section.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      hasPointer = true;

      const cx = rect.width / 2;
      const cy = rect.height / 2;
      gridTarget.x = ((pointer.x - cx) / cx) * GRID_STRENGTH;
      gridTarget.y = ((pointer.y - cy) / cy) * GRID_STRENGTH;
    };
    const handleLeave = () => {
      hasPointer = false;
    };

    window.addEventListener('mousemove', handleMove);
    section.addEventListener('mouseleave', handleLeave);

    // Frame-rate-independent easing: GRID_LERP/SPOTLIGHT_LERP are calibrated
    // per frame at 60fps, so scale them by elapsed time rather than applying
    // a flat fraction every callback — otherwise a 120Hz display eases twice
    // as fast, and a throttled/background tab eases in visible jumps.
    const REFERENCE_MS = 1000 / 60;
    let lastTime = performance.now();

    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(now - lastTime, 250);
      lastTime = now;
      const gridFactor = 1 - Math.pow(1 - GRID_LERP, dt / REFERENCE_MS);
      const spotFactor = 1 - Math.pow(1 - SPOTLIGHT_LERP, dt / REFERENCE_MS);

      gridSmooth.x += (gridTarget.x - gridSmooth.x) * gridFactor;
      gridSmooth.y += (gridTarget.y - gridSmooth.y) * gridFactor;
      if (gridRef.current) {
        gridRef.current.style.transform = `translate(${gridSmooth.x}px, ${gridSmooth.y}px)`;
      }

      const spotTargetX = hasPointer ? pointer.x : -9999;
      const spotTargetY = hasPointer ? pointer.y : -9999;
      spotSmooth.x += (spotTargetX - spotSmooth.x) * spotFactor;
      spotSmooth.y += (spotTargetY - spotSmooth.y) * spotFactor;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const grad = ctx.createRadialGradient(
        spotSmooth.x,
        spotSmooth.y,
        0,
        spotSmooth.x,
        spotSmooth.y,
        SPOTLIGHT_RADIUS,
      );
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,1)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.75)');
      grad.addColorStop(0.75, 'rgba(255,255,255,0.4)');
      grad.addColorStop(0.88, 'rgba(255,255,255,0.12)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.beginPath();
      ctx.arc(spotSmooth.x, spotSmooth.y, SPOTLIGHT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      if (maskTargetRef.current) {
        const url = `url(${canvas.toDataURL()})`;
        maskTargetRef.current.style.maskImage = url;
        maskTargetRef.current.style.setProperty('-webkit-mask-image', url);
        maskTargetRef.current.style.maskSize = '100% 100%';
        maskTargetRef.current.style.setProperty('-webkit-mask-size', '100% 100%');
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('resize', resize);
      section.removeEventListener('mouseleave', handleLeave);
    };
  }, [sectionRef, gridRef, maskTargetRef, canvasRef]);
}
