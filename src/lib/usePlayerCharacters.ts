"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import {
  normalizeCharacter,
  randomCharacter,
  type CharacterConfig,
} from "./character";
import type { Player } from "./types";

// Each player's character avatar, by player id. Account players get the
// character from their profile (or, if they never customised it, the same
// random default the hub shows them); bots and guests get a random one keyed
// by their seat, so everyone on the castle map has a face. An account
// player's entry is null until their profile has loaded (the avatar shows
// their initial meanwhile), so a customised face never flashes a default.
export function usePlayerCharacters(
  players: Player[]
): Record<string, CharacterConfig | null> {
  const [byUser, setByUser] = useState<Record<string, CharacterConfig>>({});
  const userKey = [
    ...new Set(players.map((p) => p.user_id).filter((x): x is string => !!x)),
  ]
    .sort()
    .join(",");

  useEffect(() => {
    if (!userKey) return;
    let active = true;
    const ids = userKey.split(",");
    supabase
      .from("profiles")
      .select("id, appearance")
      .in("id", ids)
      .then(({ data, error }) => {
        if (!active || error) return;
        const rows = new Map((data ?? []).map((r) => [r.id as string, r.appearance]));
        const next: Record<string, CharacterConfig> = {};
        for (const id of ids) {
          const appearance = rows.get(id);
          next[id] = appearance ? normalizeCharacter(appearance) : randomCharacter(id);
        }
        setByUser(next);
      });
    return () => {
      active = false;
    };
  }, [userKey]);

  return useMemo(() => {
    const out: Record<string, CharacterConfig | null> = {};
    for (const p of players) {
      out[p.id] = p.user_id ? byUser[p.user_id] ?? null : randomCharacter(p.id);
    }
    return out;
  }, [players, byUser]);
}
