// Game-flow operations.

import { supabase } from "./supabase";
import { assignRoles } from "./assignRoles";

// Starts the game: assigns a role to every player, then moves the room
// from the lobby into the game.
export async function startGame(
  roomId: string,
  playerIds: string[]
): Promise<void> {
  const assignments = assignRoles(playerIds);

  // Write each player's assigned role first...
  await Promise.all(
    assignments.map(({ playerId, roleId }) =>
      supabase.from("players").update({ role: roleId }).eq("id", playerId)
    )
  );

  // ...then flip the room into the game, so players never see "in game"
  // before their role exists.
  await supabase.from("rooms").update({ status: "in_game" }).eq("id", roomId);
}
