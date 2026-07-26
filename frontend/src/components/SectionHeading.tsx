interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  intro?: string;
}

export default function SectionHeading({ eyebrow, title, intro }: SectionHeadingProps) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono mb-4 flex items-center gap-2.5 text-xs tracking-[0.15em] text-accent uppercase">
        <span className="h-px w-4 bg-accent" />
        {eyebrow}
      </p>
      <h2 className="font-instrument-serif text-3xl leading-[1.1] text-white sm:text-4xl md:text-5xl">
        {title}
      </h2>
      {intro && <p className="mt-5 text-base leading-relaxed text-white/70 sm:text-lg">{intro}</p>}
    </div>
  );
}
