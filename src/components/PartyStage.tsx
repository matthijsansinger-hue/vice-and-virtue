"use client";

// The Play screen's party row: your character in the middle, one party slot on
// each side (a party is you + up to 2 friends). A slot holds a party member, a
// friend you've invited (faded, "Invited"), or a "+" that opens the friend
// picker. The leader wears a crown; the leader can remove a member or cancel
// an invite (the x on a slot). Logged out you get a plain silhouette (playing
// needs an account, so the "+" asks you to sign up).

import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { IconCrown, IconPlus, IconX } from "@tabler/icons-react";
import { CharacterAvatar } from "./CharacterAvatar";
import { LevelStar } from "./LevelStar";
import { heading, fadeUp } from "./ui/royal";
import type { CharacterConfig } from "@/lib/character";
import { PRESENCE_LABEL, type PresenceStatus } from "@/lib/presence";

export type StageMember = {
  name: string;
  character: CharacterConfig | null;
  nameStyle?: CSSProperties;
  level?: number | null;
  leader?: boolean;
};

export type StageSlot =
  | { kind: "empty" }
  | {
      kind: "member";
      userId: string;
      name: string;
      character: CharacterConfig;
      level: number;
      leader: boolean;
      status: PresenceStatus;
    }
  | { kind: "invited"; userId: string; name: string; character: CharacterConfig };

// Mobile: fixed sizes (the page scrolls). Desktop: the stage is a size
// container that gets whatever height the Play screen has left, so the boxes
// follow that height (100cqh, minus ~6rem for the name, crown and "Leave
// party") up to their full size — the screen never has to scroll.
const ME_BOX =
  "h-40 w-40 sm:h-52 sm:w-52 " +
  "lg:h-[clamp(6rem,calc(100cqh_-_6rem),18rem)] lg:w-[clamp(6rem,calc(100cqh_-_6rem),18rem)] " +
  "xl:h-[clamp(6rem,calc(100cqh_-_6rem),22rem)] xl:w-[clamp(6rem,calc(100cqh_-_6rem),22rem)] " +
  "2xl:h-[clamp(6rem,calc(100cqh_-_6rem),26rem)] 2xl:w-[clamp(6rem,calc(100cqh_-_6rem),26rem)]";
const SLOT_BOX =
  "h-24 w-24 sm:h-32 sm:w-32 " +
  "lg:h-[clamp(4.5rem,calc((100cqh_-_6rem)*0.62),11rem)] lg:w-[clamp(4.5rem,calc((100cqh_-_6rem)*0.62),11rem)] " +
  "xl:h-[clamp(4.5rem,calc((100cqh_-_6rem)*0.65),14rem)] xl:w-[clamp(4.5rem,calc((100cqh_-_6rem)*0.65),14rem)] " +
  "2xl:h-[clamp(4.5rem,calc((100cqh_-_6rem)*0.65),17rem)] 2xl:w-[clamp(4.5rem,calc((100cqh_-_6rem)*0.65),17rem)]";

