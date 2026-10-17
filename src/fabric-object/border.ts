import * as fabric from "fabric";
import {
  BORDER_ANCHORS,
  BORDER_PRESETS,
  DEFAULT_BORDER_SETTINGS,
  borderMinimumSize,
  borderPathsSvg,
  layoutBorder,
  type BorderSettings,
} from "$/utils/border_layout";

export interface BorderProps extends fabric.FabricObjectProps, BorderSettings {}
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
    Object.assign(this, DEFAULT_BORDER_SETTINGS, { width: 160, height: 80, strokeWidth: 0, fill: "none" });
    const { width = 160, height = 80, ...otherOptions } = options;
    this.setOptions(otherOptions);
    this.set({ width, height });
    this.ensureMinimumSize();
    this.lockScalingFlip = true;
    this.lockSkewingX = this.lockSkewingY = true;
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

  private ensureMinimumSize() {
    super._set("width", Math.max(this.width, this.minimumSize));
    super._set("height", Math.max(this.height, this.minimumSize));
  }

  override _set(key: string, value: any): this {
    if (key in LIMITS) {
      if (!Number.isFinite(value)) return this;
      const [min, max] = LIMITS[key];
      value = Math.max(min, Math.min(max, value));
    }
    if (key === "preset" && !Object.hasOwn(BORDER_PRESETS, value)) value = "rounded";
    if (key === "decorationAnchor" && !BORDER_ANCHORS.includes(value)) value = "top";
    if (key === "borderColor" && !/^#[0-9a-f]{6}$/i.test(value)) value = "#000000";
    if ((key === "width" || key === "height") && this.decorationSize !== undefined) {
      if (!Number.isFinite(value)) return this;
      value = Math.max(this.minimumSize, value);
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
      ctx.lineWidth = this.lineWidth / part.scale;
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
      borderPathsSvg(layoutBorder(width, height, this), this.lineWidth),
      "</g></g>",
    ];
  }

  override toObject(propertiesToInclude: any[] = []) {
    return super.toObject([...BORDER_PROPS, ...propertiesToInclude]);
  }
}

fabric.classRegistry.setClass(LabelBorder);
