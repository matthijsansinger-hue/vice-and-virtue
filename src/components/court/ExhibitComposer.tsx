"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ChatLine, Material } from "@/lib/court";
import { lineText } from "./ExhibitCard";
import type { Player } from "@/lib/types";

type Kind = "quiz_peek" | "quiz_hint" | "chat";

// File proof (prosecution exhibit) or counterproof. The composer starts from
// what you really have — to file genuine proof you just confirm. Changing
// anything makes it a forgery; only you get the warning. You can only file
// what the record makes possible: a peek or hint for a day you took one, a
// chat with someone you actually talked to that day (migrations 137 / 142).
export function ExhibitComposer({
  myPlayer,
  players,
  nameOf,
  title,
  cost,
  onFile,
  onCancel,
}: {
  myPlayer: Player;
  players: Player[];
  nameOf: (id: string) => string;
  title: string;
  cost: number;
  onFile: (kind: Kind, payload: Record<string, unknown>) => Promise<string | null>; // error text or null
  onCancel: () => void;
}) {
  const me = myPlayer.id;
  const [material, setMaterial] = useState<Material | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [target, setTarget] = useState("");
  const [camp, setCamp] = useState("vice");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [form, setForm] = useState<"opposite" | "at_least_one">("opposite");
  const [partner, setPartner] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("court_my_material", { p_player_id: me }).then(({ data }) => {
      if (!cancelled && data) setMaterial(data as Material);
    });
    return () => {
      cancelled = true;
    };
  }, [me]);

  const others = players.filter((p) => p.id !== me);
  const peekDays = (material?.quiz ?? []).filter((q) => q.kind === "peek").map((q) => q.day);
  const hintDays = (material?.quiz ?? []).filter((q) => q.kind === "hint").map((q) => q.day);
  const chatDays = useMemo(
    () =>
      [...new Set([...(material?.sent ?? []), ...(material?.received ?? [])].map((m) => m.day))].sort(
        (x, y) => x - y
      ),
    [material]
  );
  const partnersOn = (d: number) =>
    [
      ...new Set([
        ...(material?.sent ?? []).filter((m) => m.day === d).map((m) => m.to),
        ...(material?.received ?? []).filter((m) => m.day === d).map((m) => m.from),
      ]),
    ];

  // The genuine chat with `who` on day `d`, every message in order.
  function realChat(d: number, who: string): ChatLine[] {
    const sent = (material?.sent ?? [])
      .filter((m) => m.day === d && m.to === who)
      .map((m) => ({ at: m.at, line: toLine(me, m.payload, m.text) }));
    const got = (material?.received ?? [])
      .filter((m) => m.day === d && m.from === who)
      .map((m) => ({ at: m.at, line: toLine(who, m.payload, m.text) }));
    return [...sent, ...got].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).map((x) => x.line);
  }

  // Pre-fill with the real thing whenever the kind / day / partner changes.
  function prefill(k: Kind, d: number, who?: string) {
    const q = material?.quiz.find((x) => x.day === d);
    if (k === "quiz_peek") {
      setTarget(q?.target_id ?? q?.result?.peek?.target ?? "");
      setCamp(q?.result?.peek?.camp ?? "vice");
    } else if (k === "quiz_hint") {
      const h = q?.result?.hint ?? {};
      setA(h.a ?? "");
      setB(h.b ?? "");
      setForm(h.kind === "opposite" ? "opposite" : "at_least_one");
      setCamp(h.camp ?? "vice");
    } else {
      const w = who ?? partnersOn(d)[0] ?? "";
      setPartner(w);
      setLines(w ? realChat(d, w) : []);
    }
  }

  function choose(k: Kind) {
    const days = k === "quiz_peek" ? peekDays : k === "quiz_hint" ? hintDays : chatDays;
    const d = days[days.length - 1] ?? null;
    setKind(k);
    setDay(d);
    setError(null);
    if (d !== null) prefill(k, d);
  }

  const forged = useMemo(() => {
    if (!kind || day === null || !material) return false;
    const q = material.quiz.find((x) => x.day === day);
    if (kind === "quiz_peek") {
      return target !== (q?.target_id ?? q?.result?.peek?.target ?? "") || camp !== q?.result?.peek?.camp;
    }
    if (kind === "quiz_hint") {
      const h = q?.result?.hint ?? {};
      const samePair = [a, b].sort().join() === [h.a, h.b].sort().join();
      const realForm = h.kind === "opposite" ? "opposite" : "at_least_one";
      return !samePair || form !== realForm || (form === "at_least_one" && camp !== h.camp);
    }
    return JSON.stringify(lines.map(norm)) !== JSON.stringify(realChat(day, partner).map(norm));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, day, target, camp, a, b, form, partner, lines, material]);

  async function file() {
    if (!kind || day === null || busy) return;
    let payload: Record<string, unknown>;
    if (kind === "quiz_peek") payload = { day, target, camp };
    else if (kind === "quiz_hint")
      payload = form === "opposite" ? { day, a, b, form } : { day, a, b, form, camp };
    else payload = { day, with: partner, messages: lines.map(norm) };
    setBusy(true);
    setError(null);
    try {
      const err = await onFile(kind, payload);
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  }

  const select =
    "rounded-lg border border-gold/40 bg-home-bg px-2 py-1.5 text-sm text-cream focus:outline-none";
  const days = kind === "quiz_peek" ? peekDays : kind === "quiz_hint" ? hintDays : chatDays;

  return (
    <div className="rounded-xl border-2 border-gold bg-home-bg p-4 text-cream shadow-[0_6px_18px_rgba(0,0,0,.3)]">
      <p className="text-sm font-semibold uppercase tracking-widest text-gold">{title}</p>
      <p className="mt-1 text-xs text-cream/70">{cost > 0 ? `${cost} SE` : "Free"} · proof can be genuine or forged.</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["quiz_peek", "Quiz peek", peekDays.length],
            ["quiz_hint", "Quiz hint", hintDays.length],
            ["chat", "A whole chat", chatDays.length],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => choose(k)}
            disabled={n === 0}
            className={
              "rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40 " +
              (kind === k ? "border-gold bg-gold text-home-bg" : "border-gold/40 text-cream")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {!material && <p className="mt-3 text-xs text-cream/60">Loading your Quiz results and messages…</p>}

      {kind && day !== null && (
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2">
            Day
            <select
              className={select}
              value={day}
              onChange={(e) => {
                const d = Number(e.target.value);
                setDay(d);
                prefill(kind, d);
              }}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          {kind === "quiz_peek" && (
            <p className="flex flex-wrap items-center gap-2">
              “I peeked at
              <select className={select} value={target} onChange={(e) => setTarget(e.target.value)}>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {nameOf(p.id)}
                  </option>
                ))}
              </select>
              . They are
              <select className={select} value={camp} onChange={(e) => setCamp(e.target.value)}>
                <option value="vice">a Vice</option>
                <option value="virtue">a Virtue</option>
                <option value="neutral">neutral</option>
              </select>
              .”
            </p>
          )}

          {kind === "quiz_hint" && (
            <div className="flex flex-wrap items-center gap-2">
              {[a, b].map((v, i) => (
                <select
                  key={i}
                  className={select}
                  value={v}
                  onChange={(e) => (i === 0 ? setA(e.target.value) : setB(e.target.value))}
                >
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {nameOf(p.id)}
                    </option>
                  ))}
                </select>
              ))}
              <select
                className={select}
                value={form}
                onChange={(e) => setForm(e.target.value as "opposite" | "at_least_one")}
              >
                <option value="opposite">are on opposite sides</option>
                <option value="at_least_one">— at least one is a…</option>
              </select>
              {form === "at_least_one" && (
                <select className={select} value={camp} onChange={(e) => setCamp(e.target.value)}>
                  <option value="vice">Vice</option>
                  <option value="virtue">Virtue</option>
                </select>
              )}
            </div>
          )}

          {kind === "chat" && (
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                With
                <select
                  className={select}
                  value={partner}
                  onChange={(e) => {
                    setPartner(e.target.value);
                    setLines(realChat(day, e.target.value));
                  }}
                >
                  {partnersOn(day).map((id) => (
                    <option key={id} value={id}>
                      {nameOf(id)}
                    </option>
                  ))}
                </select>
              </label>
              <ul className="space-y-1">
                {lines.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 truncate text-xs text-cream/70">{nameOf(m.from)}</span>
                    {"text" in m ? (
                      <input
                        value={m.text}
                        maxLength={200}
                        onChange={(e) =>
                          setLines(lines.map((x, j) => (j === i ? { from: m.from, text: e.target.value } : x)))
                        }
                        className="flex-1 rounded-lg border border-gold/30 bg-home-bg px-2 py-1 text-sm text-cream"
                      />
                    ) : (
                      <span className="flex-1 text-sm">{lineText(m, nameOf)}</span>
                    )}
                    <button
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      className="text-xs text-red-300"
                      title="Leave this message out"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 text-xs">
                {[me, partner].map((who) => (
                  <button
                    key={who}
                    onClick={() => setLines([...lines, { from: who, text: "" }])}
                    className="rounded-lg border border-gold/40 px-2 py-1"
                  >
                    + a line from {who === me ? "me" : nameOf(who)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {forged && (
            <p className="rounded-lg bg-red-900/60 px-3 py-2 text-xs font-medium text-red-100">
              This doesn&rsquo;t match what you really have — filing it is a forgery. Only you see
              this warning.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={file}
          disabled={!kind || day === null || busy || (kind === "chat" && lines.length === 0)}
          className="flex-1 rounded-lg bg-gold py-2 font-semibold text-home-bg disabled:opacity-50"
        >
          {busy ? "Filing…" : "File it"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-gold/40 px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

function toLine(from: string, payload: { s: string; about?: string; role?: string } | null, text: string): ChatLine {
  if (payload && payload.s) {
    const l: ChatLine = { from, s: payload.s };
    if (payload.about) (l as { about?: string }).about = payload.about;
    if (payload.role) (l as { role?: string }).role = payload.role;
    return l;
  }
  return { from, text: text.trim() };
}

// The server's shape: sentence {from, s, about?, role?} or {from, text}.
function norm(m: ChatLine): ChatLine {
  if ("s" in m) {
    const l: ChatLine = { from: m.from, s: m.s };
    if (m.about) (l as { about?: string }).about = m.about;
    if (m.role) (l as { role?: string }).role = m.role;
    return l;
  }
  return { from: m.from, text: m.text.trim() };
}
