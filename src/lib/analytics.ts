// Privacy-respecting product analytics (PostHog).
//
// Design notes:
// - Initialized once from src/instrumentation-client.ts (before hydration).
// - Privacy by construction: EU cloud, NO session recording, NO autocapture,
//   localStorage persistence (no tracking cookies), person profiles only for
//   identified accounts. We identify accounts by their Supabase UUID only —
//   never email or username. Guests keep PostHog's random device id (which is
//   what makes retention work without any PII).
// - If NEXT_PUBLIC_POSTHOG_KEY is unset (e.g. local dev), every function here
//   is a no-op, so the app runs identically without analytics.
// - This module is the single source of truth for event names + properties so
//   they stay consistent. Call the typed track* helpers, never posthog.capture
//   directly.

import posthog from "posthog-js";

// Canonical event names. Snake_case, matching the agreed funnel spec.
export const ANALYTICS_EVENTS = {
  accountCreated: "account_created",
  friendAdded: "friend_added",
  inviteSent: "invite_sent",
  inviteAccepted: "invite_accepted",
  gameStarted: "game_started",
  gameCompleted: "game_completed",
  playersPerGame: "players_per_game",
} as const;

// Where an invite came from. Room = lobby code/link sharing; friend = a
// friend request. Sent as the `invite_type` property.
export type InviteType = "room" | "friend";

let ready = false;

// Initialize PostHog. Safe to call more than once; only the first call inits.
// No-ops when no key is configured so the app works without analytics.
export function initAnalytics(): void {
  if (ready || typeof window === "undefined") return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
  if (!key) return; // analytics disabled (no key)

  posthog.init(key, {
    api_host: host,
    // Only create person profiles for logged-in accounts; anonymous guests
    // stay anonymous (still counted for retention via their device id).
    person_profiles: "identified_only",
    // We only send the events we explicitly define below + manual pageviews.
    autocapture: false,
    capture_pageview: false,
    // The most privacy-sensitive feature — keep it off.
    disable_session_recording: true,
    // No tracking cookies; the device id lives in localStorage only.
    persistence: "localStorage",
  });

  ready = true;
}

// Whether the app is running as an installed PWA vs a browser tab. Useful,
// non-identifying context for the `platform` property.
function platform(): "pwa" | "web" {
  if (typeof window === "undefined") return "web";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    // iOS Safari home-screen apps
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
      true;
  return standalone ? "pwa" : "web";
}

// Internal: capture with the no-op guard. PostHog adds the timestamp,
// anonymous/session ids, $os/$browser automatically — we don't resend those.
function capture(event: string, props?: Record<string, unknown>): void {
  if (!ready) return;
  posthog.capture(event, props);
}

// --- Identity (accounts only; by UUID, never PII) ---

export function identifyUser(userId: string): void {
  if (!ready) return;
  posthog.identify(userId);
}

export function resetUser(): void {
  if (!ready) return;
  posthog.reset();
}

// --- Pageviews (manual; called from instrumentation-client) ---

export function capturePageview(path?: string): void {
  if (!ready || typeof window === "undefined") return;
  const url = path
    ? path.startsWith("http")
      ? path
      : window.location.origin + path
    : window.location.href;
  posthog.capture("$pageview", { $current_url: url });
}

// --- Funnel events ---

export function trackAccountCreated(): void {
  capture(ANALYTICS_EVENTS.accountCreated, { platform: platform() });
}

export function trackFriendAdded(): void {
  capture(ANALYTICS_EVENTS.friendAdded, { platform: platform() });
}

export function trackInviteSent(inviteType: InviteType, gameId?: string): void {
  capture(ANALYTICS_EVENTS.inviteSent, {
    invite_type: inviteType,
    ...(gameId ? { game_id: gameId } : {}),
    platform: platform(),
  });
}

export function trackInviteAccepted(
  inviteType: InviteType,
  gameId?: string
): void {
  capture(ANALYTICS_EVENTS.inviteAccepted, {
    invite_type: inviteType,
    ...(gameId ? { game_id: gameId } : {}),
    platform: platform(),
  });
}

export function trackGameStarted(p: {
  gameId: string;
  playerCount: number;
  isPublic: boolean;
}): void {
  capture(ANALYTICS_EVENTS.gameStarted, {
    game_id: p.gameId,
    player_count: p.playerCount,
    visibility: p.isPublic ? "public" : "private",
    platform: platform(),
  });
  // Dedicated metric event so "average players per game" is a one-click
  // PostHog insight (average of player_count on this event).
  capture(ANALYTICS_EVENTS.playersPerGame, {
    game_id: p.gameId,
    player_count: p.playerCount,
    visibility: p.isPublic ? "public" : "private",
  });
}

export function trackGameCompleted(p: {
  gameId: string;
  playerCount: number;
  isPublic: boolean;
  day: number;
}): void {
  capture(ANALYTICS_EVENTS.gameCompleted, {
    game_id: p.gameId,
    player_count: p.playerCount,
    visibility: p.isPublic ? "public" : "private",
    day_reached: p.day,
    platform: platform(),
  });
}
