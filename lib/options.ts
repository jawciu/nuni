"use client";
import { useStore } from "@/lib/store";
import { SavedOption } from "@/lib/types";

/**
 * DROP-IN. One line, inside `runTool` in components/ChatPanel.tsx, next to the other
 * `if (name === ...)` branches:
 *
 *     if (name === "save_option") return runSaveOption(input);
 *
 * and one import at the top of that file:
 *
 *     import { runSaveOption } from "@/lib/options";
 *
 * Nothing else in ChatPanel changes. The tool definition and the system-prompt paragraph are
 * already in `lib/agent.ts`, so until that one line is pasted the agent will call a tool that
 * comes back "no tool called save_option". The button in components/Options.tsx works either
 * way, because it calls into this file directly.
 */

/** 3:4, the shape a garment on a figure wants. */
const THUMB_W = 174;
const THUMB_H = 232;

/** Wait for the scene to actually carry whatever just changed.
 *
 *  A save that follows a set_params in the same turn is asking for a picture of numbers React
 *  has only just committed, and the drawing buffer still holds the frame before them. Three
 *  frames is one for the commit, one for r3f to draw it, and one in hand. */
function settled(): Promise<void> {
  return new Promise((res) => {
    let n = 3;
    const tick = () => (n-- > 0 ? requestAnimationFrame(tick) : res());
    requestAnimationFrame(tick);
  });
}

/**
 * A picture of the garment, not of the print.
 *
 * She is choosing between looks on a body, so a swatch of the flat artwork tells her nothing.
 * `preserveDrawingBuffer` is on for exactly this, so the live buffer can be read at any point.
 * Centre-cropped to portrait and knocked down to a couple of hundred pixels, because a
 * full-size PNG per option would be megabytes of state within a dozen saves.
 */
export function captureThumb(): string | null {
  const canvas = document.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return null;

  // the widest 3:4 window the buffer can give, centred
  const wanted = THUMB_W / THUMB_H;
  let sw = canvas.width;
  let sh = canvas.height;
  if (sw / sh > wanted) sw = sh * wanted;
  else sh = sw / wanted;
  const sx = (canvas.width - sw) / 2;
  const sy = (canvas.height - sh) / 2;

  const out = document.createElement("canvas");
  out.width = THUMB_W;
  out.height = THUMB_H;
  const g = out.getContext("2d");
  if (!g) return null;
  g.drawImage(canvas, sx, sy, sw, sh, 0, 0, THUMB_W, THUMB_H);
  // jpeg, and the scene is opaque anyway: a png of the same frame is roughly ten times the
  // bytes for a thumbnail nobody is going to pixel peep
  return out.toDataURL("image/jpeg", 0.72);
}

/** "option 3", counting the ones already kept, so two saves never collide. */
function nextName(): string {
  const taken = new Set(useStore.getState().options.map((o) => o.name));
  let n = useStore.getState().options.length + 1;
  while (taken.has(`option ${n}`)) n++;
  return `option ${n}`;
}

/**
 * Keep the look currently on screen.
 *
 * Everything that makes it: the params in full, and which print was carrying them, so
 * restoring is exact rather than close.
 */
export async function saveOption(name?: string): Promise<SavedOption | null> {
  await settled();
  const s = useStore.getState();
  const thumb = captureThumb();
  if (!thumb) return null;

  const option: SavedOption = {
    id: crypto.randomUUID(),
    name: (name ?? "").trim() || nextName(),
    thumb,
    printId: s.activePrintId,
    // a copy, never the live object: the params are about to keep moving
    params: JSON.parse(JSON.stringify(s.params)),
    savedAt: Date.now(),
  };
  s.saveOption(option);
  return option;
}

/**
 * `save_option`. Keeps the look on screen so she can go and try another one.
 *
 * No round trip, no sandbox, no model. It reads the store and the drawing buffer, which is
 * why it can sit at the end of a turn that also moved the print.
 */
export async function runSaveOption(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const saved = await saveOption(input.name as string | undefined);
  if (!saved) {
    return { ok: false, error: "the garment view could not be read, nothing was kept" };
  }
  const options = useStore.getState().options;
  return {
    ok: true,
    name: saved.name,
    saved: options.map((o) => o.name),
    note: "kept as a thumbnail under the garment. Clicking it puts the whole look back, so it is safe to change anything now.",
  };
}

// the same kind of handle the store carries: window.nuni is the state, window.nuniOptions
// keeps a look from the console, including through the exact path the agent tool takes
if (typeof window !== "undefined") {
  (window as unknown as { nuniOptions: unknown }).nuniOptions = {
    saveOption,
    runSaveOption,
    captureThumb,
  };
}
