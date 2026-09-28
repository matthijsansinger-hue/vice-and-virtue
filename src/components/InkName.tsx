"use client";

// A name drowned in Torment's ink (see lib/ink.ts): a dark blot where the name
// should be, plus the blot's number so the tormented player can still tell
// their conversations apart. The real name is never rendered.
const INK = "#150f1c";

export function InkName({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 align-middle ${className}`}
      aria-label={`Ink-blotted player ${n}`}
    >
      <span
        aria-hidden
        className="inline-block h-4 w-20 shrink-0"
        style={{
          background: `radial-gradient(circle at 18% 58%, ${INK} 0 34%, transparent 37%),
            radial-gradient(circle at 46% 38%, ${INK} 0 44%, transparent 47%),
            radial-gradient(circle at 76% 62%, ${INK} 0 38%, transparent 41%),
            radial-gradient(ellipse at 50% 52%, ${INK} 0 52%, transparent 58%)`,
          filter: "blur(0.6px)",
        }}
      />
      <span className="text-xs font-semibold opacity-70">#{n}</span>
    </span>
  );
}

// The round avatar disc, as an ink droplet instead of an initial.
export function InkDrop({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${className}`}
      style={{
        background: `radial-gradient(circle at 40% 35%, #2a2233 0 18%, ${INK} 22% 100%)`,
        boxShadow: `0 0 6px 1px ${INK}aa`,
      }}
    />
  );
}
