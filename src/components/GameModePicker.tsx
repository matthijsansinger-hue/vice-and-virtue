"use client";

// "Select game mode": the four ways to play. Public and Ranked are queue
// MODES — picking one selects it and the Play button then searches. Private
// lobby and Join by code are immediate actions (they take you, and later your
// party, straight into a lobby).

import { motion } from "framer-motion";
import {
  IconCheck,
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
  rankNote,
  onChoose,
}: {
  selected: QueueKind;
  rankNote: string | null;
  onChoose: (choice: ModeChoice) => void;
}) {
  const options: {
    id: ModeChoice;
    title: string;
    note: string;
    Icon: typeof IconTrophy;
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
    },
    {
      id: "private",
      title: "Start private lobby",
      note: "A lobby you host. Share the code with friends.",
      Icon: IconUsersPlus,
    },
    {
      id: "join",
      title: "Join by code",
      note: "Enter the code of a friend's lobby.",
      Icon: IconTicket,
    },
  ];

  return (
    <div>
      <h2 className={`text-xl font-semibold tracking-wide text-gold ${heading}`}>Select game mode</h2>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {options.map(({ id, title, note, Icon }) => {
          const isSelected = id === selected;
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
