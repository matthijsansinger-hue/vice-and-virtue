// The 12 roles in the MVP (v0.1).
// Descriptions are display text for the role-reveal card. The actual
// abilities are not implemented yet — that comes with the game phases.

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
      "Murder can spend points to kill a player. If Murder is killed, he picks another Vice to take over the role.",
  },
  empathy: {
    id: "empathy",
    name: "Empathy",
    camp: "virtue",
    tier: "S",
    multipleAllowed: false,
    description:
      "Each reflection phase, Empathy picks a player and sees who voted for them.",
  },
  intoxication: {
    id: "intoxication",
    name: "Intoxication",
    camp: "vice",
    tier: "A",
    multipleAllowed: false,
    description:
      "Intoxication can spend points to send a player to hospital for one cycle — they cannot use their role or earn minigame points.",
  },
  justice: {
    id: "justice",
    name: "Justice",
    camp: "virtue",
    tier: "A",
    multipleAllowed: false,
    description:
      "Justice can spend points to kill a player, or to protect one for a cycle. Protection blocks Murder and Intoxication, but not votes.",
  },
  envy: {
    id: "envy",
    name: "Envy",
    camp: "vice",
    tier: "B",
    multipleAllowed: false,
    description:
      "Envy can spend points to swap identities with another player for a round. Their icons switch, and votes land on the other player instead.",
  },
  truthfulness: {
    id: "truthfulness",
    name: "Truthfulness",
    camp: "virtue",
    tier: "B",
    multipleAllowed: false,
    description:
      "After a player is voted out, Truthfulness can spend points to reveal to everyone who voted for them.",
  },
  torment: {
    id: "torment",
    name: "Torment",
    camp: "vice",
    tier: "C",
    multipleAllowed: false,
    description:
      "Each reflection phase, Torment can choose a player whose screen gets covered with ink spots during the minigame.",
  },
  vengeance: {
    id: "vengeance",
    name: "Vengeance",
    camp: "vice",
    tier: "C",
    multipleAllowed: false,
    description:
      "When a Vice is voted out, Vengeance may guess who voted for them. A correct guess sends that player to hospital for a day.",
  },
  certainty: {
    id: "certainty",
    name: "Certainty",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Certainty can spend points to choose a tier and see every player who holds a role in that tier.",
  },
  sacrifice: {
    id: "sacrifice",
    name: "Sacrifice",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Once per game, at any moment, Sacrifice can choose to die and take another player down with them.",
  },
  vice_worshipper: {
    id: "vice_worshipper",
    name: "Vice Worshipper",
    camp: "vice",
    tier: "D",
    multipleAllowed: true,
    description:
      "At the start of the reflection phase, Vice Worshipper can spend points to send a secret message to all Vices — the more points spent, the longer the message.",
  },
  virtue_seeker: {
    id: "virtue_seeker",
    name: "Virtue Seeker",
    camp: "virtue",
    tier: "D",
    multipleAllowed: true,
    description:
      "At the start of the reflection phase, Virtue Seeker can spend points to send a secret message to all Virtues — the more points spent, the longer the message.",
  },
};

// Look up a role by id; returns undefined if the id is unknown.
export function getRole(roleId: string | null | undefined): RoleDef | undefined {
  if (!roleId) return undefined;
  return ROLES[roleId];
}
