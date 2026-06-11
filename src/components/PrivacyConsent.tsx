"use client";

// Site-entry privacy gate: a small box that animates in on first visit with a
// short summary of the privacy notice and a link to the full one. The visitor
// must agree to enter. The choice is remembered per-device in localStorage so
// it only shows once. The /privacy page itself is never gated, so the box's
// link stays readable.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const CONSENT_KEY = "vv_privacy_consent_v1";

export function PrivacyConsent() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [shown, setShown] = useState(false); // drives the enter animation

  useEffect(() => {
    // Never gate the privacy notice page itself — it must stay readable from
    // the box's link (which opens it in a new tab).
    if (pathname === "/privacy") return;
    let consented = false;
    try {
      consented = localStorage.getItem(CONSENT_KEY) === "1";
    } catch {
      // localStorage blocked — show the box to be safe.
    }
    if (!consented) setShow(true);
  }, [pathname]);

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShown(true), 10);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;

  function accept() {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      // ignore; the box will just reappear next time
    }
    setShow(false);
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-consent-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gold/50 bg-home-bg p-6 text-cream shadow-2xl"
        style={{
          transform: shown
            ? "translateY(0) scale(1)"
            : "translateY(10px) scale(0.97)",
          opacity: shown ? 1 : 0,
          transition: "transform 260ms ease, opacity 260ms ease",
        }}
      >
        <h2
          id="privacy-consent-title"
          className="text-lg font-semibold text-gold"
        >
          Before you enter
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-cream/85">
          Vice and Virtue stores what it needs to run the game — your account
          (email &amp; password), your gameplay and chat, and an avatar if you
          add one — and uses privacy-friendly analytics (no ads, no tracking
          cookies). Game rooms and chat are deleted automatically after about 24
          hours.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-cream/85">
          By entering, you confirm you have read and agree to our{" "}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-gold underline"
          >
            Privacy Notice
          </Link>
          .
        </p>
        <button
          onClick={accept}
          className="mt-5 w-full rounded-xl bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          I agree — enter
        </button>
      </div>
    </div>
  );
}
