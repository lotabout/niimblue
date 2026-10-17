import type * as fabric from "fabric";
import type { CsvParams, ExportedLabelTemplate, LabelProps } from "$/types";

export type UndoState = { undoDisabled: boolean; redoDisabled: boolean };

export class UndoRedo {
  private readonly UNDO_MAX: number = 20;

  private buf: ExportedLabelTemplate[] = [];
  private index: number = 0;

  public paused: boolean = false;

  public onLabelUpdate?: (data: ExportedLabelTemplate) => Promise<void>;
  public onStateUpdate?: (state: UndoState) => void;

  private updateState() {
    this.onStateUpdate?.({
      undoDisabled: this.index === 0,
      redoDisabled: this.index >= this.buf.length - 1,
    });
  }
  async undo() {
    if (this.index > 0 && this.index < this.buf.length) {
      await this.onLabelUpdate?.(this.buf[this.index - 1]);
      this.index--;
    }
    this.updateState();
  }

  async redo() {
    if (this.index < this.buf.length - 1) {
      await this.onLabelUpdate?.(this.buf[this.index + 1]);
      this.index++;
    }
    this.updateState();
  }

  reset() {
    this.buf = [];
    this.index = 0;
    this.updateState();
  }

  push(fabricCanvas: fabric.Canvas, labelProps: LabelProps, csv?: CsvParams) {
    if (this.paused) {
      return;
    }

    const snapshot = JSON.stringify({ label: labelProps, canvas: fabricCanvas.toJSON(), csv });
    if (snapshot === JSON.stringify(this.buf[this.index])) return;
    this.buf = this.buf.slice(0, this.index + 1);
    this.buf.push(JSON.parse(snapshot));

    if (this.buf.length > this.UNDO_MAX) {
      this.buf.shift();
    }

    this.index = this.buf.length - 1;
    this.updateState();
  }
}
