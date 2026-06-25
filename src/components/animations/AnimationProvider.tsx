"use client";

// Provides useAbilityAnimation().play(name, opts) to anything inside it. A
// play() request enqueues a clip; the provider renders one CanvasClip at a time
// (z above the notices/popups) and resolves the play() promise when it ends, so
// callers can `await play(...)` then continue to their queued/result UI.
//
// Mounted in app/room/[code]/page.tsx wrapping the phase screen — so every
// ability component and the PhaseTransition stinger can reach it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CanvasClip } from "@/components/animations/CanvasClip";
import { getClip } from "@/lib/animations/registry";
import type { ClipConfig, ClipParams } from "@/lib/animations/engine";

type PlayOpts = { params?: ClipParams };
type Entry = {
  id: number;
  clip: ClipConfig;
  params: ClipParams;
  resolve: () => void;
};
type AnimationCtx = {
  play: (name: string | null | undefined, opts?: PlayOpts) => Promise<void>;
};

const NOOP: AnimationCtx = { play: () => Promise.resolve() };
const AnimationContext = createContext<AnimationCtx | null>(null);

// Safe outside a provider (returns a no-op) so ability components never crash.
export function useAbilityAnimation(): AnimationCtx {
  return useContext(AnimationContext) ?? NOOP;
}

export function AnimationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Entry[]>([]);
  const idRef = useRef(0);

  // The clips draw text in literal 'Cinzel'. The app self-hosts Cinzel under a
  // hashed next/font family name, so the literal name isn't available to
  // <canvas>. Link the CDN "Cinzel" face once (it's the real brand face the
  // clips were authored with). CanvasClip waits for it before the first frame.
  useEffect(() => {
    if (document.querySelector("link[data-vv-cinzel]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&display=swap";
    link.setAttribute("data-vv-cinzel", "");
    document.head.appendChild(link);
  }, []);

  const play = useCallback(
    (name: string | null | undefined, opts?: PlayOpts) => {
      const clip = name ? getClip(name) : undefined;
      if (!clip) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const id = ++idRef.current;
        setQueue((q) => [
          ...q,
          { id, clip, params: opts?.params ?? {}, resolve },
        ]);
      });
    },
    [],
  );

  const handleDone = useCallback(() => {
    setQueue((q) => {
      if (q.length === 0) return q;
      const [first, ...rest] = q;
      first.resolve();
      return rest;
    });
  }, []);

  const current = queue[0] ?? null;

  return (
    <AnimationContext.Provider value={{ play }}>
      {children}
      {current && (
        <CanvasClip
          key={current.id}
          clip={current.clip}
          params={current.params}
          onDone={handleDone}
        />
      )}
    </AnimationContext.Provider>
  );
}
