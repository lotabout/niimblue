import {
  AutomationPropsSchema,
  CsvParamsSchema,
  ExportedLabelTemplateSchema,
  FabricJsonSchema,
  LabelPresetSchema,
  LabelPropsSchema,
  PreviewPropsSchema,
  type AutomationProps,
  type ConnectionType,
  type ExportedLabelTemplate,
  type LabelPreset,
  type LabelProps,
  type PreviewProps,
} from "$/types";
import { z } from "zod";
import type { LabelDraft } from "./label_document";
import { get, writable, type Updater, type Writable } from "svelte/store";

const LabelDraftSchema = z.object({
  version: z.literal(1),
  label: ExportedLabelTemplateSchema.omit({ id: true }),
  csvData: CsvParamsSchema.optional(),
  document: z.object({
    id: z.string().startsWith("saved_label_").optional(),
    title: z.string(),
    baseline: z.string(),
  }),
});

/** Writable store, value is persisted to localStorage */
export function writablePersisted<T>(key: string, schema: z.ZodType<T>, initialValue: T): Writable<T> {
  const wr = writable<T>(initialValue);

  try {
    const val = LocalStoragePersistence.loadAndValidateObject(key, schema);
    if (val === null) {
      wr.set(initialValue);
    } else {
      wr.set(val);
    }
  } catch {
    wr.set(initialValue);
  }

  return {
    subscribe: wr.subscribe,

    set: (value: T) => {
      LocalStoragePersistence.validateAndSaveObject(key, value, schema);
      wr.set(value);
    },

    update: (updater: Updater<T>) => {
      const newValue: T = updater(get(wr));
      LocalStoragePersistence.validateAndSaveObject(key, newValue, schema);
      wr.set(newValue);
    },
  };
}

export class LocalStoragePersistence {
  /** Result in kilobytes */
  static usedSpace(): number {
    let total = 0;
    Object.keys(localStorage).forEach((key) => {
      total += (localStorage[key].length + key.length) * 2;
    });
    return Math.floor(total / 1024);
  }

