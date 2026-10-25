// Premade Outreach sentences (migration 129). Camps only — no role claims.
// The server stores the MEANING ({s, about}) on dm_messages.payload and also
// renders a plain-text copy; live clients render from the payload with their
// own display names so an Envy swap still reads correctly. Bots understand only
// these; humans can use them with anyone, next to free text.
//
// Keep the keys + wording in sync with vv_sentence_text in the migration.

import { supabase } from "./supabase";

export type SentenceKey =
  | "claim_vice"
  | "claim_virtue"
  | "self_virtue"
  | "self_vice"
  | "suspect"
  | "trust"
  | "vote"
  | "ask_suspect"
  | "ask_side"
  | "believe"
  | "disbelieve"
  | "check"
  | "no_idea";

export type SentencePayload = { s: SentenceKey; about?: string | null };

type SentenceDef = {
  key: SentenceKey;
  // Shown on the picker chip; "…" marks where the chosen player goes.
  label: string;
  needsPlayer: boolean;
  render: (about: string) => string;
};

export const SENTENCE_GROUPS: { title: string; items: SentenceDef[] }[] = [
  {
    title: "Claims",
    items: [
      { key: "claim_vice", label: "… is a Vice.", needsPlayer: true, render: (a) => `${a} is a Vice.` },
      { key: "claim_virtue", label: "… is a Virtue.", needsPlayer: true, render: (a) => `${a} is a Virtue.` },
      { key: "self_virtue", label: "I'm a Virtue.", needsPlayer: false, render: () => "I'm a Virtue." },
      { key: "self_vice", label: "I'm a Vice.", needsPlayer: false, render: () => "I'm a Vice." },
    ],
  },
  {
    title: "Opinions",
    items: [
      { key: "suspect", label: "I suspect …", needsPlayer: true, render: (a) => `I suspect ${a}.` },
      { key: "trust", label: "I trust …", needsPlayer: true, render: (a) => `I trust ${a}.` },
      { key: "vote", label: "Let's vote … out.", needsPlayer: true, render: (a) => `Let's vote ${a} out.` },
    ],
  },
  {
    title: "Questions",
    items: [
      { key: "ask_suspect", label: "Who do you suspect?", needsPlayer: false, render: () => "Who do you suspect?" },
      { key: "ask_side", label: "Which side are you on?", needsPlayer: false, render: () => "Which side are you on?" },
    ],
  },
  {
    title: "Replies",
    items: [
      { key: "believe", label: "I believe you.", needsPlayer: false, render: () => "I believe you." },
      { key: "disbelieve", label: "I don't believe you.", needsPlayer: false, render: () => "I don't believe you." },
      { key: "check", label: "I'll check that.", needsPlayer: false, render: () => "I'll check that." },
      { key: "no_idea", label: "No idea yet.", needsPlayer: false, render: () => "No idea yet." },
    ],
  },
];

const BY_KEY = new Map(
  SENTENCE_GROUPS.flatMap((g) => g.items).map((d) => [d.key, d] as const)
);

// The display text of a sentence message, or null if the payload is unknown
// (the caller then falls back to the server-rendered text).
export function renderSentence(
  payload: SentencePayload,
  nameOf: (playerId: string) => string
): string | null {
  const def = BY_KEY.get(payload.s);
  if (!def) return null;
  return def.render(payload.about ? nameOf(payload.about) : "someone");
}

const REASONS: Record<string, string> = {
  partner_locked: "You've already reached out to someone else this cycle.",
  muted: "You've been muted.",
  wrong_phase: "Outreach is over.",
  bad_about: "Pick a player for that sentence.",
};

export async function sendSentence(
  senderId: string,
  recipientId: string,
  key: SentenceKey,
  aboutId?: string
): Promise<void> {
  const { data, error } = await supabase.rpc("send_dm_sentence", {
    p_sender_id: senderId,
    p_recipient_id: recipientId,
    p_sentence: key,
    p_about: aboutId ?? null,
  });
  if (error) throw error;
  const res = data as { ok: boolean; reason?: string } | null;
  if (!res?.ok) {
    throw new Error(REASONS[res?.reason ?? ""] ?? "Couldn't send that.");
  }
}
