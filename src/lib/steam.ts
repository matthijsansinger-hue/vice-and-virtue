// Steam desktop bridge (Step 3 — Steam Microtransactions).
//
// Real-money purchases happen ONLY inside the Steam client: the Electron shell
// injects `window.vvDesktop` (see desktop/preload.js). The public website has no
// such object, so isSteamClient() is false there and the Shop hides every
// real-money button — the web build never sells Mano.
//
// Flow (desktop): the web app calls steamPurchase(packageId) with the user's
// Supabase access token → the Electron main process drives the Steam overlay +
// our backend (which holds the Steam publisher key) → the backend credits Mano
// only after Steam confirms the charge. The client never credits anything.

import { supabase } from "./supabase";

type VVDesktop = {
  isDesktop?: boolean;
  platform?: string;
  steam?: {
    purchase?: (
      packageId: string,
      accessToken: string | null
    ) => Promise<{ ok: boolean; reason?: string }>;
    steamId?: () => Promise<string | null>;
    signIn?: () => Promise<{
      ok: boolean;
      reason?: string;
      tokenHash?: string;
      hasProfile?: boolean;
    }>;
    name?: () => Promise<string | null>;
  };
};

function desktop(): VVDesktop | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { vvDesktop?: VVDesktop }).vvDesktop;
}

// True only inside the Steam desktop client. The website returns false, so the
// real-money store is never rendered there.
export function isSteamClient(): boolean {
  return !!desktop()?.isDesktop;
}

// Start a Steam Microtransaction for a package id ("mano_450", "founder", ...).
// Resolves { ok: true } once Steam has confirmed and the backend credited the
// account; { ok: false } on the website, when signed out, or before the Steam
// backend is wired up.
export async function steamPurchase(
  packageId: string
): Promise<{ ok: boolean; reason?: string }> {
  const d = desktop();
  if (!d?.isDesktop || !d.steam?.purchase) return { ok: false, reason: "not_steam" };

  // Real-money purchases credit the signed-in account, so a session is required.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;
  if (!token) return { ok: false, reason: "signed_out" };

  try {
    return await d.steam.purchase(packageId, token);
  } catch {
    return { ok: false, reason: "error" };
  }
}

// Sign in with the player's Steam identity (Steam client only). The shell
// fetches a Steamworks auth ticket, the steam-auth Edge Function verifies it
// with Steam and returns a one-shot token we redeem for a Supabase session —
// so a Steam player never types an email or a password.
//
// Returns false (never throws) on the website, when Steam isn't running, or
// when the backend isn't deployed yet; ensureSession() then falls back to the
// normal anonymous-guest session, exactly as before.
export async function steamSignIn(): Promise<boolean> {
  const d = desktop();
  if (!d?.isDesktop || !d.steam?.signIn) return false;

  try {
    const res = await d.steam.signIn();
    if (!res?.ok || !res.tokenHash) return false;
    const { error } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: res.tokenHash,
    });
    return !error;
  } catch {
    return false;
  }
}

// The player's Steam persona name, or null outside the Steam client. Only used
// to pre-fill the username field — the account name is what they confirm.
export async function steamPersonaName(): Promise<string | null> {
  const d = desktop();
  if (!d?.isDesktop || !d.steam?.name) return null;
  try {
    return await d.steam.name();
  } catch {
    return null;
  }
}

// Squeeze a Steam persona name into our username rule (3-20 letters, digits or
// underscores). Returns "" when nothing usable is left, so the field just
// starts empty rather than pre-filled with something invalid.
export function usernameFromPersona(persona: string): string {
  const cleaned = persona.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20);
  return cleaned.length >= 3 ? cleaned : "";
}
