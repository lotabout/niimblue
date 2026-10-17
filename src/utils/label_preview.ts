import { CustomCanvas } from "$/fabric-object/custom_canvas";
import type { ExportedLabelTemplate } from "$/types";
import { FileUtils } from "$/utils/file_utils";

// Only render one offscreen canvas at a time, even when a whole row comes into view.
let renderQueue: Promise<unknown> = Promise.resolve();

export function renderLabelPreview(label: ExportedLabelTemplate, signal: AbortSignal): Promise<string> {
  // Fabric's loader may modify its input. Previews must not change saved documents.
  const snapshot: ExportedLabelTemplate = JSON.parse(JSON.stringify({ label: label.label, canvas: label.canvas }));
  const job = renderQueue.then(async () => {
    signal.throwIfAborted();
    await document.fonts.ready;
    signal.throwIfAborted();

    const canvas = new CustomCanvas(undefined, {
      ...snapshot.label.size,
      enableRetinaScaling: false,
      renderOnAddRemove: false,
      selection: false,
    });
    canvas.setLabelProps(snapshot.label);
    canvas.setHighlightMirror(false);

    try {
      await FileUtils.loadCanvasState(canvas, snapshot.canvas, signal);
      signal.throwIfAborted();
      return FileUtils.makeLabelThumbnail(canvas);
    } finally {
      await canvas.dispose();
    }
  });

  // A failed or cancelled preview must not stop the next card from rendering.
  renderQueue = job.catch(() => undefined);
  return job;
}
