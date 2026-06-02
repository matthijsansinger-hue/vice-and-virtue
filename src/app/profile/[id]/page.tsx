"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { getUserStats, type UserStats } from "@/lib/stats";
import { getEarnedBadges } from "@/lib/achievements";
import { gamesPlayedTogether } from "@/lib/friends";
import { ProfileStats } from "@/components/ProfileStats";
import { BadgesShowcase } from "@/components/BadgesShowcase";
import type { Profile } from "@/lib/types";

// Read-only view of another player's public profile + stats.
export default function FriendProfilePage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const { profile: me } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [together, setTogether] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // If you navigate to your own id, send you to the editable profile.
  const isSelf = me?.id === userId;

  useEffect(() => {
    let active = true;
    async function load() {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (!active) return;
      const prof = (data as Profile) ?? null;
      setProfile(prof);
      setLoading(false);
      if (prof) {
        getUserStats(userId)
          .then(async (s) => {
            if (!active) return;
            setStats(s);
            const e = await getEarnedBadges(userId, prof.created_at, s);
            if (active) setEarned(e);
          })
          .catch(() => {});
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!me || isSelf) return;
    let active = true;
    gamesPlayedTogether(me.id, userId)
      .then((n) => active && setTogether(n))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [me, userId, isSelf]);

  if (loading) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen items-center justify-center bg-home-bg text-cream">
        <p className="text-cream/70">Loading…</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-4 bg-home-bg px-6 text-cream">
        <p className="text-cream/80">That player could not be found.</p>
        <Link
          href="/friends"
          className="rounded-lg bg-gold px-4 py-2 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          Back to friends
        </Link>
      </main>
    );
  }

  return (
    <main className="wood-desk-startscreen min-h-screen bg-home-bg px-6 py-8 text-cream">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link
          href={isSelf ? "/profile" : "/friends"}
          className="text-sm text-cream/70 hover:text-cream"
        >
          ← Back
        </Link>

        {/* Avatar + username */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-28 w-28 overflow-hidden rounded-full border-2 border-gold bg-home-bg/60">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-4xl font-bold text-gold">
                {profile.username.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <h1 className="text-2xl font-semibold">{profile.username}</h1>

          {!isSelf && together !== null && (
            <p className="rounded-lg border border-gold/30 bg-cream/5 px-3 py-1.5 text-sm text-cream/80">
              <span className="font-semibold text-gold">{together}</span>{" "}
              {together === 1 ? "game" : "games"} played together
            </p>
          )}
        </div>

        <ProfileStats stats={stats} />

        <BadgesShowcase earned={earned} />
      </div>
    </main>
  );
}
