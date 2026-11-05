// A small device-remembered string (localStorage) as React state, read with
// useSyncExternalStore: no setState-in-effect, no hydration mismatch (the
// server snapshot is null), and every component using the same key stays in
// sync. If storage is unavailable (private mode) the value lives in memory for
// the session instead of silently refusing to change.

"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "vv-stored-string";
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function useStoredString(key: string): [string | null, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null
  );
  const set = useCallback(
    (next: string) => {
      memory.set(key, next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* memory copy above keeps it for this session */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key]
  );
  return [value, set];
}
