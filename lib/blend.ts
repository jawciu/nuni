"use client";
import { useStore } from "@/lib/store";

/**
 * DROP-IN. One line, inside `runTool` in components/ChatPanel.tsx, next to the other
 * `if (name === ...)` branches:
 *
 *     if (name === "restyle_print") return runRestylePrint(refB64.current, input);
 *
 * and one import at the top of that file:
 *
 *     import { runRestylePrint } from "@/lib/blend";
 *
 * Nothing else in ChatPanel changes. The tool definition and the system-prompt paragraph
 * that go with it are in `lib/blend-tool.md`.
 */

type BlendResponse = {
  pngB64?: string;
  ms?: number;
  model?: string;
  usedStyleRef?: boolean;
  error?: string;
};

/** Whatever a print is behind the scenes, as bare base64 the API route can read. */
async function urlToB64(url: string): Promise<string> {
  if (url.startsWith("data:")) return url.split(",")[1];
  const blob = await fetch(url).then((r) => r.blob());
  return new Promise<string>((res) => {
    const fr = new FileReader();
    fr.onload = () => res((fr.result as string).split(",")[1]);
    fr.readAsDataURL(blob);
  });
}

/**
 * Re-render a motif in a different technique.
 *
 * The shape comes from one image and the craft comes from the words, or optionally from a
 * second image. Unlike isolation this does redraw the pixels, which is the point: they asked
 * for their drawing as embroidery, and embroidery is not something you can mask out of a
 * photograph. The result comes back transparent and goes straight onto the garment.
 *
 * No sandbox, no GPU. It is one call to the image API, so it works even when the sandbox
 * is still warming.
 */
export async function runRestylePrint(
  refB64: string | null,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const s = useStore.getState();

  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "no prompt, write the technique brief" };

  const active = s.prints.find((p) => p.id === s.activePrintId);
  // the agent says which image carries the shape. Left unsaid, a reference photo they just
  // uploaded is what they mean, and the print on the garment is the fallback.
  const wants = input.source === "print" || input.source === "reference" ? input.source : null;
  const source = wants ?? (refB64 ? "reference" : "print");

  if (source === "reference" && !refB64) {
    return { ok: false, error: "no reference photo uploaded yet" };
  }
  if (source === "print" && !active) {
    return { ok: false, error: "there is no print on the garment to restyle yet" };
  }

  const imageB64 = source === "reference" ? refB64! : await urlToB64(active!.url);

  // the second image is a technique swatch, never a second motif. Only meaningful when the
  // shape came from somewhere else, so a reference cannot be both at once.
  const styleB64 =
    input.techniqueFromReference === true && source === "print" && refB64 ? refB64 : undefined;
  if (input.techniqueFromReference === true && !styleB64) {
    return {
      ok: false,
      error:
        source !== "print"
          ? "the reference is already carrying the shape, it cannot also be the technique"
          : "no reference photo uploaded to take the technique from",
    };
  }

  const label = (input.label as string) ?? "restyled";
  s.setBusy(true, `rendering it as ${label}`);
  const r: BlendResponse = await fetch("/api/blend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageB64, styleB64, prompt }),
  })
    .then((x) => x.json())
    .catch((e) => ({ error: String(e) }));
  useStore.getState().setBusy(false, null);

  if (r.error || !r.pngB64) return { ok: false, error: r.error ?? "no image came back" };

  const st = useStore.getState();
  // a slider left over from a transform would keep re-running that python against the print
  // this one just replaced, and write its result somewhere nobody is looking
  if (st.transform) st.setTransform(null);
  st.addPrint({
    id: crypto.randomUUID(),
    url: `data:image/png;base64,${r.pngB64}`,
    label,
    // it was drawn by an image model, same as generate_print. The union in lib/types.ts has
    // no "restyled" member and this file does not own it.
    source: "generated",
    note: input.why as string,
  });

  return {
    ok: true,
    ms: r.ms,
    usedStyleRef: !!r.usedStyleRef,
    note: "on the garment already, it came back transparent. The original is still in the list.",
  };
}
