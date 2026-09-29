"""Vet a model-written print shader before it is allowed anywhere near the browser.

The agent writes the body of one GLSL function, `vec4 nuniLive(vec2 uv)`. Once it passes here
the browser compiles it into the garment's own shader and every slider on it moves at 60fps,
with no round trip. So this file is the whole of the trust decision, and it runs in the
sandbox for the same reason the Python transforms do: it is where the model's code is allowed
to be wrong, or hostile, without costing anything.

Three gates, in order, and the first failure stops the run:

1. **Shape.** The body is read as text and held to a small grammar: no preprocessor, no
   declarations that reach outside the function, braces that never close past the function's
   own, loops with literal bounds only, a hard cap on texture reads. GLSL can already only
   compute a colour, so what is left to guard is a stall (an unbounded loop hangs the GPU) and
   an escape (a stray brace that lets the body define things at file scope).
2. **Compile.** glslangValidator, the Khronos reference compiler, against GLSL ES 3.00, which
   is what WebGL 2 speaks. A desktop compiler would wave through `float x = 1;`, and the
   browser would then refuse it.
3. **Render.** The shader runs on test prints, and on the real one when it is supplied, at
   every slider's default, minimum and maximum. It fails if it produces NaN, if it erases the
   print, if it changes nothing, or if any slider moves nothing, because a slider that moves
   and changes nothing is the worst thing that can happen in front of an audience.

Reads one JSON job on stdin, writes one JSON verdict on stdout. Imported by nothing, so it can
be pushed to a box on its own and run without restarting the isolation server.
"""

import base64
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time

import numpy as np
from PIL import Image

MAX_CHARS = 4000
MAX_LOOP = 16  # iterations of any single loop
MAX_SAMPLES = 32  # texture reads per fragment, loops multiplied out
MAX_PARAMS = 4
MAX_COST = 60.0  # render time against a plain passthrough of the same print

PARAM_NAME = re.compile(r"^[a-z][a-z0-9_]{0,23}$")

# words that would let the body reach past its own function or past the print
FORBIDDEN = [
    (r"#", "no preprocessor lines"),
    (r"\b(uniform|varying|attribute|in|out|inout|layout|precision|struct|const)\b",
     "no declarations or qualifiers, only local variables"),
    (r"\b(while|do|goto|switch|case|break|continue|discard)\b",
     "only `for` loops with literal bounds, no while, do, switch, break, continue or discard"),
    (r"\b(texture\w*|sampler\w*|gl_\w+|dFdx|dFdy|fwidth|image\w*)\b",
     "read the print through nuniSample(uv) only"),
    (r"\b(nuni(?!Sample\b|Texel\b)\w*)\b", "only nuniSample and nuniTexel are yours to call"),
    (r"\b[uv][A-Z]\w*\b", "the garment's own uniforms and varyings are off limits"),
    (r"\b(diffuseColor|main)\b", "the garment's own variables are off limits"),
    (r"__", "no double underscores, they are reserved"),
    # the garment's shader is built by three, which #defines PI, EPSILON, RECIPROCAL_PI and
    # friends. `float PI = 3.14;` would pass here and turn into `float 3.14 = 3.14;` there.
    (r"\b[A-Z][A-Z0-9_]*\b", "no all-caps names, three reserves them for its own macros. "
     "Write the number, 3.14159265 for pi"),
]

LOOP_HEADER = re.compile(
    r"for\s*\(\s*int\s+([a-z_]\w*)\s*=\s*(-?\d+)\s*;\s*\1\s*(<|<=)\s*(-?\d+)\s*;"
    r"\s*(?:\1\s*\+\+|\+\+\s*\1|\1\s*\+=\s*1)\s*\)\s*\{",
    re.I,
)


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    return re.sub(r"//[^\n]*", "", src)


