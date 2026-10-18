import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Exercise real Fabric wrapping, styling, editing and serialization with a
// deterministic measuring context. Browser QA separately checks actual glyphs.
const bundle = await build({
  stdin: {
    contents: `export { TextboxExt } from "./src/fabric-object/textbox-ext.ts";
      export { DEFAULT_EMOJI_FONT, isEmojiGrapheme, emojiRenderText } from "./src/utils/emoji.ts";
      export { setEnv, classRegistry } from "fabric";`,
    resolveDir: process.cwd(),
  },
  bundle: true, platform: "browser", format: "esm", write: false, tsconfig: "tsconfig.json",
});
const { TextboxExt, DEFAULT_EMOJI_FONT, isEmojiGrapheme, emojiRenderText, setEnv, classRegistry } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + "\n//# sourceURL=emoji-text-tests.js").toString("base64")}`);
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const measurements = [];
const context = () => ({
  font: "", direction: "ltr", canvas: { setAttribute() {} }, draws: [], stack: [],
  save() { this.stack.push(this.font); },
  restore() { this.font = this.stack.pop(); },
  measureText(text) {
    measurements.push({ text, font: this.font });
    return { width: [...segmenter.segment(text)].length * (this.font.includes(DEFAULT_EMOJI_FONT) ? 400 : 200) };
  },
  fillText(text) { this.draws.push({ text, font: this.font }); },
});
setEnv({
  document: { createElement: () => ({ getContext: () => context() }) },
  window: { Intl },
});
classRegistry.setClass(TextboxExt, "Textbox");

const render = (text) => {
  const ctx = context();
  for (let i = 0; i < text._textLines.length; i++) {
    text.getLineWidth(i);
    text._renderChars("fillText", ctx, text._textLines[i], 0, 0, i);
  }
  return ctx.draws;
};

test("emoji detection covers whole clusters without treating ordinary numbers as emoji", () => {
  for (const emoji of ["😀", "❤️", "👍🏽", "👨‍👩‍👧‍👦", "🇨🇳", "1️⃣", "🏳️‍🌈"]) assert.ok(isEmojiGrapheme(emoji), emoji);
  for (const text of ["今天", "A", "1", "#", "*", " ", "\n", ""]) assert.equal(isEmojiGrapheme(text), false, text);
});

test("monochrome glyph normalization preserves source text and whole emoji sequences", () => {
  const source = "❤️ 1️⃣ 🏳️‍🌈 👍🏽";
  assert.equal(emojiRenderText(source, DEFAULT_EMOJI_FONT), "❤ 1⃣ 🏳‍🌈 👍🏽");
  assert.equal(emojiRenderText(source, "Apple Color Emoji"), source);
  const text = new TextboxExt(source, { width: 1000 });
  assert.equal(text.text, source);
  assert.equal(text._text.length, 7, "each composite emoji occupies one cursor position");
  assert.equal(text.fromStringToGraphemeSelection(0, source.length, source).selectionEnd, 7);
});

test("mixed runs render with separate fonts and changing body font leaves emoji alone", () => {
  const text = new TextboxExt("正文 😀 ❤️ 1️⃣ ABC", { width: 1000, fontFamily: "serif" });
  let draws = render(text);
  assert.ok(draws.some((draw) => draw.text === "正文 " && draw.font.includes("serif")));
  assert.ok(draws.some((draw) => draw.text.includes("❤") && draw.font.includes(DEFAULT_EMOJI_FONT)));
  assert.ok(draws.every((draw) => !draw.text.includes("\ufe0f")));
  text.set({ fontFamily: "monospace" });
  draws = render(text);
  assert.ok(draws.find((draw) => draw.text.includes("ABC")).font.includes("monospace"));
  assert.ok(draws.find((draw) => draw.text.includes("😀")).font.includes(DEFAULT_EMOJI_FONT));
  assert.deepEqual(text.styles, {}, "derived emoji fonts never leak into persisted character styles");
});

test("changing emoji font updates dimensions and retains color presentation selectors", () => {
  const text = new TextboxExt("AB ❤️", { width: 1000, fontFamily: "serif" });
  const monoWidth = text.getLineWidth(0);
  text.set({ emojiFontFamily: "Apple Color Emoji" });
  const draws = render(text);
  assert.ok(text.getLineWidth(0) < monoWidth);
  assert.ok(draws.find((draw) => draw.text === "❤️").font.includes("Apple Color Emoji"));
  assert.ok(draws.find((draw) => draw.text === "AB ").font.includes("serif"));
  text.set({ emojiFontFamily: DEFAULT_EMOJI_FONT });
  assert.equal(text.getLineWidth(0), monoWidth);
});

test("wrapping measures incoming emoji with its own font and keeps clusters intact", () => {
  const text = new TextboxExt("abc", { width: 65, fontSize: 20, splitByGrapheme: true });
  text.set({ text: "A 😀 👨‍👩‍👧‍👦 1️⃣ B" });
  assert.ok(text._textLines.length > 1);
  assert.ok(text._textLines.flat().includes("👨‍👩‍👧‍👦"));
  for (const line of text._textLines) {
    line.forEach((grapheme, index) => {
      const lineIndex = text._textLines.indexOf(line);
      const family = text.getCompleteStyleDeclaration(lineIndex, index).fontFamily;
      assert.equal(family, isEmojiGrapheme(grapheme) ? DEFAULT_EMOJI_FONT : text.fontFamily);
    });
  }
  assert.ok(measurements.some((item) => item.text === "👨‍👩‍👧‍👦" && item.font.includes(DEFAULT_EMOJI_FONT)));
  const edited = new TextboxExt("😀", { fontFamily: "serif", width: 400 });
  edited.insertChars("hello", undefined, 1);
  assert.equal(edited.text, "😀hello");
  assert.ok(render(edited).find((draw) => draw.text === "hello").font.includes("serif"));
});

test("save, load, cloning and legacy labels preserve independent font settings", async () => {
  const text = new TextboxExt("正文 ❤️", { fontFamily: "serif", emojiFontFamily: "Apple Color Emoji", width: 500 });
  const saved = JSON.parse(JSON.stringify(text.toObject()));
  for (const restored of [await TextboxExt.fromObject(saved), await text.clone()]) {
    assert.ok(restored instanceof TextboxExt);
    assert.equal(restored.emojiFontFamily, "Apple Color Emoji");
    assert.equal(restored.fontFamily, "serif");
    assert.equal(restored.text, text.text);
    assert.ok(render(restored).find((draw) => draw.text === "❤️").font.includes("Apple Color Emoji"));
  }
  delete saved.emojiFontFamily;
  const legacy = await TextboxExt.fromObject(saved);
  assert.equal(legacy.emojiFontFamily, DEFAULT_EMOJI_FONT);
  assert.ok(render(legacy).find((draw) => draw.text === "❤").font.includes(DEFAULT_EMOJI_FONT));
});
