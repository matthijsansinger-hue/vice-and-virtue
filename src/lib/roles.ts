// The game's roles. Descriptions are the display text for the role card.
// Phase language follows the day cycle: Reflection (Role action → Quiz),
// Action (Outreach → Market), Consultation. Costs are stated up front.

export type Camp = "vice" | "virtue" | "neutral";
export type Tier = "S" | "A" | "B" | "C" | "D";

export type RoleDef = {
  id: string;
  name: string;
  camp: Camp;
  tier: Tier;
  // Whether more than one player can hold this role in a single game.
  multipleAllowed: boolean;
  // Anomaly roles (e.g. the Wandering Soul) are neutral specials that appear
  // outside the normal Vice/Virtue deal. They're hidden from the hub roles
  // gallery + role-config and excluded from camp/tier iterations.
  anomaly?: boolean;
  description: string;
  // One-line ability summary shown on the Game Overview screen (next
  // to the cost). Keep it short — the full description below is shown
  // when a player expands the entry.
  ability: string;
  // Short cost label used on the Game Overview chip ("100 SE", "Free",
  // "100-350 SE", "20 SE / char").
  cost: string;
};

export const ROLES: Record<string, RoleDef> = {
  murder: {
    id: "murder",
    name: "Murder",
    camp: "vice",
    tier: "S",
    multipleAllowed: false,
    description: "Role action — spend 150 Soul Energy to kill any player outright.",
    ability: "Kill a player.",
    cost: "150 SE",
  },
  empathy: {
    id: "empathy",
    name: "Empathy",
    camp: "virtue",
    tier: "S",
    multipleAllowed: false,
    description:
      "Role action (from day 2) — spend 150 Soul Energy to reveal who voted for whom in the last Consultation, or 100 to expose one player's camp.",
    ability: "Reveal last Consultation's voters (150), or one player's camp (100).",
    cost: "150 / 100 SE",
  },
  intoxication: {
    id: "intoxication",
    name: "Intoxication",
    camp: "vice",
    tier: "A",
    multipleAllowed: false,
    description:
      "Role action — spend 100 Soul Energy to hospitalise a player for a day. Justice's protect blocks it.",
    ability: "Send a player to the hospital for one day.",
    cost: "100 SE",
  },
  justice: {
    id: "justice",
    name: "Justice",
    camp: "virtue",
    tier: "A",
    multipleAllowed: false,
    description:
      "Role action — spend 100 Soul Energy to shield a player (yourself included) from Murder and Intoxication, or 200 to kill one.",
    ability: "Protect a player from Murder + Intox, or kill a player.",
    cost: "100 / 200 SE",
  },
  envy: {
    id: "envy",
    name: "Envy",
    camp: "vice",
    tier: "B",
    multipleAllowed: false,
    description:
      "Role action — spend 100 Soul Energy to swap identities with a player for the round. Names swap for everyone else, and their votes route to the real you.",
    ability: "Swap identities with another player for the round.",
    cost: "100 SE",
  },
  truthfulness: {
    id: "truthfulness",
    name: "Truthfulness",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "When a player is jailed in Consultation, spend 200 Soul Energy to reveal their voters to everyone.",
    ability: "Reveal who voted for the imprisoned player to everyone.",
    cost: "200 SE",
  },
  torment: {
    id: "torment",
    name: "Torment",
    camp: "vice",
    tier: "C",
    multipleAllowed: false,
    description:
      "Role action — spend 100 Soul Energy to scramble a target's Quiz: their rows are shuffled, so visually-correct guesses tag the wrong player.",
    ability: "Scramble the names on a target's Quiz screen.",
    cost: "100 SE",
  },
  vengeance: {
    id: "vengeance",
    name: "Vengeance",
    camp: "vice",
    tier: "C",
    multipleAllowed: false,
    description:
      "Role action — spend 150 Soul Energy to hospitalise a player (Justice's protect blocks it). Once you're jailed, the game remembers everyone who voted you in: spend 150 a day to kill one of them (protect can still save them).",
    ability: "Hospitalise a player (150). Once jailed, kill one of your jailers each day (150).",
    cost: "150 SE",
  },
  certainty: {
    id: "certainty",
    name: "Certainty",
    camp: "virtue",
    tier: "B",
    multipleAllowed: false,
    description: "Role action — spend 125 Soul Energy to reveal a player's exact role.",
    ability: "Pick a player; reveal their specific role.",
    cost: "125 SE",
  },
  sacrifice: {
    id: "sacrifice",
    name: "Sacrifice",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Once per game (in Role action or the Market) — die and take players down with you. The first target is free; each extra costs 200 Soul Energy. It resolves when the phase ends, and protection can spare either side. Not usable while jailed.",
    ability: "Die and take one player (free) plus one more per 200 SE. Not usable in prison.",
    cost: "Free + 200 SE/extra",
  },
  vice_worshipper: {
    id: "vice_worshipper",
    name: "Vice Worshipper",
    camp: "vice",
    tier: "D",
    multipleAllowed: true,
    description:
      "Role action — spend 100 Soul Energy to reveal yourself (name + role) privately to one player, or 100 to guess the Virtue Seeker — a correct guess kills them.",
    ability: "Reveal yourself to a player (100), or guess the Virtue Seeker to kill them (100).",
    cost: "100 SE",
  },
  virtue_seeker: {
    id: "virtue_seeker",
    name: "Virtue Seeker",
    camp: "virtue",
    tier: "D",
    multipleAllowed: true,
    description:
      "Role action — spend 100 Soul Energy to reveal yourself (name + role) privately to one player, or 100 to guess the Vice Worshipper — a correct guess jails them.",
    ability: "Reveal yourself to a player (100), or guess the Vice Worshipper to imprison them (100).",
    cost: "100 SE",
  },

  // ---- New roles batch (unlockable, price by tier) -----------------------
  // Unlock with LP — S 2500 / A 1500 / B 1000 / C 600 (migration 079) — or the
  // rare Soul Fragment drop; guests own only the default 12. All eight abilities
  // ARE implemented (migrations 066-078) and these roles are dealt + pickable.
  wrath: {
    id: "wrath",
    name: "Wrath",
    camp: "vice",
    tier: "S",
    multipleAllowed: false,
    description:
      "Role action — spend 200 Soul Energy to mark a player: a non-S-tier Virtue is corrupted into a Vice Worshipper bound to you (the Soul Energy is spent either way, so strike with care). Spend 100 to release a follower — their life becomes a lasting extra life that absorbs your next kill or hospitalisation.",
    ability:
      "Corrupt a non-S Virtue into a Vice follower (200), or release a follower for a lasting extra life (100).",
    cost: "200 / 100 SE",
  },
  love: {
    id: "love",
    name: "Love",
    camp: "virtue",
    tier: "S",
    multipleAllowed: false,
    description:
      "Role action — spend 200 Soul Energy to reach a player: a non-S-tier Vice turns and becomes a Virtue Seeker (Soul Energy spent either way). Or 100 to arm the next Consultation — if the vote ties on someone you backed, your pick is jailed instead of forcing a re-vote.",
    ability:
      "Turn a non-S Vice into a Virtue Seeker (200), or arm a tie-breaking imprisonment vote (100).",
    cost: "200 / 100 SE",
  },
  gambling: {
    id: "gambling",
    name: "Gambling",
    camp: "vice",
    tier: "A",
    multipleAllowed: false,
    description:
      "Role action — spend 100 Soul Energy to roll a die: 1 hospitalise yourself · 2 score nothing in the Quiz · 3 double your Quiz Soul Energy · 4 hospitalise anyone · 5 a lasting extra life · 6 kill anyone (Justice's protect still stops a kill or hospitalisation). The Soul Energy is spent whatever you roll.",
    ability: "Roll a die (100): each face a different boon or bane — heal, harm, score, kill, or backfire.",
    cost: "100 SE",
  },
  determination: {
    id: "determination",
    name: "Determination",
    camp: "virtue",
    tier: "A",
    multipleAllowed: false,
    description:
      "Role action — spend 125 Soul Energy for a lasting extra life: the next kill or hospitalisation aimed at you is absorbed instead. Stack as many as you can afford (125 each).",
    ability: "Buy a lasting extra life that absorbs a future kill/hospitalisation (125 each, stackable).",
    cost: "125 SE",
  },
  fanaticism: {
    id: "fanaticism",
    name: "Fanaticism",
    camp: "vice",
    tier: "B",
    multipleAllowed: false,
    description:
      "Role action — spend 50 Soul Energy to slip a player a bomb (up to two per game); from the next day they must pass it on each Reflection. In the Market, spend 150 to detonate one — killing whoever holds it, with no protection — or 50 to see who carries your bombs. You're never told where a bomb has drifted, so detonating blind may strike a friend.",
    ability: "Plant bombs passed hand-to-hand (50); in the Market, detonate one to kill the (hidden) holder (150).",
    cost: "50 / 150 SE",
  },
  generosity: {
    id: "generosity",
    name: "Generosity",
    camp: "virtue",
    tier: "B",
    multipleAllowed: false,
    description:
      "Role action — spend 100 Soul Energy to gift a player 100 of your own, or 200 to grant them a lasting extra life that absorbs the next kill or hospitalisation.",
    ability: "Gift a player 100 Soul Energy (100), or grant them a lasting extra life (200).",
    cost: "100 / 200 SE",
  },
  pride: {
    id: "pride",
    name: "Pride",
    camp: "vice",
    tier: "C",
    multipleAllowed: false,
    description:
      "Role action — spend 50 Soul Energy to flaunt your name and role to a random player; dazzled, they score nothing in that round's Quiz.",
    ability: "Reveal yourself to a random player; they score nothing in that round's Quiz.",
    cost: "50 SE",
  },
  diligence: {
    id: "diligence",
    name: "Diligence",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Passive — a wrong Quiz guess never zeroes your round; you keep whatever your correct tags earn. Role action: spend 100 Soul Energy to learn how many of your Quiz guesses were correct.",
    ability: "Passive: a wrong Quiz guess won't zero your round. Pay 100 SE to count your correct guesses.",
    cost: "Passive / 100 SE",
  },

  // ---- Anomaly role (neutral) -------------------------------------------
  // Appears automatically only when the player count is ODD: exactly one
  // Wandering Soul, the rest split evenly Vice/Virtue. Never bought/unlocked,
  // hidden from the hub gallery, shown only in How-to-play (anomaly section).
  wandering_soul: {
    id: "wandering_soul",
    name: "The Wandering Soul",
    camp: "neutral",
    tier: "D", // placeholder — never rendered (anomaly is excluded from tier UIs)
    multipleAllowed: false,
    anomaly: true,
    description:
      "A neutral anomaly — a soul that strayed into the castle on its way from the living world to heaven, now trapped. He appears only when the player count is odd. Role action — guess the camp (Vice or Virtue) of every player still in play; name them all correctly and you escape, ending the game as the sole winner. You also win by outlasting the castle: if every Vice and Virtue is dead or imprisoned while you are still alive, the game ends and you win alone. In the Market, spend 100 Soul Energy to ward yourself for one cycle against prison, killing, and hospitalisation. Beware on the Quiz: anyone who tags the Soul as Vice or Virtue is always wrong and scores nothing that round — tag him “unknown”.",
    ability:
      "Guess every living player's camp to escape and win — or simply outlast both camps. Ward yourself for 100 SE. Tagging him on the Quiz is always wrong.",
    cost: "100 SE",
  },
};