def check_shape(code: str, names: list[str]) -> tuple[list[str], dict]:
    """Everything that can be decided by reading. Returns problems and a little accounting."""
    problems: list[str] = []
    if len(code) > MAX_CHARS:
        problems.append(f"the body is {len(code)} characters, keep it under {MAX_CHARS}")
    if not code.isascii():
        problems.append("plain ASCII only")
    if "return" not in code:
        problems.append("the body must return a vec4: the colour, in sRGB, with alpha")

    for pat, why in FORBIDDEN:
        m = re.search(pat, code)
        if m:
            problems.append(f"`{m.group(0)}` is not allowed: {why}")

    # braces and brackets may open and close inside the body but never close past it, or the
    # rest of the body would land at file scope where it could declare anything
    for o, c in ("{}", "()", "[]"):
        depth = 0
        for ch in code:
            depth += (ch == o) - (ch == c)
            if depth < 0:
                problems.append(f"a `{c}` closes something the body never opened")
                break
        else:
            if depth:
                problems.append(f"a `{o}` is never closed")

    # every loop has to be the one shape the compiler can bound
    loops = []  # (start, end, iterations)
    for m in re.finditer(r"\bfor\b", code):
        h = LOOP_HEADER.match(code, m.start())
        if not h:
            problems.append(
                "write every loop as `for (int i = 0; i < 8; i++) { ... }` with literal "
                "bounds and braces"
            )
            continue
        var, lo, op, hi = h.group(1), int(h.group(2)), h.group(3), int(h.group(4))
        n = max(0, hi - lo + (1 if op == "<=" else 0))
        if n > MAX_LOOP:
            problems.append(f"a loop runs {n} times, keep each under {MAX_LOOP + 1}")
        # find the matching close brace of the loop body
        depth, i = 1, h.end()
        while i < len(code) and depth:
            depth += (code[i] == "{") - (code[i] == "}")
            i += 1
        body = code[h.end() : i - 1]
        if re.search(rf"\b{var}\s*(\+\+|--|[-+*/]?=(?!=))", body):
            problems.append(f"the loop counter `{var}` is changed inside its own loop")
        loops.append((m.start(), i, max(n, 1)))

    # texture reads, each multiplied by every loop it sits inside
    samples = 0
    for m in re.finditer(r"\bnuniSample\s*\(", code):
        mult = 1
        for s, e, n in loops:
            if s < m.start() < e:
                mult *= n
        samples += mult
    if samples > MAX_SAMPLES:
        problems.append(
            f"that is {samples} texture reads per pixel with the loops multiplied out, "
            f"keep it to {MAX_SAMPLES}"
        )

    for n in names:
        if not re.search(rf"\bp_{n}\b", code):
            problems.append(f"the slider `{n}` is declared but `p_{n}` is never read")

    return problems, {"samples": samples, "loops": len(loops)}


def source(code: str, names: list[str], version: str) -> str:
    """The same fragment shader the browser builds, minus the garment around it."""
    head = [version, "precision highp float;", "uniform sampler2D uPrint;", "uniform vec2 nuniTexel;"]
    head += [f"uniform float p_{n};" for n in names]
    head += [
        "in vec2 vUv;",
        "out vec4 fragColor;",
        # the test textures are uploaded as raw sRGB bytes, so a plain read is already what
        # the browser's nuniSample hands back after it re-encodes the linear sample
        "vec4 nuniSample(vec2 uv) { return texture(uPrint, uv); }",
        "vec4 nuniLive(vec2 uv) {",
        code,
        "}",
        "void main() { fragColor = nuniLive(vUv); }",
    ]
    return "\n".join(head) + "\n"


def compile_es(code: str, names: list[str]) -> list[str]:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "live.frag")
        with open(path, "w") as f:
            f.write(source(code, names, "#version 300 es"))
        try:
            r = subprocess.run(
                ["glslangValidator", path], capture_output=True, text=True, timeout=10
            )
        except FileNotFoundError:
            return ["the sandbox has no glslangValidator installed"]
        except subprocess.TimeoutExpired:
            return ["the compiler gave up on it"]
        if r.returncode == 0:
            return []
        # the body starts on line 9 of the assembled file, so move the numbers back to the
        # model's own lines before it reads them
        out = []
        for line in (r.stdout + r.stderr).splitlines():
            m = re.match(r"ERROR: [^:]*:(\d+): (.*)", line)
            if m:
                out.append(f"line {max(1, int(m.group(1)) - 8 - len(names))}: {m.group(2)}")
        return out or [(r.stdout + r.stderr).strip()[-600:]]


# ---- render ----------------------------------------------------------------------------

def test_prints() -> dict[str, np.ndarray]:
    """Three prints that between them catch most ways a shader goes wrong: a cut-out motif with
    hard alpha, an opaque gradient through every hue, and a small non-square graphic."""
    n = 192
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1)
    motif = np.zeros((n, n, 4), np.float32)
    r = np.hypot(xx - 0.5, yy - 0.5)
    inside = r < 0.42
    motif[..., 0] = 0.85 * (0.5 + 0.5 * np.sin(xx * 18))
    motif[..., 1] = 0.25 + 0.5 * yy
    motif[..., 2] = 0.35 + 0.4 * (r < 0.2)
    motif[..., 3] = inside

    hue = xx * 6
    grad = np.zeros((n, n, 4), np.float32)
    grad[..., 0] = np.clip(np.abs(hue - 3) - 1, 0, 1)
    grad[..., 1] = np.clip(2 - np.abs(hue - 2), 0, 1)
    grad[..., 2] = np.clip(2 - np.abs(hue - 4), 0, 1)
    grad[..., :3] = grad[..., :3] * (1 - yy[..., None]) + yy[..., None] * 0.5
    grad[..., 3] = 1

    small = np.zeros((48, 80, 4), np.float32)
    small[8:40, 10:70] = (0.1, 0.1, 0.12, 1)
    small[16:32, 20:60] = (0.95, 0.9, 0.2, 1)
    return {"motif": motif, "gradient": grad, "small": small}


