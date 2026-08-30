import { NextResponse } from "next/server";
import { client, PORT } from "@/lib/daytona";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cutting out a motif. The model emits a MASK that is applied to the original pixels, so the
 * artwork survives untouched — nothing is redrawn. That distinction is the whole point for a
 * print, which is why a generative model is the wrong tool for this step even though it is
 * the right tool for the next one.
 *
 * Goes through the sandbox's own filesystem rather than its public preview URL, so there is
 * no token to juggle and the image never leaves the private network.
 */
export async function POST(req: Request) {
  const { id, imageB64, model = "birefnet" } = await req.json();
  if (!id) return NextResponse.json({ error: "no sandbox" }, { status: 400 });

  try {
    const d = client();
    const sandbox = await d.get(id);
    const stamp = Date.now();
    const inPath = `/opt/in-${stamp}.b64`;
    const outPath = `/opt/out-${stamp}.png`;

    await sandbox.fs.uploadFiles([
      { source: Buffer.from(imageB64), destination: inPath },
    ]);

    const script = `
import base64, json, urllib.request
b64 = open("${inPath}").read().strip()
req = urllib.request.Request(
    "http://localhost:${PORT}/isolate",
    data=json.dumps({"image_b64": b64, "model": ${JSON.stringify(model)}}).encode(),
    headers={"Content-Type": "application/json"},
)
r = json.load(urllib.request.urlopen(req, timeout=120))
open("${outPath}", "wb").write(base64.b64decode(r["png_b64"]))
print(json.dumps({"ms": r["ms"], "model": r["model"], "size": r["size"]}))
`.trim();

    const run = await sandbox.process.codeRun(script);
    if (run.exitCode !== 0) {
      return NextResponse.json({ error: run.result?.slice(-800) }, { status: 500 });
    }
    const meta = JSON.parse((run.result ?? "{}").trim().split("\n").pop()!);
    const png = await sandbox.fs.downloadFile(outPath);
    await sandbox.process.executeCommand(`rm -f ${inPath} ${outPath}`).catch(() => {});

    return NextResponse.json({
      pngB64: Buffer.from(png).toString("base64"),
      ...meta,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
