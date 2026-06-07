"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/useAuth";
import { signOut } from "@/lib/auth";
import { AuthModal } from "./AuthModal";

// The account control shown under the logo on the home screen.
// Logged out: "Log in" + "Sign up". Logged in: an avatar + username chip
// (menu: Profile, Log out) with a separate "Friends" button below it.
export function AuthControl() {
  const { profile, loading } = useAuth();
  const [modalMode, setModalMode] = useState<"login" | "signup" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
  }

  // Avoid a flash of the logged-out buttons before the first auth check.
  if (loading) {
    return <div className="h-9" aria-hidden />;
  }

  return (
    <>
      {profile ? (
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full border border-gold/50 bg-home-bg/60 py-1 pl-1 pr-3 text-cream transition-colors hover:bg-cream/10"
            >
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold text-sm font-bold text-home-bg">
                  {profile.username.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="max-w-[8rem] truncate text-sm font-semibold">
                {profile.username}
              </span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 z-20 mt-2 w-40 overflow-hidden rounded-lg border border-gold/50 bg-home-bg shadow-xl">
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full px-4 py-2 text-left text-sm text-cream hover:bg-cream/10"
                >
                  Profile
                </Link>
                <button
                  onClick={handleSignOut}
                  className="block w-full px-4 py-2 text-left text-sm text-cream hover:bg-cream/10"
                >
                  Log out
                </button>
              </div>
            )}
          </div>

          {/* Friends — a separate button below the account/profile chip. */}
          <Link
            href="/friends"
            className="rounded-full border border-gold/50 bg-home-bg/60 px-4 py-1.5 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            Friends
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModalMode("login")}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            Log in
          </button>
          <button
            onClick={() => setModalMode("signup")}
            className="rounded-lg bg-gold px-3 py-1.5 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90"
          >
            Sign up
          </button>
        </div>
      )}

      {modalMode && (
        <AuthModal
          initialMode={modalMode}
          onClose={() => setModalMode(null)}
        />
      )}
    </>
  );
}
