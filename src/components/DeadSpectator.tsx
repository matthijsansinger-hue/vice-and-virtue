"use client";

// The omniscient spectator view for DEAD players. Living players are routed to
// the normal phase components; dead players see this instead during the secret
// phases (role_action, minigame, outreach, store, consultation). It reveals the
// secret per-player snapshot via the dead-gated `spectator_secrets` RPC
// (migration 093) and, in outreach, every private chat (dm_messages, open RLS).
// Read-only — plus the dead-only chat at the bottom.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { heading, staggerContainer, fadeUp } from "@/components/ui/royal";
import { supabase } from "@/lib/supabase";
import { displayedName } from "@/lib/swaps";
import { getRole } from "@/lib/roles";
import { RoleIcon } from "./RoleIcon";
import { DeadChat } from "./DeadChat";
import type { Player, Room, DirectMessage } from "@/lib/types";

type Potions = {
  kill: string | null;
  hosp: string | null;
  protect: boolean;
  mult: boolean;
  vote_reveal: boolean;
  iron_will: boolean;
};
type Secret = {
  player_id: string;
  role: string | null;
  soul_energy: number;
  pending_action: string | null;
  pending_target: string | null;
  vote: string | null;
  guesses: Record<string, "vice" | "virtue" | "unknown"> | null;
  potions: Potions;
};

const PHASE_LABEL: Record<string, string> = {
  role_action: "Role action",
  minigame: "Quiz",
  outreach: "Outreach",
  store: "Market",
  consultation: "Consultation",
};

// Humanised role-action verbs (pending_action) for the role-action panel.
const ACTION_LABEL: Record<string, string> = {
  kill: "Kill",
  protect: "Protect",
  intox: "Hospitalise",
  sacrifice: "Sacrifice",
  vengeance_guess: "Vengeance",
  envy_swap: "Swap with",
  torment: "Torment",
  convert: "Corrupt",
  reach: "Turn",
};

