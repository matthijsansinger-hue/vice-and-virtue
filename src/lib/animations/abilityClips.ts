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
  vice_worshipper: { default: "vice_worshipper" },
  virtue_seeker: { default: "virtue_seeker" },
  wrath: { corrupt: "wrath", relinquish: "wrath_absorb", default: "wrath" },
  love: { default: "love" },
  gambling: { default: "gambling" },
  determination: { default: "determination" },
  generosity: { default: "generosity" },
  pride: { default: "pride" },
  diligence: { default: "diligence" },
  fanaticism: {
    plant: "fanaticism_plant",
    detonate: "fanaticism_detonate",
    reveal: "fanaticism_reveal",
    default: "fanaticism_plant",
  },
  truthfulness: { default: "truthfulness" },
  wandering_soul: { default: "wandering_soul" },
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
  role_action: "use_role_ability",
  minigame: "clues_gathered",
  outreach: "classified_whisper",
  store: "black_market",
  consultation: "council_vote",
  role_overview: "vices_vs_virtues",
  new_day: "abyss_flight",
};
