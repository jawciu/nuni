"use client";
import { create } from "zustand";
import {
  ActiveTransform,
  ChatMsg,
  ControlSpec,
  DEFAULT_PARAMS,
  Params,
  Print,
  SavedOption,
} from "./types";

type State = {
  params: Params;
  controls: ControlSpec[];
  prints: Print[];
  activePrintId: string | null;
  messages: ChatMsg[];
  busy: boolean;
  status: string | null;
  reference: string | null; // uploaded photo, before isolation
  sandbox: { id: string; url: string } | null;
  /** The model-written transform currently driving the sliders, or null when the print is
   *  whatever came out of generation or isolation. */
  transform: ActiveTransform | null;
  /** Looks she kept, oldest first, so the row reads left to right the way a lay-down does. */
  options: SavedOption[];
  /** Which kept look is on screen, or null the moment anything is changed away from it. */
  activeOptionId: string | null;

  setParams: (patch: Partial<Params>) => void;
  setAt: (path: string, value: number) => void;
  addControls: (c: ControlSpec[]) => void;
  clearControls: () => void;
  addPrint: (p: Print) => void;
  updatePrint: (id: string, patch: Partial<Print>) => void;
  removePrint: (id: string) => void;
  setActivePrint: (id: string | null) => void;
  push: (m: ChatMsg) => void;
  patchLast: (m: Partial<ChatMsg>) => void;
  setBusy: (b: boolean, status?: string | null) => void;
  setReference: (url: string | null) => void;
  setSandbox: (s: { id: string; url: string } | null) => void;
  setTransform: (t: ActiveTransform | null) => void;
  saveOption: (o: SavedOption) => void;
  removeOption: (id: string) => void;
  restoreOption: (id: string) => void;
};

/** Options hold a whole params object each and are compared against live params, so they are
 *  copied rather than aliased. Everything in there is plain data. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Write a dotted path into a nested object without mutating the original. */
function writePath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const out: any = { ...obj };
  let cur = out;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = { ...cur[keys[i]] };
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return out;
}

export function readPath(obj: any, path: string): number {
  return path.split(".").reduce((a, k) => (a == null ? a : a[k]), obj);
}

export const useStore = create<State>((set) => ({
  params: DEFAULT_PARAMS,
  controls: [],
  prints: [],
  activePrintId: null,
  messages: [],
  busy: false,
  status: null,
  reference: null,
  sandbox: null,
  transform: null,
  options: [],
  activeOptionId: null,

  // any change to the params is a step away from the kept look, so the highlight on the
  // saved row lets go the moment she touches anything
  setParams: (patch) =>
    set((s) => ({ params: { ...s.params, ...patch }, activeOptionId: null })),
  setAt: (path, value) =>
    set((s) => {
      const params = writePath(s.params, path, value);
      // the transform carries its own copy of the values, because the re-run needs them
      // together with the code that reads them
      const transform =
        s.transform && path.startsWith("transform.")
          ? { ...s.transform, params: { ...s.transform.params, [path.slice(10)]: value } }
          : s.transform;
      return { params, transform, activeOptionId: null };
    }),
  addControls: (c) =>
    set((s) => {
      // replacing by id means "give me a bigger range for size" swaps the slider
      const byId = new Map(s.controls.map((x) => [x.id, x]));
      for (const x of c) byId.set(x.id, x);
      return { controls: [...byId.values()] };
    }),
  clearControls: () => set({ controls: [] }),
  // a new print is a new look, so the highlight on the saved row lets go with it
  addPrint: (p) =>
    set((s) => ({ prints: [...s.prints, p], activePrintId: p.id, activeOptionId: null })),
  updatePrint: (id, patch) =>
    set((s) => ({ prints: s.prints.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  removePrint: (id) =>
    set((s) => {
      const prints = s.prints.filter((p) => p.id !== id);
      return {
        prints,
        // fall back to the most recent survivor rather than leaving the garment bare
        activePrintId:
          s.activePrintId === id ? (prints.at(-1)?.id ?? null) : s.activePrintId,
        // only when the one on the garment went: deleting a print she is not looking at
        // leaves the look, and the kept option it matches, exactly as it was
        activeOptionId: s.activePrintId === id ? null : s.activeOptionId,
      };
    }),
  // swapping the print is a step away from the kept look too, same as moving a slider
  setActivePrint: (id) => set({ activePrintId: id, activeOptionId: null }),
  saveOption: (o) =>
    set((s) => ({ options: [...s.options, o], activeOptionId: o.id })),
  removeOption: (id) =>
    set((s) => ({
      options: s.options.filter((o) => o.id !== id),
      activeOptionId: s.activeOptionId === id ? null : s.activeOptionId,
    })),
  restoreOption: (id) =>
    set((s) => {
      const o = s.options.find((x) => x.id === id);
      if (!o) return s;
      return {
        // one write, so the print and the numbers land on the same render and the garment
        // never flashes the new placement carrying the old print
        params: clone(o.params),
        // a print deleted since the option was kept leaves the garment as it is rather than
        // stripping it bare
        activePrintId:
          o.printId && s.prints.some((p) => p.id === o.printId) ? o.printId : s.activePrintId,
        activeOptionId: o.id,
      };
    }),
  push: (m) => set((s) => ({ messages: [...s.messages, m] })),
  patchLast: (m) =>
    set((s) => {
      if (!s.messages.length) return s;
      const msgs = s.messages.slice();
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...m };
      return { messages: msgs };
    }),
  setBusy: (busy, status = null) => set({ busy, status }),
  setReference: (reference) => set({ reference }),
  setSandbox: (sandbox) => set({ sandbox }),
  setTransform: (t) =>
    set((s) => ({
      transform: t,
      // seed the live values so a slider has something to read the moment it appears
      params: { ...s.params, transform: t ? { ...t.params } : {} },
      // a slider left over from the previous transform would read a value nothing writes
      controls: s.controls.filter(
        (c) =>
          !c.target.startsWith("transform.") ||
          (t ? c.target.slice(10) in t.params : false),
      ),
    })),
}));

// a handle for driving the scene from the console while building
if (typeof window !== "undefined") {
  (window as unknown as { nuni: unknown }).nuni = useStore;
}