export function DeadSpectator({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [secrets, setSecrets] = useState<Map<string, Secret>>(new Map());
  const [dms, setDms] = useState<DirectMessage[]>([]);

  // Poll the dead-gated snapshot (and, in outreach, all DMs) every 2.5s so the
  // view stays live as votes / purchases land.
  useEffect(() => {
    if (!myPlayer) return;
    let active = true;
    async function poll() {
      const { data } = await supabase.rpc("spectator_secrets", {
        p_player_id: myPlayer!.id,
      });
      if (!active) return;
      const d = data as { ok?: boolean; players?: Secret[] } | null;
      if (d?.ok && Array.isArray(d.players)) {
        setSecrets(new Map(d.players.map((s) => [s.player_id, s])));
      }
      if (room.phase === "outreach") {
        const { data: dmData } = await supabase
          .from("dm_messages")
          .select("*")
          .eq("room_id", room.id)
          .eq("day", room.day)
          .order("created_at", { ascending: true });
        if (active) setDms((dmData ?? []) as DirectMessage[]);
      }
    }
    poll();
    const t = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [myPlayer?.id, room.id, room.phase, room.day]); // eslint-disable-line react-hooks/exhaustive-deps

  const ordered = useMemo(
    () => [...players].sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
    [players]
  );

  const nameOf = (id: string | null | undefined) => {
    if (!id) return "?";
    if (id === "skip") return "skip";
    const p = players.find((x) => x.id === id);
    return p ? displayedName(p, room, players, myPlayer?.id) : "?";
  };

  function actionText(s: Secret): string | null {
    if (!s.pending_action) return null;
    const label = ACTION_LABEL[s.pending_action] ?? s.pending_action;
    if (!s.pending_target) return label;
    let targets: string[] = [];
    try {
      const parsed = JSON.parse(s.pending_target);
      targets = Array.isArray(parsed) ? parsed.map((t) => nameOf(String(t))) : [nameOf(s.pending_target)];
    } catch {
      targets = [nameOf(s.pending_target)];
    }
    return targets.length ? `${label} → ${targets.join(", ")}` : label;
  }

  function potionText(po: Potions): string[] {
    const parts: string[] = [];
    if (po.kill) parts.push(`Kill → ${nameOf(po.kill)}`);
    if (po.hosp) parts.push(`Hospitalise → ${nameOf(po.hosp)}`);
    if (po.protect) parts.push("Protection");
    if (po.mult) parts.push("Quiz ×2");
    if (po.vote_reveal) parts.push("Vote reveal");
    if (po.iron_will) parts.push("Iron Will");
    return parts;
  }

  const label = PHASE_LABEL[room.phase] ?? room.phase;

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#181226] px-4 pb-10 pt-16 text-cream">
      <motion.div
        className="w-full max-w-2xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.div variants={fadeUp} className="text-center">
          <p className={`text-xs uppercase tracking-[0.3em] text-red-300/80 ${heading}`}>
            Spectating &mdash; you&rsquo;re dead
          </p>
          <p className={`mt-1 text-2xl font-bold text-gold ${heading}`}>
            Day {room.day} &middot; {label}
          </p>
          <p className="mt-1 text-xs text-cream/55">
            The dead see all. This updates live.
          </p>
        </motion.div>

        <motion.div variants={fadeUp} className="mt-5">
          {room.phase === "outreach" ? (
            <OutreachThreads dms={dms} nameOf={nameOf} />
          ) : (
            <ul className="flex flex-col gap-2">
              {ordered.map((p) => {
                const s = secrets.get(p.id);
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-gold/25 bg-black/25 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      {s?.role && (
                        <RoleIcon
                          roleId={s.role}
                          camp={getRole(s.role)?.camp ?? "vice"}
                          className="h-8 w-8 shrink-0"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-cream">
                          {displayedName(p, room, players, myPlayer?.id)}
                          {p.dead && <span className="ml-1.5 text-xs text-red-300/70">(dead)</span>}
                          {p.in_prison && <span className="ml-1.5 text-xs text-slate-300/70">(prison)</span>}
                          {p.in_hospital && <span className="ml-1.5 text-xs text-emerald-200/70">(hospital)</span>}
                        </span>
                        <span className="block text-xs text-cream/60">
                          {s?.role ? getRole(s.role)?.name : "?"} &middot;{" "}
                          {s?.soul_energy ?? p.soul_energy} SE
                        </span>
                      </span>
                    </div>

                    {/* Per-phase secret line. */}
                    {s && (
                      <div className="mt-1.5 text-sm">
                        {room.phase === "role_action" &&
                          (actionText(s) ? (
                            <span className="text-gold/90">{actionText(s)}</span>
                          ) : (
                            <span className="text-cream/40">no action yet</span>
                          ))}

                        {room.phase === "store" &&
                          (potionText(s.potions).length ? (
                            <span className="text-gold/90">{potionText(s.potions).join(" · ")}</span>
                          ) : (
                            <span className="text-cream/40">nothing bought</span>
                          ))}

                        {room.phase === "consultation" &&
                          (s.vote ? (
                            <span className="text-gold/90">
                              voted {s.vote === "skip" ? "skip" : `→ ${nameOf(s.vote)}`}
                            </span>
                          ) : (
                            <span className="text-cream/40">no vote yet</span>
                          ))}

                        {room.phase === "minigame" && (
                          <Tags guesses={s.guesses} nameOf={nameOf} />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </motion.div>

        <motion.div variants={fadeUp} className="mt-6">
          <DeadChat room={room} players={players} myPlayer={myPlayer} />
        </motion.div>
      </motion.div>
    </main>
  );
}

function Tags({
  guesses,
  nameOf,
}: {
  guesses: Record<string, "vice" | "virtue" | "unknown"> | null;
  nameOf: (id: string) => string;
}) {
  const entries = guesses ? Object.entries(guesses) : [];
  if (entries.length === 0) return <span className="text-cream/40">no tags yet</span>;
  const tagLabel = (t: string) => (t === "vice" ? "Vice" : t === "virtue" ? "Virtue" : "?");
  const tagColor = (t: string) =>
    t === "vice" ? "text-consultation-bg" : t === "virtue" ? "text-consultation-fg" : "text-cream/55";
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {entries.map(([id, tag]) => (
        <span key={id} className="text-xs">
          {nameOf(id)}:{" "}
          <span className={`font-semibold ${tagColor(tag)}`}>{tagLabel(tag)}</span>
        </span>
      ))}
    </span>
  );
}

function OutreachThreads({
  dms,
  nameOf,
}: {
  dms: DirectMessage[];
  nameOf: (id: string) => string;
}) {
  const threads = useMemo(() => {
    const m = new Map<string, DirectMessage[]>();
    for (const msg of dms) {
      const key = [msg.sender_id, msg.recipient_id].sort().join("|");
      const arr = m.get(key);
      if (arr) arr.push(msg);
      else m.set(key, [msg]);
    }
    return [...m.values()];
  }, [dms]);

  if (threads.length === 0)
    return <p className="text-center text-sm text-cream/50">No chats yet today.</p>;

  return (
    <div className="flex flex-col gap-3">
      {threads.map((thread) => {
        const a = thread[0].sender_id;
        const b = thread[0].recipient_id;
        return (
          <div key={a + b} className="rounded-xl border border-gold/25 bg-black/25 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gold/80">
              {nameOf(a)} &harr; {nameOf(b)}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {thread.map((m) => (
                <li key={m.id} className="text-sm">
                  <span className="font-semibold text-cream/90">{nameOf(m.sender_id)}:</span>{" "}
                  <span className="text-cream/80">{m.text}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
