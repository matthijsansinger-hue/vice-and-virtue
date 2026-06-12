"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, MotionConfig } from "framer-motion";
import { heading } from "@/components/ui/royal";
import { useAuth } from "@/lib/useAuth";

// Landing page after a player clicks the email confirmation link. The
// Supabase client picks up the session from the URL automatically (so
// they arrive already signed in); we just show a friendly "you're in"
// state. If the session never establishes (e.g. an expired/used link),
// we fall back to a "please log in" message.
export default function WelcomePage() {
  const router = useRouter();
  const { profile, loading } = useAuth();
  // Give the client a moment to process the confirmation tokens in the
  // URL before deciding the link didn't work.
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const checking = loading || (!profile && !waited);

  return (
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-5 bg-home-bg px-6 py-10 text-center text-cream">
      <motion.img
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        src="/logo.png?v=3"
        alt="Vice and Virtue"
        className="h-auto w-44 max-w-full drop-shadow-2xl"
      />

      {checking ? (
        <p className="animate-pulse text-cream/70">Confirming your account…</p>
      ) : profile ? (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          className="flex flex-col items-center gap-5"
        >
          <h1
            className={`text-3xl font-bold text-gold ${heading}`}
            style={{ textShadow: "0 0 18px rgba(227,181,16,.4)" }}
          >
            You&rsquo;re in, {profile.username}!
          </h1>
          <p className="max-w-xs text-sm text-cream/80">
            Your account is confirmed and you&rsquo;re signed in. Create a room
            to host a game, or join one with a room code.
          </p>
          <div className="flex w-full max-w-xs flex-col gap-3">
            <motion.button
              onClick={() => router.push("/")}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className={`rounded-xl bg-gold px-4 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
            >
              Enter the castle
            </motion.button>
            <Link
              href="/profile"
              className={`rounded-xl border border-gold px-4 py-3 text-sm font-semibold text-cream transition-colors hover:bg-gold/10 ${heading}`}
            >
              Set up your profile
            </Link>
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          className="flex flex-col items-center gap-5"
        >
          <h1 className={`text-2xl font-bold text-gold ${heading}`}>
            Couldn&rsquo;t confirm
          </h1>
          <p className="max-w-xs text-sm text-cream/80">
            This confirmation link may have expired or already been used. Try
            logging in from the home screen.
          </p>
          <Link
            href="/"
            className={`rounded-xl bg-gold px-4 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
          >
            Back to home
          </Link>
        </motion.div>
      )}
    </main>
    </MotionConfig>
  );
}
