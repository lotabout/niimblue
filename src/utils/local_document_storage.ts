import { z } from "zod";
import {
  CsvParamsSchema,
  ExportedLabelTemplateSchema,
  FabricJsonSchema,
  LabelPropsSchema,
  type ExportedLabelTemplate,
} from "$/types";
import { normalizeLabelBaseline, type LabelDraft } from "./label_document";
import {
  databaseTransaction,
  idbRequest,
  migrateLocalStorage,
  readDatabaseValue,
  writeDatabaseValue,
} from "./browser_database";

const labelSchema = ExportedLabelTemplateSchema.omit({ id: true });
const draftSchema = z.object({
  version: z.literal(1),
  label: labelSchema,
  csvData: CsvParamsSchema.optional(),
  document: z.object({
    id: z.string().min(1).optional(),
    storageKey: z.string().optional(),
    storageRevision: z.number().int().positive().optional(),
    title: z.string(),
    baseline: z.string(),
  }),
});
let draftWrites = Promise.resolve();

function assertLabelId(id: string) {
  if (!id.startsWith("saved_label_")) throw new Error("Invalid label ID");
}

async function migrateLabels() {
  const keys = Object.keys(localStorage).filter((key) => key.startsWith("saved_label_"));
  for (const key of keys) await migrateLocalStorage(key, labelSchema);

  // Very old versions kept one canvas outside the saved-label collection.
  const props = localStorage.getItem("saved_canvas_props");
  const canvas = localStorage.getItem("saved_canvas_data");
  if (props !== null && canvas !== null) {
    const label = labelSchema.parse({
      label: LabelPropsSchema.parse(JSON.parse(props)),
      canvas: FabricJsonSchema.parse(JSON.parse(canvas)),
      timestamp: Math.floor(Date.now() / 1000),
    });
    await databaseTransaction("readwrite", async (store) => {
      const key = "saved_label_legacy_canvas";
      if ((await idbRequest(store.get(key))) === undefined) await idbRequest(store.put(label, key));
    });
    if (localStorage.getItem("saved_canvas_props") === props && localStorage.getItem("saved_canvas_data") === canvas) {
      localStorage.removeItem("saved_canvas_props");
      localStorage.removeItem("saved_canvas_data");
    }
  }
}

/** Documents keep their portable image data intact, now outside localStorage's quota. */
export class LocalDocumentStorage {
  static async loadLabel(id: string): Promise<ExportedLabelTemplate | null> {
    assertLabelId(id);
    await migrateLabels();
    const label = await readDatabaseValue(id, labelSchema);
    return label ? { ...label, id } : null;
  }

  static async loadLabels(): Promise<ExportedLabelTemplate[]> {
    await migrateLabels();
    return databaseTransaction("readonly", async (store) => {
      const range = IDBKeyRange.bound("saved_label_", "saved_label_\uffff");
      const keys = await idbRequest(store.getAllKeys(range));
      const labels = await idbRequest(store.getAll(range));
      return labels.map((value, index) => ({ ...labelSchema.parse(value), id: String(keys[index]) }));
    });
  }

  static async saveLabel(label: ExportedLabelTemplate, id?: string): Promise<ExportedLabelTemplate> {
    const parsed = labelSchema.parse(label);
    parsed.timestamp = Math.floor(Date.now() / 1000);
    if (id) assertLabelId(id);
    await migrateLabels();
    const key = id ?? `saved_label_${parsed.timestamp}_${crypto.randomUUID()}`;
    await databaseTransaction("readwrite", async (store) => {
      if (id && (await idbRequest(store.get(id))) === undefined)
        throw new Error("The original label no longer exists. Save it as a new label.");
      await idbRequest(store.put(parsed, key));
    });
    return { ...parsed, id: key };
  }

  static async deleteLabel(id: string): Promise<void> {
    assertLabelId(id);
    await migrateLabels();
    await databaseTransaction("readwrite", async (store) => {
      await idbRequest(store.delete(id));
    });
  }

  static async importLabels(labels: ExportedLabelTemplate[]): Promise<void> {
    const parsed = z
      .array(labelSchema)
      .parse(labels)
      .map((label) => ({
        ...label,
        timestamp: label.timestamp ?? Math.floor(Date.now() / 1000),
      }));
    await migrateLabels();
    await databaseTransaction("readwrite", async (store) => {
      for (const label of parsed) {
        await idbRequest(store.add(label, `saved_label_${label.timestamp}_${crypto.randomUUID()}`));
      }
    });
  }

  static async loadLabelDraft(): Promise<LabelDraft | null> {
    const draft = await readDatabaseValue("label_workspace_draft", draftSchema);
    if (draft) draft.document.baseline = normalizeLabelBaseline(draft.document.baseline);
    return draft;
  }

  static saveLabelDraft(draft: LabelDraft): Promise<void> {
    const snapshot = draftSchema.parse({
      ...draft,
      document: { ...draft.document, baseline: normalizeLabelBaseline(draft.document.baseline) },
    });
    const job = draftWrites.then(() => writeDatabaseValue("label_workspace_draft", snapshot, draftSchema));
    draftWrites = job.catch(() => {});
    return job;
  }

  static loadDefaultTemplate(): Promise<ExportedLabelTemplate | null> {
    return readDatabaseValue("default_template", labelSchema);
  }

  static saveDefaultTemplate(value?: ExportedLabelTemplate): Promise<void> {
    return writeDatabaseValue("default_template", value, labelSchema);
  }
}
