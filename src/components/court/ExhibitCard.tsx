"use client";

import { renderSentence, type SentencePayload } from "@/lib/sentences";
import type { ChatLine, Exhibit } from "@/lib/court";

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
  if (e.kind === "chat") {
    return ((p.messages ?? []) as ChatLine[]).map((m) => `${nameOf(m.from)}: “${lineText(m, nameOf)}”`);
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
  if (e.kind === "quiz_peek") return `QUIZ · DAY ${day} · PEEK`;
  if (e.kind === "quiz_hint") return `QUIZ · DAY ${day} · HINT`;
  return `OUTREACH · DAY ${day}`;
}

export function ExhibitCard({
  exhibit,
  nameOf,
  filerRole,
  objection,
  canObject,
  onObject,
  busy,
}: {
  exhibit: Exhibit;
  nameOf: (id: string) => string;
  filerRole?: string; // "witness" / "defendant" on counterproof
  objection?: { objector_id: string; ruling: "forged" | "upheld" };
  canObject: boolean;
  onObject: () => void;
  busy?: boolean;
}) {
  const e = exhibit;
  const label = `${e.side}${e.number}`;
  return (
    <div
      className={
        "rounded-xl border-2 p-3 text-left " +
        (e.status === "forged"
          ? "border-red-400/60 bg-red-950/40 opacity-80"
          : e.side === "P"
            ? "border-gold/50 bg-home-bg/70"
            : "border-[#7678ed]/50 bg-[#190f2e]/70")
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-cream/60">
        {label} · {e.side === "P" ? "Prosecution" : "Defence"} · {nameOf(e.filer_id)}
        {filerRole ? ` (${filerRole})` : ""} · {e.cost} SE · {exhibitSource(e)}
      </p>
      <div className="mt-1 space-y-0.5 text-sm text-cream">
        {exhibitStatement(e, nameOf).map((line, i) => (
          <p key={i} className={e.status === "forged" ? "line-through" : ""}>
            {line}
          </p>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {e.status === "standing" && <span className="text-cream/60">Not challenged</span>}
        {objection && e.status === "upheld" && (
          <span className="font-semibold text-green-300">✓ UPHELD ({nameOf(objection.objector_id)})</span>
        )}
        {objection && e.status === "forged" && (
          <span className="font-semibold text-red-300">✗ FORGED ({nameOf(objection.objector_id)})</span>
        )}
        {e.genuine !== null && e.status === "standing" && (
          <span
            className={
              "rounded-full px-2 py-0.5 font-semibold " +
              (e.genuine ? "bg-green-800/60 text-green-200" : "bg-red-800/60 text-red-200")
            }
            title="Only you can see this"
          >
            {e.genuine ? "Genuine" : "Forged"} · only you see this
          </span>
        )}
        {canObject && (
          <button
            onClick={onObject}
            disabled={busy}
            className="ml-auto rounded-lg bg-red-700 px-3 py-1.5 font-semibold text-cream hover:opacity-90 disabled:opacity-50"
          >
            Object — 50
          </button>
        )}
      </div>
    </div>
  );
}
