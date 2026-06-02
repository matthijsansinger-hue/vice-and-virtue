"use client";

import { useState } from "react";
import { signIn, signUp } from "@/lib/auth";

type Mode = "login" | "signup";

export function AuthModal({
  onClose,
  initialMode = "login",
  message,
}: {
  onClose: () => void;
  initialMode?: Mode;
  // Optional context line, e.g. "You need an account to create a room."
  message?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a successful sign-up we show a "check your email" state since
  // email confirmation is required before the first login.
  const [confirmSent, setConfirmSent] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await signIn({ email, password });
        onClose(); // auth state change updates the rest of the UI
      } else {
        await signUp({ email, username, password });
        setConfirmSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-gold bg-home-bg p-6 text-cream shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {confirmSent ? (
          <div className="flex flex-col gap-4 text-center">
            <h2 className="text-xl font-semibold text-gold">Check your email</h2>
            <p className="text-sm text-cream/80">
              We sent a confirmation link to{" "}
              <span className="font-semibold">{email}</span>. Click it to
              activate your account, then come back and log in.
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Got it
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => switchMode("login")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  mode === "login"
                    ? "bg-gold text-home-bg"
                    : "border border-gold/40 text-cream/70 hover:bg-cream/10"
                }`}
              >
                Log in
              </button>
              <button
                onClick={() => switchMode("signup")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  mode === "signup"
                    ? "bg-gold text-home-bg"
                    : "border border-gold/40 text-cream/70 hover:bg-cream/10"
                }`}
              >
                Sign up
              </button>
            </div>

            {message && (
              <p className="mb-4 rounded-lg border border-gold/30 bg-cream/5 px-3 py-2 text-sm text-cream/80">
                {message}
              </p>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                required
                className="rounded-lg border border-gold bg-cream px-4 py-3 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
              />

              {mode === "signup" && (
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  maxLength={20}
                  autoComplete="username"
                  required
                  className="rounded-lg border border-gold bg-cream px-4 py-3 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
                />
              )}

              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={6}
                className="rounded-lg border border-gold bg-cream px-4 py-3 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
              />

              {error && (
                <p className="text-center text-sm text-red-300">{error}</p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-1 rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy
                  ? "Please wait…"
                  : mode === "login"
                    ? "Log in"
                    : "Create account"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
