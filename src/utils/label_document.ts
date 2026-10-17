import type { CsvParams, ExportedLabelTemplate } from "../types";

export interface LabelDocumentState {
  id?: string;
  storageKey?: string;
  storageRevision?: number;
  title: string;
  baseline: string;
}

export interface LabelDraft {
  version: 1;
  label: ExportedLabelTemplate;
  document: LabelDocumentState;
  csvData?: CsvParams;
}

// Keep the comparison baseline small even when a label embeds large images.
function contentFingerprint(content: string): string {
  let a = 1779033703;
  let b = 3144134277;
  let c = 1013904242;
  let d = 2773480762;
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    a = b ^ Math.imul(a ^ code, 597399067);
    b = c ^ Math.imul(b ^ code, 2869860233);
    c = d ^ Math.imul(c ^ code, 951274213);
    d = a ^ Math.imul(d ^ code, 2716044179);
  }
  a = Math.imul(c ^ (a >>> 18), 597399067);
  b = Math.imul(d ^ (b >>> 22), 2869860233);
  c = Math.imul(a ^ (c >>> 17), 951274213);
  d = Math.imul(b ^ (d >>> 19), 2716044179);
  const digest = [a ^ b ^ c ^ d, b ^ a, c ^ a, d ^ a]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return `v1:${content.length}:${digest}`;
}

export function normalizeLabelBaseline(baseline: string): string {
  // Older drafts store the complete canonical JSON as their comparison baseline.
  return baseline.startsWith("{") ? contentFingerprint(baseline) : baseline;
}

// Compare editable content only. Export timestamps and thumbnails change on every export.
export function labelFingerprint(label: ExportedLabelTemplate): string {
  const canonicalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .filter((key) => value[key] !== undefined)
          .map((key) => [key, canonicalize(value[key])]),
      );
    }
    return value;
  };

  return contentFingerprint(
    JSON.stringify(
      canonicalize({ title: label.title ?? "", label: label.label, canvas: label.canvas, csv: label.csv }),
    ),
  );
}

export function hasLabelChanges(label: ExportedLabelTemplate, baseline: string): boolean {
  return labelFingerprint(label) !== normalizeLabelBaseline(baseline);
}

export function createLabelDocument(label: ExportedLabelTemplate, id?: string): LabelDocumentState {
  return { id, title: label.title ?? "", baseline: labelFingerprint(label) };
}

export function restoreLabelDocument(
  draft: LabelDraft,
  savedLabel: ExportedLabelTemplate | null,
  currentStorageKey = "local",
): LabelDocumentState {
  if ((draft.document.storageKey ?? "local") !== currentStorageKey) {
    return { title: draft.document.title, baseline: "", storageKey: currentStorageKey };
  }
  // Remote drafts retain their saved baseline and revision while offline. Never adopt a newer
  // remote revision without loading its content, as that would bypass conflict protection.
  if (currentStorageKey !== "local" || !draft.document.id) return { ...draft.document };
  // A deleted original must become a new document instead of overwriting a different label.
  return savedLabel
    ? { ...draft.document, baseline: labelFingerprint(savedLabel) }
    : { title: draft.document.title, baseline: "" };
}
