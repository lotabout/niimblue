import type { CsvParams, ExportedLabelTemplate } from "../types";

export interface LabelDocumentState {
  id?: string;
  title: string;
  baseline: string;
}

export interface LabelDraft {
  version: 1;
  label: ExportedLabelTemplate;
  document: LabelDocumentState;
  csvData?: CsvParams;
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

  return JSON.stringify(
    canonicalize({ title: label.title ?? "", label: label.label, canvas: label.canvas, csv: label.csv }),
  );
}

export function createLabelDocument(label: ExportedLabelTemplate, id?: string): LabelDocumentState {
  return { id, title: label.title ?? "", baseline: labelFingerprint(label) };
}

export function restoreLabelDocument(draft: LabelDraft, savedLabel: ExportedLabelTemplate | null): LabelDocumentState {
  if (!draft.document.id) return { ...draft.document };
  // A deleted original must become a new document instead of overwriting a different label.
  return savedLabel
    ? { ...draft.document, baseline: labelFingerprint(savedLabel) }
    : { title: draft.document.title, baseline: "" };
}
