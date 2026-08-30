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

/** Behind every swatch, so you can see what is actually transparent rather than guessing. */
const CHECKER =
  "repeating-conic-gradient(#2a2724 0% 25%, #1e1c1a 0% 50%)";

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
    <div className="flex h-full flex-col border-r border-white/8 bg-[#131110]">
      <header className="flex items-baseline justify-between px-5 pb-3 pt-4">
        <h1 className="text-[13px] lowercase tracking-[0.42em] text-stone-100">nuni</h1>
        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] text-stone-600">
          <span
            className={`h-1 w-1 rounded-full ${
              store.sandbox?.id ? "bg-emerald-400/70" : "animate-pulse bg-amber-400/70"
            }`}
          />
          {store.sandbox?.id ? "gpu ready" : "gpu warming"}
        </span>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 pb-4">
        {!store.messages.length && (
          <div className="space-y-3 pt-1">
            <p className="text-[13px] leading-relaxed text-stone-500">
              Say what you want on the cloth. Ask to play with something and the dial for it
              turns up here.
            </p>
            <div className="space-y-1.5 pt-1">
              {OPENERS.map((o) => (
                <button
                  key={o}
                  onClick={() => turn(o)}
                  className="block w-full rounded-sm border border-white/8 bg-white/2 px-3 py-2 text-left text-[12px] leading-snug text-stone-400 transition hover:border-white/20 hover:bg-white/4 hover:text-stone-100"
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        )}

        {store.messages.map((m, i) => (
          <div key={i} className="text-[13px] leading-relaxed">
            {m.role === "user" ? (
              <p className="border-l border-white/12 pl-3 text-stone-500">{m.text}</p>
            ) : (
              <>
                <p className="text-stone-100">
                  {m.text || (m.pending ? <span className="text-stone-600">thinking</span> : "")}
                </p>
                {!!m.actions?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.actions.map((a, j) => (
                      <span
                        key={j}
                        className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] tracking-wide text-stone-500"
                      >
                        {a.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </>
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
        <div className="border-t border-white/8 px-5 py-3">
          <div className="mb-2 text-[9px] uppercase tracking-[0.18em] text-stone-600">
            prints
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {store.reference && (
              <figure className="shrink-0">
                <div
                  className="h-16 w-16 rounded-sm border border-white/10 bg-cover bg-center opacity-50"
                  style={{ backgroundImage: `url(${store.reference})` }}
                />
                <figcaption className="mt-1 text-[9px] text-stone-600">reference</figcaption>
              </figure>
            )}
            {store.prints.map((p) => (
              <figure key={p.id} className="group relative shrink-0">
                <button
                  onClick={() => store.setActivePrint(p.id)}
                  title={p.note}
                  className={`block h-16 w-16 rounded-sm border bg-contain bg-center bg-no-repeat transition ${
                    p.id === store.activePrintId
                      ? "border-rose-400/80"
                      : "border-white/10 hover:border-white/25"
                  }`}
                  style={{
                    backgroundImage: `url(${p.url}), ${CHECKER}`,
                    backgroundSize: "contain, 8px 8px",
                  }}
                />
                <button
                  onClick={() => store.removePrint(p.id)}
                  aria-label={`remove ${p.label}`}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-stone-900 text-[10px] leading-none text-stone-400 ring-1 ring-white/15 group-hover:flex hover:text-stone-100"
                >
                  ×
                </button>
                <figcaption className="mt-1 w-16 truncate text-[9px] text-stone-500">
                  {p.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      <Controls />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !store.busy) turn(input.trim());
        }}
        className="flex items-center gap-3 border-t border-white/8 px-5 py-3.5"
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-stone-600 transition hover:text-stone-300"
          title="upload a reference photo to cut a motif out of"
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
