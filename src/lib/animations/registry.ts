// Clip registry — every ability + phase-transition clip, keyed by its `name`.
// getClip(name) is used by AnimationProvider to resolve a play() request.

import type { ClipConfig } from "./engine";

import abyss_flight from "./clips/abyss_flight";
import black_market from "./clips/black_market";
import certainty from "./clips/certainty";
import classified_whisper from "./clips/classified_whisper";
import clues_gathered from "./clips/clues_gathered";
import council_vote from "./clips/council_vote";
import determination from "./clips/determination";
import diligence from "./clips/diligence";
import empathy from "./clips/empathy";
import envy from "./clips/envy";
import fanaticism from "./clips/fanaticism";
import fanaticism_detonate from "./clips/fanaticism_detonate";
import fanaticism_plant from "./clips/fanaticism_plant";
import fanaticism_reveal from "./clips/fanaticism_reveal";
import gambling from "./clips/gambling";
import generosity from "./clips/generosity";
import intoxication from "./clips/intoxication";
import justice from "./clips/justice";
import justice_kill from "./clips/justice_kill";
import love from "./clips/love";
import murder from "./clips/murder";
import pride from "./clips/pride";
import sacrifice_cinematic from "./clips/sacrifice_cinematic";
import torment from "./clips/torment";
import truthfulness from "./clips/truthfulness";
import use_role_ability from "./clips/use_role_ability";
import vengeance from "./clips/vengeance";
import vengeance_hospitalise from "./clips/vengeance_hospitalise";
import vice_worshipper from "./clips/vice_worshipper";
import vices_vs_virtues from "./clips/vices_vs_virtues";
import virtue_seeker from "./clips/virtue_seeker";
import wandering_soul from "./clips/wandering_soul";
import wrath from "./clips/wrath";
import wrath_absorb from "./clips/wrath_absorb";
import generosity_extra_life from "./clips/generosity_extra_life";
import love_tiebreak from "./clips/love_tiebreak";
import vice_worshipper_guess from "./clips/vice_worshipper_guess";
import virtue_seeker_guess from "./clips/virtue_seeker_guess";
import wandering_soul_escape from "./clips/wandering_soul_escape";

const ALL: ClipConfig[] = [
  abyss_flight,
  black_market,
  certainty,
  classified_whisper,
  clues_gathered,
  council_vote,
  determination,
  diligence,
  empathy,
  envy,
  fanaticism,
  fanaticism_detonate,
  fanaticism_plant,
  fanaticism_reveal,
  gambling,
  generosity,
  intoxication,
  justice,
  justice_kill,
  love,
  murder,
  pride,
  sacrifice_cinematic,
  torment,
  truthfulness,
  use_role_ability,
  vengeance,
  vengeance_hospitalise,
  vice_worshipper,
  vices_vs_virtues,
  virtue_seeker,
  wandering_soul,
  wrath,
  wrath_absorb,
  generosity_extra_life,
  love_tiebreak,
  vice_worshipper_guess,
  virtue_seeker_guess,
  wandering_soul_escape,
];

export const CLIPS: Record<string, ClipConfig> = Object.fromEntries(
  ALL.map((c) => [c.name, c]),
);

export function getClip(name: string): ClipConfig | undefined {
  return CLIPS[name];
}

// Sorted clip names — used by the dev preview gallery.
export const CLIP_NAMES: string[] = ALL.map((c) => c.name).sort();
