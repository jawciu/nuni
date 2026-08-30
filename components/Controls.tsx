"use client";
import { readPath, useStore } from "@/lib/store";
import { ControlSpec } from "@/lib/types";

/** A fixed number of decimals, taken from the step, so the readout never
 *  jitters between one digit and two while it is being dragged. */
function format(value: number, step: number) {
  const dp = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return value.toFixed(dp);
}

function Slider({ spec }: { spec: ControlSpec }) {
  const value = useStore((s) => readPath(s.params, spec.target));
  const setAt = useStore((s) => s.setAt);

  const v = typeof value === "number" ? value : spec.min;
  const span = Math.max(spec.max - spec.min, 1e-9);
  const at = Math.min(1, Math.max(0, (v - spec.min) / span));

  // A control that runs either side of zero fills outwards from the middle,
  // so rotation and offset show which side of centre they are on rather than
  // how far they are from their minimum, which means nothing to anyone.
  const bipolar = spec.min < 0 && spec.max > 0;
  const zero = bipolar ? (0 - spec.min) / span : 0;
  const a = bipolar ? Math.min(at, zero) : 0;
  const b = bipolar ? Math.max(at, zero) : at;

  const style = {
    "--p": at,
    "--a": a,
    "--b": b,
    "--z": zero,
  } as React.CSSProperties;

  return (
    <label className="nuni-ctl" style={style}>
      <span className="nuni-ctl-label">{spec.label}</span>
      <span className="nuni-ctl-readout">
        <span className="nuni-ctl-value">
          {format(v, spec.step)}
          {spec.unit ? <span className="nuni-ctl-unit">{spec.unit}</span> : null}
        </span>
      </span>
      <span className="nuni-ctl-track" {...(bipolar ? { "data-zero": "" } : {})}>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={v}
          aria-label={spec.label}
          onChange={(e) => setAt(spec.target, parseFloat(e.target.value))}
          className="nuni-range"
        />
      </span>
    </label>
  );
}

/**
 * The controls float over the garment, bottom right.
 *
 * They are dragged while you are looking at the print, so putting them at the
 * foot of the chat column meant your hand was in one place and your eye in
 * another. Over the canvas they sit an inch from the thing they change.
 *
 * There is no empty state: the panel does not exist until the agent authors a
 * control, so it reads as something that arrived rather than chrome that was
 * always waiting. Pointer events are stopped at the panel so dragging a
 * handle never reaches the orbit controls behind it, and the panel is the
 * only part of the canvas that is not orbitable.
 */
export function Controls() {
  const controls = useStore((s) => s.controls);
  if (!controls.length) return null;
  return (
    <div
      className="nuni-controls pointer-events-auto absolute right-5 bottom-5 z-20 w-[278px] select-none rounded-xl border border-white/10 bg-[rgba(13,12,11,0.72)] px-4 pt-3.5 pb-4 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="text-[9.5px] uppercase tracking-[0.22em] text-stone-400">
          controls
        </span>
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-[9px] tabular-nums text-stone-600">
          {controls.length}
        </span>
      </div>
      <div className="space-y-3.5">
        {controls.map((c) => (
          <Slider key={c.id} spec={c} />
        ))}
      </div>
    </div>
  );
}
