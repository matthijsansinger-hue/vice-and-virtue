// Profanity filter (English).
//
// Two public functions:
//   - censorText(text)        -> replaces curse words with **** (used for chats)
//   - containsProfanity(text) -> true/false (used to REJECT bad names)
//
// How matching works: each word is "normalized" first so common dodges
// are caught — leetspeak (f@ck, sh1t), symbols (f*ck), and stretched
// letters (fuuuck). Then:
//   - STEMS are matched anywhere inside a word (e.g. "motherfucker" hits
//     the "fuck" stem). Only words that almost never appear inside clean
//     English go here, to avoid false positives.
//   - WHOLE_WORDS must match a whole word on their own (e.g. "ass" would
//     wrongly flag "class" or "pass" if matched as a substring, so it is
//     whole-word only).
//
// To add or remove a word, just edit the two lists below.

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

// Strong stems — safe to match anywhere inside a word.
const STEMS = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
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
  "retard",
];

// Whole-word matches only (would cause false positives as substrings).
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
  "fag",
  "fags",
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
]);

// Lowercase, fold leetspeak/symbols to letters, drop anything that's not
// a letter, then collapse any run of 3+ identical letters down to one
// ("fuuuck" -> "fuck"). Double letters (e.g. the "ss" in "ass") are kept.
function normalize(word: string): string {
  let t = word.toLowerCase();
  for (const [from, to] of Object.entries(LEET)) {
    t = t.split(from).join(to);
  }
  t = t.replace(/[^a-z]/g, "");
  t = t.replace(/(.)\1{2,}/g, "$1");
  return t;
}

// Is this single word a curse word?
function isProfaneWord(word: string): boolean {
  const n = normalize(word);
  if (!n) return false;
  if (WHOLE_WORDS.has(n)) return true;
  return STEMS.some((stem) => n.includes(stem));
}

// Replaces every curse word in `text` with asterisks of the same length,
// leaving everything else (and spacing) untouched. The message still sends.
export function censorText(text: string): string {
  return text.replace(/\S+/g, (word) =>
    isProfaneWord(word) ? "*".repeat(word.length) : word
  );
}

// True if any word in `text` is a curse word. Used to reject names.
export function containsProfanity(text: string): boolean {
  return text.split(/\s+/).some(isProfaneWord);
}
