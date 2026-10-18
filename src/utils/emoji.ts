/** A grapheme may contain a whole ZWJ sequence, flag, skin tone or keycap. */
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

export const DEFAULT_EMOJI_FONT = "Niimblue Emoji";

export const isEmojiGrapheme = (grapheme: string): boolean => EMOJI_RE.test(grapheme);

/** VS16 can make browsers prefer a color font even over our monochrome face.
 * Normalize only the glyph sent to Canvas; preserve the user's original text.
 */
export const emojiRenderText = (text: string, fontFamily: string): string =>
  fontFamily === DEFAULT_EMOJI_FONT ? text.replace(/\ufe0f/g, "") : text;