export function PartyStage({
  me,
  loggedOut,
  slots,
  canInvite,
  canRemove,
  onAddFriend,
  onRemove,
  onLeave,
}: {
  me: StageMember;
  loggedOut: boolean;
  slots: [StageSlot, StageSlot];
  canInvite: boolean;
  canRemove: boolean;
  onAddFriend: () => void;
  onRemove: (userId: string, name: string) => void;
  onLeave: (() => void) | null;
}) {
  const initials = (me.name || "?").slice(0, 2).toUpperCase();
  const slot = (s: StageSlot) => (
    <Slot s={s} canInvite={canInvite} canRemove={canRemove} onAdd={onAddFriend} onRemove={onRemove} />
  );
  return (
    <motion.div
      variants={fadeUp}
      className="mx-auto mt-6 max-w-2xl lg:mt-3 lg:flex lg:min-h-[12rem] lg:w-full lg:max-w-5xl lg:flex-1 lg:flex-col lg:justify-center lg:[container-type:size] 2xl:max-w-6xl"
    >
      <div className="relative flex items-center justify-center gap-3 sm:gap-6 lg:gap-12">
        {slot(slots[0])}

        <div className="relative flex flex-col items-center">
          {/* Soft spotlight behind your character. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-6 -z-10 rounded-full"
            style={{ background: "radial-gradient(circle at 50% 45%, rgba(227,181,16,.20), rgba(227,181,16,0) 65%)" }}
          />
          <div className="relative">
            <CharacterAvatar
              character={loggedOut ? null : me.character}
              initials={initials}
              variant="full"
              className={`${ME_BOX} border border-gold/35 bg-cream/5 shadow-[0_10px_30px_rgba(0,0,0,.45)]`}
              textClass="text-5xl"
            />
            {!loggedOut && me.level != null && (
              <span className="absolute -right-3 -top-3 lg:-right-4 lg:-top-4">
                <LevelStar level={me.level} size={52} />
              </span>
            )}
            {me.leader && <Crown className="-top-4 left-1/2 -translate-x-1/2 lg:-top-5" big />}
          </div>
          {loggedOut ? (
            <span className="mt-3 text-sm text-cream/55">Not signed in</span>
          ) : (
            <span
              className={`mt-3 min-h-[1.75rem] max-w-[12rem] truncate text-lg font-semibold tracking-wide text-cream sm:max-w-[14rem] lg:max-w-[18rem] lg:text-2xl ${heading}`}
              style={me.nameStyle}
            >
              {me.name}
            </span>
          )}
        </div>

        {slot(slots[1])}
      </div>

      {onLeave && (
        <div className="mt-1 text-center">
          <button
            onClick={onLeave}
            className="rounded-lg px-3 py-1 text-xs font-semibold text-cream/60 underline decoration-cream/30 underline-offset-2 transition-colors hover:text-cream"
          >
            Leave party
          </button>
        </div>
      )}
    </motion.div>
  );
}

function Crown({ className, big = false }: { className: string; big?: boolean }) {
  return (
    <span
      className={`absolute flex items-center justify-center rounded-full border-2 border-gold bg-home-bg text-gold shadow-[0_2px_8px_rgba(0,0,0,.5)] ${big ? "h-9 w-9" : "h-7 w-7"} ${className}`}
      title="Party leader"
      aria-label="Party leader"
    >
      <IconCrown size={big ? 20 : 15} aria-hidden />
    </span>
  );
}

function Slot({
  s,
  canInvite,
  canRemove,
  onAdd,
  onRemove,
}: {
  s: StageSlot;
  canInvite: boolean;
  canRemove: boolean;
  onAdd: () => void;
  onRemove: (userId: string, name: string) => void;
}) {
  if (s.kind === "empty") {
    return (
      <div className="flex flex-col items-center">
        {canInvite ? (
          <motion.button
            type="button"
            onClick={onAdd}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            aria-label="Invite a friend to your party"
            className={`${SLOT_BOX} group flex items-center justify-center rounded-2xl border-2 border-dashed border-gold/40 bg-black/20 text-gold/70 transition-colors hover:border-gold hover:bg-gold/10 hover:text-gold`}
          >
            <IconPlus className="h-8 w-8 lg:h-11 lg:w-11" stroke={2.2} aria-hidden />
          </motion.button>
        ) : (
          <div className={`${SLOT_BOX} rounded-2xl border-2 border-dashed border-cream/15 bg-black/10`} aria-hidden />
        )}
        <span className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-cream/50 lg:text-xs">
          {canInvite ? "Invite" : "Open slot"}
        </span>
      </div>
    );
  }

  const invited = s.kind === "invited";
  const sub = invited ? "Invited…" : s.status !== "home" ? PRESENCE_LABEL[s.status] : null;
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <CharacterAvatar
          character={s.character}
          initials={s.name.slice(0, 2).toUpperCase()}
          variant="full"
          className={`${SLOT_BOX} border bg-cream/5 shadow-[0_8px_22px_rgba(0,0,0,.4)] ${
            invited ? "border-dashed border-gold/40 opacity-45" : "border-gold/35"
          }`}
          textClass="text-3xl"
        />
        {!invited && (
          <span className="absolute -right-2.5 -top-2.5">
            <LevelStar level={s.level} size={36} />
          </span>
        )}
        {!invited && s.leader && <Crown className="-top-3.5 left-1/2 -translate-x-1/2" />}
        {canRemove && (
          <button
            onClick={() => onRemove(s.userId, s.name)}
            aria-label={invited ? `Cancel the invite to ${s.name}` : `Remove ${s.name} from the party`}
            title={invited ? "Cancel invite" : "Remove from party"}
            className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full border border-cream/30 bg-home-bg text-cream/70 shadow transition-colors hover:border-red-300 hover:text-red-300"
          >
            <IconX size={14} aria-hidden />
          </button>
        )}
      </div>
      <span
        className={`mt-2 max-w-[6.5rem] truncate text-sm font-semibold text-cream sm:max-w-[8rem] lg:max-w-[11rem] lg:text-base ${heading} ${invited ? "opacity-60" : ""}`}
      >
        {s.name}
      </span>
      {sub && <span className="text-[10px] font-semibold uppercase tracking-widest text-cream/50 lg:text-[11px]">{sub}</span>}
    </div>
  );
}
