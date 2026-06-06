// Profanity filter (English), tiered by severity.
//
// Two tiers:
//   - PROFANITY (general swearing) -> CENSORED. The message still sends,
//     with the word starred out (****).
//   - SLURS (hate speech) -> HARD-BLOCKED. The message/name is refused.
//
// Public API:
//   - censorText(text)        -> stars out profanity + slurs (display safety net)
//   - containsProfanity(text) -> true if any profanity OR slur (rejects names)
//   - containsSlur(text)      -> true if a slur is present (hard-block trigger)
//   - cleanForSend(text)      -> throws on a slur, else returns censored text
//                                (used by every chat send path)
//
// Obfuscation handling. Before matching, text is normalized so common
// dodges are caught:
//   - Unicode tricks: NFKD folds styled/fullwidth letters to ASCII;
//     combining marks and zero-width/invisible chars are stripped.
//   - Homoglyphs: Cyrillic/Greek lookalikes (e, o, a, p...) -> latin.
//   - Leetspeak/symbols: f@ck, sh1t, f*ck.
//   - Stretched letters: fuuuuck -> fuck.
//   - Spaced-out letters: "f u c k", "n-i-g-g-e-r", "f.u.c.k" are rejoined
//     (only runs of *single* letters, so real words like "if a guy" are
//     untouched).
//
// Matching then uses these lists:
//   - STEMS: profanity safe to match anywhere inside a word (motherfucker).
//   - WHOLE_WORDS: profanity that would false-positive as a substring
//     (ass -> class/pass), so matched whole-word only.
//   - SLUR_STEMS / SLUR_WORDS: the hard-block tier, split the same way.
//
// To tune, edit the lists below.

// Leetspeak / symbol substitutions applied before matching.
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  "$": "s",
  "!": "i",
  "|": "i",
  "(": "c",
  "+": "t",
};

// Common Cyrillic/Greek homoglyphs that look like Latin letters.
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", к: "k", м: "m",
  н: "h", т: "t", в: "b", і: "i", ј: "j", ѕ: "s",
  // Greek
  α: "a", ο: "o", ε: "e", ι: "i", ρ: "p", τ: "t", υ: "u", χ: "x", κ: "k",
};

// --- Profanity (censored) ---
const STEMS = [
  "fuck",
  "shit",
  "bitch",
  "motherfuck",
  "bullshit",
  "asshole",
  "dumbass",
  "jackass",
  "cocksuck",
  "dickhead",
  "wanker",
  "bollock",
  "whore",
  "slut",
  "twat",
];

const WHOLE_WORDS = new Set([
  "ass",
  "arse",
  "cock",
  "cocks",
  "dick",
  "dicks",
  "piss",
  "pissed",
  "prick",
  "pricks",
  "pussy",
  "pussies",
  "bastard",
  "bastards",
  "douche",
  "douchebag",
  "wank",
  "tit",
  "tits",
  "titty",
  "boob",
  "boobs",
  "cum",
  "cumming",
  "jizz",
  "blowjob",
  "handjob",
  "bugger",
  "wtf",
  "stfu",
  "fck",
  "fuk",
  "fuc",
  "fuckface",
  "skank",
  "hoe",
  "cunt",
  "cunts",
  "retard",
  "retarded",
  // Slurs demoted from hard-block because they collide with everyday words
  // (chink in the armor / raccoon / Van Dyke). Censored, whole-word only.
  "chink",
  "chinks",
  "coon",
  "coons",
  "dyke",
  "dykes",
]);

// --- Slurs (hard-blocked) ---
// Long, distinctive stems: safe to match anywhere (won't form from clean
// English words even after spaces are collapsed). Words that DO appear inside
// clean words ("cunt" in Scunthorpe, "chink" in "a chink of light",
// "retard" in "retardant") are kept out of here and matched whole-word only,
// to avoid hard-blocking innocent text.
const SLUR_STEMS = [
  "nigger",
  "nigga",
  "faggot",
  "tranny",
  "wetback",
  "beaner",
];

// Short slurs with no common homograph: whole-word hard-block. (Slurs that
// DO collide with everyday words — chink/coon/dyke — are demoted to the
// censor tier in WHOLE_WORDS below so legit phrases aren't refused.)
const SLUR_WORDS = new Set([
  "fag",
  "fags",
  "kike",
  "kikes",
  "spic",
  "spics",
  "gook",
  "gooks",
  "paki",
  "pakis",
]);

