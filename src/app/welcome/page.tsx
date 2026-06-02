"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-5 bg-home-bg px-6 py-10 text-center text-cream">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png?v=3"
        alt="Vice and Virtue"
        className="h-auto w-44 max-w-full drop-shadow-2xl"
      />

      {checking ? (
        <p className="text-cream/70">Confirming your account…</p>
      ) : profile ? (
        <>
          <h1 className="text-2xl font-semibold text-gold">
            You&rsquo;re in, {profile.username}!
          </h1>
          <p className="max-w-xs text-sm text-cream/80">
            Your account is confirmed and you&rsquo;re signed in. Create a room
            to host a game, or join one with a room code.
          </p>
          <div className="flex w-full max-w-xs flex-col gap-3">
            <button
              onClick={() => router.push("/")}
              className="rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Enter the castle
            </button>
            <Link
              href="/profile"
              className="rounded-lg border border-gold px-4 py-3 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
            >
              Set up your profile
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-gold">
            Couldn&rsquo;t confirm
          </h1>
          <p className="max-w-xs text-sm text-cream/80">
            This confirmation link may have expired or already been used. Try
            logging in from the home screen.
          </p>
          <Link
            href="/"
            className="rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
          >
            Back to home
          </Link>
        </>
      )}
    </main>
  );
}
