import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { buildSync } from "esbuild";
import {
  createLabelDocument,
  hasLabelChanges,
  labelFingerprint,
  normalizeLabelBaseline,
  restoreLabelDocument,
} from "../src/utils/label_document.ts";

// Bundle the existing browser module so its $/ imports work in Node as they do in Vite.
const bundled = buildSync({
  entryPoints: ["src/utils/persistence.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
});
const { LocalStoragePersistence: persistence } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

let failWrites;
let storageLimit;
beforeEach(() => {
  failWrites = false;
  storageLimit = Infinity;
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value: (key) => storage[key] ?? null },
    setItem: {
      value: (key, value) => {
        if (failWrites) throw new Error("Quota exceeded");
        const size = Object.entries(storage).reduce(
          (total, [storedKey, storedValue]) => total + (storedKey === key ? 0 : storedKey.length + storedValue.length),
          key.length + value.length,
        );
        if (size > storageLimit) throw new DOMException("Local storage quota exceeded", "QuotaExceededError");
        storage[key] = value;
      },
    },
    removeItem: {
      value: (key) => {
        delete storage[key];
      },
    },
  });
  globalThis.localStorage = storage;
});

const label = (overrides = {}) => ({
  title: "Cable",
  label: { size: { width: 240, height: 96 }, printDirection: "left" },
  canvas: { version: "7.4.0", objects: [{ type: "Textbox", text: "Original" }] },
  ...overrides,
});

