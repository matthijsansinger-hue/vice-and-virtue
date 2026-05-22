// Role-distribution algorithm.
//
// Rules (from the game design template, section 5.3):
//  - Camps are balanced: as close to equal Vices and Virtues as possible.
//  - Roles are filled in tier order S > A > B > C > D.
//  - The S/A/B/C roles are unique. Once they run out, the remaining players
//    in a camp become the D-tier filler role (Vice Worshipper / Virtue Seeker).

// Unique roles per camp, in tier priority order.
const VICE_TIER_ORDER = ["murder", "intoxication", "envy", "torment", "vengeance"];
const VIRTUE_TIER_ORDER = [
  "empathy",
  "justice",
  "truthfulness",
  "certainty",
  "sacrifice",
];

// Builds a list of `count` role ids for one camp: unique roles first,
// then the repeatable filler role for any remaining slots.
function buildCampRoles(
  uniqueOrder: string[],
  fillerId: string,
  count: number
): string[] {
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

  const viceRoles = buildCampRoles(VICE_TIER_ORDER, "vice_worshipper", viceCount);
  const virtueRoles = buildCampRoles(
    VIRTUE_TIER_ORDER,
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
