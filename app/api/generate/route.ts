import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.NUNI_IMAGE_MODEL ?? "gpt-image-1-mini";

/**
 * Generating a print. This one comes back already transparent, so it goes straight onto the
 * cloth and skips the cut-out step entirely. Two paths in, only one of them needs isolating.
 */
export async function POST(req: Request) {
  const { prompt, size = "1024x1024" } = await req.json();
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await openai.images.generate({
      model: MODEL,
      prompt,
      size: size as "1024x1024",
      background: "transparent",
      output_format: "png",
      quality: "high",
      n: 1,
    } as never);
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: "no image returned" }, { status: 500 });
    return NextResponse.json({ pngB64: b64, model: MODEL });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
