"use client";

// The profile layout, shared by the hub "Profile" tab + /profile (editable, your
// own) and another player's /profile/[id] (read-only). Identity is shown as the
// in-game BANNER; when editable, tapping it (or the brush) opens the "Customize"
// modal (change photo + name/banner colors). Self-contained — loads stats,
// earned badges, and founder rank from `profile`; level/colors only for your own.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { IconBrush } from "@tabler/icons-react";
import { heading, staggerContainer, fadeUp } from "@/components/ui/royal";
import { updateProfile, saveCharacter, setCosmeticColor } from "@/lib/profile";
import type { CharacterConfig } from "@/lib/character";
import { getMyEconomy, getAccountXp, levelFromXp } from "@/lib/economy";
import { getUserStats, type UserStats } from "@/lib/stats";
import {
  awardAchievement,
  getAccountOlderCount,
  getEarnedBadges,
  hasAnyAcceptedFriend,
} from "@/lib/achievements";
import type { Profile } from "@/lib/types";
import { Banner } from "@/components/Banner";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { ProfileStats } from "@/components/ProfileStats";
import { BadgesShowcase } from "@/components/BadgesShowcase";
import { FeaturedBadges } from "@/components/FeaturedBadges";
import { ShowcaseBadges } from "@/components/ShowcaseBadges";
import { LevelStar } from "@/components/LevelStar";
import { ColorCustomizer } from "@/components/ColorCustomizer";
import { CharacterCreator } from "@/components/CharacterCreator";

