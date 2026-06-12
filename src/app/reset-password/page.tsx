"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, MotionConfig } from "framer-motion";
import { heading, CornerFrame } from "@/components/ui/royal";
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
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-5 bg-home-bg px-6 py-10 text-center text-cream">
      <motion.img
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        src="/logo.png?v=3"
        alt="Vice and Virtue"
        className="h-auto w-40 max-w-full drop-shadow-2xl"
      />

      {done ? (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="flex flex-col items-center gap-5"
        >
          <h1
            className={`text-2xl font-bold text-gold ${heading}`}
            style={{ textShadow: "0 0 18px rgba(227,181,16,.4)" }}
          >
            Password updated
          </h1>
          <p className="max-w-xs text-sm text-cream/80">
            Your new password is set and you&rsquo;re signed in.
          </p>
          <motion.button
            onClick={() => router.push("/")}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            className={`rounded-xl bg-gold px-4 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
          >
            Enter the castle
          </motion.button>
        </motion.div>
      ) : ready ? (
        <motion.form
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          onSubmit={handleSubmit}
          className="relative flex w-full max-w-xs flex-col gap-3 overflow-hidden rounded-2xl border-2 border-gold/50 bg-panel p-6 shadow-2xl"
        >
          <CornerFrame />
          <h1 className={`relative text-xl font-bold text-gold ${heading}`}>
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
          {error && <p className="relative text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className={`relative rounded-xl bg-gold px-4 py-3 font-semibold text-home-bg shadow-[0_0_14px_rgba(227,181,16,.3)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_22px_rgba(227,181,16,.5)] disabled:opacity-50 ${heading}`}
          >
            {busy ? "Saving…" : "Update password"}
          </button>
        </motion.form>
      ) : waited ? (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="flex flex-col items-center gap-5"
        >
          <h1 className={`text-2xl font-bold text-gold ${heading}`}>Link expired</h1>
          <p className="max-w-xs text-sm text-cream/80">
            This password reset link is invalid or has expired. Request a new
            one from the login screen.
          </p>
          <Link
            href="/"
            className={`rounded-xl bg-gold px-4 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
          >
            Back to home
          </Link>
        </motion.div>
      ) : (
        <p className="animate-pulse text-cream/70">Verifying your reset link…</p>
      )}
    </main>
    </MotionConfig>
  );
}
