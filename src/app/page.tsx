"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, joinRoom, findOrCreatePublicRoom } from "@/lib/room";
import {
  getStoredPlayerName,
  setStoredPlayerId,
  setStoredPlayerName,
} from "@/lib/player";
import { RulesGuide } from "@/components/RulesGuide";
import { AuthControl } from "@/components/AuthControl";
import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/lib/useAuth";
import { awardAchievement } from "@/lib/achievements";

export default function HomePage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  // Shown when a logged-out player tries to create a room.
  const [showCreateGate, setShowCreateGate] = useState(false);

  useEffect(() => {
    setName(getStoredPlayerName());
  }, []);

  // Once logged in, prefill the name field with the account username so
  // creating/joining uses it by default (still editable).
  useEffect(() => {
    if (profile) setName((n) => n || profile.username);
  }, [profile]);

  async function handleCreate() {
    // Creating a room requires an account; joining does not.
    if (!authLoading && !profile) {
      setShowCreateGate(true);
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter your name first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { room, player } = await createRoom(trimmedName, profile?.id ?? null);
      setStoredPlayerName(trimmedName);
      setStoredPlayerId(player.id);
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function handleFindPublic() {
    // Open to everyone — guests included. If no public lobby is open, the
    // matchmaker spins one up with this player as host.
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter your name first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { code, playerId } = await findOrCreatePublicRoom(
        trimmedName,
        profile?.id ?? null
      );
      setStoredPlayerName(trimmedName);
      setStoredPlayerId(playerId);
      router.push(`/room/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function handleJoin() {
    const trimmedName = name.trim();
    const code = joinCode.trim().toUpperCase();
    if (!trimmedName) {
      setError("Please enter your name first.");
      return;
    }
    if (!code) {
      setError("Please enter a room code.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { room, player } = await joinRoom(code, trimmedName, profile?.id ?? null);
      setStoredPlayerName(trimmedName);
      setStoredPlayerId(player.id);
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="wood-desk-startscreen relative flex min-h-screen flex-col items-center justify-center gap-3 bg-home-bg px-6 py-8 text-cream">
      {/* Login / sign-up control, top-right. */}
      <div className="absolute right-4 top-4 z-10">
        <AuthControl />
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png?v=3"
        alt="Vice and Virtue"
        width={1254}
        height={1254}
        className="h-auto w-72 max-w-full drop-shadow-2xl sm:w-80"
      />

      <div className="flex w-full max-w-xs flex-col gap-3">
        {/* Name input — visually separated so it's clear it feeds both
            join AND create. */}
        <label className="text-sm text-cream/70" htmlFor="name">
          Your name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type your name"
          maxLength={20}
          className="rounded-lg border border-gold bg-cream px-4 py-3 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
        />

        <div className="my-4 h-px w-full bg-gold/30" />

        {/* Join (primary action — top, gold filled). */}
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="Room code"
          maxLength={5}
          className="rounded-lg border border-gold bg-cream px-4 py-3 text-center text-lg tracking-[0.3em] text-home-bg placeholder:tracking-normal placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
        />
        <button
          onClick={handleJoin}
          disabled={busy}
          className="rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Join a room
        </button>
        <p className="text-center text-xs text-cream/50">
          No account needed to join — only to create a room.
        </p>

        {/* Public matchmaking — no code needed, open to guests. */}
        <button
          onClick={handleFindPublic}
          disabled={busy}
          className="mt-2 rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Find Public Session
        </button>
        <p className="text-center text-xs text-cream/50">
          No code? Jump into a public game with other players.
        </p>

        <div className="my-2 flex items-center gap-3 text-xs text-cream/40">
          <div className="h-px flex-1 bg-gold/30" />
          OR
          <div className="h-px flex-1 bg-gold/30" />
        </div>

        {/* Create (secondary action — bottom, outlined). */}
        <button
          onClick={handleCreate}
          disabled={busy}
          className="rounded-lg border border-gold px-4 py-3 font-semibold text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
        >
          Create a room
        </button>

        {error && (
          <p className="mt-2 text-center text-sm text-red-300">{error}</p>
        )}

        {/* Secondary actions: rules guide + Discord. Outlined and
            a touch smaller than the primary Join / Create buttons so
            they read as supplementary links. */}
        <button
          onClick={() => setShowRules(true)}
          className="mt-3 rounded-lg border border-gold px-3 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
        >
          How to play
        </button>
        <a
          href="https://discord.gg/Ju5K2cZquH"
          target="_blank"
          rel="noopener noreferrer"
          // Logged-in players earn the Discord badge by opening the invite.
          onClick={() => {
            if (profile) void awardAchievement("discord_joined");
          }}
          // Discord brand colours: #5865F2 (Blurple) bg, white text +
          // mark. Hover dims slightly for consistency with the other
          // buttons.
          className="flex items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-current"
            aria-hidden
          >
            <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
          </svg>
          <span>Join the Discord</span>
        </a>
      </div>

      {showRules && <RulesGuide onClose={() => setShowRules(false)} />}

      {showCreateGate && (
        <AuthModal
          initialMode="signup"
          message="You need an account to create a room. Joining a room is free — no account needed."
          onClose={() => setShowCreateGate(false)}
        />
      )}
    </main>
  );
}
