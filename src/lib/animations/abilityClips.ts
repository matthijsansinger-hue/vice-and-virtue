// Maps a role (and, for multi-ability roles, a variant) to its clip name, and
// each day-cycle phase to its transition stinger. Components import
// clipForAbility() and call play(clipForAbility(role, variant)) right after
// their ability's server call succeeds.

// role id -> { variant -> clip name }. "default" is used when a component
// doesn't pass a variant (single-ability roles) or passes an unknown one.
const ABILITY_CLIPS: Record<string, Record<string, string>> = {
  murder: { default: "murder" },
  justice: { protect: "justice", kill: "justice_kill", default: "justice" },
  intoxication: { default: "intoxication" },
  envy: { default: "envy" },
  torment: { default: "torment" },
  vengeance: {
    hospitalise: "vengeance_hospitalise",
    revenge: "vengeance",
    default: "vengeance_hospitalise",
  },
  empathy: { default: "empathy" },
  certainty: { default: "certainty" },
  sacrifice: { default: "sacrifice_cinematic" },
  vice_worshipper: {
    reveal: "vice_worshipper",
    guess: "vice_worshipper_guess",
    default: "vice_worshipper",
  },
  virtue_seeker: {
    reveal: "virtue_seeker",
    guess: "virtue_seeker_guess",
    default: "virtue_seeker",
  },
  wrath: { corrupt: "wrath", relinquish: "wrath_absorb", default: "wrath" },
  love: { turn: "love", tiebreak: "love_tiebreak", default: "love" },
  gambling: { default: "gambling" },
  determination: { default: "determination" },
  generosity: { gift: "generosity", life: "generosity_extra_life", default: "generosity" },
  pride: { default: "pride" },
  diligence: { default: "diligence" },
  fanaticism: {
    plant: "fanaticism_plant",
    detonate: "fanaticism_detonate",
    reveal: "fanaticism_reveal",
    default: "fanaticism_plant",
  },
  truthfulness: { default: "truthfulness" },
  wandering_soul: {
    ward: "wandering_soul",
    escape: "wandering_soul_escape",
    default: "wandering_soul",
  },
};

export function clipForAbility(
  roleId: string | null | undefined,
  variant: string = "default",
): string | null {
  if (!roleId) return null;
  const entry = ABILITY_CLIPS[roleId];
  if (!entry) return null;
  return entry[variant] ?? entry.default ?? null;
}

// Phase -> transition stinger clip name. Plays for all players on phase entry.
export const STINGER_BY_PHASE: Record<string, string> = {
  // role_action (use_role_ability) and minigame (clues_gathered) stingers were
  // removed by request. abyss_flight moved to the lore intro (LoreIntro.tsx), so
  // it's no longer the new_day stinger either.
  outreach: "classified_whisper",
  store: "black_market",
  consultation: "council_vote",
  role_overview: "vices_vs_virtues",
};
