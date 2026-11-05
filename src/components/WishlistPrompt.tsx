"use client";

import { useEffect, useState } from "react";
import { IconBrandSteam, IconX } from "@tabler/icons-react";
import { heading } from "@/components/ui/royal";
import { isSteamClient } from "@/lib/steam";

// Steam store page for the app (STEAM_APP_ID 5077460).
export const STEAM_STORE_URL = "https://store.steampowered.com/app/5077460/";

const DISMISS_KEY = "vv_wishlist_dismissed";
// The hub mounts two instances (a card on mobile, a bar on desktop); dismissing
// one hides the other too.
const DISMISS_EVENT = "vv-wishlist-dismissed";

// "Wishlist on Steam" prompt, shown in the hub and after a game.
//
// Hidden inside the Steam client itself — someone playing the Steam build has
// already found it, and asking them to wishlist a game they're running reads as
// broken. Dismissal is remembered per device so it asks once, not every match.
//
// "bar" is a slim one-row version (the desktop hub, beside the season ribbon);
// its className must set the display (e.g. "hidden lg:flex").
export function WishlistPrompt({
  variant = "card",
  className = "",
}: {
  variant?: "card" | "inline" | "bar";
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
    const onDismissed = () => setHidden(true);
    window.addEventListener(DISMISS_EVENT, onDismissed);
    return () => window.removeEventListener(DISMISS_EVENT, onDismissed);
  }, []);

  function dismiss() {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to remember it with; it'll ask again */
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
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

  if (variant === "bar") {
    return (
      <div className={`items-center gap-3 rounded-xl border border-gold/40 bg-black/35 px-3 py-2 ${className}`}>
        <IconBrandSteam size={26} className="shrink-0 text-gold" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-semibold text-gold ${heading}`}>Coming to Steam</p>
          <p className="truncate text-[11px] text-cream/65">Wishlist it to hear when it&rsquo;s out.</p>
        </div>
        <a
          href={STEAM_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
          className={`shrink-0 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-home-bg transition-opacity hover:opacity-90 ${heading}`}
        >
          Wishlist
        </a>
        <button
          onClick={dismiss}
          aria-label="Not now"
          title="Not now"
          className="shrink-0 rounded-lg p-1 text-cream/50 transition-colors hover:bg-cream/10 hover:text-cream"
        >
          <IconX size={16} aria-hidden />
        </button>
      </div>
    );
  }

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
