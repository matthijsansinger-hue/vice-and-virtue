"use client";

import { useEffect, useState } from "react";
import { IconBrandSteam } from "@tabler/icons-react";
import { heading } from "@/components/ui/royal";
import { isSteamClient } from "@/lib/steam";

// Steam store page for the app (STEAM_APP_ID 5077460).
export const STEAM_STORE_URL = "https://store.steampowered.com/app/5077460/";

const DISMISS_KEY = "vv_wishlist_dismissed";

// "Wishlist on Steam" prompt, shown in the hub and after a game.
//
// Hidden inside the Steam client itself — someone playing the Steam build has
// already found it, and asking them to wishlist a game they're running reads as
// broken. Dismissal is remembered per device so it asks once, not every match.
export function WishlistPrompt({
  variant = "card",
  className = "",
}: {
  variant?: "card" | "inline";
  className?: string;
}) {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isSteamClient()) return; // already ours
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* private mode — just show it */
    }
    setHidden(false);
  }, []);

  function dismiss() {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to remember it with; it'll ask again */
    }
  }

  if (hidden) return null;

  const link = (
    <a
      href={STEAM_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={dismiss}
      className={`inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 ${heading}`}
    >
      <IconBrandSteam size={18} aria-hidden />
      Wishlist on Steam
    </a>
  );

  if (variant === "inline") {
    return (
      <div className={`flex flex-wrap items-center justify-center gap-2 ${className}`}>
        {link}
        <button
          onClick={dismiss}
          className="text-xs text-cream/50 underline transition-colors hover:text-cream/80"
        >
          Not now
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-gold/40 bg-black/25 p-4 text-center ${className}`}
    >
      <p className={`text-sm font-semibold text-gold ${heading}`}>
        Coming to Steam
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-cream/70">
        Wishlist it and you&rsquo;ll be told the moment it launches — and
        everyone who signs up before release keeps the Founder badge.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {link}
        <button
          onClick={dismiss}
          className="text-xs text-cream/50 underline transition-colors hover:text-cream/80"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
