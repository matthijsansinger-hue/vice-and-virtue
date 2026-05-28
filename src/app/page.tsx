"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, joinRoom } from "@/lib/room";
import {
  getStoredPlayerName,
  setStoredPlayerId,
  setStoredPlayerName,
} from "@/lib/player";

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(getStoredPlayerName());
  }, []);

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter your name first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { room, player } = await createRoom(trimmedName);
      setStoredPlayerName(trimmedName);
      setStoredPlayerId(player.id);
      router.push(`/room/${room.code}`);
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
      const { room, player } = await joinRoom(code, trimmedName);
      setStoredPlayerName(trimmedName);
      setStoredPlayerId(player.id);
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-8 bg-home-bg px-6 text-cream">
      <h1 className="text-center text-4xl font-semibold tracking-tight sm:text-5xl">
        Vice <span className="text-gold">and</span> Virtue
      </h1>

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
      </div>
    </main>
  );
}
