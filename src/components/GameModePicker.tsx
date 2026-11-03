"use client";

// "Select game mode": the four ways to play. Public and Ranked are queue
// MODES — picking one selects it and the Play button then searches. Private
// lobby and Join by code are immediate actions (they take you, and later your
// party, straight into a lobby).

import { motion } from "framer-motion";
import {
  IconCheck,
  IconLock,
  IconPlayerPlay,
  IconTicket,
  IconTrophy,
  IconUsersPlus,
} from "@tabler/icons-react";
import { CornerFrame, PlaqueLayers, heading, plaqueStyle } from "./ui/royal";
import type { QueueKind } from "@/lib/matchmaking";

export type ModeChoice = "private" | "public" | "ranked" | "join";

export const MODE_LABEL: Record<QueueKind, string> = {
  public: "Public match",
  ranked: "Ranked match",
};

export function GameModePicker({
  selected,
  account,
  rankNote,
  onChoose,
}: {
  selected: QueueKind;
  account: boolean;
  rankNote: string | null;
  onChoose: (choice: ModeChoice) => void;
}) {
  const options: {
    id: ModeChoice;
    title: string;
    note: string;
    Icon: typeof IconTrophy;
    needsAccount?: boolean;
  }[] = [
    {
      id: "public",
      title: "Public match",
      note: "4v4 with players from the queue. Bots fill empty seats after a minute.",
      Icon: IconPlayerPlay,
    },
    {
      id: "ranked",
      title: "Ranked match",
      note: rankNote ? `4v4 on the ranked ladder. You're ${rankNote}.` : "4v4 on the ranked ladder.",
      Icon: IconTrophy,
      needsAccount: true,
    },
    {
      id: "private",
      title: "Start private lobby",
      note: "A lobby you host. Share the code with friends.",
      Icon: IconUsersPlus,
      needsAccount: true,
    },
    {
      id: "join",
      title: "Join by code",
      note: "Enter a friend's lobby code. No account needed.",
      Icon: IconTicket,
    },
  ];

  return (
    <div>
      <h2 className={`text-xl font-semibold tracking-wide text-gold ${heading}`}>Select game mode</h2>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {options.map(({ id, title, note, Icon, needsAccount }) => {
          const isSelected = id === selected;
          const locked = needsAccount && !account;
          return (
            <motion.button
              key={id}
              type="button"
              onClick={() => onChoose(id)}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 24 }}
              className={`group relative flex items-start gap-3 overflow-hidden rounded-xl border-2 p-3.5 text-left ${
                isSelected ? "border-gold" : "border-gold/30"
              }`}
              style={plaqueStyle(isSelected)}
            >
              <PlaqueLayers shine />
              <CornerFrame accent={isSelected} />
              <span
                className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  isSelected
                    ? "border-gold bg-gold text-home-bg"
                    : "border-gold/50 bg-black/30 text-gold group-hover:border-gold"
                }`}
              >
                <Icon size={22} aria-hidden />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className={`flex items-center gap-1.5 text-base font-semibold tracking-wide ${heading}`}>
                  {title}
                  {isSelected && <IconCheck size={16} className="text-gold" aria-label="Selected" />}
                  {locked && <IconLock size={14} className="text-cream/50" aria-label="Needs an account" />}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-cream/65">{note}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
