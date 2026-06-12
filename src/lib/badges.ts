// The badge catalog. Badges are grouped into five tiers (highest to
// lowest): Divine, Noble, Primal, Verdant, Earthen. Each badge has an
// earn condition evaluated against a player's stats + recorded
// achievement keys + account age.

import { ROLES } from "./roles";
import type { UserStats } from "./stats";

export type BadgeTier = "divine" | "noble" | "primal" | "verdant" | "earthen";

// Rank order, highest first.
export const TIER_ORDER: BadgeTier[] = [
  "divine",
  "noble",
  "primal",
  "verdant",
  "earthen",
];

export const TIER_META: Record<
  BadgeTier,
  { label: string; gradient: string; ring: string; text: string; glow?: string }
> = {
  divine: {
    label: "Divine",
    gradient: "linear-gradient(135deg,#fff7d6,#e9c64a)",
    ring: "#fffbe6",
    text: "#4e3624",
    glow: "0 0 14px rgba(227,181,16,0.75)",
  },
  noble: {
    label: "Noble",
    gradient: "linear-gradient(135deg,#7b4bb0,#3a1857)",
    ring: "#e3b510",
    text: "#ffefc5",
    glow: "0 0 10px rgba(123,75,176,0.55)",
  },
  primal: {
    label: "Primal",
    gradient: "linear-gradient(135deg,#d4551f,#6e1d0c)",
    ring: "#f3a05a",
    text: "#fff",
  },
  verdant: {
    label: "Verdant",
    gradient: "linear-gradient(135deg,#4f9d4f,#1e3d1e)",
    ring: "#8fd98f",
    text: "#fff",
  },
  earthen: {
    label: "Earthen",
    gradient: "linear-gradient(135deg,#7a5a3f,#3e2c1c)",
    ring: "#a8825f",
    text: "#ffefc5",
  },
};

export type BadgeIcon =
  | "trophy"
  | "medal"
  | "star"
  | "eye"
  | "shield"
  | "skull"
  | "mask"
  | "key"
  | "user"
  | "chat"
  | "link"
  | "sun";

// Earn conditions. "achievement" keys are recorded in user_achievements
// (in-game events / claims); everything else is derived live.
type BadgeCond =
  | { kind: "always" }
  | { kind: "account_rank"; max: number } // among the first `max` accounts
  | { kind: "achievement"; key: string }
  | { kind: "games_played"; n: number }
  | { kind: "games_won"; n: number }
  | { kind: "role_wins"; role: string; n: number };

export type BadgeDef = {
  id: string;
  tier: BadgeTier;
  name: string;
  description: string;
  cond: BadgeCond;
  roleId?: string; // medallion shows this role's card art instead of an icon
  icon?: BadgeIcon;
  glyphText?: string; // short text (e.g. "19") shown in the coin instead of an icon
};

// Per-role win badges: one threshold per tier.
const ROLE_THRESHOLDS: { n: number; tier: BadgeTier }[] = [
  { n: 1, tier: "earthen" },
  { n: 5, tier: "verdant" },
  { n: 15, tier: "primal" },
  { n: 40, tier: "noble" },
  { n: 100, tier: "divine" },
];

function roleBadges(): BadgeDef[] {
  const out: BadgeDef[] = [];
  // All 20 roles get the per-tier win-badge matrix now (the 8 unlockable roles
  // have their tier-tinted badge-icons too — migration-075 art batch).
  for (const role of Object.values(ROLES)) {
    for (const { n, tier } of ROLE_THRESHOLDS) {
      out.push({
        id: `role_${role.id}_${n}`,
        tier,
        name: role.name,
        description: `Win ${n} game${n === 1 ? "" : "s"} as ${role.name}.`,
        cond: { kind: "role_wins", role: role.id, n },
        roleId: role.id,
      });
    }
  }
  return out;
}

