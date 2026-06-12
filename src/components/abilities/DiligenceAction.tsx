"use client";

// Diligence (role-action): nothing to do here — the passive is always on, and
// the paid "count your correct reads" ability lives on the results screen.
export function DiligenceAction() {
  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Diligence</p>
      <p className="mt-2 text-sm text-cream/80">
        Your passive is always on: a wrong guess in the minigame won&rsquo;t
        zero your round — you keep whatever your correct tags earn.
      </p>
      <p className="mt-2 text-sm text-cream/80">
        After the minigame, on the results screen, you can pay 100 Soul Energy
        to count how many players you read correctly.
      </p>
      <p className="mt-3 text-xs text-cream/60 italic">
        Nothing to do here — tap Done to continue.
      </p>
    </div>
  );
}
