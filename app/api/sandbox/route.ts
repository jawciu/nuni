import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { client, GPU_PREFS, PORT, SETUP_SH } from "@/lib/daytona";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The cut-out models want a GPU, and installing torch's model stack takes minutes, which is
 * far longer than a serverless request lives. So the work is split: create returns as soon as
 * the box exists, install kicks the setup off detached, and the client polls status until the
 * server inside answers. One sandbox stays alive for the whole session with the weights
 * resident, which is what makes every cut-out after the first sub-second.
 */
export async function POST(req: Request) {
  const { action, id } = await req.json();
  const d = client();

  try {
    if (action === "create") {
      // GPU concurrency is capped at one, so a box that is already up is the box we want
      for await (const existing of d.list()) {
        if (String(existing.state).toLowerCase().includes("started")) {
          return NextResponse.json({ id: existing.id, reused: true });
        }
      }

      const sandbox = await d.create(
        {
          image: "pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime",
          // gpuType belongs INSIDE resources. At the top level it is silently ignored and
          // you get handed an H100 at three times the price of the card you asked for.
          resources: { cpu: 8, memory: 16, disk: 40, gpu: 1, gpuType: GPU_PREFS },
          ephemeral: true,
          autoStopInterval: 240,
        } as never,
        { timeout: 300 },
      );
      // the first exec after create pays a warm-up, so spend it on nothing
      await sandbox.process.executeCommand("true").catch(() => {});
      return NextResponse.json({ id: sandbox.id });
    }

    const sandbox = await d.get(id);

    if (action === "install") {
      const server = readFileSync(join(process.cwd(), "sandbox", "server.py"), "utf8");
      await sandbox.fs.uploadFiles([
        { source: Buffer.from(server), destination: "/opt/server.py" },
        { source: Buffer.from(SETUP_SH), destination: "/opt/setup.sh" },
      ]);
      await sandbox.process.executeCommand(
        "chmod +x /opt/setup.sh && nohup /opt/setup.sh > /tmp/setup.log 2>&1 & echo started",
      );
      return NextResponse.json({ started: true });
    }

    if (action === "status") {
      const log = await sandbox.process
        .executeCommand("tail -c 4000 /tmp/setup.log 2>/dev/null || true")
        .catch(() => ({ result: "" }));
      const health = await sandbox.process
        // the pytorch image ships no curl, so ask python
        .executeCommand(
          `python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:${PORT}/health',timeout=3).read().decode())" 2>/dev/null || true`,
        )
        .catch(() => ({ result: "" }));
      const ready = (health.result ?? "").includes('"ok"');
      const text = log.result ?? "";
      const step =
        [...text.matchAll(/STEP (\w+)/g)].map((m) => m[1]).pop() ?? "starting";
      let url: string | null = null;
      if (ready) {
        const link = await sandbox.getPreviewLink(PORT);
        url = link.url;
      }
      return NextResponse.json({ ready, step, url, tail: text.replace(/[\x00-\x08\x0b-\x1f]/g, " ").slice(-600) });
    }

    if (action === "kill") {
      await sandbox.delete();
      return NextResponse.json({ deleted: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