// The canonical JSON format used by drafts written before compact fingerprints.
const legacyBaseline = (label) => {
  const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sortKeys(value[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(
    sortKeys({ title: label.title ?? "", label: label.label, canvas: label.canvas, csv: label.csv }),
  );
};

test("opening a large image label after an unsaved draft stays within the browser storage quota", () => {
  storageLimit = 5 * 1024 * 1024;
  const src = `data:image/png;base64,${"a".repeat(2 * 1024 * 1024)}`;
  const imageLabel = persistence.saveLabel(label({ canvas: { version: "7.4.0", objects: [{ type: "Image", src }] } }));
  const unsaved = label({ title: "" });
  persistence.saveLabelDraft({ version: 1, label: unsaved, document: createLabelDocument(unsaved) });
  const oldDraft = {
    version: 1,
    label: imageLabel,
    document: { id: imageLabel.id, title: imageLabel.title, baseline: legacyBaseline(imageLabel) },
  };
  assert.throws(
    () => localStorage.setItem("label_workspace_draft", JSON.stringify(oldDraft)),
    (error) => error.name === "QuotaExceededError",
  );
  const document = createLabelDocument(imageLabel, imageLabel.id);
  assert.ok(document.baseline.length < 64);
  persistence.saveLabelDraft({ version: 1, label: imageLabel, document });
  const recovered = persistence.loadLabelDraft();
  assert.equal(recovered.label.canvas.objects[0].src.length, src.length);
  assert.equal(recovered.document.id, imageLabel.id);
  assert.equal(hasLabelChanges(recovered.label, recovered.document.baseline), false);
  assert.equal(persistence.loadLabels().length, 1);
  assert.equal(persistence.loadLabel(imageLabel.id).canvas.objects[0].src.length, src.length);
});

test("old drafts migrate their full comparison baseline while retaining dirty state", () => {
  const original = persistence.saveLabel(label());
  const document = { id: original.id, title: original.title, baseline: legacyBaseline(original) };
  const edited = { ...original, csv: { data: "name\nUnsaved" } };
  localStorage.setItem("label_workspace_draft", JSON.stringify({ version: 1, label: edited, document }));
  const recovered = persistence.loadLabelDraft();
  assert.equal(recovered.document.baseline, labelFingerprint(original));
  assert.equal(hasLabelChanges(recovered.label, recovered.document.baseline), true);
  assert.equal(hasLabelChanges(original, document.baseline), false);
  persistence.saveLabelDraft({ version: 1, label: edited, document });
  const stored = JSON.parse(localStorage.getItem("label_workspace_draft"));
  assert.equal(stored.document.baseline, labelFingerprint(original));
  assert.equal(stored.label.csv.data, "name\nUnsaved");
  assert.equal(normalizeLabelBaseline(""), "");
});

test("first save, in-place save, and Save as preserve identity without touching other labels", () => {
  const original = persistence.saveLabel(label());
  const other = persistence.saveLabel(label({ title: "Other" }));
  const untouched = localStorage.getItem(other.id);
  const edited = label({ canvas: { version: "7.4.0", objects: [{ type: "Textbox", text: "Edited" }] } });
  const updated = persistence.saveLabel(edited, original.id);
  assert.equal(updated.id, original.id);
  assert.equal(persistence.loadLabels().length, 2);
  assert.equal(persistence.loadLabel(original.id).canvas.objects[0].text, "Edited");
  assert.equal(localStorage.getItem(other.id), untouched);
  const copy = persistence.saveLabel({ ...updated, title: "Copy" });
  assert.notEqual(copy.id, original.id);
  assert.equal(persistence.loadLabels().length, 3);
  assert.equal(persistence.loadLabel(original.id).title, "Cable");
  assert.equal(persistence.loadLabel(copy.id).title, "Copy");
});

test("quota or validation failure leaves the original, other labels, and dirty baseline intact", () => {
  const original = persistence.saveLabel(label());
  const other = persistence.saveLabel(label({ title: "Other" }));
  const document = createLabelDocument(original, original.id);
  const before = { ...localStorage };
  const edited = { ...original, csv: { data: "name\nnew" } };
  failWrites = true;
  assert.throws(() => persistence.saveLabel(edited, original.id), /Quota/);
  assert.deepEqual({ ...localStorage }, before);
  assert.notEqual(labelFingerprint(edited), document.baseline);
  failWrites = false;
  assert.throws(() => persistence.saveLabel(label({ label: { size: { width: -1, height: 96 } } }), original.id));
  assert.deepEqual({ ...localStorage }, before);
  assert.ok(persistence.loadLabel(other.id));
});

test("dirty state includes title, dimensions, objects, and CSV, and clears when content is undone", () => {
  const saved = label();
  const document = createLabelDocument(saved, "saved_label_1_0");
  for (const edited of [
    { ...saved, title: "Renamed" },
    { ...saved, label: { ...saved.label, size: { width: 320, height: 96 } } },
    { ...saved, canvas: { ...saved.canvas, objects: [] } },
    { ...saved, csv: { data: "name\nAda" } },
  ])
    assert.notEqual(labelFingerprint(edited), document.baseline);
  assert.equal(labelFingerprint(structuredClone(saved)), document.baseline);
  assert.equal(labelFingerprint({ ...saved, id: "other", timestamp: 42, thumbnailBase64: "new" }), document.baseline);
  assert.equal(
    labelFingerprint({ ...saved, label: { printDirection: "left", size: { height: 96, width: 240 } } }),
    document.baseline,
  );
});

test("recovery keeps unsaved edits separate from the saved original and reconnects future saves", () => {
  const original = persistence.saveLabel(label());
  const document = createLabelDocument(original, original.id);
  const edited = { ...original, csv: { data: "name\nGrace" } };
  persistence.saveLabelDraft({ version: 1, label: edited, document });
  const draft = persistence.loadLabelDraft();
  const restored = restoreLabelDocument(draft, persistence.loadLabel(draft.document.id));
  assert.equal(restored.id, original.id);
  assert.notEqual(labelFingerprint(draft.label), restored.baseline);
  assert.equal(persistence.loadLabel(original.id).csv, undefined);
  const saved = persistence.saveLabel(draft.label, restored.id);
  assert.equal(persistence.loadLabel(saved.id).csv.data, "name\nGrace");
  assert.equal(persistence.loadLabels().length, 1);
});

test("new unnamed drafts recover without entering the library; deleted originals become new documents", () => {
  const initial = label({ title: "" });
  const document = createLabelDocument(initial);
  persistence.saveLabelDraft({ version: 1, label: { ...initial, csv: { data: "A\n1" } }, document });
  const recovered = persistence.loadLabelDraft();
  assert.equal(persistence.loadLabels().length, 0);
  assert.equal(restoreLabelDocument(recovered, null).id, undefined);
  assert.notEqual(labelFingerprint(recovered.label), recovered.document.baseline);
  const saved = persistence.saveLabel(label());
  const other = persistence.saveLabel(label({ title: "Other" }));
  persistence.deleteLabel(saved.id);
  const restored = restoreLabelDocument(
    { version: 1, label: saved, document: createLabelDocument(saved, saved.id) },
    null,
  );
  assert.equal(restored.id, undefined);
  assert.notEqual(labelFingerprint(saved), restored.baseline);
  assert.throws(() => persistence.saveLabel(saved, saved.id), /no longer exists/);
  assert.ok(persistence.loadLabel(other.id));
});

test("draft write failure keeps the previous recoverable draft", () => {
  const saved = persistence.saveLabel(label());
  const draft = { version: 1, label: saved, document: createLabelDocument(saved, saved.id) };
  persistence.saveLabelDraft(draft);
  failWrites = true;
  assert.throws(() => persistence.saveLabelDraft({ ...draft, label: label({ title: "New edit" }) }), /Quota/);
  assert.deepEqual(persistence.loadLabelDraft().label.title, "Cable");
});

test("recovery retains CSV input even while CSV is disabled for the document", () => {
  const current = label();
  persistence.saveLabelDraft({
    version: 1,
    label: current,
    document: createLabelDocument(current),
    csvData: { data: "name\nKeep this while disabled" },
  });
  const recovered = persistence.loadLabelDraft();
  assert.equal(recovered.label.csv, undefined);
  assert.equal(recovered.csvData.data, "name\nKeep this while disabled");
});

test("legacy IDs stay valid and importing never adopts an imported document identity", () => {
  const legacy = label({ timestamp: 123 });
  localStorage.setItem("saved_label_123", JSON.stringify(legacy));
  const loaded = persistence.loadLabels()[0];
  persistence.saveLabel({ ...loaded, title: "Updated legacy" }, loaded.id);
  assert.equal(persistence.loadLabels().length, 1);
  const errors = persistence.appendLabels([{ ...legacy, id: loaded.id }]);
  assert.deepEqual(errors, { zodErrors: [], otherErrors: [] });
  assert.equal(persistence.loadLabels().length, 2);
  assert.equal(persistence.loadLabel(loaded.id).title, "Updated legacy");
});

test("undo snapshots isolate mutable label settings and CSV; new documents reset history", async () => {
  const { UndoRedo } = await import("../src/utils/undo_redo.ts");
  const history = new UndoRedo();
  const props = label().label;
  const csv = { data: "name\nAda" };
  const canvas = { toJSON: () => label().canvas };
  const updates = [];
  let lastState;
  history.onLabelUpdate = async (value) => {
    updates.push(value);
  };
  history.onStateUpdate = (value) => {
    lastState = value;
  };
  history.push(canvas, props, csv);
  props.size.width = 320;
  csv.data = "name\nGrace";
  history.push(canvas, props, csv);
  await history.undo();
  assert.equal(updates[0].label.size.width, 240);
  assert.equal(updates[0].csv.data, "name\nAda");
  history.reset();
  history.push(canvas, label().label);
  await history.undo();
  assert.equal(updates.length, 1);
  assert.deepEqual(lastState, { undoDisabled: true, redoDisabled: true });
});

test("editing after undoing to the first state replaces the abandoned redo branch", async () => {
  const { UndoRedo } = await import("../src/utils/undo_redo.ts");
  const history = new UndoRedo();
  let text = "A";
  const canvas = { toJSON: () => ({ version: "7.4.0", objects: [{ text }] }) };
  const updates = [];
  let lastState;
  history.onLabelUpdate = async (value) => {
    updates.push(value.canvas.objects[0].text);
  };
  history.onStateUpdate = (value) => {
    lastState = value;
  };
  history.push(canvas, label().label);
  text = "B";
  history.push(canvas, label().label);
  await history.undo();
  text = "C";
  history.push(canvas, label().label);
  assert.deepEqual(lastState, { undoDisabled: false, redoDisabled: true });
  await history.undo();
  await history.redo();
  assert.deepEqual(updates, ["A", "A", "C"]);
});

test("remote recovery preserves the saved revision and baseline offline, and switching servers detaches identity", () => {
  const saved = label();
  const document = {
    ...createLabelDocument(saved, "884ec8c6-8a3d-4acc-a236-a106a50b2205"),
    storageKey: "remote:https://storage.example.com",
    storageRevision: 3,
  };
  const draft = { version: 1, label: { ...saved, title: "Offline edit" }, document };
  persistence.saveLabelDraft(draft);
  const recovered = persistence.loadLabelDraft();
  assert.equal(recovered.document.storageRevision, 3);
  const restored = restoreLabelDocument(recovered, label({ title: "Newer remote version" }), document.storageKey);
  assert.deepEqual(restored, document);
  assert.notEqual(labelFingerprint(recovered.label), restored.baseline);
  for (const target of ["local", "remote:https://another.example.com"]) {
    const detached = restoreLabelDocument(recovered, null, target);
    assert.equal(detached.id, undefined);
    assert.equal(detached.storageRevision, undefined);
    assert.equal(detached.storageKey, target);
    assert.equal(detached.baseline, "");
  }
});

test("recovery detaches a different user's draft on the same service", () => {
  const saved = label();
  const scope = "remote:https://storage.example.com#user:alice";
  const document = { ...createLabelDocument(saved, "alice-label"), storageKey: scope, storageRevision: 2 };
  const draft = { version: 1, label: saved, document };
  const own = restoreLabelDocument(draft, null, scope);
  assert.equal(own.id, "alice-label");
  assert.equal(own.storageRevision, 2);
  const other = restoreLabelDocument(draft, saved, "remote:https://storage.example.com#user:bob");
  assert.equal(other.id, undefined);
  assert.equal(other.storageRevision, undefined);
  assert.equal(other.baseline, "");
});
