// The Quiz (migration 122): each round a player makes ONE secret choice —
//   'points' → 100 Soul Energy
//   'hint'   → 50 Soul Energy + a clue about two other players
//   'peek'   → 0 Soul Energy, see one player's camp
// The server records the choice (player_secrets.quiz) and pays the points when
// the round ends (apply_quiz_awards). Nothing about the choice is public.

import { supabase } from "./supabase";

export const QUIZ_POINTS = { points: 100, hint: 50, peek: 0 } as const;

export type QuizChoice = keyof typeof QUIZ_POINTS;

export type QuizHint =
  | { kind: "opposite"; a: string; b: string }
  | { kind: "at_least"; camp: "vice" | "virtue"; a: string; b: string };

export type QuizResult = {
  day: number;
  choice: QuizChoice;
  // Points this choice is worth (0 when dazzled by Pride / Gambling's 2).
  points: number;
  dazzled: boolean;
  hint: QuizHint | null;
  peek: { target: string; camp: "vice" | "virtue" | "neutral" } | null;
  // Filled in once the round is paid out (apply_quiz_awards).
  awarded?: number;
  doubled?: boolean;
};

export async function submitQuizChoice(
  playerId: string,
  choice: QuizChoice,
  targetId?: string
): Promise<{ ok: boolean; quiz?: QuizResult; reason?: string }> {
  const { data, error } = await supabase.rpc("submit_quiz_choice", {
    p_player_id: playerId,
    p_choice: choice,
    p_target: targetId ?? null,
  });
  if (error) return { ok: false, reason: error.message };
  return (
    (data as { ok: boolean; quiz?: QuizResult; reason?: string } | null) ?? {
      ok: false,
      reason: "no_response",
    }
  );
}

// My choice for the current day, or null if I haven't chosen.
export async function myQuiz(playerId: string): Promise<QuizResult | null> {
  const { data, error } = await supabase.rpc("my_quiz", {
    p_player_id: playerId,
  });
  if (error || !data) return null;
  return data as QuizResult;
}
