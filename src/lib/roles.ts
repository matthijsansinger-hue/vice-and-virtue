// The 12 roles in the MVP (v0.1).
// Descriptions are display text for the role-reveal card. Costs are
// stated explicitly so players see them up front.

export type Camp = "vice" | "virtue";
export type Tier = "S" | "A" | "B" | "C" | "D";

export type RoleDef = {
  id: string;
  name: string;
  camp: Camp;
  tier: Tier;
  // Whether more than one player can hold this role in a single game.
  multipleAllowed: boolean;
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
    description:
      "Spend 150 Soul Energy during role-action to kill a player. If Murder is left with only one other active player, Vices win immediately.",
    ability:
      "Kill a player. Murder + 1 other active player = Vice win.",
    cost: "150 SE",
  },
  empathy: {
    id: "empathy",
    name: "Empathy",
    camp: "virtue",
    tier: "S",
    multipleAllowed: false,
    description:
      "Spend 150 Soul Energy during role-action to reveal, for every player who got at least one vote in the last consultation, exactly who voted for them. Or spend 100 to pick one player and reveal which camp (Vice or Virtue) they belong to.",
    ability:
      "Reveal who voted for each player last consultation (150), or reveal one player's camp (100).",
    cost: "150 / 100 SE",
  },
  intoxication: {
    id: "intoxication",
    name: "Intoxication",
    camp: "vice",
    tier: "A",
    multipleAllowed: false,
    description:
      "Spend 100 Soul Energy during role-action to send a player to the hospital for one day. Justice protect blocks this.",
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
      "Spend 100 Soul Energy to protect a player (yourself included) — blocks Murder and Intoxication for the round. Or spend 200 to kill a player.",
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
      "Spend 100 Soul Energy during role-action to swap identities with another player for the round. Names swap everywhere; votes get routed accordingly.",
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
      "After a player is voted to prison, spend 200 Soul Energy to reveal to everyone who voted for them.",
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
      "Spend 100 Soul Energy during role-action to target a player. On their minigame screen the displayed names are scrambled across rows, so even visually-correct guesses end up tagging the wrong player.",
    ability: "Scramble the names on a target's minigame screen.",
    cost: "100 SE",
  },
  vengeance: {
    id: "vengeance",
    name: "Vengeance",
    camp: "vice",
    tier: "C",
    multipleAllowed: false,
    description:
      "Spend 150 Soul Energy during role-action to send a player to the hospital for one day (Justice protect blocks it). If you are ever voted to prison, the game remembers everyone who voted for you: while imprisoned you may spend 150 each day to kill one of them (Justice protect can still save them).",
    ability:
      "Hospitalise a player (150). Once imprisoned, kill one of the players who jailed you each day (150).",
    cost: "150 SE",
  },
  certainty: {
    id: "certainty",
    name: "Certainty",
    camp: "virtue",
    tier: "B",
    multipleAllowed: false,
    description:
      "Spend 125 Soul Energy during role-action to pick a player and reveal their exact role.",
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
      "Once per game, choose to die and take players with you. The first target is free; each additional target costs 200 Soul Energy (stackable, unlimited). Usable in role-action (queued, Justice protect can spare either side) or in consultation (instant, no protect). Cannot be used while imprisoned.",
    ability:
      "Die and take one player (free) plus one more per 200 SE. Not usable in prison.",
    cost: "Free + 200 SE/extra",
  },
  vice_worshipper: {
    id: "vice_worshipper",
    name: "Vice Worshipper",
    camp: "vice",
    tier: "D",
    multipleAllowed: true,
    description:
      "Spend 100 Soul Energy during role-action to reveal your identity (your name and role) privately to one player. Or spend 100 to guess who the Virtue Seeker is — a correct guess kills them.",
    ability:
      "Reveal yourself to a player (100), or guess the Virtue Seeker to kill them (100).",
    cost: "100 SE",
  },
  virtue_seeker: {
    id: "virtue_seeker",
    name: "Virtue Seeker",
    camp: "virtue",
    tier: "D",
    multipleAllowed: true,
    description:
      "Spend 100 Soul Energy during role-action to reveal your identity (your name and role) privately to one player. Or spend 100 to guess who the Vice Worshipper is — a correct guess imprisons them.",
    ability:
      "Reveal yourself to a player (100), or guess the Vice Worshipper to imprison them (100).",
    cost: "100 SE",
  },

  // ---- New roles batch (unlockable, 1000 LP each) -------------------------
  // Added to the collection; gameplay/abilities not yet implemented, so they
  // are not assigned in matches. Camps/tiers/effects from the design doc.
  wrath: {
    id: "wrath",
    name: "Wrath",
    camp: "vice",
    tier: "S",
    multipleAllowed: false,
    description:
      "Designates a player who turns 'bad' once a certain number of points is scored. If they are already a Vice, nothing happens; if they are a Virtue, they become a generic Vice Worshipper and a follower of Wrath. Wrath can trade the life of a follower for an extra life of his own. Make a new devotee = Y×2. Trade a follower for a life = Y×1.5.",
    ability:
      "Convert a Virtue into a Vice follower; trade a follower's life for an extra life.",
    cost: "Y×2 / Y×1.5",
  },
  love: {
    id: "love",
    name: "Love",
    camp: "virtue",
    tier: "S",
    multipleAllowed: false,
    description:
      "Can turn a player 'good' once a certain number of points is achieved. If they are already a Virtue, nothing happens; if they are a Vice, they become a Virtue Worshipper. Make a new devotee = Y×2. Hold the deciding vote during imprisonment = Y×1.5.",
    ability:
      "Convert a Vice into a Virtue follower, or take the deciding imprisonment vote.",
    cost: "Y×2 / Y×1.5",
  },
  gambling: {
    id: "gambling",
    name: "Gambling",
    camp: "vice",
    tier: "A",
    multipleAllowed: false,
    description:
      "For a certain number of points, picks a number between 1 and 6 and rolls a die. If the die matches the chosen number, Gambling may kill a player. Formula: Y×1.",
    ability: "Pick 1–6 and roll a die — on a match, kill a player.",
    cost: "Y×1",
  },
  determination: {
    id: "determination",
    name: "Determination",
    camp: "virtue",
    tier: "A",
    multipleAllowed: false,
    description:
      "Can buy extra lives with Soul Energy. Formula: Y×2.",
    ability: "Buy extra lives with Soul Energy.",
    cost: "Y×2",
  },
  fanaticism: {
    id: "fanaticism",
    name: "Fanaticism",
    camp: "vice",
    tier: "B",
    multipleAllowed: false,
    description:
      "Passes a bomb to a player of choice from the first round. Whoever holds a bomb must pass it on each reflection phase, and Fanaticism can detonate it during consultation to kill that holder. Give a bomb (max 1 per night, 2 total) = Y×1. Detonate bomb(s) (max 2) = Y×1.5. See who holds the bombs = Y×1.",
    ability: "Pass bombs hand-to-hand; detonate during consultation to kill the holder.",
    cost: "Y×1 / Y×1.5",
  },
  generosity: {
    id: "generosity",
    name: "Generosity",
    camp: "virtue",
    tier: "B",
    multipleAllowed: false,
    description:
      "Can give away points and lives. Give 100 points = Y×1. Give a life = Y×2.",
    ability: "Give away points, or grant a life.",
    cost: "Y×1 / Y×2",
  },
  pride: {
    id: "pride",
    name: "Pride",
    camp: "vice",
    tier: "C",
    multipleAllowed: false,
    description:
      "Reveals himself to a random player in the night; that player cannot score any points that night. Formula: Y×1.",
    ability: "Reveal yourself to a random player — they score nothing that night.",
    cost: "Y×1",
  },
  diligence: {
    id: "diligence",
    name: "Diligence",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Passive (always on): a wrong guess in the minigame never drops Diligence to 0 points. For 100 Soul Energy, can see how many guesses were correct during the minigame.",
    ability: "Passive: a wrong minigame guess won't zero you. Pay 100 SE to see your correct-guess count.",
    cost: "Passive / 100 SE",
  },
};

// Look up a role by id; returns undefined if the id is unknown.
export function getRole(roleId: string | null | undefined): RoleDef | undefined {
  if (!roleId) return undefined;
  return ROLES[roleId];
}

// The new roles batch is collection-only for now: shown in the Roles tab as
// unlockable, but not yet assigned in matches (their abilities aren't built).
// isPlayableRole keeps them out of the gameplay-facing surfaces — assignment,
// badges, wins-per-character, the ranked loadout, and the in-game rules — until
// they're implemented. (The Roles-tab collection deliberately shows everything.)
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
