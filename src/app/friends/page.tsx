"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion, MotionConfig } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  CornerFrame,
  plaqueStyle,
  PlaqueLayers,
} from "@/components/ui/royal";
import { IconArrowLeft } from "@tabler/icons-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import {
  acceptRequest,
  getFriendData,
  removeFriendship,
  searchUsers,
  sendFriendRequest,
  type FriendData,
} from "@/lib/friends";
import type { Profile } from "@/lib/types";

export default function FriendsPage() {
  const { profile: me, loading: authLoading } = useAuth();

  const [data, setData] = useState<FriendData | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      setData(await getFriendData(me.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load friends.");
    }
  }, [me]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload when any friendship row involving anyone changes (low volume).
  useEffect(() => {
    if (!me) return;
    const channel = supabase
      .channel("friendships-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friendships" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me, load]);

  useEffect(() => {
    setCanShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function"
    );
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchUsers(query, me.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function act(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function copyInvite() {
    if (!me) return;
    const link = `${window.location.origin}/?invite=${me.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard can be blocked; ignore
    }
  }

  async function shareInvite() {
    if (!me) return;
    const link = `${window.location.origin}/?invite=${me.id}`;
    try {
      await navigator.share({
        title: "Vice and Virtue",
        text: "Add me as a friend on Vice and Virtue",
        url: link,
      });
    } catch {
      // user cancelled / unsupported; ignore
    }
  }

  if (authLoading) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen items-center justify-center bg-home-bg text-cream">
        <p className="animate-pulse text-cream/70">Loading…</p>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-4 bg-home-bg px-6 text-cream">
        <p className="text-cream/80">You need to be logged in to see friends.</p>
        <Link
          href="/"
          className={`rounded-xl bg-gold px-4 py-2 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
        >
          Back to home
        </Link>
      </main>
    );
  }

  // Relationship lookups so search results show the right action.
  const friendIds = new Set(data?.friends.map((f) => f.profile.id));
  const outgoingIds = new Set(data?.outgoing.map((r) => r.profile.id));
  const incomingById = new Map(
    data?.incoming.map((r) => [r.profile.id, r.friendshipId])
  );

  return (
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen min-h-screen bg-home-bg px-6 py-8 text-cream">
      <motion.div
        className="mx-auto flex w-full max-w-md flex-col gap-6"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.div variants={fadeUp}>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-cream/70 transition-colors hover:text-cream"
          >
            <IconArrowLeft size={16} aria-hidden /> Back
          </Link>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          className={`text-3xl font-bold tracking-wide text-gold ${heading}`}
        >
          Friends
        </motion.h1>

        {error && <p className="text-center text-sm text-red-300">{error}</p>}

        {/* Invite a friend by link */}
        <motion.section
          variants={fadeUp}
          className="relative flex flex-col gap-2 overflow-hidden rounded-xl border-2 border-gold/40 p-4"
          style={plaqueStyle()}
        >
          <PlaqueLayers />
          <CornerFrame />
          <h2 className={`relative text-lg font-semibold text-gold ${heading}`}>Invite a friend</h2>
          <p className="relative text-xs text-cream/60">
            Share this link — anyone who opens it and logs in is added to your
            friends instantly.
          </p>
          <div className="relative flex gap-2">
            <button
              onClick={copyInvite}
              className={`flex-1 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-home-bg shadow-[0_0_10px_rgba(227,181,16,.3)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_16px_rgba(227,181,16,.5)] ${heading}`}
            >
              {copied ? "Copied!" : "Copy invite link"}
            </button>
            {canShare && (
              <button
                onClick={shareInvite}
                className={`rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-gold/10 ${heading}`}
              >
                Share
              </button>
            )}
          </div>
        </motion.section>

        {/* Search */}
        <motion.form variants={fadeUp} onSubmit={handleSearch} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username"
            className="flex-1 rounded-lg border border-gold bg-cream px-4 py-2 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <button
            type="submit"
            disabled={searching}
            className={`rounded-lg bg-gold px-4 py-2 font-semibold text-home-bg shadow-[0_0_10px_rgba(227,181,16,.3)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_16px_rgba(227,181,16,.5)] disabled:opacity-50 ${heading}`}
          >
            Search
          </button>
        </motion.form>

        {results !== null && (
          <div className="flex flex-col gap-1">
            {results.length === 0 ? (
              <p className="text-sm text-cream/50">No players found.</p>
            ) : (
              results.map((p) => {
                const incomingFid = incomingById.get(p.id);
                return (
                  <Row key={p.id} profile={p}>
                    {friendIds.has(p.id) ? (
                      <Tag>Friends</Tag>
                    ) : outgoingIds.has(p.id) ? (
                      <Tag>Requested</Tag>
                    ) : incomingFid ? (
                      <ActBtn onClick={() => act(() => acceptRequest(incomingFid))}>
                        Accept
                      </ActBtn>
                    ) : (
                      <ActBtn
                        onClick={() =>
                          act(() => sendFriendRequest(me.id, p.id))
                        }
                      >
                        Add
                      </ActBtn>
                    )}
                  </Row>
                );
              })
            )}
          </div>
        )}

        {/* Incoming requests */}
        {data && data.incoming.length > 0 && (
          <motion.section variants={fadeUp} className="flex flex-col gap-2">
            <h2 className={`text-lg font-semibold text-gold ${heading}`}>Friend requests</h2>
            {data.incoming.map((r) => (
              <Row key={r.friendshipId} profile={r.profile}>
                <ActBtn onClick={() => act(() => acceptRequest(r.friendshipId))}>
                  Accept
                </ActBtn>
                <ActBtn
                  variant="ghost"
                  onClick={() => act(() => removeFriendship(r.friendshipId))}
                >
                  Decline
                </ActBtn>
              </Row>
            ))}
          </motion.section>
        )}

        {/* Outgoing requests */}
        {data && data.outgoing.length > 0 && (
          <motion.section variants={fadeUp} className="flex flex-col gap-2">
            <h2 className={`text-lg font-semibold text-gold ${heading}`}>Sent requests</h2>
            {data.outgoing.map((r) => (
              <Row key={r.friendshipId} profile={r.profile}>
                <ActBtn
                  variant="ghost"
                  onClick={() => act(() => removeFriendship(r.friendshipId))}
                >
                  Cancel
                </ActBtn>
              </Row>
            ))}
          </motion.section>
        )}

        {/* Friends list */}
        <motion.section variants={fadeUp} className="flex flex-col gap-2">
          <h2 className={`text-lg font-semibold text-gold ${heading}`}>
            Your friends{data ? ` (${data.friends.length})` : ""}
          </h2>
          {data && data.friends.length > 0 ? (
            data.friends.map((f) => (
              <Row
                key={f.friendshipId}
                profile={f.profile}
                href={`/profile/${f.profile.id}`}
                subtitle={`${f.gamesTogether} ${
                  f.gamesTogether === 1 ? "game" : "games"
                } together`}
              >
                <ActBtn
                  variant="ghost"
                  onClick={() => act(() => removeFriendship(f.friendshipId))}
                >
                  Remove
                </ActBtn>
              </Row>
            ))
          ) : (
            <p className="text-sm text-cream/50">
              No friends yet — search above to add some.
            </p>
          )}
        </motion.section>
      </motion.div>
    </main>
    </MotionConfig>
  );
}

// A row: avatar + username (+ optional subtitle), optionally a link,
// with action buttons on the right.
function Row({
  profile,
  subtitle,
  href,
  children,
}: {
  profile: Profile;
  subtitle?: string;
  href?: string;
  children?: React.ReactNode;
}) {
  const identity = (
    <div className="flex min-w-0 items-center gap-3">
      {profile.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.avatar_url}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-gold/40"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-bold text-home-bg ring-2 ring-gold/40">
          {profile.username.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-cream">
          {profile.username}
        </p>
        {subtitle && <p className="truncate text-xs text-cream/60">{subtitle}</p>}
      </div>
    </div>
  );

  return (
    <motion.div
      variants={fadeUp}
      className="flex items-center justify-between gap-2 rounded-xl border border-gold/30 bg-panel px-3 py-2.5 shadow-[0_2px_8px_rgba(0,0,0,.25)] transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,.35)]"
    >
      {href ? (
        <Link href={href} className="min-w-0 flex-1 transition-opacity hover:opacity-80">
          {identity}
        </Link>
      ) : (
        identity
      )}
      <div className="flex shrink-0 gap-2">{children}</div>
    </motion.div>
  );
}

function ActBtn({
  onClick,
  variant = "solid",
  children,
}: {
  onClick: () => void;
  variant?: "solid" | "ghost";
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        `text-xs font-semibold ${heading} ` +
        (variant === "solid"
          ? "rounded-lg bg-gold px-3 py-1.5 text-home-bg shadow-[0_0_8px_rgba(227,181,16,.25)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_14px_rgba(227,181,16,.45)]"
          : "rounded-lg border border-gold/40 px-3 py-1.5 text-cream transition-colors hover:bg-gold/10")
      }
    >
      {children}
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className={`rounded-lg border border-gold/30 px-3 py-1.5 text-xs font-semibold text-cream/60 ${heading}`}>
      {children}
    </span>
  );
}
