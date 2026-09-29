import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { client } from "@/lib/daytona";

export const runtime = "nodejs";
export const maxDuration = 120;

/** What a box needs to vet a shader: the Khronos reference compiler, and a software GL to
 *  render the test prints with. Checked every call and installed once, so a sandbox warmed
 *  before vetting existed picks it up rather than needing to be thrown away. */
const VET_DEPS = `command -v glslangValidator >/dev/null && python -c "import moderngl" 2>/dev/null && echo ready || (
  apt-get install -y -qq glslang-tools libegl1 libegl-mesa0 libgl1-mesa-dri >/dev/null 2>&1 ||
  (apt-get update -qq && apt-get install -y -qq glslang-tools libegl1 libegl-mesa0 libgl1-mesa-dri >/dev/null)
) && pip install -q --no-cache-dir moderngl && echo installed`;

type Verdict = {
  ok: boolean;
  stage?: string;
  problems?: string[];
  code?: string;
  stats?: Record<string, number>;
  preview_b64?: string;
};

function lastJson(out: string): Verdict {
  const line = out.trim().split("\n").reverse().find((l) => l.startsWith("{"));
  if (!line) throw new Error(`the vetter said nothing useful: ${out.slice(-400)}`);
  return JSON.parse(line);
}

/** Only for working on this without a Daytona key. Vetting on the app server defeats the
 *  point of the sandbox, so it is opt-in by name and never the default. */
function vetHere(job: object): Promise<Verdict> {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", [join(process.cwd(), "sandbox", "vet.py")], {
      env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: "1" },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), 60_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(lastJson(out));
      } catch (e) {
        reject(new Error(`${e instanceof Error ? e.message : e} ${err.slice(-400)}`));
      }
    });
    p.stdin.end(JSON.stringify(job));
  });
}

/**
 * The sandbox's second job: not running the model's code, but deciding whether it may run
 * somewhere else.
 *
 * A Python transform has to execute in the sandbox every time a slider moves, which is a two
 * second round trip on every drag. A shader is different. GLSL can only ever compute a
 * colour, so once the sandbox has read it, compiled it against the reference compiler and
 * watched it render, it can be handed to the browser and run there on every frame. The
 * sandbox pays once, at the moment the model writes the code, and every slider after that is
 * free.
 */
export async function POST(req: Request) {
  const { id, code, params = [], imageB64 } = await req.json();
  const job = { code, params, image_b64: imageB64 };

  try {
    if (process.env.NUNI_VET_LOCAL === "1") {
      return NextResponse.json(await vetHere(job));
    }
    if (!id) return NextResponse.json({ error: "no sandbox" }, { status: 400 });

    const sandbox = await client().get(id);
    const stamp = Date.now();
    const jobPath = `/opt/vet-${stamp}.json`;

    // the vetter travels with every job rather than living in the image, so the rules the
    // browser trusts are always the ones in this checkout
    await sandbox.fs.uploadFiles([
      { source: readFileSync(join(process.cwd(), "sandbox", "vet.py")), destination: "/opt/vet.py" },
      { source: Buffer.from(JSON.stringify(job)), destination: jobPath },
    ]);

    const deps = await sandbox.process.executeCommand(VET_DEPS, undefined, undefined, 90);
    if (!/ready|installed/.test(deps.result ?? "")) {
      return NextResponse.json(
        { error: `could not set the vetter up in the sandbox: ${(deps.result ?? "").slice(-400)}` },
        { status: 500 },
      );
    }

    const run = await sandbox.process.executeCommand(
      // killed a little inside the call's own limit, so a stuck vet never outlives its request
      // and squats on the one GPU box
      `LIBGL_ALWAYS_SOFTWARE=1 timeout -s KILL 50 python /opt/vet.py < ${jobPath}; rm -f ${jobPath}`,
      undefined,
      undefined,
      60,
    );
    return NextResponse.json(lastJson(run.result ?? ""));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
