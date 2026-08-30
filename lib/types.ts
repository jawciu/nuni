export type GarmentId = "tee" | "trews";

export type PrintMode = "placed" | "repeat";

export type Print = {
  id: string;
  url: string; // PNG with alpha, data: or blob:
  label: string;
  source: "generated" | "isolated" | "uploaded" | "transformed";
  note?: string; // why the agent cut it the way it did
};

export type Placement = {
  across: number; // -1 left .. 1 right, garment space
  height: number; // 0 hem .. 1 shoulder, garment space
  size: number; // fraction of garment width
  rotation: number; // degrees
};

export type Repeat = {
  scale: number; // centimetres per tile
  rotation: number; // degrees
  offsetX: number;
  offsetY: number;
};

export type Params = {
  mode: PrintMode;
  /** Per garment, because height is measured against that garment's own length: one number
   *  cannot mean "chest" on a cropped tee and "thigh" on a full-length trouser. Repeat stays
   *  shared, because it is quoted in real centimetres and normalised by texel density. */
  placement: Record<GarmentId, Placement>;
  repeat: Repeat;
  targets: GarmentId[]; // which garments carry the print
  colours: Record<GarmentId, string>; // the garment itself, before any print
  /** Live values for whatever the current print transform exposed. The agent names these
   *  itself, so the shape is open: a slider binds to `transform.<name>`. */
  transform: Record<string, number>;
};

/** A parameter the model's transform code exposed, read inside that code as P["name"]. */
export type TransformParam = {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

/** The print transform currently on screen: the Python the model wrote, and the print it
 *  runs against. The source never changes as sliders move, or each drag would compound on
 *  the last output instead of re-cutting the original. */
export type ActiveTransform = {
  sourcePrintId: string;
  outputPrintId: string;
  code: string;
  label: string;
  params: Record<string, number>;
};

/** A control the agent decided you needed. Materialises as a slider. */
export type ControlSpec = {
  id: string;
  label: string;
  target: string; // dotted path into Params, e.g. "placement.size"
  min: number;
  max: number;
  step: number;
  unit?: string;
};

export type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  actions?: string[]; // human-readable trace of what it did
};

export const DEFAULT_PARAMS: Params = {
  mode: "placed",
  placement: {
    tee: { across: 0, height: 0.46, size: 0.44, rotation: 0 },
    trews: { across: -0.32, height: 0.62, size: 0.30, rotation: 0 },
  },
  repeat: { scale: 14, rotation: 0, offsetX: 0, offsetY: 0 },
  targets: ["tee"],
  colours: { tee: "#eae5dd", trews: "#3d4350" },
  transform: {},
};

/** Every path a control is allowed to bind to. An invented target would produce a slider
 *  that silently does nothing, which is the worst possible failure in front of an audience,
 *  so the agent is told off and asked again rather than trusted. */
export const CONTROL_TARGETS = [
  "placement.tee.across",
  "placement.tee.height",
  "placement.tee.size",
  "placement.tee.rotation",
  "placement.trews.across",
  "placement.trews.height",
  "placement.trews.size",
  "placement.trews.rotation",
  "repeat.scale",
  "repeat.rotation",
  "repeat.offsetX",
  "repeat.offsetY",
] as const;

export type ControlTarget = (typeof CONTROL_TARGETS)[number] | `transform.${string}`;

/** Transform params are the one open-ended family: the model names them when it writes the
 *  code, so they cannot be listed ahead of time. The name still has to be a plain
 *  identifier, so a path cannot reach anywhere else in the params object. */
const TRANSFORM_TARGET = /^transform\.[a-z][a-z0-9_]*$/i;

export function isTransformTarget(t: string): t is `transform.${string}` {
  return TRANSFORM_TARGET.test(t);
}

export function isControlTarget(t: string): t is ControlTarget {
  return (CONTROL_TARGETS as readonly string[]).includes(t) || isTransformTarget(t);
}
