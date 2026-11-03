"use client";

// The Play screen's party row: your character in the middle, one party slot on
// each side (a party is you + up to 2 friends). An empty slot is a "+" that
// opens the friend picker. Logged out you get a plain silhouette (playing needs
// an account, so the "+" asks you to sign up).

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

const ME_BOX = "h-40 w-40 sm:h-52 sm:w-52 lg:h-72 lg:w-72 xl:h-80 xl:w-80";
const SLOT_BOX = "h-24 w-24 sm:h-32 sm:w-32 lg:h-44 lg:w-44 xl:h-52 xl:w-52";

export function PartyStage({
  me,
  loggedOut,
  onAddFriend,
}: {
  me: StageMember;
  loggedOut: boolean;
  onAddFriend: () => void;
}) {
  const initials = (me.name || "?").slice(0, 2).toUpperCase();
  return (
    <motion.div variants={fadeUp} className="relative mx-auto mt-6 flex max-w-2xl items-center justify-center gap-3 sm:gap-6 lg:mt-8 lg:max-w-5xl lg:gap-12">
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
        <IconPlus className="h-8 w-8 lg:h-11 lg:w-11" stroke={2.2} aria-hidden />
      </motion.button>
      <span className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-cream/50 lg:text-xs">Invite</span>
    </div>
  );
}
