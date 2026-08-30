import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, SYSTEM, TOOLS } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One turn of the conversation, and only one. The client runs whatever tool comes back and
 * calls again with the result, which keeps every request short and lets the panel say what it
 * is doing while a cut-out or a generation is in flight.
 */
export async function POST(req: Request) {
  const { messages, context } = await req.json();
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: [
        { type: "text", text: SYSTEM },
        { type: "text", text: `Right now: ${JSON.stringify(context)}` },
      ],
      tools: TOOLS,
      messages,
    });
    return NextResponse.json({
      content: r.content,
      stop_reason: r.stop_reason,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
