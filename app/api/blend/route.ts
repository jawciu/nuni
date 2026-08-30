import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 180;

const MODEL = process.env.NUNI_IMAGE_MODEL ?? "gpt-image-1-mini";

/** png, webp and jpg are all accepted, and a photo someone dropped in could be any of them.
 *  Sniff the magic bytes rather than trusting a name, because the endpoint rejects a
 *  mislabelled part on its declared format and the error does not say so. */
function sniff(b: Buffer): { ext: string; type: string } {
  if (b[0] === 0x89 && b[1] === 0x50) return { ext: "png", type: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8) return { ext: "jpg", type: "image/jpeg" };
  if (b.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", type: "image/webp" };
  return { ext: "png", type: "image/png" };
}

/** toFile buffers into a real File. A bare Buffer is not an Uploadable, and the multipart part
 *  comes out unnamed, which reads as a format error rather than a missing name. */
async function asUpload(b64: string, name: string) {
  const buf = Buffer.from(b64, "base64");
  const { ext, type } = sniff(buf);
  return toFile(buf, `${name}.${ext}`, { type });
}

/**
 * Re-rendering a print in a different technique. The motif goes in as an image and comes back
 * redrawn as embroidery, watercolour, screen print, whatever was asked for, with the shape and
 * composition held.
 *
 * This is `images.edit`, not `images.generate`, because the shape has to survive. Generation
 * from a description would invent a different rose. Isolation would keep the pixels but cannot
 * change how they were made. This is the third thing: their drawing, another craft.
 *
 * `background: "transparent"` with `output_format: "png"` is not optional. The result goes
 * straight onto the garment, and anything opaque reads as a sticker rather than a print.
 *
 * A second image can be handed in as `styleB64`. The API takes an array for `image`, so the
 * motif is always first and the technique swatch second, and the prompt has to say which is
 * which because the model is given no other way to tell them apart.
 */
export async function POST(req: Request) {
  const { imageB64, styleB64, prompt, size = "1024x1024" } = await req.json();
  if (!imageB64) return NextResponse.json({ error: "no image to work from" }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: "no prompt" }, { status: 400 });

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const images = [await asUpload(imageB64, "motif")];
    if (styleB64) images.push(await asUpload(styleB64, "technique"));

    const started = Date.now();
    const r = await openai.images.edit({
      model: MODEL,
      image: images,
      prompt,
      background: "transparent",
      output_format: "png",
      quality: "high",
      size: size as "1024x1024",
      n: 1,
      // only the full-size models take this, and it is what holds the drawing's shape while
      // the technique changes. Sending it to the mini model is a 400.
      ...(MODEL.includes("mini") ? {} : { input_fidelity: "high" as const }),
    });

    const b64 = r.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: "no image returned" }, { status: 500 });
    return NextResponse.json({
      pngB64: b64,
      model: MODEL,
      ms: Date.now() - started,
      usedStyleRef: !!styleB64,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
