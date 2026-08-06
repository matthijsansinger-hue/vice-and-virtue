"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn, signUp, requestPasswordReset } from "@/lib/auth";
import { PasswordField } from "./PasswordField";

type Mode = "login" | "signup" | "reset";

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
  const [confirmPassword, setConfirmPassword] = useState("");
  // One-time privacy-notice consent, required to create an account (there's no
  // longer a site-entry consent gate — see PrivacyConsent removal).
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a successful sign-up we show a "check your email" state since
  // email confirmation is required before the first login.
  const [confirmSent, setConfirmSent] = useState(false);
  // After requesting a password reset, show a "check your email" state.
  const [resetSent, setResetSent] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setConfirmPassword("");
    setAgreed(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (mode === "signup" && !agreed) {
      setError("Please agree to the Privacy Notice to create an account.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await signIn({ email, password });
        onClose(); // auth state change updates the rest of the UI
      } else if (mode === "signup") {
        await signUp({ email, username, password });
        setConfirmSent(true);
      } else {
        await requestPasswordReset(email);
        setResetSent(true);
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
              activate your account — you&rsquo;ll be signed in automatically.
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Got it
            </button>
          </div>
        ) : resetSent ? (
          <div className="flex flex-col gap-4 text-center">
            <h2 className="text-xl font-semibold text-gold">Check your email</h2>
            <p className="text-sm text-cream/80">
              If an account exists for{" "}
              <span className="font-semibold">{email}</span>, we&rsquo;ve sent a
              password reset link. Open it to choose a new password.
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
            {mode === "reset" ? (
              <div className="mb-4">
                <h2 className="text-xl font-semibold text-gold">
                  Reset your password
                </h2>
                <p className="mt-1 text-sm text-cream/70">
                  Enter your email and we&rsquo;ll send a reset link.
                </p>
              </div>
            ) : (
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
            )}

            {message && mode !== "reset" && (
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

              {mode !== "reset" && (
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder="Password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={6}
                />
              )}

              {mode === "signup" && (
                <PasswordField
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  minLength={6}
                />
              )}

              {mode === "signup" && (
                <label className="flex items-start gap-2.5 text-xs leading-relaxed text-cream/80">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
                  />
                  <span>
                    I have read and agree to the{" "}
                    <Link
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-gold underline"
                    >
                      Privacy Notice
                    </Link>
                    .
                  </span>
                </label>
              )}

              {error && (
                <p className="text-center text-sm text-red-300">{error}</p>
              )}

              <button
                type="submit"
                disabled={busy || (mode === "signup" && !agreed)}
                className="mt-1 rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy
                  ? "Please wait…"
                  : mode === "login"
                    ? "Log in"
                    : mode === "signup"
                      ? "Create account"
                      : "Send reset link"}
              </button>
            </form>

            {mode === "login" && (
              <button
                onClick={() => switchMode("reset")}
                className="mt-3 w-full text-center text-sm text-cream/70 underline transition-colors hover:text-cream"
              >
                Forgot password?
              </button>
            )}
            {mode === "reset" && (
              <button
                onClick={() => switchMode("login")}
                className="mt-3 w-full text-center text-sm text-cream/70 underline transition-colors hover:text-cream"
              >
                ← Back to log in
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
