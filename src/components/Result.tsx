import Link from "next/link";
import { rankPlayers } from "@/lib/scoring";
import type { Player } from "@/lib/types";

// Turns 1, 2, 3... into "1st", "2nd", "3rd"...
function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

// The scoreboard shown after the minigame.
export function Result({
  players,
  myPlayer,
}: {
  players: Player[];
  myPlayer: Player | null;
}) {
  const ranked = rankPlayers(players);
  const mine = ranked.find((r) => r.player.id === myPlayer?.id) ?? null;

  return (
    <main className="flex min-h-screen flex-col items-center bg-home-bg px-6 py-12 text-cream">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-sm uppercase tracking-widest text-gold">
          Reflection &mdash; results
        </h1>

        {mine && (
          <div className="mt-4 rounded-xl border border-gold bg-cream p-6 text-center text-home-bg">
            <p className="text-sm text-home-bg/60">You finished</p>
            <p className="mt-1 text-4xl font-semibold">{ordinal(mine.rank)}</p>
            <p className="mt-3 text-sm text-home-bg/60">Soul Energy earned</p>
            <p className="text-2xl font-semibold">{mine.soulEnergy}</p>
          </div>
        )}

        <h2 className="mt-8 text-sm uppercase tracking-widest text-gold">
          Scoreboard
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {ranked.map(({ player, rank, soulEnergy }) => {
            const isMe = player.id === myPlayer?.id;
            return (
              <li
                key={player.id}
                className={
                  "flex items-center justify-between rounded-lg bg-cream px-4 py-3 text-home-bg " +
                  (isMe ? "border-2 border-gold" : "border border-gold/40")
                }
              >
                <span className="flex items-center gap-3">
                  <span className="w-6 text-right font-semibold text-home-bg/60">
                    {rank}
                  </span>
                  <span>
                    {player.name}
                    {isMe && (
                      <span className="ml-2 text-xs text-home-bg/50">
                        (you)
                      </span>
                    )}
                  </span>
                </span>
                <span className="font-semibold">{soulEnergy}</span>
              </li>
            );
          })}
        </ul>

        <p className="mt-8 text-center text-sm text-cream/60">
          Day 1 complete. Outreach and consultation come in a later build.
        </p>
        <div className="mt-4 text-center">
          <Link href="/" className="text-gold underline">
            Back to start
          </Link>
        </div>
      </div>
    </main>
  );
}