// Look up a role by id; returns undefined if the id is unknown.
export function getRole(roleId: string | null | undefined): RoleDef | undefined {
  if (!roleId) return undefined;
  return ROLES[roleId];
}

// The 8 new roles ARE pickable in role select once unlocked (LP price by tier:
// S 2500 / A 1500 / B 1000 / C 600; the server enforces ownership in
// select_role). This filter keeps them out of the META surfaces that assume the
// original catalog: the badge matrix, wins-per-character, the (orphaned) ranked
// loadout, the in-game rules list, and the host's random-mode role config.
const COLLECTION_ONLY_ROLE_IDS = new Set<string>([
  "wrath",
  "love",
  "gambling",
  "determination",
  "fanaticism",
  "generosity",
  "pride",
  "diligence",
]);

export function isPlayableRole(roleId: string): boolean {
  return !COLLECTION_ONLY_ROLE_IDS.has(roleId);
}

// Anomaly roles (the Wandering Soul) are neutral specials dealt only on odd
// counts. They must be hidden from the hub roles gallery, role-config, and any
// Vice/Virtue iteration; How-to-play shows them in a dedicated section.
export function isAnomalyRole(roleId: string | null | undefined): boolean {
  return !!roleId && !!ROLES[roleId]?.anomaly;
}
