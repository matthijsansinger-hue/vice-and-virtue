"use client";

import { useState } from "react";
import { useAuth } from "@/lib/useAuth";
import { signOut } from "@/lib/auth";
import { AuthModal } from "./AuthModal";

// The login / sign-up control shown in the top-right of the home screen.
// Logged out: "Log in" + "Sign up" buttons. Logged in: avatar initial +
// username with a small menu (Log out for now; Profile arrives in a
// later batch).
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
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-full border border-gold/50 bg-home-bg/60 py-1 pl-1 pr-3 text-cream transition-colors hover:bg-cream/10"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold text-sm font-bold text-home-bg">
              {profile.username.charAt(0).toUpperCase()}
            </span>
            <span className="max-w-[8rem] truncate text-sm font-semibold">
              {profile.username}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-40 overflow-hidden rounded-lg border border-gold/50 bg-home-bg shadow-xl">
              <button
                onClick={handleSignOut}
                className="block w-full px-4 py-2 text-left text-sm text-cream hover:bg-cream/10"
              >
                Log out
              </button>
            </div>
          )}
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