def decode_print(b64: str) -> np.ndarray:
    im = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")
    im.thumbnail((384, 384))
    return np.asarray(im, np.float32) / 255.0


class Renderer:
    def __init__(self):
        import moderngl

        os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
        self.mgl = moderngl
        self.ctx = moderngl.create_standalone_context(backend="egl")
        self.quad = self.ctx.buffer(np.array([-1, -1, 1, -1, -1, 1, 1, 1], "f4").tobytes())

    def program(self, code: str, names: list[str]):
        vs = (
            "#version 330\nin vec2 pos;\nout vec2 vUv;\n"
            # row 0 of the uploaded array is the top of the image, and the browser's print
            # uv has v running downwards too (flipY is off), so v = 0 is the top in both
            "void main(){ vUv = vec2(pos.x, -pos.y) * 0.5 + 0.5; gl_Position = vec4(pos, 0, 1); }"
        )
        prog = self.ctx.program(vertex_shader=vs, fragment_shader=source(code, names, "#version 330"))
        vao = self.ctx.vertex_array(prog, [(self.quad, "2f", "pos")])
        return prog, vao

    def render(self, prog, vao, img: np.ndarray, values: dict[str, float]) -> tuple[np.ndarray, float]:
        h, w = img.shape[:2]
        tex = self.ctx.texture((w, h), 4, (np.clip(img, 0, 1) * 255).astype("u1").tobytes())
        tex.repeat_x = tex.repeat_y = True
        tex.use(0)
        fbo = self.ctx.simple_framebuffer((w, h), components=4, dtype="f4")
        fbo.use()
        for k in list(prog):
            if k == "uPrint":
                prog[k].value = 0
            elif k == "nuniTexel":
                prog[k].value = (1 / w, 1 / h)
            elif k.startswith("p_"):
                prog[k].value = float(values.get(k[2:], 0))
        t0 = time.perf_counter()
        vao.render(self.mgl.TRIANGLE_STRIP)
        out = np.frombuffer(fbo.read(components=4, dtype="f4"), "f4").reshape(h, w, 4)
        ms = (time.perf_counter() - t0) * 1000
        tex.release()
        fbo.release()
        # framebuffer rows come back bottom first
        return out[::-1].copy(), ms


def changed(a: np.ndarray, b: np.ndarray) -> float:
    """Fraction of pixels that moved visibly, comparing premultiplied colour so that a change
    hidden under full transparency does not count."""
    pa = np.concatenate([np.clip(a[..., :3], 0, 1) * np.clip(a[..., 3:], 0, 1), np.clip(a[..., 3:], 0, 1)], -1)
    pb = np.concatenate([np.clip(b[..., :3], 0, 1) * np.clip(b[..., 3:], 0, 1), np.clip(b[..., 3:], 0, 1)], -1)
    return float((np.abs(pa - pb).max(-1) > 6 / 255).mean())


def to_png(arr: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(np.nan_to_num(arr), 0, 1) * 255).astype("u1"), "RGBA")


