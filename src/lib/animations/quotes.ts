// Quote shown over each role's ability animation. CanvasClip renders the one
// keyed by the playing clip's `name`. Roles with several ability clips share the
// role's quote across them; Justice's two clips carry distinct quotes (protect
// vs kill). The Wandering Soul intentionally has none. Stingers/lore clips
// aren't keyed here, so they show no quote.

const LOVE =
  "Ye must show forth tenderness and love to every human being, even to your enemies, and welcome them all with unalloyed friendship, good cheer, and loving-kindness.";
const GENEROSITY =
  "We must be like the fountain or spring that is continually emptying itself of all that it has and is continually being refilled from an invisible source. To be continually giving out for the good of our fellows undeterred by fear of poverty and reliant on the unfailing bounty of the Source of all wealth and all good—this is the secret of right living";
const VIRTUE_SEEKER =
  "Let each morn be better than its eve and each morrow richer than its yesterday. Man’s merit lieth in service and virtue and not in the pageantry of wealth and riches.";
const WRATH =
  "The individual must be educated to such a high degree that he would rather have his throat cut than tell a lie, and would think it easier to be slashed with a sword or pierced with a spear than to utter calumny or be carried away by wrath.";
const FANATICISM =
  "prejudice and fanaticism—whether sectarian, denominational, patriotic or political—are destructive to the foundation of human solidarity; therefore, man should release himself from such bonds in order that the oneness of the world of humanity may become manifest.";
const VENGEANCE =
  "Should anyone give you a blow, return him not in kind. Should anyone heap abuse upon you, answer him not. If anyone would stab you, do not stab him; if anyone would wound you, wound him not.";
const VICE_WORSHIPPER =
  "Be fair in your judgement. Every good thing is of God, and every evil thing is from yourselves.";

export const QUOTE_BY_CLIP: Record<string, string> = {
  truthfulness: "Truthfulness is the foundation of all human virtues",
  empathy: "Blessed is he who preferreth his brother before himself.",
  love: LOVE,
  love_tiebreak: LOVE,
  justice: "The purpose of justice is the appearance of unity among men",
  justice_kill:
    "The light of men is Justice. Quench it not with the contrary winds of oppression and tyranny",
  certainty:
    "Think not the secrets of hearts are hidden, nay, know ye of a certainty that in clear characters they are engraved and are openly manifest in the holy Presence.",
  determination:
    "Have determination to carry the decision through. Many fail here. The decision, budding into determination, is blighted and instead becomes a wish or a vague longing. When determination is born, immediately take the next step.",
  generosity: GENEROSITY,
  generosity_extra_life: GENEROSITY,
  sacrifice_cinematic:
    "When you look at the tree, you will realize that the perfections, blessings, properties and beauty of the seed have become manifest in the branches, twigs, blossoms and fruit; consequently, the seed has sacrificed itself to the tree. Had it not done so, the tree would not have come into existence.",
  diligence:
    "It behoveth the craftsmen of the world at each moment to offer a thousand tokens of gratitude at the Sacred Threshold, and to exert their highest endeavour and diligently pursue their professions so that their efforts may produce that which will manifest the greatest beauty and perfection before the eyes of all men.",
  virtue_seeker: VIRTUE_SEEKER,
  virtue_seeker_guess: VIRTUE_SEEKER,
  wrath: WRATH,
  wrath_absorb: WRATH,
  murder:
    "the community has no hatred nor animosity for the murderer: it imprisons or punishes him merely for the protection and security of others. It is not for the purpose of taking vengeance upon the murderer, but for the purpose of inflicting a punishment by which the community will be protected.",
  intoxication:
    "Alcohol consumeth the mind and causeth man to commit acts of absurdity",
  gambling:
    "If a person gambles he will lose his money. All these sufferings are caused by the man himself, it is quite clear therefore that certain sorrows are the result of our own deeds.",
  envy:
    "Jealousy consumeth the body and anger doth burn the liver: avoid these two as you would a lion.",
  fanaticism: FANATICISM,
  fanaticism_plant: FANATICISM,
  fanaticism_detonate: FANATICISM,
  fanaticism_reveal: FANATICISM,
  torment:
    "Lay not on any soul a load which ye would not wish to be laid upon you, and desire not for anyone the things ye would not desire for yourselves.",
  vengeance: VENGEANCE,
  vengeance_hospitalise: VENGEANCE,
  pride:
    "He must never seek to exalt himself above any one, must wash away from the tablet of his heart every trace of pride and vain-glory, must cling unto patience and resignation, observe silence and refrain from idle talk",
  vice_worshipper: VICE_WORSHIPPER,
  vice_worshipper_guess: VICE_WORSHIPPER,
};
