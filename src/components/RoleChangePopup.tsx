"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { heading, CornerFrame, SoulEnergyText } from "@/components/ui/royal";
import { ROLES } from "@/lib/roles";

// Conversion (Wrath/Love) is the only thing that changes a player's role
// mid-game, and it always produces one of these two roles. We watch the
// player's own role for a change INTO one of them and pop a prominent,
// centered modal so they can't miss that their allegiance flipped.
const CONVERSION_ROLES = new Set(["vice_worshipper", "virtue_seeker"]);

export function RoleChangePopup({ role }: { role: string | null }) {
  const prev = useRef<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!role) return;
    // Only a real change (from a different, already-known role) into a
    // conversion role counts — so the initial deal / role-select picks don't
    // trigger it, and a page reload (prev = null) stays quiet.
    if (prev.current && prev.current !== role && CONVERSION_ROLES.has(role)) {
      setShown(role);
    }
    prev.current = role;
  }, [role]);

  if (!shown) return null;
  const def = ROLES[shown];
  if (!def) return null;
  const isVice = def.camp === "vice";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      onClick={() => setShown(null)}
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-6"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border-2 border-gold p-6 text-home-bg shadow-2xl"
        style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
      >
        <CornerFrame colorClass="border-home-bg/25" />
        <p className={`relative text-center text-xs uppercase tracking-[0.3em] text-home-bg/50 ${heading}`}>
          Your allegiance has changed
        </p>
        <h1 className={`relative mt-2 text-center text-3xl font-bold ${heading}`}>
          {def.name}
        </h1>

        <div className="relative mt-3 flex items-center justify-center">
          <span
            className={
              `rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cream ${heading} ` +
              (isVice
                ? "bg-consultation-bg shadow-[0_0_10px_rgba(128,0,32,.5)]"
                : "bg-consultation-fg shadow-[0_0_10px_rgba(0,0,128,.5)]")
            }
          >
            {isVice ? "Vice" : "Virtue"}
          </span>
        </div>

        <p className="relative mt-3 text-center text-sm font-semibold text-home-bg/80">
          You now serve the {isVice ? "Vices" : "Virtues"} — your old power is
          gone. Your camp wins when every {isVice ? "Virtue" : "Vice"} is
          imprisoned or dead.
        </p>

        <p className="relative mt-3 text-center text-sm leading-relaxed">
          <SoulEnergyText onLight>{def.description}</SoulEnergyText>
        </p>

        <button
          onClick={() => setShown(null)}
          className={`relative mt-6 w-full rounded-xl bg-gold py-2 font-semibold text-home-bg shadow-[0_0_14px_rgba(227,181,16,.3)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_22px_rgba(227,181,16,.5)] ${heading}`}
        >
          Understood
        </button>
      </motion.div>
    </motion.div>
  );
}
