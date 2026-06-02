"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { updatePassword } from "@/lib/auth";
import { PasswordField } from "@/components/PasswordField";

// Landing page for the password-reset email link. Supabase establishes a
// short-lived recovery session from the link automatically; once it's
// present we let the user choose a new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [waited, setWaited] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) setReady(true);
    });
    // The recovery session may land a moment after page load.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) setReady(true);
    });
    const t = setTimeout(() => active && setWaited(true), 2500);
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-5 bg-home-bg px-6 py-10 text-center text-cream">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png?v=3"
        alt="Vice and Virtue"
        className="h-auto w-40 max-w-full drop-shadow-2xl"
      />

      {done ? (
        <>
          <h1 className="text-2xl font-semibold text-gold">Password updated</h1>
          <p className="max-w-xs text-sm text-cream/80">
            Your new password is set and you&rsquo;re signed in.
          </p>
          <button
            onClick={() => router.push("/")}
            className="rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
          >
            Enter the castle
          </button>
        </>
      ) : ready ? (
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-xs flex-col gap-3"
        >
          <h1 className="text-2xl font-semibold text-gold">
            Choose a new password
          </h1>
          <PasswordField
            value={password}
            onChange={setPassword}
            placeholder="New password"
            autoComplete="new-password"
            minLength={6}
          />
          <PasswordField
            value={confirm}
            onChange={setConfirm}
            placeholder="Confirm new password"
            autoComplete="new-password"
            minLength={6}
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      ) : waited ? (
        <>
          <h1 className="text-2xl font-semibold text-gold">Link expired</h1>
          <p className="max-w-xs text-sm text-cream/80">
            This password reset link is invalid or has expired. Request a new
            one from the login screen.
          </p>
          <Link
            href="/"
            className="rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
          >
            Back to home
          </Link>
        </>
      ) : (
        <p className="text-cream/70">Verifying your reset link…</p>
      )}
    </main>
  );
}