const MISC_BADGES: BadgeDef[] = [
  // --- Earthen ---
  { id: "make_account", tier: "earthen", name: "Awakened", description: "Create an account.", cond: { kind: "always" }, icon: "user" },
  { id: "finish_game", tier: "earthen", name: "First Steps", description: "Finish a game.", cond: { kind: "games_played", n: 1 }, icon: "medal" },
  { id: "win_game", tier: "earthen", name: "First Victory", description: "Win a game.", cond: { kind: "games_won", n: 1 }, icon: "trophy" },
  { id: "add_friend", tier: "earthen", name: "Kindred", description: "Add a friend.", cond: { kind: "achievement", key: "friend_added" }, icon: "link" },
  { id: "discord_joined", tier: "earthen", name: "The Gathering", description: "Join the Discord.", cond: { kind: "achievement", key: "discord_joined" }, icon: "chat" },
  { id: "minigame_first", tier: "earthen", name: "Sharpest Eye", description: "Finish first in a minigame.", cond: { kind: "achievement", key: "minigame_first" }, icon: "star" },

  // --- Verdant ---
  { id: "wins_20", tier: "verdant", name: "Proven", description: "Win 20 games in total.", cond: { kind: "games_won", n: 20 }, icon: "trophy" },
  { id: "plays_50", tier: "verdant", name: "Seasoned", description: "Play 50 games in total.", cond: { kind: "games_played", n: 50 }, icon: "medal" },
  { id: "justice_protect", tier: "verdant", name: "Guardian", description: "Protect someone from dying with Justice.", cond: { kind: "achievement", key: "justice_protect" }, icon: "shield" },
  { id: "murder_3", tier: "verdant", name: "Bloodletter", description: "Kill three players in a single game with Murder.", cond: { kind: "achievement", key: "murder_3" }, icon: "skull" },
  { id: "freed_prison", tier: "verdant", name: "Jailbreak", description: "Get freed from prison.", cond: { kind: "achievement", key: "freed_prison" }, icon: "key" },
  { id: "murdered_hospital", tier: "verdant", name: "No Mercy", description: "Get murdered while you're hospitalised.", cond: { kind: "achievement", key: "murdered_hospital" }, icon: "skull" },
  { id: "kill_teammate", tier: "verdant", name: "Betrayer", description: "Kill a teammate.", cond: { kind: "achievement", key: "kill_teammate" }, icon: "skull" },

  // --- Primal ---
  { id: "plays_100", tier: "primal", name: "Centurion", description: "Play 100 games in total.", cond: { kind: "games_played", n: 100 }, icon: "medal" },
  { id: "wins_50", tier: "primal", name: "Conqueror", description: "Win 50 games in total.", cond: { kind: "games_won", n: 50 }, icon: "trophy" },
  { id: "murder_5", tier: "primal", name: "Reaper", description: "Kill five players in a single game with Murder.", cond: { kind: "achievement", key: "murder_5" }, icon: "skull" },
  { id: "envy_escape", tier: "primal", name: "Face Stealer", description: "Escape death with Envy by swapping faces.", cond: { kind: "achievement", key: "envy_escape" }, icon: "mask" },

  // --- Noble ---
  { id: "plays_200", tier: "noble", name: "Veteran", description: "Play 200 games in total.", cond: { kind: "games_played", n: 200 }, icon: "medal" },
  { id: "wins_100", tier: "noble", name: "Champion", description: "Win 100 games in total.", cond: { kind: "games_won", n: 100 }, icon: "trophy" },
  { id: "minigame_no_unknown", tier: "noble", name: "Unwavering", description: "Don't press a single ? during the minigame in a game.", cond: { kind: "achievement", key: "minigame_no_unknown" }, icon: "eye" },

  // --- Divine ---
  { id: "first_95", tier: "divine", name: "Founder", description: "Be one of the first 19 players to create an account.", cond: { kind: "account_rank", max: 19 }, icon: "sun", glyphText: "19" },
  { id: "plays_500", tier: "divine", name: "Eternal", description: "Play 500 games in total.", cond: { kind: "games_played", n: 500 }, icon: "medal" },
  { id: "wins_250", tier: "divine", name: "Legend", description: "Win 250 games in total.", cond: { kind: "games_won", n: 250 }, icon: "trophy" },
];

export const BADGES: BadgeDef[] = [...MISC_BADGES, ...roleBadges()];

