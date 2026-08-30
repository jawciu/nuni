import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { client, PORT } from "@/lib/daytona";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Replace the server the sandbox is running with the one in this checkout, and wait for it
 *  to answer again. The weights reload, which costs a few seconds, once. */
async function refreshServer(sandbox: {
  fs: { uploadFiles: (f: { source: Buffer; destination: string }[]) => Promise<unknown> };
  process: {
    executeCommand: (c: string) => Promise<{ result?: string }>;
  };
}) {
  const server = readFileSync(join(process.cwd(), "sandbox", "server.py"), "utf8");
  await sandbox.fs.uploadFiles([
    { source: Buffer.from(server), destination: "/opt/server.py" },
  ]);
  await sandbox.process.executeCommand("pkill -f 'uvicorn server:app' || true");
  await sandbox.process.executeCommand(
    `cd /opt && HF_HOME=/opt/hf nohup python -m uvicorn server:app --host 0.0.0.0 --port ${PORT} > /tmp/server.log 2>&1 & echo restarted`,
  );
  for (let i = 0; i < 40; i++) {
    const h = await sandbox.process
      .executeCommand(
        `python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:${PORT}/health',timeout=3).read().decode())" 2>/dev/null || true`,
      )
      .catch(() => ({ result: "" }));
    if ((h.result ?? "").includes('"ok"')) return;
  }
}

/**
 * Running code a language model wrote.
 *
 * This is the one thing in nuni that genuinely cannot happen anywhere else. The agent writes
 * real Python against the print (posterise it, halftone it, recolour it, mirror it into a
 * half-drop) and that code has to execute somewhere that does not care if it is hostile or
 * simply wrong. Not the browser, where it would run inside the user's page. Not the app
 * server, where it would run next to the API keys. A disposable sandbox.
 */
export async function POST(req: Request) {
  const { id, imageB64, code, params = {} } = await req.json();
  if (!id) return NextResponse.json({ error: "no sandbox" }, { status: 400 });

  try {
    const d = client();
    const sandbox = await d.get(id);
    const stamp = Date.now();
    const inPath = `/opt/tin-${stamp}.b64`;
    const codePath = `/opt/tcode-${stamp}.py`;
    const outPath = `/opt/tout-${stamp}.png`;

    await sandbox.fs.uploadFiles([
      { source: Buffer.from(imageB64), destination: inPath },
      { source: Buffer.from(code), destination: codePath },
    ]);

    const runner = `
import base64, json, urllib.request
b64 = open("${inPath}").read().strip()
code = open("${codePath}").read()
req = urllib.request.Request(
    "http://localhost:${PORT}/transform",
    data=json.dumps({"image_b64": b64, "code": code, "params": ${JSON.stringify(params)}}).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    r = json.load(urllib.request.urlopen(req, timeout=120))
except urllib.error.HTTPError as e:
    # a sandbox warmed before /transform existed is still serving the older file
    print(json.dumps({"stale": e.code}))
    raise SystemExit(0)
if "error" in r:
    print(json.dumps({"error": r["error"]}))
else:
    open("${outPath}", "wb").write(base64.b64decode(r["png_b64"]))
    print(json.dumps({"ms": r["ms"], "size": r["size"]}))
`.trim();

    let run = await sandbox.process.codeRun(runner);
    if (run.exitCode !== 0) {
      return NextResponse.json({ error: run.result?.slice(-800) }, { status: 500 });
    }
    let meta = JSON.parse((run.result ?? "{}").trim().split("\n").pop()!);

    if (meta.stale) {
      // The box was warmed from an older server.py and has no /transform. Push the current
      // one, restart it and go again, rather than making someone throw the sandbox away and
      // wait out another install.
      await refreshServer(sandbox);
      run = await sandbox.process.codeRun(runner);
      if (run.exitCode !== 0) {
        return NextResponse.json({ error: run.result?.slice(-800) }, { status: 500 });
      }
      meta = JSON.parse((run.result ?? "{}").trim().split("\n").pop()!);
      if (meta.stale) {
        return NextResponse.json(
          { error: "the sandbox is not serving /transform" },
          { status: 500 },
        );
      }
    }
    if (meta.error) {
      // hand the traceback back to the agent so it can correct its own code
      await sandbox.process.executeCommand(`rm -f ${inPath} ${codePath}`).catch(() => {});
      return NextResponse.json({ codeError: meta.error });
    }

    const png = await sandbox.fs.downloadFile(outPath);
    await sandbox.process
      .executeCommand(`rm -f ${inPath} ${codePath} ${outPath}`)
      .catch(() => {});

    return NextResponse.json({
      pngB64: Buffer.from(png).toString("base64"),
      ...meta,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