  static saveObject(key: string, data: any) {
    if (data === null || data === undefined) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(data));
  }
  static loadObject(key: string): any {
    const data = localStorage.getItem(key);
    if (data !== null) {
      try {
        return JSON.parse(data);
      } catch (e) {
        console.log(e);
      }
    }
    return null;
  }

  /**
   * @throws {z.ZodError}
   */
  static loadAndValidateObject<T>(key: string, schema: z.ZodType<T>) {
    const data = this.loadObject(key);

    if (data === null) {
      return null;
    }

    return schema.parse(data);
  }

  static validateAndSaveObject<T>(key: string, data: any, schema: z.ZodType<T>): void {
    if (data === null || data === undefined) {
      this.saveObject(key, data);
      return;
    }

    const obj = schema.parse(data);
    this.saveObject(key, obj);
  }

  /**
   * @throws {z.ZodError}
   */
  static loadLastLabelProps(): LabelProps | null {
    return this.loadAndValidateObject("last_label_props", LabelPropsSchema);
  }

  /**
   * @throws {z.ZodError}
   */
  static saveLastLabelProps(labelData: LabelProps) {
    this.validateAndSaveObject("last_label_props", labelData, LabelPropsSchema);
  }

  static createUidForLabel(label: ExportedLabelTemplate): string {
    const basename = `saved_label_${label.timestamp}`;
    let counter = 0;

    while (`${basename}_${counter}` in localStorage) {
      counter++;
    }

    return `${basename}_${counter}`;
  }

  static loadLabel(id: string): ExportedLabelTemplate | null {
    if (!id.startsWith("saved_label_")) throw new Error("Invalid label ID");
    const label = this.loadAndValidateObject(id, ExportedLabelTemplateSchema.omit({ id: true }));
    return label ? { ...label, id } : null;
  }

  static saveLabel(label: ExportedLabelTemplate, id?: string): ExportedLabelTemplate {
    const parsed = ExportedLabelTemplateSchema.omit({ id: true }).parse(label);
    parsed.timestamp = Math.floor(Date.now() / 1000);
    if (id && (!id.startsWith("saved_label_") || localStorage.getItem(id) === null)) {
      throw new Error("The original label no longer exists. Save it as a new label.");
    }
    const key = id ?? this.createUidForLabel(parsed);
    // One atomic storage write: a failed save leaves the original and other labels intact.
    this.saveObject(key, parsed);
    return { ...parsed, id: key };
  }

  static deleteLabel(id: string) {
    if (!id.startsWith("saved_label_")) throw new Error("Invalid label ID");
    localStorage.removeItem(id);
  }

  static loadLabelDraft(): LabelDraft | null {
    return this.loadAndValidateObject("label_workspace_draft", LabelDraftSchema);
  }

  static saveLabelDraft(draft: LabelDraft) {
    this.validateAndSaveObject("label_workspace_draft", draft, LabelDraftSchema);
  }

  static appendLabels(labels: ExportedLabelTemplate[]): {
    zodErrors: z.ZodError[];
    otherErrors: Error[];
  } {
    const zodErrors: z.ZodError[] = [];
    const otherErrors: Error[] = [];
    const parsedLabels: ExportedLabelTemplate[] = [];

    for (const label of labels) {
      try {
        const parsed = ExportedLabelTemplateSchema.omit({ id: true }).parse(label);
        if (parsed.timestamp === undefined) {
          parsed.timestamp = Math.floor(Date.now() / 1000);
        }
        parsedLabels.push(parsed);
      } catch (e) {
        if (e instanceof z.ZodError) {
          zodErrors.push(e);
        } else {
          otherErrors.push(e instanceof Error ? e : new Error(String(e)));
        }
      }
    }

    if (zodErrors.length !== 0 || otherErrors.length !== 0) {
      return { zodErrors, otherErrors };
    }

    const createdKeys: string[] = [];

    try {
      for (const label of parsedLabels) {
        const key = this.createUidForLabel(label);
        this.validateAndSaveObject(key, label, ExportedLabelTemplateSchema.omit({ id: true }));
        createdKeys.push(key);
      }
    } catch (e) {
      createdKeys.forEach((key) => localStorage.removeItem(key));

      if (e instanceof z.ZodError) {
        zodErrors.push(e);
      } else {
        otherErrors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }

    return { zodErrors, otherErrors };
  }

  /**
   * @throws {z.ZodError}
   */
  static loadLabels(): ExportedLabelTemplate[] {
    const legacyLabel = this.loadAndValidateObject("saved_canvas_props", LabelPropsSchema);
    const legacyCanvas = this.loadAndValidateObject("saved_canvas_data", FabricJsonSchema);
    const items: ExportedLabelTemplate[] = [];

    if (legacyLabel !== null && legacyCanvas !== null) {
      localStorage.removeItem("saved_canvas_props");
      localStorage.removeItem("saved_canvas_data");
      const item: ExportedLabelTemplate = {
        label: legacyLabel,
        canvas: legacyCanvas,
        timestamp: Math.floor(Date.now() / 1000),
      };
      this.validateAndSaveObject(`saved_label_${item.timestamp}`, item, ExportedLabelTemplateSchema);
    }

    Object.keys(localStorage)
      .sort()
      .forEach((key) => {
        if (key.startsWith("saved_label")) {
          try {
            const item = this.loadAndValidateObject(key, ExportedLabelTemplateSchema);
            if (item != null) {
              item.id = key;
              items.push(item);
            }
          } catch (e) {
            console.error(e);
          }
        }
      });

    return items;
  }

  /**
   * @throws {z.ZodError}
   */
  static savePreviewProps(props: PreviewProps) {
    this.validateAndSaveObject("saved_preview_props", props, PreviewPropsSchema);
  }

  /**
   * @throws {z.ZodError}
   */
  static loadSavedPreviewProps(): PreviewProps | null {
    return this.loadAndValidateObject("saved_preview_props", PreviewPropsSchema);
  }

  /**
   * @throws {z.ZodError}
   */
  static saveLabelPresets(presets: LabelPreset[]) {
    this.validateAndSaveObject("label_presets", presets, z.array(LabelPresetSchema));
  }

  /**
   * @throws {z.ZodError}
   */
  static loadLabelPresets(): LabelPreset[] | null {
    const presets = this.loadAndValidateObject("label_presets", z.array(LabelPresetSchema));
    return presets === null || presets.length === 0 ? null : presets;
  }

  static loadLastConnectionType(): ConnectionType | null {
    const value = localStorage.getItem("connection_type");
    if (value === null || !["bluetooth", "serial"].includes(value)) {
      return null;
    }
    return value as ConnectionType;
  }

  static saveLastConnectionType(value: ConnectionType) {
    localStorage.setItem("connection_type", value);
  }

  /**
   * @throws {z.ZodError}
   */
  static saveAutomation(value?: AutomationProps) {
    this.validateAndSaveObject("automation", value, AutomationPropsSchema);
  }

  /**
   * @throws {z.ZodError}
   */
  static loadAutomation(): AutomationProps | null {
    return this.loadAndValidateObject("automation", AutomationPropsSchema);
  }

  /**
   * @throws {z.ZodError}
   */
  static saveDefaultTemplate(value?: ExportedLabelTemplate) {
    this.validateAndSaveObject("default_template", value, ExportedLabelTemplateSchema.omit({ id: true }));
  }

  /**
   * @throws {z.ZodError}
   */
  static loadDefaultTemplate(): ExportedLabelTemplate | null {
    return this.loadAndValidateObject("default_template", ExportedLabelTemplateSchema);
  }

  static hasCustomDefaultTemplate(): boolean {
    return "default_template" in localStorage;
  }

  /**
   * @throws {z.ZodError}
   */
  static saveCachedFonts(fonts: string[]) {
    this.validateAndSaveObject("font_cache", fonts, z.array(z.string()));
  }

  /**
   * @throws {z.ZodError}
   */
  static loadCachedFonts(): string[] {
    return this.loadAndValidateObject("font_cache", z.array(z.string())) ?? [];
  }
}
