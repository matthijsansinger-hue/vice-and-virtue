"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/useAuth";
import { updateProfile, uploadAvatar } from "@/lib/profile";
import { getUserStats, type UserStats } from "@/lib/stats";
import { ROLES } from "@/lib/roles";
import { ProfileStats } from "@/components/ProfileStats";

export default function ProfilePage() {
  const { profile, loading } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  // Local copies so edits show instantly without re-fetching the profile.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [favoriteRole, setFavoriteRole] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    if (profile) {
      setAvatarUrl(profile.avatar_url);
      setFavoriteRole(profile.favorite_role);
    }
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    getUserStats(profile.id)
      .then((s) => {
        if (active) setStats(s);
      })
      .catch(() => {
        /* stats are non-critical; leave them blank on error */
      });
    return () => {
      active = false;
    };
  }, [profile]);

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadAvatar(file);
      setAvatarUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function pickRole(roleId: string) {
    // Tapping the already-selected role clears it.
    const next = favoriteRole === roleId ? null : roleId;
    setFavoriteRole(next); // optimistic
    setError(null);
    try {
      await updateProfile({ favorite_role: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }

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
        <p className="text-cream/80">You need to be logged in to see your profile.</p>
        <Link
          href="/"
          className="rounded-lg bg-gold px-4 py-2 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <main className="wood-desk-startscreen min-h-screen bg-home-bg px-6 py-8 text-cream">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link href="/" className="text-sm text-cream/70 hover:text-cream">
          ← Back
        </Link>

        {/* Avatar + username */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative h-28 w-28 overflow-hidden rounded-full border-2 border-gold bg-home-bg/60">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Your profile photo"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-4xl font-bold text-gold">
                {profile.username.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <h1 className="text-2xl font-semibold">{profile.username}</h1>

          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handlePhoto}
            className="hidden"
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Add a photo"}
          </button>
        </div>

        {error && <p className="text-center text-sm text-red-300">{error}</p>}

        <Link
          href="/friends"
          className="rounded-lg border border-gold px-4 py-2 text-center text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
        >
          Friends
        </Link>

        {/* Favorite role */}
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-gold">Favorite role</h2>
          <p className="text-sm text-cream/60">
            Tap a role to set it as your favorite. Tap it again to clear.
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Object.values(ROLES).map((role) => {
              const selected = favoriteRole === role.id;
              return (
                <button
                  key={role.id}
                  onClick={() => pickRole(role.id)}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors ${
                    selected
                      ? "border-gold bg-gold/15"
                      : "border-gold/30 hover:bg-cream/10"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/cards/${role.id}.png`}
                    alt={role.name}
                    className="h-auto w-full rounded"
                  />
                  <span className="text-center text-xs leading-tight text-cream/80">
                    {role.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <ProfileStats stats={stats} />
      </div>
    </main>
  );
}
