"use client";

import { heading, ParchmentCard, SoulCost } from "@/components/ui/royal";
import { displayedName } from "@/lib/swaps";
import type { QuizResult } from "@/lib/quiz";
import type { Player, Room } from "@/lib/types";

// What the viewer got from this round's Quiz choice — shown on the Quiz screen
// once they've chosen and again on the results screen. Private to the viewer.
export function QuizOutcome({
  quiz,
  room,
  players,
  myPlayer,
}: {
  quiz: QuizResult;
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const nameOf = (id: string) => {
    const p = players.find((x) => x.id === id);
    return p ? displayedName(p, room, players, myPlayer?.id) : "someone";
  };
  // Paid amount once the round is settled; until then, what the choice is worth.
  const earned = quiz.awarded ?? quiz.points;

  return (
    <ParchmentCard kicker="Your choice" center>
      {quiz.choice === "points" && (
        <p className={`mt-1 text-xl font-semibold ${heading}`}>
          You took the Soul Energy
        </p>
      )}

      {quiz.choice === "hint" && (
        <>
          <p className={`mt-1 text-xl font-semibold ${heading}`}>A whisper</p>
          {quiz.hint ? (
            <p className="mt-2 text-base leading-snug">
              {quiz.hint.kind === "opposite" ? (
                <>
                  <strong>{nameOf(quiz.hint.a)}</strong> and{" "}
                  <strong>{nameOf(quiz.hint.b)}</strong> are on{" "}
                  <strong>opposite sides</strong>.
                </>
              ) : (
                <>
                  At least one of <strong>{nameOf(quiz.hint.a)}</strong> and{" "}
                  <strong>{nameOf(quiz.hint.b)}</strong> is a{" "}
                  <CampWord camp={quiz.hint.camp} />.
                </>
              )}
            </p>
          ) : (
            <p className="mt-2 text-sm text-home-bg/70">
              Too few players are left for a hint.
            </p>
          )}
        </>
      )}

      {quiz.choice === "peek" && quiz.peek && (
        <>
          <p className={`mt-1 text-xl font-semibold ${heading}`}>You read a soul</p>
          <p className="mt-2 text-base leading-snug">
            <strong>{nameOf(quiz.peek.target)}</strong>{" "}
            {quiz.peek.camp === "neutral" ? (
              <>
                belongs to <strong>neither camp</strong>.
              </>
            ) : (
              <>
                is a <CampWord camp={quiz.peek.camp} />.
              </>
            )}
          </p>
        </>
      )}

      <p className="mt-3 text-sm text-home-bg/70">
        {quiz.dazzled ? (
          <>Dazzled &mdash; you score nothing this round.</>
        ) : (
          <>
            <SoulCost value={`+${earned}`} label="SE" onLight />
            {quiz.doubled && <span className="ml-1">(doubled)</span>}
            {quiz.awarded === undefined && earned > 0 && (
              <span className="ml-1">when the round ends</span>
            )}
          </>
        )}
      </p>
    </ParchmentCard>
  );
}

function CampWord({ camp }: { camp: "vice" | "virtue" }) {
  return (
    <strong className={camp === "vice" ? "text-consultation-bg" : "text-consultation-fg"}>
      {camp === "vice" ? "Vice" : "Virtue"}
    </strong>
  );
}
