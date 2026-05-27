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
};

export const ROLES: Record<string, RoleDef> = {
  murder: {
    id: "murder",
    name: "Murder",
    camp: "vice",
    tier: "S",
    multipleAllowed: false,
    description:
      "Spend 150 Soul Energy during role-action to kill a player. If Murder is killed, you pick another Vice to take over the role before dying.",
  },
  empathy: {
    id: "empathy",
    name: "Empathy",
    camp: "virtue",
    tier: "S",
    multipleAllowed: false,
    description:
      "Spend 100 Soul Energy during role-action to pick a player and see who voted for them in the last consultation.",
  },
  intoxication: {
    id: "intoxication",
    name: "Intoxication",
    camp: "vice",
    tier: "A",
    multipleAllowed: false,
    description:
      "Spend 100 Soul Energy during role-action to send a player to the hospital for one day. Justice protect blocks this.",
  },
  justice: {
    id: "justice",
    name: "Justice",
    camp: "virtue",
    tier: "A",
    multipleAllowed: false,
    description:
      "Spend 100 Soul Energy to protect a player (yourself included) — blocks Murder and Intoxication for the round. Or spend 200 to kill a player.",
  },
  envy: {
    id: "envy",
    name: "Envy",
    camp: "vice",
    tier: "B",
    multipleAllowed: false,
    description:
      "Spend 100 Soul Energy during role-action to swap identities with another player for the round. Names swap everywhere; votes get routed accordingly.",
  },
  truthfulness: {
    id: "truthfulness",
    name: "Truthfulness",
    camp: "virtue",
    tier: "B",
    multipleAllowed: false,
    description:
      "After a player is voted to prison, spend 200 Soul Energy to reveal to everyone who voted for them.",
  },
  torment: {
    id: "torment",
    name: "Torment",
    camp: "vice",
    tier: "C",
    multipleAllowed: false,
    description:
      "Spend 100 Soul Energy during role-action to target a player. Half of the other players' icons will be obscured on their minigame screen.",
  },
  vengeance: {
    id: "vengeance",
    name: "Vengeance",
    camp: "vice",
    tier: "C",
    multipleAllowed: false,
    description:
      "When a Vice is voted to prison, spend 100 Soul Energy to guess who voted for them. A correct guess sends that voter to the hospital.",
  },
  certainty: {
    id: "certainty",
    name: "Certainty",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Spend Soul Energy (100 for D-tier up to 350 for S-tier) during role-action to pick a tier and see every player who holds a role in that tier.",
  },
  sacrifice: {
    id: "sacrifice",
    name: "Sacrifice",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Free, once per game. Choose to die and take another player with you. Usable in role-action (queued, Justice protect can spare either side) or in consultation (instant, no protect).",
  },
  vice_worshipper: {
    id: "vice_worshipper",
    name: "Vice Worshipper",
    camp: "vice",
    tier: "D",
    multipleAllowed: true,
    description:
      "Spend 20 Soul Energy per character during role-action to send a secret anonymous message to all Vices. Once per day.",
  },
  virtue_seeker: {
    id: "virtue_seeker",
    name: "Virtue Seeker",
    camp: "virtue",
    tier: "D",
    multipleAllowed: true,
    description:
      "Spend 20 Soul Energy per character during role-action to send a secret anonymous message to all Virtues. Once per day.",
  },
};

// Look up a role by id; returns undefined if the id is unknown.
export function getRole(roleId: string | null | undefined): RoleDef | undefined {
  if (!roleId) return undefined;
  return ROLES[roleId];
}