// Strip invisible code points so they can't be used to break up words:
// combining marks (U+0300–U+036F), zero-width space..joiner (U+200B–U+200D),
// BOM (U+FEFF), and soft hyphen (U+00AD). Done by code point (not a regex
// literal) so this source file contains no invisible bytes.
function stripInvisible(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x0300 && c <= 0x036f) continue;
    if (c >= 0x200b && c <= 0x200d) continue;
    if (c === 0xfeff || c === 0x00ad) continue;
    out += ch;
  }
  return out;
}

// Fold a single token to bare lowercase letters so dodges collapse onto the
// canonical spelling. NFKD first (styled/fullwidth unicode), then strip
// invisible chars, then homoglyphs, then leetspeak, then drop non-letters,
// then squash runs of 3+ identical letters to one.
function normalize(word: string): string {
  let t = stripInvisible(word.normalize("NFKD")).toLowerCase();
  for (const [from, to] of Object.entries(HOMOGLYPHS)) t = t.split(from).join(to);
  for (const [from, to] of Object.entries(LEET)) t = t.split(from).join(to);
  t = t.replace(/[^a-z]/g, "");
  t = t.replace(/(.)\1{2,}/g, "$1");
  return t;
}

// Rejoin spaced-out single letters ("f u c k", "n-i-g-g-e-r") so they can be
// matched as one word. Only collapses runs of THREE OR MORE single letters,
// each followed by separators — multi-letter words (e.g. "if a guy") are
// left alone, avoiding false positives.
function despace(text: string): string {
  let t = stripInvisible(text.normalize("NFKD")).toLowerCase();
  for (const [from, to] of Object.entries(HOMOGLYPHS)) t = t.split(from).join(to);
  for (const [from, to] of Object.entries(LEET)) t = t.split(from).join(to);
  return t.replace(/(?:[a-z](?:[^a-z]+|$)){3,}/g, (m) => m.replace(/[^a-z]/g, ""));
}

function isProfaneWord(word: string): boolean {
  const n = normalize(word);
  if (!n) return false;
  if (WHOLE_WORDS.has(n)) return true;
  return STEMS.some((stem) => n.includes(stem));
}

function isSlurWord(word: string): boolean {
  const n = normalize(word);
  if (!n) return false;
  if (SLUR_WORDS.has(n)) return true;
  return SLUR_STEMS.some((stem) => n.includes(stem));
}

// Run a per-word predicate over the raw text AND the de-spaced text, so
// "f u c k" style evasion is caught alongside normal tokens.
function anyWord(text: string, pred: (w: string) => boolean): boolean {
  for (const variant of [text, despace(text)]) {
    for (const w of variant.split(/\s+/)) {
      if (pred(w)) return true;
    }
  }
  return false;
}

// Replaces every profane/slur word in `text` with asterisks of the same
// length (per word, on the original text), leaving spacing untouched. This
// is the display safety net; slurs are additionally hard-blocked on send.
export function censorText(text: string): string {
  return text.replace(/\S+/g, (word) =>
    isProfaneWord(word) || isSlurWord(word) ? "*".repeat(word.length) : word
  );
}

// True if `text` contains any profanity or slur. Used to REJECT names.
export function containsProfanity(text: string): boolean {
  return anyWord(text, (w) => isProfaneWord(w) || isSlurWord(w));
}

// True if `text` contains a slur (the hard-block tier).
export function containsSlur(text: string): boolean {
  return anyWord(text, isSlurWord);
}

// Error thrown by cleanForSend when a message contains a slur, so callers
// can show a friendly "not sent" message. Other errors propagate normally.
export class BlockedMessageError extends Error {
  constructor() {
    super("Your message wasn't sent — please keep it respectful.");
    this.name = "BlockedMessageError";
  }
}

// Prepare a chat message for sending: hard-block slurs, censor the rest.
// Throws BlockedMessageError on a slur (caller surfaces the message and
// nothing is written to the database).
export function cleanForSend(text: string): string {
  if (containsSlur(text)) throw new BlockedMessageError();
  return censorText(text);
}
