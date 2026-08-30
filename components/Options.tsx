"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { saveOption } from "@/lib/options";

/**
 * The lay-down.
 *
 * A print designer does not arrive at one answer, she builds a range and then puts it all out
 * on the table and chooses. Everything before this could only ever hold the single current
 * state, so the moment anything moved the version before it was gone.
 *
 * It lives bottom left, over the garment and opposite the controls, because these are looks
 * she is comparing against the thing on screen rather than a list she is filing. The keep
 * button is anchored to the corner and never moves, and the row grows upwards out of it, so
 * her hand goes to the same place every time while presenting. Pointer events stop at the
 * panel, so nothing here reaches the orbit controls behind it.
 *
 * There is no empty state. Until something is kept there is only the button.
 */
export function Options() {
  const options = useStore((s) => s.options);
  const activeId = useStore((s) => s.activeOptionId);
  const hasPrint = useStore((s) => !!s.activePrintId);
  const restoreOption = useStore((s) => s.restoreOption);
  const removeOption = useStore((s) => s.removeOption);
  const [kept, setKept] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const count = options.length;

  // the newest one is the one she just made, so it should be the one she can see
  useEffect(() => {
    row.current?.scrollTo({ left: 1e6, behavior: "smooth" });
  }, [count]);

  async function keep() {
    const saved = await saveOption();
    if (!saved) return;
    setKept(true);
    window.setTimeout(() => setKept(false), 1100);
  }

  // nothing on the garment yet, so there is nothing worth keeping
  if (!hasPrint && !count) return null;

  return (
    <div
      className="pointer-events-auto absolute bottom-5 right-5 z-20 flex max-w-[calc(100%-2.5rem)] flex-col items-end gap-2.5 select-none xl:right-auto xl:left-5 xl:max-w-[calc(100%-330px)] xl:items-start"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {count > 0 && (
        <div className="nuni-controls w-full rounded-xl border border-white/10 bg-[rgba(13,12,11,0.72)] px-3.5 pt-3 pb-3 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md">
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className="text-[9.5px] uppercase tracking-[0.22em] text-stone-400">
              saved
            </span>
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[9px] tabular-nums text-stone-600">{count}</span>
          </div>
          <div ref={row} className="flex gap-2 overflow-x-auto pb-0.5">
            {options.map((o) => (
              <figure key={o.id} className="group relative shrink-0">
                <button
                  onClick={() => restoreOption(o.id)}
                  title={`${o.name}, ${o.params.mode}`}
                  className={`block h-[90px] w-[68px] rounded-sm border bg-[#0b0a09] bg-cover bg-center transition ${
                    o.id === activeId
                      ? "border-rose-400/80"
                      : "border-white/10 hover:border-white/30"
                  }`}
                  style={{ backgroundImage: `url(${o.thumb})` }}
                />
                <button
                  onClick={() => removeOption(o.id)}
                  aria-label={`delete ${o.name}`}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-stone-900 text-[10px] leading-none text-stone-400 ring-1 ring-white/15 group-hover:flex hover:text-stone-100"
                >
                  ×
                </button>
                <figcaption
                  className={`mt-1 w-[68px] truncate text-[9px] ${
                    o.id === activeId ? "text-stone-200" : "text-stone-400"
                  }`}
                >
                  {o.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={keep}
        title="keep this look, so you can change anything and still come back to it"
        className="flex items-center gap-2 rounded-full border border-white/10 bg-[rgba(13,12,11,0.72)] px-3.5 py-2 text-[9.5px] uppercase tracking-[0.22em] text-stone-300 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md transition hover:border-white/25 hover:text-stone-50"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full transition ${
            kept ? "bg-rose-400" : "bg-rose-400/60"
          }`}
        />
        {kept ? "kept" : "keep this look"}
      </button>
    </div>
  );
}