export function ProfileDashboard({
  profile,
  editable = true,
}: {
  profile: Profile;
  editable?: boolean; // false → read-only view of another player
}) {
  // Local copies so edits show instantly without re-fetching the profile.
  const [character, setCharacter] = useState<CharacterConfig | null>(profile.appearance);
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
  // Which customizer is open: the character editor, the banner colors, or none.
  const [customize, setCustomize] = useState<null | "character" | "banner">(null);

  // Keep local cosmetic state in sync if the profile object changes.
  useEffect(() => {
    setCharacter(profile.appearance);
    setFeatured(profile.featured_badges ?? []);
    setNameColor(profile.name_color);
    setBannerColor(profile.banner_color);
  }, [profile]);

  // Level (+ colors for editing). Your own comes from getMyEconomy; another
  // player's level comes from the public get_account_xp RPC.
  useEffect(() => {
    let active = true;
    function applyXp(xp: number) {
      const l = levelFromXp(xp);
      setLevel(l.level);
      setLevelProgress(l.progress);
      setXpInto(l.xpIntoLevel);
      setXpForNext(l.xpForNext);
    }
    if (editable) {
      getMyEconomy().then((e) => {
        if (active && e) {
          applyXp(e.xp);
          setOwnedColors(e.ownedColors);
        }
      });
    } else {
      getAccountXp(profile.id).then((xp) => {
        if (active && xp != null) applyXp(xp);
      });
    }
    return () => {
      active = false;
    };
  }, [profile.id, editable]);

  // Stats + earned badges + founder rank (public — works for any player).
  useEffect(() => {
    let active = true;
    (async () => {
      if (editable && (await hasAnyAcceptedFriend(profile.id))) {
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
  }, [profile.id, profile.created_at, editable]);

  function handleFeatured(ids: string[]) {
    setFeatured(ids);
    updateProfile({ featured_badges: ids }).catch(() => {});
  }

  function handleColor(kind: "name" | "banner", tier: string | null) {
    if (kind === "name") setNameColor(tier);
    else setBannerColor(tier);
    setCosmeticColor(kind, tier).catch(() => {});
  }

  function handleCharacter(c: CharacterConfig) {
    setCharacter(c);
    saveCharacter(c).catch(() => {});
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
      {/* Identity. Editable (own): a two-column row — banner + featured badges on
          the LEFT, a clickable full-character widget on the RIGHT (both open the
          Customize modal). Read-only (visiting): a full-width banner bar then a
          plain display of their featured badges. */}
      {editable ? (
        <motion.div
          variants={fadeUp}
          className="flex flex-col items-center gap-5 pt-2 sm:flex-row sm:items-stretch sm:justify-center sm:gap-6"
        >
          {/* Left: banner (top) + featured badges (bottom). justify-between makes
              the banner level with the widget's top and the featured card level
              with its bottom. */}
          <div className="flex w-full flex-col gap-4 sm:w-auto sm:min-w-0 sm:justify-between">
            <div className="flex flex-col items-start gap-2">
              <button
                type="button"
                onClick={() => setCustomize("banner")}
                aria-label="Customize your banner"
                className="max-w-full rounded-full transition-transform hover:scale-[1.02]"
                style={{ filter: "drop-shadow(0 10px 26px rgba(0,0,0,.5))" }}
              >
                <Banner
                  name={profile.username}
                  character={character}
                  initials={initials}
                  featuredBadges={featured}
                  nameColor={nameColor}
                  bannerColor={bannerColor}
                  level={level}
                  levelProgress={levelProgress}
                  xpInto={xpInto}
                  xpForNext={xpForNext}
                  size="lg"
                  levelStar
                />
              </button>
              {isFounder && (
                <span className="rounded-full border border-gold/60 bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
                  Founder
                </span>
              )}
            </div>
            <FeaturedBadges earned={earned} featured={featured} onChange={handleFeatured} />
          </div>

          {/* Right: the full character — click to change it */}
          <div className="flex shrink-0 flex-col items-center justify-center">
            <button
              type="button"
              onClick={() => setCustomize("character")}
              aria-label="Edit your character"
              className="group relative block"
            >
              <CharacterAvatar
                character={character}
                initials={initials}
                variant="full"
                className="h-64 w-64 border border-gold/20 bg-cream/5 transition-transform group-hover:scale-[1.02]"
                textClass="text-5xl"
              />
              <span className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full border border-gold/60 bg-panel text-gold shadow-[0_0_10px_rgba(227,181,16,.35)] transition-colors group-hover:bg-gold/15">
                <IconBrush size={18} aria-hidden />
              </span>
            </button>
          </div>
        </motion.div>
      ) : (
        <>
          <motion.div variants={fadeUp} className="flex flex-col gap-2 pt-5">
            <span className="relative block w-full">
              <span className="block" style={{ filter: "drop-shadow(0 10px 26px rgba(0,0,0,.5))" }}>
                <Banner
                  name={profile.username}
                  character={character}
                  initials={initials}
                  featuredBadges={featured}
                  nameColor={nameColor}
                  bannerColor={bannerColor}
                  size="lg"
                  fullWidth
                />
              </span>
              {/* Their level, in a 9-pointed star at the banner's top-right. */}
              <span className="absolute -right-1 -top-5 z-10">
                <LevelStar level={level} />
              </span>
            </span>
            {isFounder && (
              <span className="self-center rounded-full border border-gold/60 bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
                Founder
              </span>
            )}
          </motion.div>

          {featured.length > 0 && (
            <motion.div variants={fadeUp} className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-gold">Featured badges</h2>
              <div className="flex justify-center gap-8">
                <ShowcaseBadges ids={featured} sizeClass="h-24 w-24" />
              </div>
            </motion.div>
          )}
        </>
      )}

      {/* Stats (summary + milestones). */}
      <motion.div variants={fadeUp} className="flex flex-col gap-6">
        <ProfileStats stats={stats} />
      </motion.div>

      {/* Earned badges — underneath the milestones, collapsed by default. */}
      <motion.div variants={fadeUp}>
        <BadgesShowcase earned={earned} founderRank={founderRank} />
      </motion.div>

      {/* Customize modals — separate: the banner opens banner colors, the
          character widget opens the character editor (editable only). */}
      {editable && customize && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/70 p-4"
          onClick={() => setCustomize(null)}
        >
          <div className="flex min-h-full items-start justify-center">
            <div
              className="my-8 w-full max-w-md rounded-2xl border-2 border-gold bg-home-bg p-5 text-cream shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className={`text-lg font-semibold text-gold ${heading}`}>
                  {customize === "character" ? "Edit character" : "Customize banner"}
                </h2>
                <button
                  type="button"
                  onClick={() => setCustomize(null)}
                  aria-label="Close"
                  className="-mt-1 text-2xl leading-none text-cream/60 hover:text-cream"
                >
                  &times;
                </button>
              </div>

              <div className="mt-4">
                {customize === "character" ? (
                  <CharacterCreator character={character} onChange={handleCharacter} />
                ) : (
                  <ColorCustomizer
                    level={level}
                    levelProgress={levelProgress}
                    username={profile.username}
                    character={character}
                    featured={featured}
                    nameColor={nameColor}
                    bannerColor={bannerColor}
                    ownedColors={ownedColors}
                    onChange={handleColor}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
