// Account operations: sign up, log in, log out, and reading your own
// profile. Built on Supabase Auth (email + password, with email
// confirmation). The session is persisted in the browser by the shared
// Supabase client, so a logged-in user stays logged in across visits.

import { supabase } from "./supabase";
import { containsProfanity } from "./profanity";
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

  const { error } = await supabase.auth.signUp({
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
  return (data as Profile) ?? null;
}
