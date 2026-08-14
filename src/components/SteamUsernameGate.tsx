"use client";

// First-launch account setup for the Steam build.
//
// A Steam player is already signed in by the time this renders — ensureSession()
// exchanged their Steamworks ticket for a Supabase session (lib/steam.ts
// steamSignIn), and the steam-auth Edge Function created the auth user in the
// background. What that account does NOT have yet is a username, so it has no
// profiles row (db/106 skips the trigger for username-less users, db/110 creates
// the rows here). That's the whole gate: pick a name, continue, play.
//
// Renders nothing on the website (no window.vvDesktop), nothing for accounts
// created the normal way, and nothing once a username exists — so a returning
// Steam player goes straight to the hub.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  getMyProfile,
  isUsernameAvailable,
  setUsername,
  validateUsername,
} from "@/lib/auth";
import {
  isSteamClient,
  steamPersonaName,
  usernameFromPersona,
} from "@/lib/steam";

type Availability = "idle" | "checking" | "free" | "taken";

export function SteamUsernameGate() {
  const [needed, setNeeded] = useState(false);
  const [name, setName] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Only Steam-created accounts are gated. The steam-auth function stamps the
    // SteamID into user metadata when it creates them.
    if (!user?.user_metadata?.steam_id) {
      setNeeded(false);
      return;
    }
    const profile = await getMyProfile();
    setNeeded(profile === null);
    if (profile === null) {
      const persona = await steamPersonaName();
      // Only a suggestion, and only if the player hasn't typed anything yet.
      if (persona) setName((cur) => cur || usernameFromPersona(persona));
    }
  }, []);

  useEffect(() => {
    if (!isSteamClient()) return;
    check();
    // ensureSession() signs in asynchronously on boot, so the session usually
    // lands after the first check — pick it up when it does.
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      check();
    });
    return () => sub.subscription.unsubscribe();
  }, [check]);

  // Live "is this name free" feedback. The server still decides (db/110's insert
  // against the unique index) — this is only so the player isn't told "taken"
  // for the first time after pressing Continue.
  useEffect(() => {
    if (!needed) return;
    const trimmed = name.trim();
    if (validateUsername(trimmed)) {
      setAvailability("idle");
      return;
    }
    setAvailability("checking");
    let active = true;
    const t = setTimeout(async () => {
      try {
        const free = await isUsernameAvailable(trimmed);
        if (active) setAvailability(free ? "free" : "taken");
      } catch {
        if (active) setAvailability("idle");
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [name, needed]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setUsername(name);
      setNeeded(false);
      // Refresh the session so useAuth's onAuthStateChange listener re-reads the
      // now-existing profile and the hub renders the account HUD immediately.
      await supabase.auth.refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setAvailability("taken");
    } finally {
      setBusy(false);
    }
  }

  if (!needed) return null;

  const trimmed = name.trim();
  const formatError = trimmed ? validateUsername(trimmed) : null;
  const canSubmit =
    !busy && !formatError && trimmed.length > 0 && availability !== "taken";

  return (
    <div className="wood-desk-startscreen fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-gold bg-home-bg/95 p-6 text-cream shadow-2xl">
        <h2 className="text-center text-xl font-semibold text-gold">
          Choose your username
        </h2>
        <p className="mt-1 text-center text-sm text-cream/70">
          This is the name other players see. You can&rsquo;t change it later.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Username"
            maxLength={20}
            autoFocus
            autoComplete="off"
            className="rounded-lg border border-gold bg-cream px-4 py-3 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
          />

          <p className="min-h-5 text-center text-xs">
            {formatError ? (
              <span className="text-red-300">{formatError}</span>
            ) : availability === "checking" ? (
              <span className="text-cream/50">Checking…</span>
            ) : availability === "free" ? (
              <span className="text-green-300">
                &ldquo;{trimmed}&rdquo; is available
              </span>
            ) : availability === "taken" ? (
              <span className="text-red-300">That name is already taken.</span>
            ) : (
              <span className="text-cream/50">
                3–20 letters, numbers or underscores.
              </span>
            )}
          </p>

          {error && <p className="text-center text-sm text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Please wait…" : "Continue"}
          </button>

          <p className="text-center text-xs leading-relaxed text-cream/60">
            Signed in with Steam. By continuing you agree to the{" "}
            <Link
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-gold underline"
            >
              Privacy Notice
            </Link>
            .
          </p>
        </form>
      </div>
    </div>
  );
}
