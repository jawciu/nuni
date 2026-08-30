"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { warmSandbox } from "@/lib/sandbox-client";
import { runRestylePrint } from "@/lib/blend";
import { runSaveOption } from "@/lib/options";
import {
  CONTROL_TARGETS,
  ControlSpec,
  TransformParam,
  isControlTarget,
} from "@/lib/types";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type Turn = { role: "user" | "assistant"; content: unknown };

/** Behind every swatch, so you can see what is actually transparent rather than guessing. */
const CHECKER =
  "repeating-conic-gradient(#2a2724 0% 25%, #1e1c1a 0% 50%)";

/** Whatever a print is behind the scenes, as bare base64 the sandbox can read. */
async function urlToB64(url: string): Promise<string> {
  if (url.startsWith("data:")) return url.split(",")[1];
  const blob = await fetch(url).then((r) => r.blob());
  return new Promise<string>((res) => {
    const fr = new FileReader();
    fr.onload = () => res((fr.result as string).split(",")[1]);
    fr.readAsDataURL(blob);
  });
}

type TransformResult = {
  pngB64?: string;
  ms?: number;
  size?: [number, number];
  codeError?: string;
  error?: string;
};

function postTransform(
  id: string,
  imageB64: string,
  code: string,
  params: Record<string, number>,
): Promise<TransformResult> {
  return fetch("/api/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, imageB64, code, params }),
  }).then((x) => x.json());
}

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
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const refB64 = useRef<string | null>(null);
  // the warm-up starts on page load and takes a moment. Someone who types straight away
  // should wait for it, not be told to come back later.
  const warming = useRef<Promise<{ id: string; url: string | null } | null> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hinted, setHinted] = useState(false);
  // the print the transform runs against, held once. Every re-run goes back to this, never
  // to the last output, or four drags of a posterise slider leave four colours of mush.
  const transformSrc = useRef<string | null>(null);
  const ranWith = useRef<string | null>(null); // the values the last run used
  const running = useRef(false);

  useEffect(() => {
    warming.current = warmSandbox((step) => useStore.getState().setBusy(true, step)).then(
      (s) => {
        useStore.getState().setBusy(false, null);
        if (s) useStore.getState().setSandbox({ id: s.id, url: s.url ?? "" });
        return s;
      },
    );
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [store.messages, store.controls]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  // the first time something lands on the garment, say that this is a conversation and not a
  // one-shot, because nothing else on screen tells you that
  useEffect(() => {
    if (!hinted && store.prints.length > 0) setHinted(true);
  }, [store.prints.length, hinted]);

  // a transform slider is a round trip to a gpu, so wait for the hand to settle first
  const transformValues = JSON.stringify(store.params.transform);
  useEffect(() => {
    if (!useStore.getState().transform || !transformSrc.current) return;
    if (ranWith.current === transformValues) return;
    const timer = setTimeout(() => void rerunTransform(), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformValues]);

  /** The warm-up is already in flight when the page loads, so wait on it rather than
   *  telling someone who typed straight away to come back later. */
  async function ensureSandbox(): Promise<string | null> {
    const id = useStore.getState().sandbox?.id;
    if (id) return id;
    useStore.getState().setBusy(true, "waiting for the gpu");
    return (await warming.current)?.id ?? useStore.getState().sandbox?.id ?? null;
  }

  /** A slider moved, so run the same code again with the new numbers. Always against the
   *  print the transform was built from, never against its own last output. */
  async function rerunTransform() {
    const st = useStore.getState();
    const t = st.transform;
    const src = transformSrc.current;
    if (!t || !src || running.current) return;
    const id = st.sandbox?.id;
    if (!id) return;

    const values = { ...st.params.transform };
    ranWith.current = JSON.stringify(values);
    running.current = true;
    st.setBusy(true, `re-running ${t.label}`);
    const r = await postTransform(id, src, t.code, values);
    running.current = false;
    useStore.getState().setBusy(false, null);

    if (r.pngB64) {
      useStore
        .getState()
        .updatePrint(t.outputPrintId, { url: `data:image/png;base64,${r.pngB64}` });
    }
    // the slider may well have moved again while that was in the air
    const now = JSON.stringify(useStore.getState().params.transform);
    if (now !== ranWith.current) void rerunTransform();
  }

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
      return { ok: true, note: "on the garment already, it came back transparent" };
    }

    if (name === "restyle_print") return runRestylePrint(refB64.current, input);

    if (name === "save_option") return runSaveOption(input);

    if (name === "isolate_print") {
      if (!refB64.current) return { ok: false, error: "no reference photo uploaded yet" };

      let sandboxId = s.sandbox?.id;
      if (!sandboxId) {
        s.setBusy(true, "waiting for the gpu");
        sandboxId = (await warming.current)?.id ?? useStore.getState().sandbox?.id;
      }
      if (!sandboxId) {
        return { ok: false, error: "the gpu sandbox could not be reached" };
      }

      s.setBusy(true, `cutting it out with ${input.model}`);
      const r = await fetch("/api/isolate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sandboxId,
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

    if (name === "transform_print") {
      const src = s.prints.find((p) => p.id === s.activePrintId);
      if (!src) {
        return { ok: false, error: "there is no print on the garment to transform yet" };
      }

      const sandboxId = await ensureSandbox();
      if (!sandboxId) return { ok: false, error: "the gpu sandbox could not be reached" };

      const code = String(input.code ?? "");
      const label = (input.label as string) ?? "transformed";
      const declared = ((input.params ?? []) as TransformParam[]).filter(
        (p) => p && typeof p.name === "string" && isControlTarget(`transform.${p.name}`),
      );
      const values: Record<string, number> = {};
      for (const p of declared) values[p.name] = Number(p.default ?? 0);

      s.setBusy(true, "running your code on the gpu");
      const b64 = await urlToB64(src.url);
      const r = await postTransform(sandboxId, b64, code, values);
      useStore.getState().setBusy(false, null);

      if (r.codeError) {
        // not a failure, this is the loop working. The traceback goes back to the model and
        // it writes the next version itself.
        return {
          ok: false,
          codeError: r.codeError,
          hint: "that traceback is from the python you wrote. fix it and call transform_print again.",
        };
      }
      if (r.error || !r.pngB64) return { ok: false, error: r.error ?? "no image came back" };

      const outId = crypto.randomUUID();
      useStore.getState().addPrint({
        id: outId,
        url: `data:image/png;base64,${r.pngB64}`,
        label,
        source: "transformed",
        note: input.why as string,
      });

      transformSrc.current = b64;
      ranWith.current = JSON.stringify(values);
      useStore.getState().setTransform({
        sourcePrintId: src.id,
        outputPrintId: outId,
        code,
        label,
        params: values,
      });
      if (declared.length) {
        useStore.getState().addControls(
          declared.map((p) => ({
            id: `transform.${p.name}`,
            label: p.label ?? p.name,
            target: `transform.${p.name}`,
            min: p.min,
            max: p.max,
            step: p.step,
          })),
        );
      }

      return {
        ok: true,
        ms: r.ms,
        size: r.size,
        note: "added as a new print, the original is still in the list",
        controls: declared.map((p) => p.label),
      };
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

  function clearReference() {
    refB64.current = null;
    useStore.getState().setReference(null);
  }

  function send() {
    if (!input.trim() || store.busy) return;
    turn(input.trim());
  }

  return (
    <div className="flex h-full flex-col border-r border-white/8 bg-[#131110]">
      <header className="px-5 pb-3 pt-4">
        <h1 className="text-[13px] lowercase tracking-[0.42em] text-stone-100">nuni</h1>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 pb-4">
        {!store.messages.length && (
          <div className="space-y-4 pt-1">
            <p className="text-[13px] leading-relaxed text-stone-300">
              Say what you want on the garment. Ask to play with something and the dial for it
              turns up beside it.
            </p>
            <div>
              <div className="mb-2 text-[9px] uppercase tracking-[0.18em] text-stone-400">
                try one
              </div>
              <div className="space-y-1.5">
                {OPENERS.map((o) => (
                  // the same lilac rule the person's own messages carry, because that
                  // is exactly what these are: a line you could have typed
                  <button
                    key={o}
                    onClick={() => turn(o)}
                    className="block w-full rounded-md border border-white/12 border-l-2 border-l-[color:var(--nuni-lilac)] bg-white/6 px-3 py-2.5 text-left text-[12px] leading-snug text-stone-200 transition hover:bg-white/10 hover:text-stone-50"
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {store.messages.map((m, i) => (
          <div key={i} className="text-[13px] leading-relaxed">
            {m.role === "user" ? (
              <p className="border-l-2 border-[var(--nuni-lilac)] pl-3 text-stone-300">
                {m.text}
              </p>
            ) : (
              <p className={m.pending ? "nuni-shimmer" : "text-stone-100"}>
                {m.text || (m.pending ? "thinking" : "")}
              </p>
            )}
          </div>
        ))}

        {store.status && (
          <div className="flex items-center gap-2 text-[12px]">
            <span className="nuni-breathe h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
            <span className="nuni-shimmer">{store.status}</span>
          </div>
        )}
      </div>

      {(hinted || store.reference || store.prints.length > 0) && (
        <div className="border-t border-white/8">
          {/* the invitation to keep going sits above the prints, not under them.
              Below the strip it was the last thing on the panel and read as a
              footnote, which is the opposite of what it is asking for. */}
          {hinted && (
            <p className="px-5 pt-3 text-[12px] leading-snug text-stone-300">
              Keep going. Ask for a change and the dial for it turns up beside the garment.
            </p>
          )}
          {(store.reference || store.prints.length > 0) && (
            <div className="px-5 pb-3 pt-3">
              <div className="mb-2 text-[9px] uppercase tracking-[0.18em] text-stone-400">
                prints
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {store.reference && (
                  <figure className="shrink-0">
                    <div
                      className="h-16 w-16 rounded-sm border border-white/10 bg-cover bg-center opacity-50"
                      style={{ backgroundImage: `url(${store.reference})` }}
                    />
                    <figcaption className="mt-1 text-[9px] text-stone-400">
                      reference
                    </figcaption>
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
                    <figcaption className="mt-1 w-16 truncate text-[9px] text-stone-400">
                      {p.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f?.type.startsWith("image/")) onFile(f);
        }}
        className="px-4 pb-4 pt-1"
      >
        <div
          className={`rounded-lg border bg-[#1a1817] transition ${
            dragging ? "border-rose-400/60 bg-rose-400/5" : "border-white/12 focus-within:border-white/30"
          }`}
        >
          {store.reference && (
            <div className="flex items-center gap-2 px-3 pt-3">
              <span
                className="h-9 w-9 shrink-0 rounded border border-white/12 bg-cover bg-center"
                style={{ backgroundImage: `url(${store.reference})` }}
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-stone-400">
                reference attached, say what to cut out of it
              </span>
              <button
                onClick={clearReference}
                aria-label="remove the attached image"
                className="shrink-0 text-[13px] leading-none text-stone-400 hover:text-stone-100"
              >
                ×
              </button>
            </div>
          )}

          <textarea
            ref={boxRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              store.prints.length
                ? "ask for a change"
                : "describe the print you want on the garment"
            }
            className="block max-h-[140px] w-full resize-none bg-transparent px-3 pb-2 pt-3 text-[13px] leading-relaxed text-stone-100 placeholder:text-stone-500 focus:outline-none"
          />

          <div className="flex items-center justify-between px-2 pb-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="attach a photo of your own artwork to cut a motif out of"
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 01-7.78-7.78l8.49-8.49a3.67 3.67 0 015.18 5.18l-8.48 8.49a1.83 1.83 0 01-2.6-2.6l7.79-7.78"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />

            <button
              type="button"
              onClick={send}
              disabled={!input.trim() || store.busy}
              aria-label="send"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-100 text-stone-900 transition disabled:bg-white/8 disabled:text-stone-600"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 19V5M5 12l7-7 7 7"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
