"use client";

import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import { heading } from "@/components/ui/royal";
import {
  setReady,
  resetRoomReady,
  endViceVictoryIntro,
  endVirtueVictoryIntro,
} from "@/lib/game";
import { recordGameResults } from "@/lib/stats";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { playVictoryMusic } from "@/lib/sound";
import { GameOver } from "./GameOver";
import type { Player, Room } from "@/lib/types";

// The Vice / Virtue win screen (art: public/vice-victory.webp and
// public/virtue-victory.webp, 2026-11-22 — the title is painted into the
// image). The image is shown whole, so the title is never cut off on a phone,
// and its edges fade into a gradient of its own edge colours (sampled from
// the art), so it has no visible frame on any screen shape.
//
// Continue is per player (Matthijs, 2026-11-22): pressing it shows YOUR match
// results straight away — nobody waits for the others. The press still counts
// as Ready, so a majority moves the room itself to game_over as before (that's
// when the host's client / the server finishes up). Results are recorded as
// soon as this screen opens — by the host's client here in a private lobby,
// by the server tick in public / ranked rooms (migration 151) — so the
// results screen has them however early you continue.

const ART = {
  virtue: {
    src: "/virtue-victory.webp",
    alt: "Virtue victory",
    edge: "#223e4c",
    mid: "#3f6576",
    glow: "rgba(208,226,236,.5)",
  },
  vice: {
    src: "/vice-victory.webp",
    alt: "Vice victory",
    edge: "#6b1a10",
    mid: "#93321a",
    glow: "rgba(255,178,120,.45)",
  },
} as const;

export function VictoryScreen({
  camp,
  room,
  players,
  myPlayer,
}: {
  camp: "vice" | "virtue";
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const art = ART[camp];
  const isHost = myPlayer?.is_host ?? false;
  const [continued, setContinued] = useState(false);
  const once = useRef({ music: false, reset: false, record: false });

  useEffect(() => {
    if (once.current.music) return;
    once.current.music = true;
    playVictoryMusic(camp);
  }, [camp]);

  // Reached from a SQL resolver that doesn't reset ready: the host clears it
  // once so the majority (which moves the room on) starts clean.
  useEffect(() => {
    if (!isHost || once.current.reset) return;
    once.current.reset = true;
    void resetRoomReady(room.id);
  }, [isHost, room.id]);

  // Private lobby: record the results now (idempotent; the end of this
  // screen records them again harmlessly), so early continuers see them.
  useEffect(() => {
    if (!isHost || room.server_hosted || once.current.record) return;
    once.current.record = true;
    void recordGameResults(room.id, camp).catch((e) => console.error("Failed to record game results", e));
  }, [isHost, room.server_hosted, room.id, camp]);

  // The room still moves to game_over on a majority (10 s countdown).
  useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => (camp === "vice" ? endViceVictoryIntro(room.id) : endVirtueVictoryIntro(room.id)),
  });

  // Your own Continue (or one made before a refresh) → your results.
  if (continued || myPlayer?.ready) {
    return <GameOver room={room} players={players} myPlayer={myPlayer} />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <main
        className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12"
        style={{ background: `radial-gradient(ellipse 80% 60% at 50% 45%, ${art.mid} 0%, ${art.edge} 75%)` }}
      >
        <motion.img
          src={art.src}
          alt={art.alt}
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
          // Scales down by width (phones) or height (short desktop windows),
          // keeping its shape, so the button below always fits on screen.
          className="relative h-auto max-h-[66dvh] w-auto max-w-[min(100%,64rem)] select-none"
          style={{
            WebkitMaskImage: "radial-gradient(ellipse 50% 50% at 50% 50%, #000 58%, transparent 100%)",
            maskImage: "radial-gradient(ellipse 50% 50% at 50% 50%, #000 58%, transparent 100%)",
          }}
          draggable={false}
        />

        <motion.div
          className="relative mt-6 w-full max-w-sm sm:mt-10"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.4 }}
        >
          <button
            type="button"
            onClick={() => {
              setContinued(true);
              if (myPlayer) void setReady(myPlayer.id, true);
            }}
            className={`w-full rounded-xl border-2 border-white/80 bg-white/15 py-3 font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${heading}`}
            style={{ boxShadow: `0 0 24px ${art.glow}` }}
          >
            See the results
          </button>
        </motion.div>
      </main>
    </MotionConfig>
  );
}
