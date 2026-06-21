"use client";

import Link from "next/link";
import { MotionConfig } from "framer-motion";
import { IconArrowLeft } from "@tabler/icons-react";
import { heading } from "@/components/ui/royal";
import { useAuth } from "@/lib/useAuth";
import { ProfileDashboard } from "@/components/ProfileDashboard";

// The standalone /profile route — just a page frame around the shared, fully
// editable ProfileDashboard (the same one the hub's Profile tab renders).
export default function ProfilePage() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen items-center justify-center bg-home-bg text-cream">
        <p className="animate-pulse text-cream/70">Loading…</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-4 bg-home-bg px-6 text-cream">
        <p className="text-cream/80">You need to be logged in to see your profile.</p>
        <Link
          href="/"
          className={`rounded-xl bg-gold px-4 py-2 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
        >
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="wood-desk-startscreen min-h-screen bg-home-bg px-6 py-8 text-cream">
        <div className="mx-auto w-full max-w-5xl">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-cream/70 transition-colors hover:text-cream"
          >
            <IconArrowLeft size={16} aria-hidden /> Back
          </Link>
          <div className="mt-4">
            <ProfileDashboard profile={profile} />
          </div>
        </div>
      </main>
    </MotionConfig>
  );
}
