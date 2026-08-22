// Account operations: sign up, log in, log out, and reading your own
// profile. Built on Supabase Auth (email + password, with email
// confirmation). The session is persisted in the browser by the shared
// Supabase client, so a logged-in user stays logged in across visits.

import { supabase } from "./supabase";
import { containsProfanity } from "./profanity";
import { identifyUser, trackAccountCreated } from "./analytics";
import { withDefaultCharacter } from "./character";
import { isSteamClient, steamSignIn } from "./steam";
import type { Profile } from "./types";

// Usernames: 3-20 chars, letters/numbers/underscore. Keeps display
// names readable and avoids spaces that would break "1. Alex" indexing.
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function validateUsername(username: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return "Username must be 3–20 letters, numbers, or underscores.";
  }
  if (containsProfanity(username)) {
    return "Please choose a different username.";
  }
  return null;
}

// Is this username free? Case-insensitive (matches the DB unique index).
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw error;
  return data === null;
}

// Sign up with email + username + password. Because email confirmation
// is on, there is NO session yet on success — the caller should tell the
// user to check their email. The profile row is created automatically by
// the on_auth_user_created trigger from the username in metadata.
export async function signUp(args: {
  email: string;
  username: string;
  password: string;
}): Promise<void> {
  const username = args.username.trim();
  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);

  if (!(await isUsernameAvailable(username))) {
    throw new Error("That username is already taken.");
  }

  const { data, error } = await supabase.auth.signUp({
    email: args.email.trim(),
    password: args.password,
    options: {
      // The username the trigger reads to build the profile row.
      data: { username },
      // After the user clicks the confirmation link, Supabase redirects
      // to /welcome; the client picks up the session from the URL there
      // and shows a "you're in" welcome state.
      emailRedirectTo:
        typeof window !== "undefined"
          ? `${window.location.origin}/welcome`
          : undefined,
    },
  });
  if (error) throw error;

  // Analytics: tie the new account to its UUID (never email/username) and
  // record the signup once, at account creation.
  if (data.user) identifyUser(data.user.id);
  trackAccountCreated();
}

// Log in with email + password.
export async function signIn(args: {
  email: string;
  password: string;
}): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: args.email.trim(),
    password: args.password,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Send a password-reset email. The link lands on /reset-password where
// the client establishes a recovery session and the user sets a new
// password. (Supabase returns success even for unknown emails, to avoid
// leaking which addresses are registered.)
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo:
      typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : undefined,
  });
  if (error) throw error;
}

// Set a new password for the currently-authenticated (recovery) session.
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// Ensure every visitor has a Supabase session so the server can bind actions to
// auth.uid(). In order of preference: a real account when logged in, the
// player's STEAM identity in the Steam client, otherwise an ANONYMOUS session
// (untrusted-client / Steam hardening). No-op if a real session already exists;
// safe to call repeatedly. If anonymous sign-ins aren't enabled yet (Supabase
// dashboard → Authentication → Sign In / Providers → Anonymous), this leaves the
// visitor session-less instead of throwing, so the app keeps working exactly as
// before until the enforcement phases land.
// Callers overlap on boot (useAuth's initial load + its onAuthStateChange
// listener, and room.ts), so share one in-flight attempt. Without this, two
// parallel runs each start a Steam ticket request and Steam answers only one —
// the other rejects with "channel closed".
let sessionFlight: Promise<void> | null = null;

export async function ensureSession(): Promise<void> {
  if (sessionFlight) return sessionFlight;
  sessionFlight = runEnsureSession().finally(() => {
    sessionFlight = null;
  });
  return sessionFlight;
}

async function runEnsureSession(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    // A real account (email/password OR a previous Steam sign-in) always wins —
    // never override a session the player chose.
    if (session && !session.user.is_anonymous) return;

    // Steam client: upgrade to the player's Steam account. An anonymous session
    // from an earlier launch is left in place until verifyOtp replaces it, so a
    // failed sign-in (Steam not running) can't strand the player without one.
    if (isSteamClient() && (await steamSignIn())) return;

    if (session) return;
    await supabase.auth.signInAnonymously();
  } catch {
    /* anonymous sign-ins disabled, or offline — continue as a pre-auth guest */
  }
}

// Claim the username for an account that doesn't have one yet — the Steam
// first-launch step. The RPC (db/110) is the authority: it enforces the format,
// creates the profile + economy + ranked rows, and lets the unique index settle
// races that a client-side availability check can lose.
export async function setUsername(username: string): Promise<void> {
  const name = username.trim();
  const usernameError = validateUsername(name);
  if (usernameError) throw new Error(usernameError);

  const { data, error } = await supabase.rpc("set_username", {
    p_username: name,
  });
  if (error) throw error;

  const res = data as { ok: boolean; reason?: string } | null;
  if (!res?.ok) {
    throw new Error(
      res?.reason === "taken"
        ? "That username is already taken."
        : res?.reason === "invalid"
          ? "Username must be 3–20 letters, numbers, or underscores."
          : res?.reason === "has_profile"
            ? "This account already has a username."
            : "Could not set that username. Please try again."
    );
  }

  // Same analytics as a web sign-up: identify by UUID only, count the account.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) identifyUser(user.id);
  trackAccountCreated();
}

// The currently logged-in user's profile, or null if signed out.
export async function getMyProfile(): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data ? withDefaultCharacter(data as Profile) : null;
}
