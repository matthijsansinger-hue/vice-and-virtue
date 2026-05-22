"use client";

// TEMPORARY page to verify the Supabase connection works.
// Safe to delete once the lobby is built.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Room = {
  id: string;
  code: string;
  status: string;
  created_at: string;
};

export default function TestPage() {
  const [status, setStatus] = useState("Checking connection...");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadRooms() {
    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      setError(error.message);
      setStatus("Connection failed");
    } else {
      setRooms(data ?? []);
      setError(null);
      setStatus("Connected to Supabase");
    }
  }

  useEffect(() => {
    loadRooms();
  }, []);

  async function createTestRoom() {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const { error } = await supabase.from("rooms").insert({ code });
    if (error) {
      setError(error.message);
    } else {
      loadRooms();
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black p-6 text-white">
      <h1 className="text-2xl font-semibold">
        {error ? "X " : "OK "}
        {status}
      </h1>

      {error && (
        <pre className="max-w-md whitespace-pre-wrap text-sm text-red-400">
          {error}
        </pre>
      )}

      <p className="text-zinc-400">Rooms in database: {rooms.length}</p>

      <ul className="text-sm text-zinc-300">
        {rooms.map((room) => (
          <li key={room.id}>
            {room.code} &mdash; {room.status}
          </li>
        ))}
      </ul>

      <button
        onClick={createTestRoom}
        className="rounded-full bg-white px-5 py-2 font-medium text-black transition-colors hover:bg-zinc-300"
      >
        Create a test room
      </button>
    </div>
  );
}
