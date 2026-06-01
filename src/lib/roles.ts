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
      "Spend 150 Soul Energy during role-action to kill a player. If Murder is killed, you pick another Vice to take over the role before dying. If Murder is left with only one other active player, Vices win immediately.",
    ability:
      "Kill a player. If Murder dies, a Vice successor takes over. Murder + 1 other active player = Vice win.",
    cost: "150 SE",
  },
  empathy: {
    id: "empathy",
    name: "Empathy",
    camp: "virtue",
    tier: "S",
    multipleAllowed: false,
    description:
      "Spend 150 Soul Energy during role-action to reveal, for every player who got at least one vote in the last consultation, exactly who voted for them.",
    ability:
      "Reveal the full list of who voted for each player last consultation.",
    cost: "150 SE",
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
    tier: "B",
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
      "When a Vice is voted to prison, spend 100 Soul Energy to guess who voted for them. A correct guess sends that voter to the hospital.",
    ability:
      "After a Vice is imprisoned, guess a voter to send them to hospital.",
    cost: "100 SE",
  },
  certainty: {
    id: "certainty",
    name: "Certainty",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Spend 100 Soul Energy during role-action to pick a player and reveal their exact role.",
    ability: "Pick a player; reveal their specific role.",
    cost: "100 SE",
  },
  sacrifice: {
    id: "sacrifice",
    name: "Sacrifice",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Free, once per game. Choose to die and take another player with you. Usable in role-action (queued, Justice protect can spare either side) or in consultation (instant, no protect).",
    ability: "Once per game: die and take another player with you.",
    cost: "Free",
  },
  vice_worshipper: {
    id: "vice_worshipper",
    name: "Vice Worshipper",
    camp: "vice",
    tier: "D",
    multipleAllowed: true,
    description:
      "Spend 20 Soul Energy per character during role-action to send a secret anonymous message to all Vices. Once per day.",
    ability: "Send a secret anonymous message to all Vices.",
    cost: "20 SE / char",
  },
  virtue_seeker: {
    id: "virtue_seeker",
    name: "Virtue Seeker",
    camp: "virtue",
    tier: "D",
    multipleAllowed: true,
    description:
      "Spend 20 Soul Energy per character during role-action to send a secret anonymous message to all Virtues. Once per day.",
    ability: "Send a secret anonymous message to all Virtues.",
    cost: "20 SE / char",
  },
};

// Look up a role by id; returns undefined if the id is unknown.
export function getRole(roleId: string | null | undefined): RoleDef | undefined {
  if (!roleId) return undefined;
  return ROLES[roleId];
}