def contact_sheet(rows: list[tuple[str, list[np.ndarray]]]) -> str:
    """Before and after on a chequerboard, so transparency reads, one row per slider."""
    cell = 128
    cols = max(len(r[1]) for r in rows)
    ys, xs = np.mgrid[0:cell * len(rows), 0:cell * cols]
    sheet = Image.fromarray(
        np.where(((xs // 12 + ys // 12) % 2)[..., None], 205, 160).repeat(3, -1).astype("u1")
    ).convert("RGBA")
    board = sheet.crop((0, 0, cell, cell))
    for r, (_, imgs) in enumerate(rows):
        for c, arr in enumerate(imgs):
            im = to_png(arr)
            im.thumbnail((cell, cell))
            tile = board.copy()
            tile.alpha_composite(im, ((cell - im.width) // 2, (cell - im.height) // 2))
            sheet.paste(tile, (c * cell, r * cell))
    buf = io.BytesIO()
    sheet.convert("RGB").save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def check_render(code: str, params: list[dict], real: np.ndarray | None) -> tuple[list[str], dict, str | None]:
    names = [p["name"] for p in params]
    defaults = {p["name"]: float(p["default"]) for p in params}
    r = Renderer()
    try:
        prog, vao = r.program(code, names)
    except Exception as e:  # llvmpipe disagreeing with glslang is rare, but say so if it does
        return [f"compiled for WebGL but would not link: {str(e)[-300:]}"], {}, None
    base_prog, base_vao = r.program("return nuniSample(uv);", [])

    prints = test_prints()
    if real is not None:
        prints = {"your print": real, **prints}

    problems: list[str] = []
    did_something = False
    for label, img in prints.items():
        out, _ = r.render(prog, vao, img, defaults)
        if not np.isfinite(out).all():
            problems.append(f"it produces NaN or infinity on the {label} test print")
            continue
        if img[..., 3].max() > 0 and np.clip(out[..., 3], 0, 1).max() < 0.05:
            problems.append(f"it erases the {label} test print entirely at the default values")
        if changed(img, out) > 0.002:
            did_something = True

    dead = []
    for p in params:
        moved = False
        for img in prints.values():
            lo, _ = r.render(prog, vao, img, {**defaults, p["name"]: float(p["min"])})
            hi, _ = r.render(prog, vao, img, {**defaults, p["name"]: float(p["max"])})
            if not (np.isfinite(lo).all() and np.isfinite(hi).all()):
                problems.append(f"`{p['name']}` produces NaN at one end of its range")
                moved = True
                break
            if changed(lo, hi) > 0.002:
                moved = True
                break
        if not moved:
            dead.append(p["name"])
    for n in dead:
        problems.append(
            f"the slider `{n}` changes nothing between its min and its max, so it would move "
            f"and do nothing. Widen the range or make p_{n} matter."
        )
    if not did_something and not params:
        problems.append("at its default values it leaves the print exactly as it was")
    elif not did_something and not any(p["name"] not in dead for p in params):
        problems.append("it leaves the print exactly as it was, at every setting")

    # cost, against a plain passthrough, on a print big enough for the timing to mean anything
    big = np.tile(prints["gradient"], (4, 4, 1))
    runs = []
    for pr, va in ((base_prog, base_vao), (prog, vao)):
        r.render(pr, va, big, defaults)  # first draw pays for the compile
        runs.append(min(r.render(pr, va, big, defaults)[1] for _ in range(3)))
    cost = runs[1] / max(runs[0], 0.05)
    if cost > MAX_COST:
        problems.append(
            f"it is {cost:.0f} times the cost of drawing the print plainly, keep it under "
            f"{MAX_COST:.0f}: fewer texture reads or smaller loops"
        )

    # the picture the agent gets to look at: the print, then each slider at min, default, max
    show = prints.get("your print", prints["motif"])
    rows = [("default", [show, r.render(prog, vao, show, defaults)[0]])]
    for p in params[:3]:
        rows.append((p["name"], [
            r.render(prog, vao, show, {**defaults, p["name"]: float(v)})[0]
            for v in (p["min"], p["default"], p["max"])
        ]))
    preview = contact_sheet(rows)
    return problems, {"cost": round(cost, 1)}, preview


def vet(job: dict) -> dict:
    t0 = time.perf_counter()
    code = strip_comments(str(job.get("code", ""))).strip()
    params = list(job.get("params") or [])

    problems: list[str] = []
    if len(params) > MAX_PARAMS:
        problems.append(f"{len(params)} sliders, keep it to {MAX_PARAMS}")
    for p in params:
        n = str(p.get("name", ""))
        if not PARAM_NAME.match(n):
            problems.append(f"slider name `{n}` must be lowercase letters, digits and _")
        try:
            lo, hi, d = float(p["min"]), float(p["max"]), float(p["default"])
            if not (np.isfinite([lo, hi, d]).all() and lo < hi and lo <= d <= hi):
                problems.append(f"`{n}` needs min < max with the default between them")
        except (KeyError, TypeError, ValueError):
            problems.append(f"`{n}` needs numeric min, max and default")
    if problems:
        return {"ok": False, "stage": "params", "problems": problems}

    names = [p["name"] for p in params]
    shape, stats = check_shape(code, names)
    if shape:
        return {"ok": False, "stage": "shape", "problems": shape}

    errors = compile_es(code, names)
    if errors:
        return {"ok": False, "stage": "compile", "problems": errors}

    real = decode_print(job["image_b64"]) if job.get("image_b64") else None
    rendered, more, preview = check_render(code, params, real)
    stats.update(more)
    stats["ms"] = round((time.perf_counter() - t0) * 1000)
    if rendered:
        return {"ok": False, "stage": "render", "problems": rendered, "stats": stats, "preview_b64": preview}
    return {"ok": True, "code": code, "stats": stats, "preview_b64": preview}


if __name__ == "__main__":
    try:
        verdict = vet(json.load(sys.stdin))
    except Exception as e:  # a crash in here is ours, not the model's, and it must not pass
        verdict = {"ok": False, "stage": "vetter", "problems": [f"the vetter itself failed: {e}"]}
    print(json.dumps(verdict))
