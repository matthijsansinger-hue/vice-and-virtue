"use client";

import { renderSentence, type SentencePayload } from "@/lib/sentences";
import type { ChatLine, Exhibit } from "@/lib/court";
import { Name, PAPER, useCourtNames } from "./names";

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
  if (e.kind === "quiz_peek") return `Quiz · day ${day} · peek`;
  if (e.kind === "quiz_hint") return `Quiz · day ${day} · hint`;
  return `Outreach · day ${day} · chat`;
}

// A rubber stamp across the whole card.
// Forged: big, across the whole card. Upheld: small, in the corner, so the
// (now proven) statement stays readable.
function Stamp({ text, tone, corner = false }: { text: string; tone: "red" | "green"; corner?: boolean }) {
  const c = tone === "red" ? "#b3141b" : "#1d6b2c";
  return (
    <div
      className={
        "pointer-events-none absolute z-10 flex overflow-hidden " +
        (corner ? "right-2 top-2" : "inset-0 items-center justify-center")
      }
    >
      <span
        className={
          "-rotate-12 rounded-lg font-black uppercase opacity-80 " +
          (corner ? "px-2 text-sm tracking-[0.2em]" : "px-6 py-1 text-4xl tracking-[0.3em]")
        }
        style={{
          color: c,
          border: `5px double ${c}`,
          boxShadow: `inset 0 0 0 2px ${c}33`,
          fontFamily: "var(--font-cinzel), Georgia, serif",
          textShadow: "0 1px 0 rgba(255,255,255,.35)",
        }}
      >
        {text}
      </span>
    </div>
  );
}

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
  return (
    <div
      className={
        "relative overflow-hidden rounded-xl border-2 p-3 text-left text-home-bg shadow-[0_3px_10px_rgba(0,0,0,.2)] " +
        (e.side === "P" ? "border-[#b08a2e]" : "border-[#3a3d8f]")
      }
      style={{ background: PAPER }}
    >
      <div className={forged ? "opacity-45" : ""}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-wider text-home-bg/65">
          <span
            className={
              "rounded px-1.5 py-0.5 text-xs font-black text-cream " +
              (e.side === "P" ? "bg-[#8a6a1c]" : "bg-[#3a3d8f]")
            }
          >
            {e.side}
            {e.number}
          </span>
          <span>{e.side === "P" ? "Prosecution" : "Defence"}</span>
          <Name id={e.filer_id} small suffix={filerRole ? <span className="font-normal">({filerRole})</span> : null} />
          <span>· {e.cost} SE</span>
          <span>· {exhibitSource(e)}</span>
        </div>

        <div className="mt-2 space-y-1 text-sm">
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

      <div className="relative z-20 mt-2 flex flex-wrap items-center gap-2 text-xs">
        {e.status === "standing" && <span className="text-home-bg/60">Not challenged</span>}
        {objection && upheld && (
          <span className="font-semibold text-[#1d6b2c]">
            ✓ Upheld — objection by <Name id={objection.objector_id} small />
          </span>
        )}
        {objection && forged && (
          <span className="font-semibold text-[#b3141b]">
            ✗ Proven forged by <Name id={objection.objector_id} small />
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
            onClick={onObject}
            disabled={busy}
            className="ml-auto rounded-lg bg-[#b3141b] px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Object — 50 SE
          </button>
        )}
      </div>

      {forged && <Stamp text="Forged" tone="red" />}
      {upheld && <Stamp text="Upheld" tone="green" corner />}
    </div>
  );
}
