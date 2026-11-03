"use client";

// The Play screen's party row: your character in the middle, one party slot on
// each side (a party is you + up to 2 friends). An empty slot is a "+" that
// opens the friend picker. Guests get a plain silhouette and a name field —
// parties need an account, so their "+" asks them to log in.

import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { IconPlus } from "@tabler/icons-react";
import { CharacterAvatar } from "./CharacterAvatar";
import { LevelStar } from "./LevelStar";
import { heading, fadeUp } from "./ui/royal";
import type { CharacterConfig } from "@/lib/character";

export type StageMember = {
  name: string;
  character: CharacterConfig | null;
  nameStyle?: CSSProperties;
  level?: number | null;
};

const ME_BOX = "h-40 w-40 sm:h-52 sm:w-52 lg:h-60 lg:w-60";
const SLOT_BOX = "h-24 w-24 sm:h-32 sm:w-32 lg:h-36 lg:w-36";

export function PartyStage({
  me,
  guest,
  guestName,
  onGuestName,
  onAddFriend,
}: {
  me: StageMember;
  guest: boolean;
  guestName: string;
  onGuestName: (name: string) => void;
  onAddFriend: () => void;
}) {
  const initials = (me.name || "?").slice(0, 2).toUpperCase();
  return (
    <motion.div variants={fadeUp} className="relative mx-auto mt-6 flex max-w-2xl items-center justify-center gap-3 sm:gap-6">
      <AddSlot onClick={onAddFriend} />

      <div className="relative flex flex-col items-center">
        {/* Soft spotlight behind your character. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-6 -z-10 rounded-full"
          style={{ background: "radial-gradient(circle at 50% 45%, rgba(227,181,16,.20), rgba(227,181,16,0) 65%)" }}
        />
        <div className="relative">
          <CharacterAvatar
            character={guest ? null : me.character}
            initials={initials}
            variant="full"
            className={`${ME_BOX} border border-gold/35 bg-cream/5 shadow-[0_10px_30px_rgba(0,0,0,.45)]`}
            textClass="text-5xl"
          />
          {!guest && me.level != null && (
            <span className="absolute -right-3 -top-3">
              <LevelStar level={me.level} size={46} />
            </span>
          )}
        </div>
        {guest ? (
          <input
            value={guestName}
            onChange={(e) => onGuestName(e.target.value)}
            placeholder="Your name"
            maxLength={20}
            className="mt-3 w-40 rounded-lg border border-gold bg-cream px-3 py-2 text-center text-sm text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold sm:w-52"
          />
        ) : (
          <span
            className={`mt-3 max-w-[12rem] truncate text-lg font-semibold tracking-wide text-cream sm:max-w-[14rem] ${heading}`}
            style={me.nameStyle}
          >
            {me.name}
          </span>
        )}
      </div>

      <AddSlot onClick={onAddFriend} />
    </motion.div>
  );
}

function AddSlot({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex flex-col items-center">
      <motion.button
        type="button"
        onClick={onClick}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        aria-label="Invite a friend to your party"
        className={`${SLOT_BOX} group flex items-center justify-center rounded-2xl border-2 border-dashed border-gold/40 bg-black/20 text-gold/70 transition-colors hover:border-gold hover:bg-gold/10 hover:text-gold`}
      >
        <IconPlus size={34} stroke={2.2} aria-hidden />
      </motion.button>
      <span className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-cream/50">Invite</span>
    </div>
  );
}
