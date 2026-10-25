// Premade Outreach sentences (migration 129; role question + answer in 132).
// The server stores the MEANING ({s, about, role}) on dm_messages.payload and
// also renders a plain-text copy; live clients render from the payload with
// their own display names so an Envy swap still reads correctly. Bots
// understand only these; humans can use them with anyone, next to free text.
//
// Keep the keys + wording in sync with vv_sentence_text in the migrations.

import { supabase } from "./supabase";
import { getRole } from "./roles";

export type SentenceKey =
  | "claim_vice"
  | "claim_virtue"
  | "self_virtue"
  | "self_vice"
  | "self_role"
  | "suspect"
  | "trust"
  | "vote"
  | "ask_suspect"
  | "ask_side"
  | "ask_role"
  | "ask_vote"
  | "ask_info"
  | "ask_how"
  | "believe"
  | "disbelieve"
  | "check"
  | "no_idea"
  | "thanks"
  | "bye"
  // Bot-only (migration 134): how a bot backs up a claim.
  | "src_quiz_today"
  | "src_quiz"
  | "src_hint"
  | "src_market"
  | "src_ability"
  | "src_told"
  | "src_hunch"
  | "huh";

export type SentencePayload = { s: SentenceKey; about?: string | null; role?: string | null };

type SentenceDef = {
  key: SentenceKey;
  // Shown on the picker chip; "…" marks where the chosen player / role goes.
  label: string;
  needsPlayer: boolean;
  needsRole?: boolean;
  render: (about: string, role: string) => string;
};

export const SENTENCE_GROUPS: { title: string; items: SentenceDef[] }[] = [
  {
    title: "Claims",
    items: [
      { key: "claim_vice", label: "… is a Vice.", needsPlayer: true, render: (a) => `${a} is a Vice.` },
      { key: "claim_virtue", label: "… is a Virtue.", needsPlayer: true, render: (a) => `${a} is a Virtue.` },
      { key: "self_virtue", label: "I'm a Virtue.", needsPlayer: false, render: () => "I'm a Virtue." },
      { key: "self_vice", label: "I'm a Vice.", needsPlayer: false, render: () => "I'm a Vice." },
      { key: "self_role", label: "I'm the …", needsPlayer: false, needsRole: true, render: (_a, r) => `I'm the ${r}.` },
    ],
  },
  {
    title: "Opinions",
    items: [
      { key: "trust", label: "I trust …", needsPlayer: true, render: (a) => `I trust ${a}.` },
      { key: "vote", label: "Let's vote … out.", needsPlayer: true, render: (a) => `Let's vote ${a} out.` },
    ],
  },
  {
    title: "Questions",
    items: [
      { key: "ask_side", label: "Which side are you on?", needsPlayer: false, render: () => "Which side are you on?" },
      { key: "ask_role", label: "Which role are you?", needsPlayer: false, render: () => "Which role are you?" },
      { key: "ask_vote", label: "Who should we vote for?", needsPlayer: false, render: () => "Who should we vote for?" },
      { key: "ask_info", label: "Do you have any information on anyone?", needsPlayer: false, render: () => "Do you have any information on anyone?" },
      // A bot answers with how it knows its latest claim to you — and a lying
      // bot's story may not hold up.
      { key: "ask_how", label: "How do you know that?", needsPlayer: false, render: () => "How do you know that?" },
    ],
  },
  {
    title: "Replies",
    items: [
      { key: "believe", label: "I believe you.", needsPlayer: false, render: () => "I believe you." },
      { key: "disbelieve", label: "I don't believe you.", needsPlayer: false, render: () => "I don't believe you." },
      { key: "check", label: "I'll check that.", needsPlayer: false, render: () => "I'll check that." },
      { key: "no_idea", label: "No idea yet.", needsPlayer: false, render: () => "No idea yet." },
      // Closers (migration 130): "Talk tomorrow." ends a conversation — it's
      // the one message a bot doesn't answer.
      { key: "thanks", label: "Thanks.", needsPlayer: false, render: () => "Thanks." },
      { key: "bye", label: "Talk tomorrow.", needsPlayer: false, render: () => "Talk tomorrow." },
    ],
  },
];

// No longer offered (132, 133), but still in older messages.
const RETIRED: SentenceDef[] = [
  { key: "suspect", label: "I suspect …", needsPlayer: true, render: (a) => `I suspect ${a}.` },
  { key: "ask_suspect", label: "Who do you suspect?", needsPlayer: false, render: () => "Who do you suspect?" },
];

// Only bots send these (the server refuses them from players): their answers
// to "How do you know that?".
const BOT_ONLY: SentenceDef[] = [
  { key: "src_quiz_today", label: "", needsPlayer: false, render: () => "I read their soul in today's Quiz." },
  { key: "src_quiz", label: "", needsPlayer: false, render: () => "I read their soul in an earlier Quiz." },
  { key: "src_hint", label: "", needsPlayer: false, render: () => "I worked it out from a Quiz hint." },
  { key: "src_market", label: "", needsPlayer: false, render: () => "I used a camp reveal potion on them." },
  { key: "src_ability", label: "", needsPlayer: false, render: () => "My ability showed me their role." },
  { key: "src_told", label: "", needsPlayer: true, render: (a) => `${a} told me.` },
  { key: "src_hunch", label: "", needsPlayer: false, render: () => "Just a hunch." },
  { key: "huh", label: "", needsPlayer: false, render: () => "What do you mean?" },
];

const BY_KEY = new Map(
  [...SENTENCE_GROUPS.flatMap((g) => g.items), ...RETIRED, ...BOT_ONLY].map(
    (d) => [d.key, d] as const
  )
);

// The display text of a sentence message, or null if the payload is unknown
// (the caller then falls back to the server-rendered text). selfId: the
// viewer, so "<you> told me." reads "You told me.".
export function renderSentence(
  payload: SentencePayload,
  nameOf: (playerId: string) => string,
  selfId?: string | null
): string | null {
  const def = BY_KEY.get(payload.s);
  if (!def) return null;
  if (payload.s === "src_told" && selfId && payload.about === selfId) return "You told me.";
  return def.render(
    payload.about ? nameOf(payload.about) : "someone",
    getRole(payload.role)?.name ?? "…"
  );
}

const REASONS: Record<string, string> = {
  partner_locked: "You've already reached out to someone else this cycle.",
  muted: "You've been muted.",
  wrong_phase: "Outreach is over.",
  bad_about: "Pick a player for that sentence.",
  bad_role: "Pick a role for that sentence.",
};

export async function sendSentence(
  senderId: string,
  recipientId: string,
  key: SentenceKey,
  aboutId?: string,
  roleId?: string
): Promise<void> {
  const { data, error } = await supabase.rpc("send_dm_sentence", {
    p_sender_id: senderId,
    p_recipient_id: recipientId,
    p_sentence: key,
    p_about: aboutId ?? null,
    // Only with a role claim, so every other sentence still reaches a database
    // that doesn't have migration 132 yet.
    ...(key === "self_role" ? { p_role: roleId ?? null } : {}),
  });
  if (error) throw error;
  const res = data as { ok: boolean; reason?: string } | null;
  if (!res?.ok) {
    throw new Error(REASONS[res?.reason ?? ""] ?? "Couldn't send that.");
  }
}
