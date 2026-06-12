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
      "Once per game, choose to die and take players with you. The first target is free; each additional target costs 200 Soul Energy (stackable, unlimited). Usable in the role-action phase or the shop phase — it resolves at the end of that phase, and protection can spare either side. Cannot be used while imprisoned.",
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
  // Shown in the collection; gameplay/abilities not yet implemented, so they
  // are not assigned in matches. Descriptions are written to match the in-game
  // voice (fixed Soul Energy costs, role-action / consultation / minigame
  // phrasing, Justice-protect interactions); exact numbers are placeholders.
  wrath: {
    id: "wrath",
    name: "Wrath",
    camp: "vice",
    tier: "S",
    multipleAllowed: false,
    description:
      "Spend 200 Soul Energy during role-action to mark a player. When the role phase ends, if they are a Virtue that isn't an S-tier role, they are corrupted into a Vice Worshipper bound to you as a follower — otherwise nothing takes hold, but the Soul Energy is spent either way, so choose where you strike with care. While you hold a follower, spend 100 Soul Energy to relinquish one — their life becomes a lasting extra life of yours: the next kill or hospitalisation that would strike you is absorbed instead, spending one extra life. Extra lives last the whole game until used.",
    ability:
      "Corrupt a non-S Virtue into a Vice follower (200), or relinquish a follower for a lasting extra life (100).",
    cost: "200 / 100 SE",
  },
  love: {
    id: "love",
    name: "Love",
    camp: "virtue",
    tier: "S",
    multipleAllowed: false,
    description:
      "Spend 200 Soul Energy during role-action to reach out to a player. When the role phase ends, if they are a Vice that isn't an S-tier role, they are turned and become a Virtue Seeker — otherwise nothing takes hold, but the Soul Energy is spent either way. Or spend 100 Soul Energy to arm the deciding vote: in that day's consultation, if the imprisonment vote ties and you voted for one of the tied players, your choice is imprisoned instead of forcing a re-vote.",
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
      "Spend 100 Soul Energy during role-action to pick a number from 1 to 6 and a target, then roll the die. If the roll matches your number the target is killed (Justice protect blocks it); if it misses, nothing happens.",
    ability: "Pick 1–6 and a target, then roll — on a match, kill them (protect blocks).",
    cost: "100 SE",
  },
  determination: {
    id: "determination",
    name: "Determination",
    camp: "virtue",
    tier: "A",
    multipleAllowed: false,
    description:
      "Spend 100 Soul Energy during role-action to gain an extra life. An extra life lasts the whole game: the next kill or hospitalisation that would strike you is absorbed instead, spending one extra life. Buy as many as you can afford (100 each) to stack them.",
    ability: "Buy a lasting extra life that absorbs a future kill/hospitalisation (100 each, stackable).",
    cost: "100 SE",
  },
  fanaticism: {
    id: "fanaticism",
    name: "Fanaticism",
    camp: "vice",
    tier: "B",
    multipleAllowed: false,
    description:
      "Spend 50 Soul Energy during role-action to slip a bomb to a player (up to two bombs across the game); they're told they've received it, and from the next day on must pass it to someone else each reflection. During the shop phase, spend 150 Soul Energy to detonate one — killing whoever holds it when the shop closes, with no protection — or 50 to see who is carrying your bombs. You aren't told where a bomb has drifted, so detonating blind may strike a friend.",
    ability: "Plant bombs passed hand-to-hand (50); in the shop, detonate one to kill the (hidden) holder (150).",
    cost: "50 / 150 SE",
  },
  generosity: {
    id: "generosity",
    name: "Generosity",
    camp: "virtue",
    tier: "B",
    multipleAllowed: false,
    description:
      "Spend 100 Soul Energy during role-action to gift another player 100 Soul Energy of your own. Or spend 200 Soul Energy to grant a player a lasting extra life — the next kill or hospitalisation that would strike them is absorbed instead, spending one extra life. Extra lives last the whole game until used.",
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
      "Spend 100 Soul Energy during role-action to reveal your name and role to a random player — and so dazzle them that they score no points in this round's minigame.",
    ability: "Reveal yourself to a random player; they score nothing in that round's minigame.",
    cost: "100 SE",
  },
  diligence: {
    id: "diligence",
    name: "Diligence",
    camp: "virtue",
    tier: "C",
    multipleAllowed: false,
    description:
      "Passive: a wrong guess in the minigame never zeroes your Soul Energy for that round — you still keep whatever your correct tags earn. Spend 100 Soul Energy during role-action to learn how many of your minigame guesses were correct.",
    ability: "Passive: a wrong minigame guess won't zero your round. Pay 100 SE to count your correct guesses.",
    cost: "Passive / 100 SE",
  },
};

// Look up a role by id; returns undefined if the id is unknown.
export function getRole(roleId: string | null | undefined): RoleDef | undefined {
  if (!roleId) return undefined;
  return ROLES[roleId];
}

// The 8 new roles ARE pickable in role select once unlocked (1000 LP; the
// server enforces ownership in select_role) — their role-action abilities just
// aren't built yet (RoleAction shows a "not implemented" panel). This filter
// now only keeps them out of the META surfaces that assume the original
// catalog: the badge matrix, wins-per-character, the (orphaned) ranked
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
