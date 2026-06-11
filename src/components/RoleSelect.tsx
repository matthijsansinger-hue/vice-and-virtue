"use client";

import { useEffect, useRef, useState } from "react";
import {
  selectRole,
  getTeamSelections,
  rolesSelectReady,
  resolveRoleSelect,
  ROLE_SELECT_SECONDS,
  type TeamSelections,
} from "@/lib/game";
import { ROLES, isPlayableRole, type RoleDef } from "@/lib/roles";
import { PhaseTip } from "./PhaseTip";
import type { Player, Room } from "@/lib/types";

// The role_select phase ('choose' rooms): every player was dealt a camp + a
// tier and picks their role within it, 30 seconds on the clock. A click is a
// TENTATIVE pick — camp-mates see it instantly (anonymously, by tier) in the
// team panel so the camp can coordinate — and "Lock in" makes it final. On
// expiry the host resolves: stragglers get their tentative pick, else a random
// role of their tier. Desktop shows the team panel on the left; mobile at the
// bottom. Roles whose gameplay isn't implemented yet show greyed as a preview.
export function RoleSelect({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [sel, setSel] = useState<TeamSelections>(null);
  const [busy, setBusy] = useState(false);
  const advancedRef = useRef(false);

  const isHost = myPlayer?.is_host ?? false;
  const myId = myPlayer?.id ?? null;

  // Ticking clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const remainingSec = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : ROLE_SELECT_SECONDS;

  // Poll my camp's selection state. Selections live in player_secrets (no
  // realtime), so a short poll is the sync channel; the phase change itself
  // arrives via the room realtime/poll and unmounts this screen.
  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    async function poll() {
      const s = await getTeamSelections(myId!);
      if (!cancelled && s) setSel(s);
    }
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [myId]);

  // Host: resolve when everyone has locked (poll), or when the timer expires
  // (plus a short grace so last-second locks land).
  useEffect(() => {
    if (!isHost) return;
    let cancelled = false;
    async function check() {
      if (cancelled || advancedRef.current) return;
      const expired = endsAt !== null && Date.now() >= endsAt + 1500;
      const allLocked = await rolesSelectReady(room.id);
      if (cancelled || advancedRef.current) return;
      if (allLocked || expired) {
        advancedRef.current = true;
        resolveRoleSelect(room.id).catch(() => {
          advancedRef.current = false;
        });
      }
    }
    check();
    const t = setInterval(check, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isHost, endsAt, room.id]);

  async function pick(roleId: string) {
    if (!myId || !sel || sel.locked || busy) return;
    // Optimistic: show my tentative pick immediately.
    setSel({ ...sel, choice: roleId });
    await selectRole(myId, roleId, false);
  }

  async function lockIn() {
    if (!myId || !sel || !sel.choice || sel.locked || busy) return;
    setBusy(true);
    try {
      const ok = await selectRole(myId, sel.choice, true);
      if (ok) setSel({ ...sel, locked: true });
    } finally {
      setBusy(false);
    }
  }

  // Loading: the deal hasn't been fetched yet.
  if (!sel) {
    return (
      <main className="constellations-bg flex min-h-screen flex-col items-center justify-center bg-reflection-bg px-6 text-cream">
        <p className="text-xl font-semibold">Dealing the cards&hellip;</p>
      </main>
    );
  }

  const isVice = sel.camp === "vice";
  // All roles of my camp + tier: playable ones are pickable, the rest show
  // greyed as a preview of what's coming.
  const options = Object.values(ROLES).filter(
    (r) => r.camp === sel.camp && r.tier === sel.tier
  );
  const playableCount = options.filter((r) => isPlayableRole(r.id)).length;

  const teamPanel = (
    <section className="rounded-xl border border-gold/30 bg-black/25 p-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-gold">
        Your team&rsquo;s picks
      </h2>
      <p className="mt-1 text-[11px] leading-snug text-cream/55">
        Anonymous &mdash; you see your camp&rsquo;s roles forming, not who plays
        them.
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {sel.team.map((slot, i) => {
          const role = slot.choice ? ROLES[slot.choice] : null;
          return (
            <li
              key={i}
              className={
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm " +
                (slot.me ? "bg-gold/15" : "bg-cream/5")
              }
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-gold/80 text-xs font-bold text-home-bg">
                {slot.tier}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {role ? role.name : <span className="text-cream/45 italic">Choosing…</span>}
                {slot.me && <span className="ml-1 text-xs text-gold">(you)</span>}
              </span>
              <span
                className={
                  "shrink-0 text-[10px] font-semibold uppercase tracking-wide " +
                  (slot.locked ? "text-green-300" : "text-cream/45")
                }
              >
                {slot.locked ? "Locked" : slot.choice ? "Considering" : "…"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <main className="constellations-bg flex min-h-screen flex-col items-center bg-reflection-bg px-4 pb-10 pt-10 text-cream">
      <div className="w-full max-w-5xl">
        <PhaseTip
          id="role_select"
          text="You've been dealt a camp and a tier — pick which role you'll play. Your camp sees what roles are forming (not who picks them), so you can build a strong composition. Lock in before the timer ends."
        />

        {/* Header: camp + tier + timer. */}
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-cream/60">
            Choose your role
          </p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <span
              className={
                "rounded px-3 py-1 text-sm font-semibold uppercase tracking-wide text-cream " +
                (isVice ? "bg-consultation-bg" : "bg-consultation-fg")
              }
            >
              {isVice ? "Vice" : "Virtue"}
            </span>
            <span className="rounded border border-gold/60 px-3 py-1 text-sm font-semibold uppercase tracking-wide text-gold">
              Tier {sel.tier}
            </span>
          </div>
          <p className="mt-2 text-4xl font-semibold tabular-nums">
            {remainingSec}
            <span className="text-xl text-cream/60">s</span>
          </p>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[18rem_1fr] lg:items-start">
          {/* Desktop: team panel on the left. */}
          <div className="hidden lg:block">{teamPanel}</div>

          {/* My role options. */}
          <section>
            <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
              {options.map((r) => (
                <RoleOption
                  key={r.id}
                  role={r}
                  playable={isPlayableRole(r.id)}
                  selected={sel.choice === r.id}
                  locked={sel.locked}
                  onPick={() => pick(r.id)}
                />
              ))}
            </div>
            {playableCount === 1 && (
              <p className="mt-2 text-center text-xs text-cream/50">
                Only one role is playable in your tier right now — more arrive
                as new roles are released.
              </p>
            )}

            {/* Lock in / locked state. */}
            <div className="mx-auto mt-5 max-w-sm">
              {sel.locked ? (
                <div className="rounded-lg border-2 border-gold/60 bg-gold/15 py-3 text-center font-semibold text-gold">
                  Locked in &mdash; waiting for the others
                </div>
              ) : (
                <button
                  onClick={lockIn}
                  disabled={!sel.choice || busy}
                  className="w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {busy
                    ? "Locking…"
                    : sel.choice
                      ? `Lock in ${ROLES[sel.choice]?.name ?? ""}`
                      : "Pick a role first"}
                </button>
              )}
            </div>
          </section>
        </div>

        {/* Mobile: team panel at the bottom. */}
        <div className="mt-5 lg:hidden">{teamPanel}</div>
      </div>
    </main>
  );
}

function RoleOption({
  role,
  playable,
  selected,
  locked,
  onPick,
}: {
  role: RoleDef;
  playable: boolean;
  selected: boolean;
  locked: boolean;
  onPick: () => void;
}) {
  const vice = role.camp === "vice";
  if (!playable) {
    return (
      <div
        className="relative block overflow-hidden rounded-lg border-2 opacity-60"
        style={{ borderColor: vice ? "#9b2741" : "#3a49b8" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/cards/${role.id}.png`} alt={role.name} className="block w-full opacity-60" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 px-1 text-center">
          <span className="text-[11px] font-semibold text-cream">{role.name}</span>
          <span className="text-[9px] font-semibold uppercase tracking-wide text-cream/60">
            Coming soon
          </span>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={locked && !selected}
      className={
        "relative block overflow-hidden rounded-lg border-2 text-left transition-transform " +
        (selected ? "ring-4 ring-gold" : "hover:scale-[1.02]") +
        (locked && !selected ? " opacity-40" : "")
      }
      style={{ borderColor: selected ? "#e3b510" : vice ? "#9b2741" : "#3a49b8" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/cards/${role.id}.png`} alt={role.name} className="block w-full" />
      <div
        className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,.9), rgba(0,0,0,0))",
        }}
      >
        <div className="text-xs font-semibold leading-tight text-cream">{role.name}</div>
        <div className="text-[10px] leading-snug text-cream/80">{role.ability}</div>
      </div>
      {selected && (
        <span className="absolute right-1.5 top-1.5 rounded bg-gold px-1.5 py-0.5 text-[9px] font-bold uppercase text-home-bg">
          {locked ? "Locked" : "Picked"}
        </span>
      )}
    </button>
  );
}
