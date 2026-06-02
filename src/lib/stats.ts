// Recording game results when a game ends. Called once by the host as
// the game transitions to the game_over screen. Writes one game_results
// row per account-linked player (guests are skipped), marking a win for
// everyone on the winning camp — alive, dead, or imprisoned alike.

import { supabase } from "./supabase";
import { ROLES } from "./roles";
import type { WinningCamp } from "./winConditions";

export async function recordGameResults(
  roomId: string,
  winner: WinningCamp
): Promise<void> {
  const { data: players, error } = await supabase
    .from("players")
    .select("user_id, role")
    .eq("room_id", roomId);
  if (error) throw error;

  const rows = (players ?? [])
    .filter((p) => p.user_id && p.role && ROLES[p.role as string])
    .map((p) => {
      const camp = ROLES[p.role as string].camp;
      return {
        user_id: p.user_id as string,
        room_id: roomId,
        role: p.role as string,
        camp,
        won: camp === winner,
      };
    });

  // Idempotent: clear any prior results for this room before inserting,
  // so a re-trigger of game_over can't double-count.
  await supabase.from("game_results").delete().eq("room_id", roomId);

  if (rows.length > 0) {
    const { error: insertError } = await supabase
      .from("game_results")
      .insert(rows);
    if (insertError) throw insertError;
  }
}
