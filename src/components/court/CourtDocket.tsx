"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { heading, SoulFlame } from "@/components/ui/royal";
import {
  CHARGE_LABEL,
  STAKE_CAP,
  STAKE_STEP,
  canAct,
  chargeTotal,
  courtCall,
  reasonText,
  type Charge,
  type ChargeKind,
  type CourtState,
} from "@/lib/court";
import { usePlayerCharacters } from "@/lib/usePlayerCharacters";
import { Name, useCourtNames } from "./names";
import { BoardFrame, INK, Poster, RED_INK, WarrantSheet } from "./BountyBoard";
import type { Player } from "@/lib/types";

// Step 1 — the docket, as a bounty board. Every living player has a poster;
// the bounty on it is all the Soul Energy pressed and backed against them.
// Tap a poster to see the charges against that player, back one (+10, at most
// 100 per charge) or press your own (once a day, 10–100). Whoever has the
// biggest bounty when the docket closes is today's only defendant. The rules
// and the server calls are the same as before the board.

const SHORT: Record<ChargeKind, string> = { vice: "Vice", murder: "Murder", false_witness: "False witness" };
const KIND_ORDER: Record<ChargeKind, number> = { vice: 0, murder: 1, false_witness: 2 };

function ChargeTitle({ c }: { c: Pick<Charge, "kind" | "victim_id"> }) {
  if (c.kind === "vice") return <>Being a Vice</>;
  if (c.kind === "murder")
    return (
      <>
        Murder of <Name id={c.victim_id} small />
      </>
    );
  return <>False witness</>;
}

type Bounty = { id: string; charges: Charge[]; total: number; backers: number; first: number };

