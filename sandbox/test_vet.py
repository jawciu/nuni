"""Shaders the vetter must pass and shaders it must stop, run as a plain script.

    python sandbox/test_vet.py            # needs glslangValidator and an EGL driver

The good ones are written the way the agent is told to write them in lib/agent.ts, so if the
prompt's worked examples drift from what the vetter accepts, this is where it shows.
"""

import sys

from vet import vet

POSTERISE = """
float n = floor(p_levels + 0.5);
vec4 c = nuniSample(uv);
c.rgb = floor(c.rgb * n + 0.5) / n;
return c;
"""

HALFTONE = """
vec2 px = uv / nuniTexel;
vec2 cell = floor(px / p_dot) * p_dot + p_dot * 0.5;
vec4 c = nuniSample(cell * nuniTexel);
float ink = 1.0 - dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
float r = sqrt(ink) * p_dot * 0.62;
float on = 1.0 - smoothstep(r - 0.75, r + 0.75, length(px - cell));
return vec4(vec3(1.0 - on), nuniSample(uv).a);
"""

DUOTONE = """
vec4 c = nuniSample(uv);
float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
l = smoothstep(p_split - 0.2, p_split + 0.2, l);
return vec4(mix(vec3(0.11, 0.13, 0.33), vec3(0.96, 0.62, 0.45), l), c.a);
"""

STENCIL = """
vec4 c = nuniSample(uv);
float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
return vec4(vec3(0.08), c.a * step(l, p_cut));
"""

MIRROR = """
vec2 q = fract(uv * 2.0);
q = mix(q, 1.0 - q, step(0.5, fract(uv * 1.0)));
return nuniSample(q);
"""

BLUR = """
vec4 acc = vec4(0.0);
for (int i = -2; i <= 2; i++) {
  for (int j = -2; j <= 2; j++) {
    acc += nuniSample(uv + vec2(float(i), float(j)) * nuniTexel * p_radius);
  }
}
return acc / 25.0;
"""

GOOD = {
    "posterise": (POSTERISE, [dict(name="levels", label="levels", min=2, max=8, step=1, default=4)]),
    "halftone": (HALFTONE, [dict(name="dot", label="dot size", min=3, max=16, step=1, default=6)]),
    "duotone": (DUOTONE, [dict(name="split", label="split", min=0.1, max=0.9, step=0.01, default=0.5)]),
    "stencil": (STENCIL, [dict(name="cut", label="threshold", min=0.1, max=0.9, step=0.01, default=0.5)]),
    "mirror": (MIRROR, []),
    "blur": (BLUR, [dict(name="radius", label="softness", min=0, max=4, step=0.1, default=1.5)]),
}

P1 = [dict(name="k", label="k", min=0, max=1, step=0.01, default=0.5)]

# (name, code, params, the stage it must stop at)
BAD = [
    ("infinite loop", "vec4 c = nuniSample(uv); while (true) { c.r += p_k; } return c;", P1, "shape"),
    ("unbounded for", "vec4 c = nuniSample(uv); for (int i = 0; i < int(p_k * 1e9); i++) { c.r += 0.0; } return c;", P1, "shape"),
    ("huge loop", "vec4 c = vec4(0.0); for (int i = 0; i < 100000; i++) { c += nuniSample(uv) * p_k; } return c;", P1, "shape"),
    ("loop var rewritten", "vec4 c = nuniSample(uv); for (int i = 0; i < 4; i++) { i = 0; c.r *= p_k; } return c;", P1, "shape"),
    ("too many samples", "vec4 c = vec4(0.0); for (int i = 0; i < 16; i++) { for (int j = 0; j < 16; j++) { c += nuniSample(uv + vec2(i, j) * p_k); } } return c;", P1, "shape"),
    ("brace escape", "return nuniSample(uv) * p_k; } vec4 evil(vec2 uv) { return vec4(1.0);", P1, "shape"),
    ("preprocessor", "#define X 1\nreturn nuniSample(uv) * p_k;", P1, "shape"),
    ("new uniform", "uniform float z; return nuniSample(uv) * p_k * z;", P1, "shape"),
    ("reads garment uniform", "return nuniSample(uv) * p_k + vec4(uCloth, 0.0);", P1, "shape"),
    ("raw texture", "return texture(uPrint, uv) * p_k;", P1, "shape"),
    ("discard", "if (p_k > 0.5) discard; return nuniSample(uv);", P1, "shape"),
    ("fragment globals", "return nuniSample(gl_FragCoord.xy) * p_k;", P1, "shape"),
    ("undeclared slider read missing", "return nuniSample(uv);", P1, "shape"),
    ("no return", "vec4 c = nuniSample(uv) * p_k;", P1, "shape"),
    ("int to float, fine on desktop, fatal in WebGL", "float x = 1; return nuniSample(uv) * p_k * x;", P1, "compile"),
    ("type error", "vec3 c = nuniSample(uv); return vec4(c * p_k, 1.0);", P1, "compile"),
    ("unknown function", "return blur(nuniSample(uv), p_k);", P1, "compile"),
    ("NaN", "vec4 c = nuniSample(uv); return vec4(c.rgb * sqrt(-1.0 - p_k), c.a);", P1, "render"),
    ("erases the print", "return vec4(nuniSample(uv).rgb * p_k, 0.0);", P1, "render"),
    ("dead slider", "vec4 c = nuniSample(uv); c.rgb = 1.0 - c.rgb; return c + p_k * 0.0;", P1, "render"),
    ("does nothing", "return nuniSample(uv);", [], "render"),
    ("bad range", "return nuniSample(uv) * p_k;", [dict(name="k", label="k", min=1, max=0, step=0.1, default=0.5)], "params"),
    ("bad name", "return nuniSample(uv) * p_K;", [dict(name="K", label="k", min=0, max=1, step=0.1, default=0.5)], "params"),
    ("three macro collision", "float PI = 3.14159; return nuniSample(uv) * p_k * PI;", P1, "shape"),
    ("comment smuggling", "/* } vec4 evil() { */ return nuniSample(uv) * p_k; // }", P1, None),
]


def main() -> int:
    fails = 0
    for name, (code, params) in GOOD.items():
        v = vet({"code": code, "params": params})
        ok = v["ok"]
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  good/{name:10} {v.get('stats', '')}"
              + ("" if ok else f"  {v['stage']}: {v['problems']}"))
    for name, code, params, stage in BAD:
        v = vet({"code": code, "params": params})
        got = None if v["ok"] else v["stage"]
        ok = got == stage
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  bad/{name:48} stopped at {got}"
              + ("" if ok else f" (wanted {stage}) {v.get('problems')}"))
    print(f"\n{fails} failing")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
