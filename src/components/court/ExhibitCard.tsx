"use client";

import { renderSentence, type SentencePayload } from "@/lib/sentences";
import type { ChatLine, Exhibit } from "@/lib/court";
import { heading, SoulFlame } from "@/components/ui/royal";
import { hash } from "@/lib/castle";
import { Name, useCourtNames } from "./names";
import { SHEET_PAPER, SHEET_SHADOW, SIDE } from "./Desk";

// What a piece of proof says, in the court's words.
export function exhibitStatement(e: Pick<Exhibit, "kind" | "payload">, nameOf: (id: string) => string): string[] {
  const p = e.payload ?? {};
  if (e.kind === "quiz_peek") {
    const camp = p.camp === "vice" ? "a Vice" : p.camp === "virtue" ? "a Virtue" : "neutral";
    return [`“I peeked at ${nameOf(p.target)}. They are ${camp}.”`];
  }
  if (e.kind === "quiz_hint") {
    return p.form === "opposite"
      ? [`“${nameOf(p.a)} and ${nameOf(p.b)} are on opposite sides.”`]
      : [`“At least one of ${nameOf(p.a)} and ${nameOf(p.b)} is a ${p.camp === "vice" ? "Vice" : "Virtue"}.”`];
  }
  // The old one-message kinds (before migration 142).
  const m = p.message ?? {};
  const who = e.kind === "msg_received" ? `${nameOf(p.from)} → me` : `me → ${nameOf(p.to)}`;
  return [`${who}: “${m.s ? renderSentence(m as SentencePayload, nameOf) ?? "…" : m.text ?? "…"}”`];
}

export function lineText(m: ChatLine, nameOf: (id: string) => string): string {
  if ("s" in m) return renderSentence(m as SentencePayload, nameOf) ?? "…";
  return m.text;
}

export function exhibitSource(e: Pick<Exhibit, "kind" | "payload">): string {
  const day = e.payload?.day;
  if (e.kind === "quiz_peek") return `Quiz peek, day ${day}`;
  if (e.kind === "quiz_hint") return `Quiz hint, day ${day}`;
  return `Outreach chat, day ${day}`;
}

// Proof ruled forged gets a big red rubber stamp across the whole sheet.
// (Upheld proof gets a small green one in its status line, so the now-proven
// statement stays readable.)
function ForgedStamp() {
  const c = "#b3141b";
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden">
      <span
        className="-rotate-12 rounded-lg px-6 py-1 text-4xl font-black uppercase tracking-[0.3em] opacity-80"
        style={{
          color: c,
          border: `5px double ${c}`,
          boxShadow: `inset 0 0 0 2px ${c}33`,
          fontFamily: "var(--font-cinzel), Georgia, serif",
          textShadow: "0 1px 0 rgba(255,255,255,.35)",
        }}
      >
        Forged
      </span>
    </div>
  );
}

// One piece of proof: a sheet of paper on the trial desk. Its number is
// inked in the corner in its side's colour (P = prosecution, D = defence).
export function ExhibitCard({
  exhibit,
  filerRole,
  objection,
  canObject,
  onObject,
  busy,
}: {
  exhibit: Exhibit;
  filerRole?: string; // "witness" / "defendant" on counterproof
  objection?: { objector_id: string; ruling: "forged" | "upheld" };
  canObject: boolean;
  onObject: () => void;
  busy?: boolean;
}) {
  const { nameOf } = useCourtNames();
  const e = exhibit;
  const forged = e.status === "forged";
  const upheld = e.status === "upheld";
  const ink = SIDE[e.side].ink;
  const tilt = (((hash(e.id) % 1000) / 1000) - 0.5) * 1.6; // −0.8° … 0.8°
  return (
    <article
      aria-label={`${e.side}${e.number}, ${SIDE[e.side].name.toLowerCase()} proof`}
      className="relative overflow-hidden rounded-[3px] px-3 pb-3 pt-3 text-left"
      style={{ background: SHEET_PAPER, boxShadow: SHEET_SHADOW, color: "#2a1c10", rotate: `${tilt}deg` }}
    >
      {/* The side's colour along the top edge. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: ink }} />
      <div className={forged ? "opacity-45" : ""}>
        <div className="flex items-start gap-2.5">
          <span
            className={`flex h-9 w-9 shrink-0 -rotate-6 items-center justify-center rounded-full text-sm font-bold ${heading}`}
            style={{ color: ink, border: `2px solid ${ink}`, boxShadow: `inset 0 0 0 2px ${ink}22` }}
          >
            {e.side}
            {e.number}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1 text-xs">
              <span className="opacity-70">Filed by</span>
              <Name id={e.filer_id} small />
              {filerRole && <span className="opacity-70">({filerRole})</span>}
            </p>
            <p className="mt-0.5 text-[11px] opacity-65">{exhibitSource(e)}</p>
          </div>
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold opacity-75" title="What it cost to file">
            {e.cost}
            <SoulFlame size={11} />
          </span>
        </div>

        <div className="mt-2.5 space-y-1.5 border-t border-[#5a3c1c]/20 pt-2.5 text-sm leading-snug">
          {e.kind === "chat" ? (
            ((e.payload?.messages ?? []) as ChatLine[]).map((m, i) => (
              <p key={i} className="flex items-start gap-1.5">
                <Name id={m.from} small />
                <span>“{lineText(m, nameOf)}”</span>
              </p>
            ))
          ) : (
            exhibitStatement(e, nameOf).map((line, i) => <p key={i}>{line}</p>)
          )}
        </div>
      </div>

      <div className="relative z-20 mt-2.5 flex flex-wrap items-center gap-2 text-xs">
        {e.status === "standing" && <span className="opacity-60">Not challenged</span>}
        {objection && upheld && (
          <span className="flex flex-wrap items-center gap-1 font-semibold text-[#1d6b2c]">
            Upheld after an objection by <Name id={objection.objector_id} small />
          </span>
        )}
        {upheld && (
          <span
            aria-hidden
            className="ml-auto -rotate-6 rounded-md px-2 text-sm font-black uppercase tracking-[0.2em] opacity-80"
            style={{
              color: "#1d6b2c",
              border: "4px double #1d6b2c",
              fontFamily: "var(--font-cinzel), Georgia, serif",
            }}
          >
            Upheld
          </span>
        )}
        {objection && forged && (
          <span className="flex flex-wrap items-center gap-1 font-semibold text-[#b3141b]">
            Proven forged by <Name id={objection.objector_id} small />
          </span>
        )}
        {e.genuine !== null && e.status === "standing" && (
          <span
            className={
              "rounded-full border-2 border-dashed px-2 py-0.5 font-semibold " +
              (e.genuine ? "border-[#1d6b2c] text-[#1d6b2c]" : "border-[#b3141b] text-[#b3141b]")
            }
          >
            Only you see this: {e.genuine ? "genuine" : "forged"}
          </span>
        )}
        {canObject && (
          <button
            type="button"
            onClick={onObject}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#b3141b] px-3 py-1.5 font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50"
          >
            Object
            <span className="flex items-center gap-0.5 rounded bg-white/20 px-1.5 text-[11px]">
              50
              <SoulFlame size={11} />
            </span>
          </button>
        )}
      </div>

      {forged && <ForgedStamp />}
    </article>
  );
}
