"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

  if (authLoading) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen items-center justify-center bg-home-bg text-cream">
        <p className="text-cream/70">Loading…</p>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center gap-4 bg-home-bg px-6 text-cream">
        <p className="text-cream/80">You need to be logged in to see friends.</p>
        <Link
          href="/"
          className="rounded-lg bg-gold px-4 py-2 font-semibold text-home-bg transition-opacity hover:opacity-90"
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
    <main className="wood-desk-startscreen min-h-screen bg-home-bg px-6 py-8 text-cream">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link href="/" className="text-sm text-cream/70 hover:text-cream">
          ← Back
        </Link>

        <h1 className="text-2xl font-semibold text-gold">Friends</h1>

        {error && <p className="text-center text-sm text-red-300">{error}</p>}

        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username"
            className="flex-1 rounded-lg border border-gold bg-cream px-4 py-2 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-lg bg-gold px-4 py-2 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Search
          </button>
        </form>

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
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-gold">Friend requests</h2>
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
          </section>
        )}

        {/* Outgoing requests */}
        {data && data.outgoing.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-gold">Sent requests</h2>
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
          </section>
        )}

        {/* Friends list */}
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-gold">
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
        </section>
      </div>
    </main>
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
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-bold text-home-bg">
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
    <div className="flex items-center justify-between gap-2 rounded-lg border border-gold/20 bg-cream/5 px-3 py-2">
      {href ? (
        <Link href={href} className="min-w-0 flex-1 hover:opacity-80">
          {identity}
        </Link>
      ) : (
        identity
      )}
      <div className="flex shrink-0 gap-2">{children}</div>
    </div>
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
        variant === "solid"
          ? "rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-home-bg transition-opacity hover:opacity-90"
          : "rounded-lg border border-gold/40 px-3 py-1.5 text-xs font-semibold text-cream transition-colors hover:bg-cream/10"
      }
    >
      {children}
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-lg border border-gold/30 px-3 py-1.5 text-xs font-semibold text-cream/60">
      {children}
    </span>
  );
}
