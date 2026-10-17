import * as fabric from "fabric";
import { borderImageAtSize, borderImageHref, prepareBorderImages } from "$/utils/border_images";
import { BORDER_PACKAGES, findBorderPackage, type BorderPreset } from "$/utils/border_catalog";
import {
  BORDER_ANCHORS,
  DEFAULT_BORDER_SETTINGS,
  borderDefaultAnchor,
  isBorderPreset,
  borderMinimumSize,
  borderMinimumDimensions,
  borderPathsSvg,
  layoutBorder,
  type BorderSettings,
} from "$/utils/border_layout";

export interface BorderProps extends fabric.FabricObjectProps, BorderSettings {
  borderId?: string;
  borderVersion?: string;
}
export interface SerializedBorderProps extends fabric.SerializedObjectProps, BorderSettings {}
const BORDER_PROPS = Object.keys(DEFAULT_BORDER_SETTINGS) as (keyof BorderSettings)[];
const LIMITS: Record<string, [number, number]> = {
  decorationSize: [4, 80],
  patternSpacing: [0, 80],
  lineWidth: [0.5, 12],
  inset: [0, 60],
};

/** A border is one editable object; resizing lays out its parts rather than scaling their artwork. */
export class LabelBorder
  extends fabric.FabricObject<Partial<BorderProps>, SerializedBorderProps>
  implements BorderSettings
{
  static override readonly type = "LabelBorder";
  static override cacheProperties = [...fabric.FabricObject.cacheProperties, ...BORDER_PROPS];
  declare preset: BorderSettings["preset"];
  declare decorationSize: number;
  declare decorationAnchor: BorderSettings["decorationAnchor"];
  declare patternSpacing: number;
  declare lineWidth: number;
  declare inset: number;
  declare borderColor: string;

  constructor(options: Partial<BorderProps> = {}) {
    super();
    const border = findBorderPackage(options.borderId ?? options.preset ?? "rounded");
    if (options.borderId && !border) throw new Error(`Unknown border package: ${options.borderId}`);
    if (options.borderVersion && border && options.borderVersion !== border.version)
      throw new Error(`Unsupported border version: ${border.id}@${options.borderVersion}`);
    if (options.borderId) options = { ...options, preset: border!.legacyPreset };
    Object.assign(this, DEFAULT_BORDER_SETTINGS, border?.defaults, {
      width: 160,
      height: 80,
      strokeWidth: 0,
      fill: "none",
    });
    const { width = 160, height = 80, ...otherOptions } = options;
    this.setOptions(otherOptions);
    this.set({ width, height });
    this.ensureMinimumSize();
    this.lockScalingFlip = true;
    this.lockSkewingX = this.lockSkewingY = true;
    void prepareBorderImages()
      .then(() => {
        this.dirty = true;
        this.canvas?.requestRenderAll();
      })
      .catch((error) => console.error("Border artwork could not be loaded", error));
    // Default scale handles deform artwork. Resize width/height with Fabric's fixed-anchor wrapper instead.
    this.controls = fabric.controlsUtils.createObjectDefaultControls();
    for (const [name, control] of Object.entries(this.controls)) {
      if (name === "mtr") continue;
      const resize: fabric.TransformActionHandler = (event, transform, x, y) => {
        const changeX = name !== "mt" && name !== "mb";
        const changeY = name !== "ml" && name !== "mr";
        const changedX = changeX && fabric.controlsUtils.changeObjectWidth(event, transform, x, y);
        const changedY = changeY && fabric.controlsUtils.changeObjectHeight(event, transform, x, y);
        return changedX || changedY;
      };
      control.actionHandler = fabric.controlsUtils.wrapWithFireEvent(
        "resizing",
        fabric.controlsUtils.wrapWithFixedAnchor(resize),
      );
      control.actionName = "resizing";
      control.getActionName = () => "resizing";
      control.cursorStyleHandler = fabric.controlsUtils.scaleCursorStyleHandler;
    }
  }

  get minimumSize(): number {
    return borderMinimumSize(this);
  }

  get minimumDimensions(): { width: number; height: number } {
    return borderMinimumDimensions(this);
  }

  private ensureMinimumSize() {
    super._set("width", Math.max(this.width, this.minimumDimensions.width));
    super._set("height", Math.max(this.height, this.minimumDimensions.height));
  }

  override _set(key: string, value: any): this {
    if (key in LIMITS) {
      if (!Number.isFinite(value)) return this;
      const [min, max] = LIMITS[key];
      value = Math.max(min, Math.min(max, value));
    }
    if (key === "preset") {
      if (!isBorderPreset(value)) value = "rounded";
      super._set("decorationAnchor", borderDefaultAnchor(value));
    }
    if (key === "decorationAnchor" && !BORDER_ANCHORS.includes(value)) value = "top";
    if (key === "borderColor" && !/^#[0-9a-f]{6}$/i.test(value)) value = "#000000";
    if ((key === "width" || key === "height") && this.decorationSize !== undefined) {
      if (!Number.isFinite(value)) return this;
      value = Math.max(this.minimumDimensions[key], value);
    }
    super._set(key, value);
    if (["preset", "decorationSize", "inset", "lineWidth"].includes(key) && this.decorationSize !== undefined)
      this.ensureMinimumSize();
    return this;
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    // Also preserve artwork size when a multi-selection or a restored object carries a scale transform.
    const { x: sx, y: sy } = this.getObjectScaling();
    const width = this.width * sx;
    const height = this.height * sy;
    ctx.save();
    ctx.scale(1 / sx, 1 / sy);
    ctx.translate(-width / 2, -height / 2);
    ctx.strokeStyle = ctx.fillStyle = this.borderColor;
    ctx.lineCap = ctx.lineJoin = "round";
    for (const part of layoutBorder(width, height, this)) {
      ctx.save();
      ctx.translate(part.x, part.y);
      ctx.scale(part.scale, part.scale);
      if (part.matrix) ctx.transform(...part.matrix);
      if (part.image) {
        const source = { width: part.imageWidth!, height: part.imageHeight! };
        const transform = ctx.getTransform();
        const image = borderImageAtSize(
          part.image,
          this.borderColor,
          source.width * Math.hypot(transform.a, transform.b),
        );
        // High-resolution ink art needs area filtering when printed at small label sizes.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        if (image) ctx.drawImage(image, 0, 0, source.width, source.height);
        ctx.restore();
        continue;
      }
      ctx.lineWidth = (this.lineWidth * (part.weight ?? 1)) / part.scale;
      ctx.setLineDash((part.dash ?? []).map((n) => n / part.scale));
      const path = new Path2D(part.d);
      if (part.filled) ctx.fill(path);
      else ctx.stroke(path);
      ctx.restore();
    }
    ctx.restore();
  }

  override _toSVG(): string[] {
    const { x: sx, y: sy } = this.getObjectScaling();
    const width = this.width * sx;
    const height = this.height * sy;
    return [
      "<g ",
      "COMMON_PARTS",
      `><g color="${this.borderColor}" transform="scale(${1 / sx} ${1 / sy}) translate(${-width / 2} ${-height / 2})">`,
      borderPathsSvg(layoutBorder(width, height, this), this.lineWidth, (name) =>
        borderImageHref(name, this.borderColor),
      ),
      "</g></g>",
    ];
  }

  override toObject(propertiesToInclude: any[] = []) {
    const border = BORDER_PACKAGES[this.preset as BorderPreset];
    return {
      ...super.toObject([...BORDER_PROPS, ...propertiesToInclude]),
      ...(border ? { borderId: border.id, borderVersion: border.version } : {}),
    };
  }

  static override async fromObject<T extends fabric.TOptions<fabric.SerializedObjectProps>>(
    object: T,
    options?: fabric.Abortable,
  ) {
    const reference = object as T & { borderId?: string; borderVersion?: string; preset?: string };
    if (reference.borderId) {
      const border = findBorderPackage(reference.borderId);
      if (!border) throw new Error(`Unknown border package: ${reference.borderId}`);
      if (reference.borderVersion && reference.borderVersion !== border.version)
        throw new Error(`Unsupported border version: ${reference.borderId}@${reference.borderVersion}`);
      object = { ...object, preset: border.legacyPreset };
    } else if (reference.preset !== undefined && !isBorderPreset(reference.preset)) {
      throw new Error(`Unknown border preset: ${reference.preset}`);
    }
    await prepareBorderImages();
    return super.fromObject(object, options);
  }
}

fabric.classRegistry.setClass(LabelBorder);
