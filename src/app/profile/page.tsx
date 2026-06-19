"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, MotionConfig } from "framer-motion";
import { IconArrowLeft } from "@tabler/icons-react";
import {
  heading,
  staggerContainer,
  fadeUp,
  CornerFrame,
  plaqueStyle,
  PlaqueLayers,
} from "@/components/ui/royal";
import { useAuth } from "@/lib/useAuth";
import { updateProfile, uploadAvatar, setCosmeticColor } from "@/lib/profile";
import { getMyEconomy, levelFromXp } from "@/lib/economy";
import { getUserStats, type UserStats } from "@/lib/stats";
import {
  awardAchievement,
  getAccountOlderCount,
  getEarnedBadges,
  hasAnyAcceptedFriend,
} from "@/lib/achievements";
import { ProfileStats } from "@/components/ProfileStats";
import { BadgesShowcase } from "@/components/BadgesShowcase";
import { FeaturedBadges } from "@/components/FeaturedBadges";
import { ColorCustomizer } from "@/components/ColorCustomizer";
import { Leaderboard } from "@/components/Leaderboard";
import { AccountPanel } from "@/components/AccountPanel";
import { RankPanel } from "@/components/RankPanel";

export default function ProfilePage() {
  const { profile, loading } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  // Local copies so edits show instantly without re-fetching the profile.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [featured, setFeatured] = useState<string[]>([]);
  const [nameColor, setNameColor] = useState<string | null>(null);
  const [bannerColor, setBannerColor] = useState<string | null>(null);
  const [level, setLevel] = useState(1);
  const [ownedColors, setOwnedColors] = useState<string[]>([]);
  const [founderRank, setFounderRank] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (profile) {
      setAvatarUrl(profile.avatar_url);
      setFeatured(profile.featured_badges ?? []);
      setNameColor(profile.name_color);
      setBannerColor(profile.banner_color);
    }
  }, [profile]);

  // The account level gates which color tiers can be equipped.
  useEffect(() => {
    if (!profile) return;
    let active = true;
    getMyEconomy().then((e) => {
      if (active && e) {
        setLevel(levelFromXp(e.xp).level);
        setOwnedColors(e.ownedColors);
      }
    });
    return () => {
      active = false;
    };
  }, [profile]);

  // Save the chosen featured badges (optimistic: local state updates now).
  function handleFeatured(ids: string[]) {
    setFeatured(ids);
    updateProfile({ featured_badges: ids }).catch(() => {
      /* non-critical; the next profile load will reconcile */
    });
  }

  // Equip a name/banner color (or null to reset). Optimistic; the server
  // validates the unlock and the next load reconciles on failure.
  function handleColor(kind: "name" | "banner", tier: string | null) {
    if (kind === "name") setNameColor(tier);
    else setBannerColor(tier);
    setCosmeticColor(kind, tier).catch(() => {
      /* non-critical */
    });
  }

  useEffect(() => {
    if (!profile) return;
    let active = true;
    (async () => {
      // Self-award "friend_added" so it shows on your profile to others,
      // then load stats + earned badges.
      if (await hasAnyAcceptedFriend(profile.id)) {
        await awardAchievement("friend_added");
      }
      const s = await getUserStats(profile.id);
      if (!active) return;
      setStats(s);
      const e = await getEarnedBadges(profile.id, profile.created_at, s);
      if (active) setEarned(e);
      // Your account rank (1-based), so the Founder badge can show "n/19".
      const older = await getAccountOlderCount(profile.created_at);
      if (active && older !== null) setFounderRank(older + 1);
    })().catch(() => {
      /* stats/badges are non-critical; leave them blank on error */
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

  if (loading) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen items-center justify-center bg-home-bg text-cream">
        <p className="animate-pulse text-cream/70">Loading…</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-4 bg-home-bg px-6 text-cream">
        <p className="text-cream/80">You need to be logged in to see your profile.</p>
        <Link
          href="/"
          className={`rounded-xl bg-gold px-4 py-2 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
        >
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen min-h-screen bg-home-bg px-6 py-8 text-cream">
      <motion.div
        className="mx-auto w-full max-w-5xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.div variants={fadeUp}>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-cream/70 transition-colors hover:text-cream"
          >
            <IconArrowLeft size={16} aria-hidden /> Back
          </Link>
        </motion.div>

        <div className="mt-4 grid gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
          {/* Left: identity, links, featured badges */}
          <div className="flex flex-col gap-6">
            {/* Identity plaque: avatar + username. */}
            <motion.div
              variants={fadeUp}
              className="relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border-2 border-gold/40 p-5"
              style={plaqueStyle()}
            >
              <PlaqueLayers />
              <CornerFrame />
              <div className="relative h-28 w-28 overflow-hidden rounded-full border-2 border-gold bg-home-bg/60 shadow-[0_0_18px_rgba(227,181,16,.35)]">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt="Your profile photo"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className={`flex h-full w-full items-center justify-center text-4xl font-bold text-gold ${heading}`}>
                    {profile.username.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              <h1 className={`relative text-2xl font-bold ${heading}`}>{profile.username}</h1>

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
                className={`relative rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-gold/10 disabled:opacity-50 ${heading}`}
              >
                {uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Add a photo"}
              </button>
            </motion.div>

        {error && <p className="text-center text-sm text-red-300">{error}</p>}

            <motion.div variants={fadeUp}>
              <Link
                href="/friends"
                className={`block rounded-xl border border-gold px-4 py-2.5 text-center text-sm font-semibold text-cream transition-colors hover:bg-gold/10 ${heading}`}
              >
                Friends
              </Link>
            </motion.div>

            <motion.div variants={fadeUp}>
              <Leaderboard meUserId={profile.id} />
            </motion.div>

            <motion.div variants={fadeUp}>
              <RankPanel />
            </motion.div>

            <motion.div variants={fadeUp}>
              <AccountPanel />
            </motion.div>

            <motion.div variants={fadeUp}>
              <FeaturedBadges
                earned={earned}
                featured={featured}
                onChange={handleFeatured}
              />
            </motion.div>

            <motion.div variants={fadeUp}>
              <ColorCustomizer
                level={level}
                username={profile.username}
                avatarUrl={avatarUrl}
                featured={featured}
                nameColor={nameColor}
                bannerColor={bannerColor}
                ownedColors={ownedColors}
                onChange={handleColor}
              />
            </motion.div>
          </div>

          {/* Right: stats + badge collection */}
          <div className="flex flex-col gap-6">
            <motion.div variants={fadeUp}>
              <ProfileStats stats={stats} />
            </motion.div>

            <motion.div variants={fadeUp}>
              <BadgesShowcase earned={earned} founderRank={founderRank} />
            </motion.div>
          </div>
        </div>
      </motion.div>
    </main>
    </MotionConfig>
  );
}
