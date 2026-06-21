"use client";

// The single editable profile, shared by the hub "Profile" tab and the /profile
// page. Your identity is shown as your in-game BANNER; tapping it opens the
// "Customize" modal (change photo + name/banner colors). Self-contained: loads
// its own stats, earned badges, level, and founder rank from `profile`.

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { IconBrush } from "@tabler/icons-react";
import { heading, staggerContainer, fadeUp } from "@/components/ui/royal";
import { updateProfile, uploadAvatar, setCosmeticColor } from "@/lib/profile";
import { getMyEconomy, levelFromXp } from "@/lib/economy";
import { getUserStats, type UserStats } from "@/lib/stats";
import {
  awardAchievement,
  getAccountOlderCount,
  getEarnedBadges,
  hasAnyAcceptedFriend,
} from "@/lib/achievements";
import type { Profile } from "@/lib/types";
import { Banner } from "@/components/Banner";
import { ProfileStats } from "@/components/ProfileStats";
import { BadgesShowcase } from "@/components/BadgesShowcase";
import { FeaturedBadges } from "@/components/FeaturedBadges";
import { ColorCustomizer } from "@/components/ColorCustomizer";

export function ProfileDashboard({ profile }: { profile: Profile }) {
  const fileInput = useRef<HTMLInputElement>(null);

  // Local copies so edits show instantly without re-fetching the profile.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [featured, setFeatured] = useState<string[]>(profile.featured_badges ?? []);
  const [nameColor, setNameColor] = useState<string | null>(profile.name_color);
  const [bannerColor, setBannerColor] = useState<string | null>(profile.banner_color);
  const [level, setLevel] = useState(1);
  const [levelProgress, setLevelProgress] = useState(0);
  const [xpInto, setXpInto] = useState<number | undefined>(undefined);
  const [xpForNext, setXpForNext] = useState<number | undefined>(undefined);
  const [ownedColors, setOwnedColors] = useState<string[]>([]);
  const [founderRank, setFounderRank] = useState<number | undefined>(undefined);
  const [customizing, setCustomizing] = useState(false);

  // Keep local cosmetic state in sync if the profile object changes.
  useEffect(() => {
    setAvatarUrl(profile.avatar_url);
    setFeatured(profile.featured_badges ?? []);
    setNameColor(profile.name_color);
    setBannerColor(profile.banner_color);
  }, [profile]);

  // The account level gates which color tiers can be equipped.
  useEffect(() => {
    let active = true;
    getMyEconomy().then((e) => {
      if (active && e) {
        const l = levelFromXp(e.xp);
        setLevel(l.level);
        setLevelProgress(l.progress);
        setXpInto(l.xpIntoLevel);
        setXpForNext(l.xpForNext);
        setOwnedColors(e.ownedColors);
      }
    });
    return () => {
      active = false;
    };
  }, [profile.id]);

  // Stats + earned badges + founder rank.
  useEffect(() => {
    let active = true;
    (async () => {
      if (await hasAnyAcceptedFriend(profile.id)) {
        await awardAchievement("friend_added");
      }
      const s = await getUserStats(profile.id);
      if (!active) return;
      setStats(s);
      const e = await getEarnedBadges(profile.id, profile.created_at, s);
      if (active) setEarned(e);
      const older = await getAccountOlderCount(profile.created_at);
      if (active && older !== null) setFounderRank(older + 1);
    })().catch(() => {
      /* stats/badges are non-critical; leave them blank on error */
    });
    return () => {
      active = false;
    };
  }, [profile.id, profile.created_at]);

  function handleFeatured(ids: string[]) {
    setFeatured(ids);
    updateProfile({ featured_badges: ids }).catch(() => {});
  }

  function handleColor(kind: "name" | "banner", tier: string | null) {
    if (kind === "name") setNameColor(tier);
    else setBannerColor(tier);
    setCosmeticColor(kind, tier).catch(() => {});
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setAvatarUrl(await uploadAvatar(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const initials = profile.username.slice(0, 2).toUpperCase();
  const isFounder = founderRank !== undefined && founderRank <= 19;

  return (
    <motion.div
      className="mx-auto flex w-full max-w-2xl flex-col gap-6"
      initial="hidden"
      animate="show"
      variants={staggerContainer}
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handlePhoto}
        className="hidden"
      />

      {/* Your in-game banner — floating, big, tap (or the brush) to customize. */}
      <motion.div variants={fadeUp} className="flex flex-col items-center gap-2 pt-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCustomizing(true)}
            aria-label="Customize your banner"
            className="rounded-full transition-transform hover:scale-[1.02]"
            style={{ filter: "drop-shadow(0 10px 26px rgba(0,0,0,.5))" }}
          >
            <Banner
              name={profile.username}
              avatarUrl={avatarUrl}
              initials={initials}
              featuredBadges={featured}
              nameColor={nameColor}
              bannerColor={bannerColor}
              level={level}
              levelProgress={levelProgress}
              xpInto={xpInto}
              xpForNext={xpForNext}
              size="lg"
            />
          </button>
          <button
            type="button"
            onClick={() => setCustomizing(true)}
            aria-label="Change your banner"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/60 bg-panel text-gold shadow-[0_0_10px_rgba(227,181,16,.35)] transition-colors hover:bg-gold/15"
          >
            <IconBrush size={20} aria-hidden />
          </button>
        </div>
        {isFounder && (
          <span className="rounded-full border border-gold/60 bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
            Founder
          </span>
        )}
      </motion.div>

      {/* Featured badges — right under the banner. */}
      <motion.div variants={fadeUp}>
        <FeaturedBadges earned={earned} featured={featured} onChange={handleFeatured} />
      </motion.div>

      {/* Stats (summary + milestones). */}
      <motion.div variants={fadeUp} className="flex flex-col gap-6">
        <ProfileStats stats={stats} />
      </motion.div>

      {/* Earned badges — underneath the milestones, collapsed by default. */}
      <motion.div variants={fadeUp}>
        <BadgesShowcase earned={earned} founderRank={founderRank} />
      </motion.div>

      {/* Customize modal — change photo + name/banner colors. */}
      {customizing && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/70 p-4"
          onClick={() => setCustomizing(false)}
        >
          <div className="flex min-h-full items-start justify-center">
            <div
              className="my-8 w-full max-w-md rounded-2xl border-2 border-gold bg-home-bg p-5 text-cream shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className={`text-lg font-semibold text-gold ${heading}`}>Customize</h2>
                <button
                  type="button"
                  onClick={() => setCustomizing(false)}
                  aria-label="Close"
                  className="-mt-1 text-2xl leading-none text-cream/60 hover:text-cream"
                >
                  &times;
                </button>
              </div>

              {/* Profile photo */}
              <div className="mt-4 flex items-center gap-3">
                <span className="h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 border-gold bg-home-bg/60">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className={`flex h-full w-full items-center justify-center text-xl font-bold text-gold ${heading}`}>
                      {profile.username.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className={`rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-gold/10 disabled:opacity-50 ${heading}`}
                >
                  {uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Add a photo"}
                </button>
              </div>
              {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

              {/* Name + banner colors */}
              <div className="mt-5">
                <ColorCustomizer
                  level={level}
                  levelProgress={levelProgress}
                  username={profile.username}
                  avatarUrl={avatarUrl}
                  featured={featured}
                  nameColor={nameColor}
                  bannerColor={bannerColor}
                  ownedColors={ownedColors}
                  onChange={handleColor}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
