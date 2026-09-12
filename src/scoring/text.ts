/**
 * Text normalisation shared by the competition and stage matchers.
 *
 * Feeds disagree about everything cosmetic. One writes "Süper Lig", another
 * "Turkish Super Lig"; one "Semi-final", another "Semifinals". Normalising both
 * sides of a comparison is what lets the rules table stay readable instead of
 * accumulating a line per feed spelling.
 */

/**
 * Lowercases, folds accents away, turns punctuation into spaces and collapses
 * whitespace.
 *
 * Folding accents is deliberate and slightly lossy: it is what makes a rule
 * written "Süper Lig" match a feed that writes "Super Lig", which is the more
 * common problem by far.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ıøđłßæœþð]/g, (c) => STANDALONE[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Apostrophes are deleted rather than turned into spaces, so a rule for
    // "O'Sullivan" also finds a feed that writes "OSullivan". Feeds drop the
    // mark far more often than they replace it with a space.
    .replace(/['’ʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Letters that are not an accented form of anything, so decomposition leaves
 * them alone and the final pass would delete them outright.
 *
 * The Turkish dotless i is the one that matters here. Without this line
 * "Türkiye Kupası" normalises to "turkiye kupas" and stops matching its own
 * rule the moment any feed writes it with a plain i.
 */
const STANDALONE: Record<string, string> = {
  ı: 'i',
  ø: 'o',
  đ: 'd',
  ł: 'l',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
  ð: 'd',
};

/**
 * Whether `needle` appears in `haystack` as whole words.
 *
 * Whole words matter more than it looks. Plain substring matching would let the
 * rule "NBA" match a WNBA fixture, and "Serie A" match "Serie A2".
 */
export function containsWords(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(haystack);
}
