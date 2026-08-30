"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { warmSandbox } from "@/lib/sandbox-client";
import { CONTROL_TARGETS, ControlSpec, isControlTarget } from "@/lib/types";
import { Controls } from "./Controls";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type Turn = { role: "user" | "assistant"; content: unknown };

const OPENERS = [
  "generate a print of koi carp in bleached indigo and put it on the tee",
  "cut the flowers out of this photo",
  "let me play with the size",
  "tile it across everything instead",
];

export function ChatPanel() {
  const store = useStore();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const refB64 = useRef<string | null>(null);

  useEffect(() => {
    warmSandbox((step) => useStore.getState().setBusy(true, step)).then((s) => {
      useStore.getState().setBusy(false, null);
      if (s) useStore.getState().setSandbox({ id: s.id, url: s.url ?? "" });
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [store.messages, store.controls]);

  /** Runs one tool the model asked for and hands back what to tell it. */
  async function runTool(name: string, input: Record<string, unknown>) {
    const s = useStore.getState();

    if (name === "set_params") {
      const { mode, targets, ...paths } = input as Record<string, never>;
      if (mode) s.setParams({ mode: mode as never });
      if (targets) s.setParams({ targets: targets as never });
      const bad: string[] = [];
      for (const [k, v] of Object.entries(paths)) {
        if (typeof v !== "number") continue;
        if (!isControlTarget(k)) {
          bad.push(k);
          continue;
        }
        s.setAt(k, v);
      }
      if (bad.length) {
        return { ok: false, unknownParams: bad, valid: CONTROL_TARGETS };
      }
      return { ok: true, targets: useStore.getState().params.targets };
    }

    if (name === "add_controls") {
      const asked = (input.controls ?? []) as ControlSpec[];
      const good = asked.filter((c) => isControlTarget(c.target));
      const bad = asked.filter((c) => !isControlTarget(c.target)).map((c) => c.target);
      if (good.length) s.addControls(good);
      if (bad.length) {
        // a slider bound to a path that does not exist would move and change nothing
        return { ok: false, unknownTargets: bad, valid: CONTROL_TARGETS, shown: good.map((c) => c.label) };
      }
      return { ok: true, shown: good.map((c) => c.label) };
    }

    if (name === "set_colours") {
      const next = { ...s.params.colours };
      if (typeof input.tee === "string") next.tee = input.tee;
      if (typeof input.trews === "string") next.trews = input.trews;
      s.setParams({ colours: next });
      return { ok: true, colours: next };
    }

    if (name === "clear_controls") {
      s.clearControls();
      return { ok: true };
    }

    if (name === "generate_print") {
      s.setBusy(true, "drawing it");
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: input.prompt }),
      }).then((x) => x.json());
      s.setBusy(false, null);
      if (r.error) return { ok: false, error: r.error };
      s.addPrint({
        id: crypto.randomUUID(),
        url: `data:image/png;base64,${r.pngB64}`,
        label: (input.label as string) ?? "print",
        source: "generated",
      });
      return { ok: true, note: "on the cloth already, it came back transparent" };
    }

    if (name === "isolate_print") {
      if (!refB64.current) return { ok: false, error: "no reference photo uploaded yet" };
      if (!s.sandbox?.id) return { ok: false, error: "the gpu sandbox is not up yet" };
      s.setBusy(true, `cutting it out with ${input.model}`);
      const r = await fetch("/api/isolate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: s.sandbox.id,
          imageB64: refB64.current,
          model: input.model,
        }),
      }).then((x) => x.json());
      s.setBusy(false, null);
      if (r.error) return { ok: false, error: r.error };
      s.addPrint({
        id: crypto.randomUUID(),
        url: `data:image/png;base64,${r.pngB64}`,
        label: (input.label as string) ?? "cut-out",
        source: "isolated",
        note: input.why as string,
      });
      return { ok: true, ms: r.ms, size: r.size };
    }

    return { ok: false, error: `no tool called ${name}` };
  }

  async function turn(userText: string) {
    const s = useStore.getState();
    s.push({ role: "user", text: userText });
    s.push({ role: "assistant", text: "", pending: true, actions: [] });

    let convo: Turn[] = [...history, { role: "user", content: userText }];
    setInput("");

    for (let hop = 0; hop < 6; hop++) {
      const st = useStore.getState();
      const ctx = {
        mode: st.params.mode,
        placement: st.params.placement,
        repeat: st.params.repeat,
        targets: st.params.targets,
        controlsOnScreen: st.controls.map((c) => c.target),
        prints: st.prints.map((p) => p.label),
        colours: st.params.colours,
        hasReference: !!refB64.current,
        sandboxReady: !!st.sandbox?.id,
      };

      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: convo, context: ctx }),
      }).then((x) => x.json());

      if (r.error) {
        useStore.getState().patchLast({ text: `something broke: ${r.error}`, pending: false });
        return;
      }

      // the API decorates tool_use with fields it will not accept back, so hand it only
      // the shape it defined
      const blocks = (r.content as Block[]).map((b) =>
        b.type === "tool_use"
          ? { type: "tool_use" as const, id: b.id, name: b.name, input: b.input }
          : b,
      );
      const said = blocks
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n")
        .trim();
      if (said) useStore.getState().patchLast({ text: said });

      const calls = blocks.filter((b) => b.type === "tool_use") as Extract<Block, { type: "tool_use" }>[];
      if (!calls.length) {
        useStore.getState().patchLast({ pending: false });
        convo = [...convo, { role: "assistant", content: blocks }];
        setHistory(convo);
        return;
      }

      const results = [];
      for (const c of calls) {
        useStore.getState().patchLast({
          actions: [...(useStore.getState().messages.at(-1)?.actions ?? []), c.name],
        });
        const out = await runTool(c.name, c.input);
        results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) });
      }

      convo = [
        ...convo,
        { role: "assistant", content: blocks },
        { role: "user", content: results },
      ];
    }

    useStore.getState().patchLast({ pending: false });
    setHistory(convo);
  }

  async function onFile(f: File) {
    const b64 = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res((fr.result as string).split(",")[1]);
      fr.readAsDataURL(f);
    });
    refB64.current = b64;
    useStore.getState().setReference(`data:${f.type};base64,${b64}`);
  }

  return (
    <div className="flex h-full flex-col border-r border-stone-800 bg-[#141210]">
      <header className="flex items-baseline justify-between border-b border-stone-800 px-4 py-3">
        <h1 className="text-[15px] lowercase tracking-[0.24em] text-stone-100">nuni</h1>
        <span className="text-[10px] text-stone-600">
          {store.sandbox?.id ? "gpu ready" : "gpu warming"}
        </span>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!store.messages.length && (
          <div className="space-y-2">
            <p className="text-[13px] leading-relaxed text-stone-400">
              Say what you want on the cloth. Ask to play with something and the dial for it
              turns up here.
            </p>
            {OPENERS.map((o) => (
              <button
                key={o}
                onClick={() => turn(o)}
                className="block w-full rounded border border-stone-800 px-3 py-2 text-left text-[12px] text-stone-400 transition hover:border-stone-600 hover:text-stone-200"
              >
                {o}
              </button>
            ))}
          </div>
        )}

        {store.messages.map((m, i) => (
          <div key={i} className="text-[13px] leading-relaxed">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-stone-600">
              {m.role === "user" ? "you" : "nuni"}
            </div>
            <div className={m.role === "user" ? "text-stone-300" : "text-stone-100"}>
              {m.text || (m.pending ? "…" : "")}
            </div>
            {!!m.actions?.length && (
              <div className="mt-1 flex flex-wrap gap-1">
                {m.actions.map((a, j) => (
                  <span
                    key={j}
                    className="rounded-full border border-stone-800 px-2 py-0.5 text-[10px] text-stone-500"
                  >
                    {a.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {store.status && (
          <div className="flex items-center gap-2 text-[12px] text-stone-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
            {store.status}
          </div>
        )}
      </div>

      {(store.reference || store.prints.length > 0) && (
        <div className="flex gap-2 overflow-x-auto border-t border-stone-800 px-4 py-3">
          {store.reference && (
            <div className="shrink-0">
              <div
                className="h-14 w-14 rounded border border-stone-800 bg-cover bg-center"
                style={{ backgroundImage: `url(${store.reference})` }}
              />
              <div className="mt-1 text-[9px] text-stone-600">reference</div>
            </div>
          )}
          {store.prints.map((p) => (
            <button
              key={p.id}
              onClick={() => store.setActivePrint(p.id)}
              className="shrink-0 text-left"
              title={p.note}
            >
              <div
                className={`h-14 w-14 rounded border bg-contain bg-center bg-no-repeat ${
                  p.id === store.activePrintId ? "border-rose-400" : "border-stone-800"
                }`}
                style={{
                  backgroundImage: `url(${p.url})`,
                  backgroundColor: "#22201d",
                }}
              />
              <div className="mt-1 max-w-14 truncate text-[9px] text-stone-600">{p.label}</div>
            </button>
          ))}
        </div>
      )}

      <Controls />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !store.busy) turn(input.trim());
        }}
        className="flex items-center gap-2 border-t border-stone-800 px-3 py-3"
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded border border-stone-800 px-2 py-1.5 text-[11px] text-stone-500 hover:border-stone-600 hover:text-stone-300"
          title="upload a reference photo"
        >
          photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="say what you want"
          className="flex-1 bg-transparent text-[13px] text-stone-100 placeholder:text-stone-600 focus:outline-none"
        />
      </form>
    </div>
  );
}
