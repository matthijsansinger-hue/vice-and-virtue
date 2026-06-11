// Role-distribution algorithm.
//
// NOTE: this client-side version is no longer called — role assignment runs
// entirely in Postgres (assign_roles_and_start) so the host never sees the
// roles. It's kept as the readable reference for the rule.
//
// Rules:
//  - Camps are balanced: as close to equal Vices and Virtues as possible.
//  - Roles are filled in tier order S > A > B > C > D, ONE role per tier.
//  - The C tier has two roles per camp (Vice: torment/vengeance, Virtue:
//    truthfulness/sacrifice); exactly one of them is picked at random per game.
//  - So a full camp is S,A,B,C,D. Once those run out, the remaining players in
//    a camp become the D-tier filler role (Vice Worshipper / Virtue Seeker).

// Tiers S/A/B per camp, in priority order.
const VICE_SAB = ["murder", "intoxication", "envy"];
const VIRTUE_SAB = ["empathy", "justice", "certainty"];
// The two C-tier roles per camp — one is chosen at random each game.
const VICE_C = ["torment", "vengeance"];
const VIRTUE_C = ["truthfulness", "sacrifice"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Builds a list of `count` role ids for one camp: S, A, B, one random C role,
// then the repeatable D-tier filler role for any remaining slots.
function buildCampRoles(
  sab: string[],
  cRoles: string[],
  fillerId: string,
  count: number
): string[] {
  const uniqueOrder = [...sab, pick(cRoles)];
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(i < uniqueOrder.length ? uniqueOrder[i] : fillerId);
  }
  return result;
}

// Fisher-Yates shuffle — returns a new shuffled copy.
function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Assigns a role id to each player id.
// If the player count is odd, the Virtues get the extra player.
export function assignRoles(
  playerIds: string[]
): { playerId: string; roleId: string }[] {
  const total = playerIds.length;
  const viceCount = Math.floor(total / 2);
  const virtueCount = total - viceCount;

  const viceRoles = buildCampRoles(
    VICE_SAB,
    VICE_C,
    "vice_worshipper",
    viceCount
  );
  const virtueRoles = buildCampRoles(
    VIRTUE_SAB,
    VIRTUE_C,
    "virtue_seeker",
    virtueCount
  );

  const allRoles = shuffle([...viceRoles, ...virtueRoles]);
  const shuffledPlayers = shuffle(playerIds);

  return shuffledPlayers.map((playerId, index) => ({
    playerId,
    roleId: allRoles[index],
  }));
}
