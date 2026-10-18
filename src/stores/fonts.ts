import { derived } from "svelte/store";
import { createLocalFonts } from "$/utils/local_media";
import { storageConfig } from "$/utils/label_storage";
import { createFontLibrary } from "$/utils/font_library";
import { loadCustomFonts } from "$/utils/font_loader";

export { loadedFonts } from "$/utils/font_loader";
export const localUserFonts = createLocalFonts();
export const fontLibrary = createFontLibrary(localUserFonts, loadCustomFonts);
export const fontState = fontLibrary.state;
export const userFonts = derived(fontState, (state) => state.fonts);
storageConfig.subscribe((config) => void fontLibrary.select(config));
