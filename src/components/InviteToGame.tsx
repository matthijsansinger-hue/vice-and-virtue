"use client";

import { useState } from "react";
import Link from "next/link";
import { getFriendData, sendGameInvite, type FriendEntry } from "@/lib/friends";
import { CharacterAvatar } from "./CharacterAvatar";

// "Invite a friend to this game" — a button (logged-in players only) that
// opens a picker of your friends and sends each a direct invite to this
// lobby. Invited friends see it on their start screen and can join.
export function InviteToGame({
  roomId,
  myUserId,
}: {
  roomId: string;
  myUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  async function openModal() {
    setOpen(true);
    if (friends === null) {
      setLoading(true);
      try {
        const data = await getFriendData(myUserId);
        setFriends(data.friends);
      } catch {
        setFriends([]);
      } finally {
        setLoading(false);
      }
    }
  }

  async function invite(friendId: string) {
    // Optimistic: mark invited immediately (re-sending is a harmless no-op).
    setInvited((s) => new Set(s).add(friendId));
    try {
      await sendGameInvite(roomId, friendId);
    } catch {
      // leave it marked; the invite simply may not have gone through
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="w-full max-w-sm rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
      >
        Invite a friend to this game
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-2xl border-2 border-gold bg-home-bg p-5 text-cream shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gold">Invite a friend</h3>
            <p className="mt-0.5 text-xs text-cream/50">
              They&rsquo;ll see your game on their start screen and can join.
            </p>

            {loading ? (
              <p className="mt-6 text-center text-sm text-cream/60">Loading…</p>
            ) : friends && friends.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-2">
                {friends.map((f) => {
                  const done = invited.has(f.profile.id);
                  return (
                    <li
                      key={f.friendshipId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-gold/20 bg-cream/5 px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <CharacterAvatar
                          character={f.profile.appearance}
                          initials={f.profile.username.charAt(0).toUpperCase()}
                          className="h-8 w-8"
                          textClass="text-sm"
                        />
                        <span className="min-w-0 truncate text-sm font-semibold">
                          {f.profile.username}
                        </span>
                      </span>
                      {done ? (
                        <span className="shrink-0 rounded-lg border border-gold/20 px-3 py-1.5 text-xs font-semibold text-cream/50">
                          Invited
                        </span>
                      ) : (
                        <button
                          onClick={() => invite(f.profile.id)}
                          className="shrink-0 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-home-bg transition-opacity hover:opacity-90"
                        >
                          Invite
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-6 text-center text-sm text-cream/60">
                No friends yet —{" "}
                <Link href="/friends" className="text-gold underline">
                  add some first
                </Link>
                .
              </p>
            )}

            <button
              onClick={() => setOpen(false)}
              className="mt-5 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
