"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { IconArrowLeft } from "@tabler/icons-react";
import { heading } from "@/components/ui/royal";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { ProfileDashboard } from "@/components/ProfileDashboard";
import type { Profile } from "@/lib/types";

// Another player's profile — the same ProfileDashboard layout as your own, but
// read-only (no brush / no editing). Your own id renders the editable version.
export default function FriendProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userId = params.id;
  const { profile: me } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const isSelf = me?.id === userId;

  useEffect(() => {
    let active = true;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setProfile((data as Profile) ?? null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

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
        <p className="text-cream/80">That player could not be found.</p>
        <Link
          href="/friends"
          className={`rounded-xl bg-gold px-4 py-2 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
        >
          Back to friends
        </Link>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="wood-desk-startscreen min-h-screen bg-home-bg px-6 py-8 text-cream">
        <div className="mx-auto w-full max-w-5xl">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1 text-sm text-cream/70 transition-colors hover:text-cream"
          >
            <IconArrowLeft size={16} aria-hidden /> Back
          </button>
          <div className="mt-4">
            <ProfileDashboard profile={profile} editable={isSelf} />
          </div>
        </div>
      </main>
    </MotionConfig>
  );
}
