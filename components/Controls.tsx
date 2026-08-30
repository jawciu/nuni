"use client";
import { readPath, useStore } from "@/lib/store";
import { ControlSpec } from "@/lib/types";

function Slider({ spec }: { spec: ControlSpec }) {
  const value = useStore((s) => readPath(s.params, spec.target));
  const setAt = useStore((s) => s.setAt);
  const shown =
    Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return (
    <label className="block select-none">
      <div className="flex items-baseline justify-between text-[11px] tracking-wide">
        <span className="text-stone-300">{spec.label}</span>
        <span className="tabular-nums text-stone-500">
          {shown}
          {spec.unit ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value ?? spec.min}
        onChange={(e) => setAt(spec.target, parseFloat(e.target.value))}
        className="nuni-range mt-1 w-full"
      />
    </label>
  );
}

export function Controls() {
  const controls = useStore((s) => s.controls);
  if (!controls.length) return null;
  return (
    <div className="border-t border-stone-800 px-4 py-3">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-stone-500">
        controls
      </div>
      <div className="space-y-3">
        {controls.map((c) => (
          <Slider key={c.id} spec={c} />
        ))}
      </div>
    </div>
  );
}
