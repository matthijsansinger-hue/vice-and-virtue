"use client";

// Diligence (role-action): no ability for now. His old kit (a wrong-guess-proof
// Quiz + a paid correct-guess count) was built on the tag-everyone Quiz, which
// migration 122 replaced; a new ability is still to be designed.
export function DiligenceAction() {
  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Diligence</p>
      <p className="mt-2 text-sm text-cream/80">
        Diligence has no ability right now &mdash; a new one is on its way.
        Play the Quiz and the vote like everyone else.
      </p>
      <p className="mt-3 text-xs text-cream/60 italic">
        Nothing to do here — tap Done to continue.
      </p>
    </div>
  );
}
