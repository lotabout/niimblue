import { derived } from "svelte/store";
import { z } from "zod";
import { UserFontSchema, type UserFont } from "$/types";
import { writablePersisted } from "$/utils/persistence";
import { storageConfig } from "$/utils/label_storage";
import { createFontLibrary } from "$/utils/font_library";
import { loadCustomFonts } from "$/utils/font_loader";

export { loadedFonts } from "$/utils/font_loader";
export const localUserFonts = writablePersisted<UserFont[]>("user_fonts", z.array(UserFontSchema), []);
export const fontLibrary = createFontLibrary(localUserFonts, loadCustomFonts);
export const fontState = fontLibrary.state;
export const userFonts = derived(fontState, (state) => state.fonts);
storageConfig.subscribe((config) => void fontLibrary.select(config));