export function CourtDocket({
  state,
  players,
  myPlayer,
}: {
  state: CourtState;
  players: Player[];
  myPlayer: Player | null;
}) {
  const { nameOf, colorOf } = useCourtNames();
  const characters = usePlayerCharacters(players);
  const me = myPlayer?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);

  const open = useMemo(() => state.charges.filter((c) => c.status === "open"), [state.charges]);

  // Per defendant: total backed, distinct backers, earliest press. Highest
  // total goes on trial; tie → more backers → charged first.
  const bounties = useMemo(() => {
    const out = new Map<string, Bounty>();
    for (const c of open) {
      const b = out.get(c.defendant_id) ?? { id: c.defendant_id, charges: [], total: 0, backers: 0, first: Infinity };
      b.charges.push(c);
      b.total += chargeTotal(c);
      b.first = Math.min(b.first, Date.parse(c.created_at));
      out.set(c.defendant_id, b);
    }
    for (const b of out.values()) {
      b.backers = new Set(b.charges.flatMap((c) => c.stakes.map((s) => s.player_id))).size;
      b.charges.sort((x, y) => chargeTotal(y) - chargeTotal(x) || KIND_ORDER[x.kind] - KIND_ORDER[y.kind]);
    }
    return out;
  }, [open]);
  const ranked = [...bounties.values()].sort(
    (x, y) => y.total - x.total || y.backers - x.backers || x.first - y.first
  );
  const leader = ranked[0] ?? null;
  const tiedOnTotal = ranked.length > 1 && ranked[1].total === leader?.total;

  // Everyone alive is on the board, in seat order.
  const onBoard = players.filter((p) => !p.dead);
  const target = openId ? players.find((p) => p.id === openId) ?? null : null;

  // The feed: every press and every top-up, newest first.
  const feed = state.charges
    .flatMap((c) =>
      c.stakes.map((s, i) => ({
        at: s.at,
        who: s.player_id,
        press: i === 0 && s.player_id === c.pressed_by,
        charge: c,
        amount: s.amount,
      }))
    )
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
    .slice(0, 6);

  return (
    <div className="space-y-3">
      <p className="mx-auto max-w-xl text-center text-sm text-home-bg">
        {leader ? (
          <>
            <Name id={leader.id} /> has the biggest bounty and goes on trial if the docket closes now.
            {tiedOnTotal && " On a tied bounty, more backers wins, then whoever was charged first."}
          </>
        ) : (
          <>
            No bounties yet.{canAct(myPlayer) && " Tap a poster to press a charge."} Without a charge, nobody goes
            to prison today.
          </>
        )}
      </p>

      <BoardFrame>
        {onBoard.map((p) => {
          const b = bounties.get(p.id);
          const top = b?.charges[0];
          return (
            <Poster
              key={p.id}
              id={p.id}
              name={nameOf(p.id)}
              character={characters[p.shown_as ?? p.id] ?? null}
              color={colorOf(p.id)}
              bounty={b?.total ?? 0}
              summary={top ? SHORT[top.kind] + (b!.charges.length > 1 ? ` +${b!.charges.length - 1}` : "") : null}
              chargeCount={b?.charges.length ?? 0}
              leader={leader?.id === p.id}
              me={p.id === me}
              inPrison={p.in_prison}
              inHospital={p.in_hospital}
              open={openId === p.id}
              onOpen={p.in_prison ? null : () => setOpenId(p.id)}
            />
          );
        })}
      </BoardFrame>

      {feed.length > 0 && (
        <ul className="space-y-1 text-xs text-home-bg" aria-label="Latest charges">
          {feed.map((f, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1">
              <Name id={f.who} small />
              {f.press ? (
                <>
                  <span>charged</span>
                  <Name id={f.charge.defendant_id} small />
                  <span>with {CHARGE_LABEL[f.charge.kind]}</span>
                  {f.charge.victim_id && (
                    <>
                      <span>of</span>
                      <Name id={f.charge.victim_id} small />
                    </>
                  )}
                  <span className="font-bold">({f.amount})</span>
                </>
              ) : (
                <>
                  <span>backed the charge against</span>
                  <Name id={f.charge.defendant_id} small />
                  <span className="font-bold">(+{f.amount})</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {target && (
        <Warrant
          key={target.id}
          target={target}
          bounty={bounties.get(target.id) ?? null}
          leader={leader?.id === target.id}
          state={state}
          open={open}
          myPlayer={myPlayer}
          character={characters[target.shown_as ?? target.id] ?? null}
          onClose={close}
        />
      )}
    </div>
  );
}

type Option = { key: string; kind: ChargeKind; victim: string | null; existing: Charge | undefined };

// The sheet for one player: the charges against them, and your moves.
function Warrant({
  target,
  bounty,
  leader,
  state,
  open,
  myPlayer,
  character,
  onClose,
}: {
  target: Player;
  bounty: Bounty | null;
  leader: boolean;
  state: CourtState;
  open: Charge[];
  myPlayer: Player | null;
  character: ReturnType<typeof usePlayerCharacters>[string];
  onClose: () => void;
}) {
  const { nameOf } = useCourtNames();
  const titleId = useId();
  const me = myPlayer?.id ?? null;
  const se = myPlayer?.soul_energy ?? 0;
  const mayAct = canAct(myPlayer);
  const isMe = target.id === me;
  const pressedToday = open.some((c) => c.pressed_by === me);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const mineOn = (c: Charge | undefined) =>
    c ? c.stakes.filter((s) => s.player_id === me).reduce((n, s) => n + s.amount, 0) : 0;

  // What you could press against them: always "a Vice"; murder of each of
  // today's victims; false witness only if they messaged you today.
  const options: Option[] = [];
  const find = (kind: ChargeKind, victim: string | null) =>
    open.find((c) => c.defendant_id === target.id && c.kind === kind && (c.victim_id ?? null) === victim);
  options.push({ key: "vice", kind: "vice", victim: null, existing: find("vice", null) });
  for (const v of state.victims)
    options.push({ key: "murder:" + v, kind: "murder", victim: v, existing: find("murder", v) });
  if (state.record.dms.some((d) => d.day === state.day && d.from === target.id && d.to === me))
    options.push({ key: "fw", kind: "false_witness", victim: null, existing: find("false_witness", null) });

  const [choice, setChoice] = useState("vice");
  const picked = options.find((o) => o.key === choice) ?? options[0];
  // An existing charge's cap counts what you already put on it.
  const headroom = picked.existing ? STAKE_CAP - mineOn(picked.existing) : STAKE_CAP;
  const [stake, setStake] = useState(STAKE_STEP);
  const stakeOk = stake <= headroom && stake <= se;

  async function run(fn: string, args: Record<string, unknown>, ok: (r: Record<string, unknown>) => string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await courtCall(fn, args);
      if (!res.ok) setError(reasonText(res.reason));
      else setDone(ok(res));
    } finally {
      setBusy(false);
    }
  }

  const canPress = mayAct && !isMe && !target.dead && !target.in_prison && !pressedToday;
  const whyNot = !myPlayer
    ? null
    : myPlayer.dead
      ? "The dead can watch the board but can't press or back charges."
      : myPlayer.in_prison
        ? "You can't press or back charges from the dungeon."
        : myPlayer.in_hospital
          ? "You can't press or back charges from the infirmary."
          : null;
  const note = isMe
    ? "You can't charge yourself or back charges against you."
    : whyNot ?? (pressedToday ? "You've pressed your charge for today. You can still back charges." : null);

  return (
    <WarrantSheet titleId={titleId} onClose={onClose}>
      <div className="flex items-center gap-3 pr-8">
        <span
          className="block h-16 w-16 shrink-0 rounded-full"
          style={{ boxShadow: `0 0 0 2px ${INK}, 0 0 0 4px rgba(42,28,16,.15)` }}
        >
          <CharacterAvatar
            character={character}
            initials={nameOf(target.id).charAt(0).toUpperCase()}
            className="h-full w-full"
            textClass="text-base"
          />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Name id={target.id} />
            {isMe && <span className="text-sm font-semibold opacity-70">(you)</span>}
          </h2>
          <p
            className={`mt-1 flex items-center gap-1 text-2xl font-bold leading-none tabular-nums ${heading}`}
            style={{ color: bounty ? RED_INK : undefined }}
          >
            {bounty ? (
              <>
                {bounty.total}
                <SoulFlame size={18} />
              </>
            ) : (
              <span className="text-base font-semibold opacity-60">No bounty</span>
            )}
          </p>
          {leader && (
            <p className="mt-1 text-xs font-semibold" style={{ color: RED_INK }}>
              On trial if the docket closed now
            </p>
          )}
          {target.in_hospital && <p className="mt-1 text-xs opacity-75">In the infirmary, but can still be charged.</p>}
        </div>
      </div>

      {/* The charges against them. */}
      {bounty && (
        <ul className="mt-4 space-y-2">
          {bounty.charges.map((c) => {
            const mine = mineOn(c);
            const canBack = mayAct && !isMe && mine + STAKE_STEP <= STAKE_CAP && se >= STAKE_STEP;
            const by = new Map<string, number>();
            for (const s of c.stakes) by.set(s.player_id, (by.get(s.player_id) ?? 0) + s.amount);
            return (
              <li key={c.id} className="rounded-lg border border-[#5a3c1c]/25 bg-white/40 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-1 text-sm font-semibold">
                    <ChargeTitle c={c} />
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 font-bold tabular-nums">
                    {chargeTotal(c)}
                    <SoulFlame size={13} />
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[...by].map(([id, n]) => (
                    <span key={id} className="inline-flex items-center gap-1 text-xs font-semibold">
                      <Name id={id} small />
                      <span className="tabular-nums">{n}</span>
                    </span>
                  ))}
                </div>
                {canBack ? (
                  <button
                    type="button"
                    onClick={() =>
                      run("back_charge", { p_player_id: me, p_charge_id: c.id }, () => `You put ${STAKE_STEP} more on it.`)
                    }
                    disabled={busy}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg bg-home-bg px-3 py-1.5 text-xs font-bold text-cream hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50"
                  >
                    Back it +{STAKE_STEP}
                    <SoulFlame size={12} />
                  </button>
                ) : (
                  mayAct &&
                  !isMe &&
                  mine + STAKE_STEP > STAKE_CAP && (
                    <p className="mt-1.5 text-xs opacity-70">You&apos;ve put the most you can on this charge ({STAKE_CAP}).</p>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Your own charge. */}
      {canPress ? (
        <div className="mt-4 border-t border-[#5a3c1c]/25 pt-3">
          <p className="text-sm font-bold">Press a charge</p>
          <div role="radiogroup" aria-label="The charge" className="mt-2 flex flex-wrap gap-1.5">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={picked.key === o.key}
                onClick={() => setChoice(o.key)}
                className={
                  "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold " +
                  (picked.key === o.key
                    ? "border-home-bg bg-home-bg text-cream"
                    : "border-home-bg/35 bg-white/50 text-home-bg hover:bg-white/80")
                }
              >
                {o.kind === "vice" ? (
                  "Being a Vice"
                ) : o.kind === "murder" ? (
                  <>Murder of {nameOf(o.victim!)}</>
                ) : (
                  "False witness"
                )}
              </button>
            ))}
          </div>
          {picked.kind === "false_witness" && (
            <p className="mt-1.5 text-xs opacity-75">They messaged you today, and you say it wasn&apos;t true.</p>
          )}
          {picked.existing && (
            <p className="mt-1.5 text-xs opacity-75">
              This charge is already on the board, so your stake backs it and you keep your press for today.
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap gap-1" role="radiogroup" aria-label="Your stake">
            {Array.from({ length: STAKE_CAP / STAKE_STEP }, (_, i) => (i + 1) * STAKE_STEP).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={stake === v}
                onClick={() => setStake(v)}
                disabled={se < v || v > headroom}
                className={
                  "w-10 rounded-md py-1 text-xs font-bold tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-30 " +
                  (stake === v ? "bg-home-bg text-cream" : "border border-home-bg/35 bg-white/50 text-home-bg")
                }
              >
                {v}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              run(
                "press_charge",
                {
                  p_player_id: me,
                  p_defendant: target.id,
                  p_kind: picked.kind,
                  p_victim: picked.victim,
                  p_stake: stake,
                },
                (r) => (r.backed ? `Your ${stake} backs the charge that was already there.` : "Charge pressed.")
              )
            }
            disabled={busy || !stakeOk}
            className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 font-bold text-[#fff4e4] shadow-[0_3px_8px_rgba(0,0,0,.3)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50`}
            style={{ background: RED_INK }}
          >
            {busy ? "Pressing…" : picked.existing ? `Back the charge with ${stake}` : `Press the charge for ${stake}`}
            {!busy && <SoulFlame size={15} />}
          </button>
          <p className="mt-1.5 text-xs opacity-70">
            One charge a day. No withdrawals. You have {se} Soul Energy.
          </p>
        </div>
      ) : (
        note && <p className="mt-4 border-t border-[#5a3c1c]/25 pt-3 text-xs opacity-75">{note}</p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold" style={{ color: RED_INK }}>
          {error}
        </p>
      )}
      {done && <p className="mt-2 text-sm font-semibold text-[#2f6b2a]">{done}</p>}
    </WarrantSheet>
  );
}
