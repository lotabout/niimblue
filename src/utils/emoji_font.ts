import fontUrl from "$/assets/fonts/noto-emoji/NotoEmoji-Variable.ttf?url";
import { DEFAULT_EMOJI_FONT } from "./emoji";

/** Load before creating any text objects so Fabric never caches fallback widths. */
export const loadEmojiFont = async (): Promise<void> => {
  const face = new FontFace(DEFAULT_EMOJI_FONT, `url("${fontUrl}")`, { weight: "300 700" });
  document.fonts.add(await face.load());
};
