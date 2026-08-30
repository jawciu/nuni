"use client";
import { create } from "zustand";
import { ChatMsg, ControlSpec, DEFAULT_PARAMS, Params, Print } from "./types";

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

  setParams: (patch: Partial<Params>) => void;
  setAt: (path: string, value: number) => void;
  addControls: (c: ControlSpec[]) => void;
  clearControls: () => void;
  addPrint: (p: Print) => void;
  setActivePrint: (id: string | null) => void;
  push: (m: ChatMsg) => void;
  patchLast: (m: Partial<ChatMsg>) => void;
  setBusy: (b: boolean, status?: string | null) => void;
  setReference: (url: string | null) => void;
  setSandbox: (s: { id: string; url: string } | null) => void;
};

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

  setParams: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),
  setAt: (path, value) => set((s) => ({ params: writePath(s.params, path, value) })),
  addControls: (c) =>
    set((s) => {
      // replacing by id means "give me a bigger range for size" swaps the slider
      const byId = new Map(s.controls.map((x) => [x.id, x]));
      for (const x of c) byId.set(x.id, x);
      return { controls: [...byId.values()] };
    }),
  clearControls: () => set({ controls: [] }),
  addPrint: (p) => set((s) => ({ prints: [...s.prints, p], activePrintId: p.id })),
  setActivePrint: (id) => set({ activePrintId: id }),
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
}));

// a handle for driving the scene from the console while building
if (typeof window !== "undefined") {
  (window as unknown as { nuni: unknown }).nuni = useStore;
}
