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

  // Load the player's last-used name from the browser, after the first render
  // (avoids a server/client mismatch).
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-black px-6 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Vice <span className="text-zinc-500">and</span> Virtue
        </h1>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <label className="text-sm text-zinc-400" htmlFor="name">
          Your name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type your name"
          maxLength={20}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder:text-zinc-600 focus:border-zinc-400 focus:outline-none"
        />

        <button
          onClick={handleCreate}
          disabled={busy}
          className="mt-2 rounded-lg bg-white px-4 py-3 font-medium text-black transition-colors hover:bg-zinc-300 disabled:opacity-50"
        >
          Create a room
        </button>

        <div className="my-2 flex items-center gap-3 text-xs text-zinc-600">
          <div className="h-px flex-1 bg-zinc-800" />
          OR
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="Room code"
          maxLength={5}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-center text-lg tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-zinc-600 focus:border-zinc-400 focus:outline-none"
        />
        <button
          onClick={handleJoin}
          disabled={busy}
          className="rounded-lg border border-zinc-700 px-4 py-3 font-medium text-white transition-colors hover:bg-zinc-900 disabled:opacity-50"
        >
          Join a room
        </button>

        {error && (
          <p className="mt-2 text-center text-sm text-red-400">{error}</p>
        )}
      </div>
    </main>
  );
}
