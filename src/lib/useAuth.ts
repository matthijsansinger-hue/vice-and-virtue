// React hook that tracks the logged-in account across the app.
// Returns the current profile (or null when signed out) and a loading
// flag for the first check. Re-reads automatically on login/logout and
// when the email-confirmation redirect establishes a session.

"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getMyProfile } from "./auth";
import { claimDailyLogin } from "./economy";
import type { Profile } from "./types";

export function useAuth() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const p = await getMyProfile();
        if (active) setProfile(p);
        // Logged in: grant today's daily-login Soul Shard if it's due
        // (server date-gated; fire-and-forget, never blocks the auth load).
        if (p) claimDailyLogin().catch(() => {});
      } finally {
        if (active) setLoading(false);
      }
    }
    load();

    // Fires on SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED and when the
    // confirmation link lands back on the site with a session.
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      load();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { profile, loading };
}