export const BADGES_BY_TIER: Record<BadgeTier, BadgeDef[]> = {
  divine: BADGES.filter((b) => b.tier === "divine"),
  noble: BADGES.filter((b) => b.tier === "noble"),
  primal: BADGES.filter((b) => b.tier === "primal"),
  verdant: BADGES.filter((b) => b.tier === "verdant"),
  earthen: BADGES.filter((b) => b.tier === "earthen"),
};

// Inputs needed to evaluate every badge condition.
export type BadgeContext = {
  stats: UserStats;
  achievementKeys: Set<string>;
  // Number of accounts created before this one (null if unknown).
  accountOlderCount: number | null;
};

function roleWins(stats: UserStats): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of stats.perRole) m[r.role] = r.won;
  return m;
}

export function isBadgeEarned(badge: BadgeDef, ctx: BadgeContext): boolean {
  const c = badge.cond;
  switch (c.kind) {
    case "always":
      return true;
    case "account_rank":
      return ctx.accountOlderCount !== null && ctx.accountOlderCount < c.max;
    case "achievement":
      return ctx.achievementKeys.has(c.key);
    case "games_played":
      return ctx.stats.totalGames >= c.n;
    case "games_won":
      return ctx.stats.totalWins >= c.n;
    case "role_wins":
      return (roleWins(ctx.stats)[c.role] ?? 0) >= c.n;
  }
}

export function computeEarnedBadgeIds(ctx: BadgeContext): Set<string> {
  return new Set(BADGES.filter((b) => isBadgeEarned(b, ctx)).map((b) => b.id));
}

// --- Categorization + progress (for the profile badge UI) ---

// Achievement-key badges that stay visible as goals even when locked.
// Every OTHER achievement-key badge is a SECRET (hidden until earned).
const GOAL_ACHIEVEMENT_KEYS = new Set([
  "friend_added",
  "discord_joined",
  "minigame_first",
  "minigame_no_unknown",
]);

export type BadgeCategory = "character" | "milestone" | "goal" | "secret";

// How a badge is surfaced on the profile:
//  - character: per-role win badge → shown under "Wins per character" with progress
//  - milestone: total wins / total games → shown with progress
//  - goal: always visible, even when locked (account / Founder / friend / Discord / minigame)
//  - secret: hidden until earned (role-ability event badges)
export function badgeCategory(b: BadgeDef): BadgeCategory {
  if (b.roleId) return "character";
  const c = b.cond;
  if (c.kind === "games_won" || c.kind === "games_played") return "milestone";
  if (c.kind === "achievement") {
    return GOAL_ACHIEVEMENT_KEYS.has(c.key) ? "goal" : "secret";
  }
  // "always" (make_account) + "account_rank" (Founder) stay visible as goals.
  return "goal";
}

// The numeric threshold behind a count-based badge, or null.
function condThreshold(b: BadgeDef): number | null {
  const c = b.cond;
  if (
    c.kind === "role_wins" ||
    c.kind === "games_won" ||
    c.kind === "games_played"
  ) {
    return c.n;
  }
  return null;
}

export type BadgeProgress = {
  earned: BadgeDef[]; // earned thresholds, ascending
  next: BadgeDef | null; // the next unearned threshold (null if maxed)
  current: number; // current count
  target: number | null; // next threshold value (null if maxed)
};

function progressOver(badges: BadgeDef[], value: number): BadgeProgress {
  const sorted = [...badges].sort(
    (a, b) => (condThreshold(a) ?? 0) - (condThreshold(b) ?? 0)
  );
  const earned = sorted.filter((b) => value >= (condThreshold(b) ?? Infinity));
  const next =
    sorted.find((b) => value < (condThreshold(b) ?? Infinity)) ?? null;
  return {
    earned,
    next,
    current: value,
    target: next ? condThreshold(next) : null,
  };
}

// Progress for one character's win badges (earned thresholds + next target).
export function roleBadgeProgress(roleId: string, wins: number): BadgeProgress {
  return progressOver(
    BADGES.filter((b) => b.roleId === roleId),
    wins
  );
}

// Progress for the total-wins or total-games milestone badges.
export function milestoneProgress(
  kind: "games_won" | "games_played",
  value: number
): BadgeProgress {
  return progressOver(
    BADGES.filter((b) => b.cond.kind === kind),
    value
  );
}
