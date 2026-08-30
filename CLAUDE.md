# nuni

A print studio for clothes. You say what you want on the cloth, it makes or cuts out the
print, puts it on a simulated garment in 3D, and hands you the controls you asked for.

Built at the Daytona HackSprint, London, 30 August 2026.

Read `PLAN.md` first. It carries the idea, the architecture and the demo script.

## Stack

Next 16 (app router, Turbopack) · React 19 · R3F 9 + drei 10 + three 0.184 · Tailwind 4 ·
zustand · Anthropic SDK · OpenAI SDK · Daytona SDK. Deployed on Vercel.

## Commands

```bash
npm run dev            # localhost:3000
npm run build          # what Vercel runs
npx tsc --noEmit       # typecheck, keep this clean

# rebuild the garment library from the simulated meshes
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/to_glb.py
```

`.env.local` needs `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DAYTONA_API_KEY`.
Optional: `NUNI_IMAGE_MODEL` (default `gpt-image-1-mini`), `NUNI_MODEL` (default
`claude-sonnet-5`).

## Where things are

| Path | What |
| --- | --- |
| `components/Garment.tsx` | The shader. Placement in garment space, repeat in UV space. |
| `components/Viewer.tsx` | Canvas, lighting, camera, the body. |
| `components/ChatPanel.tsx` | Runs the agent loop and executes every tool. |
| `components/Controls.tsx` | Renders whatever sliders the agent asked for. |
| `lib/agent.ts` | System prompt and the five tool definitions. |
| `lib/store.ts` | One zustand store. `window.nuni` is a live handle in the browser. |
| `lib/daytona.ts` | Sandbox image, setup script, GPU preference order. |
| `sandbox/server.py` | FastAPI isolation server. Models stay resident. |

## Decision log

- **Chat on the left, 3D filling the rest.** The garment is the hero and has to read from the
  back of a room. Controls materialise under the transcript.
- **Placement and repeat both ship.** Wallpapered against placed is the clearest visual
  contrast in the demo, and repeat was cheap once texel density was derived from the mesh.
- **`gpt-image-1-mini` behind `NUNI_IMAGE_MODEL`.** It is the tested one and it returns real
  transparency. Swapping to `gpt-image-2` is one env var.
- **The agent loop runs on the client.** One turn per request keeps every serverless call
  short and lets the panel narrate a cut-out while it is in flight.
- **Placement is projected in garment space, never UV space.** UV space here is the packed
  sewing pattern, so a UV coordinate lands on whichever panel happens to sit there. Projecting
  through the garment's own box means the same numbers work on every silhouette.
- **Repeat projects triplanar.** It went UV tiling (seam down the centre front where the two
  front panels meet), then a single cylindrical wrap (fixed the seam, but smeared anywhere the
  surface runs parallel to the projection, badly on the sleeves, which are horizontal tubes).
  It now samples all three axes and blends by the surface normal, sharpened to the fourth
  power, so every face is printed by whichever axis faces it most squarely.
- **A control has a kind.** A slider is for a range, a choice is for a switch with nothing in
  between, like placed against repeat. Without the second kind the agent correctly refuses to
  build a toggle rather than handing over a dial that cannot move.
- **`gpt-image-1.5` for generation.** Better than the mini and faster with it, 27s against 35s,
  same real transparency. `gpt-image-2` is better again and took 161s, which is unusable in a
  two minute demo. Behind `NUNI_IMAGE_MODEL`.
- **Superseded: repeat wrapped the body cylindrically.** Tiling UV space restarts the
  motif at every panel edge, which put a hard seam straight down the centre front where the
  two front panels meet. The tile grid now wraps the body's vertical axis by arc length, using
  the mesh's measured mean radius (a garment is not a circular cylinder and the bounding box
  overestimates the sweep, which squashes the tile). One seam, at centre back, where a real
  garment has one. Texel density normalisation went with it: measuring in real centimetres on
  the body is consistent across garments for free.
- **Colour is shader-side, structure is sandbox-side.** Hue, saturation, brightness and
  contrast are live uniforms on the print at 60fps, non-destructive and reversible, because a
  designer expects those to feel like Photoshop and a 2s round trip does not. `transform_print`
  keeps the structural treatments (posterise, halftone, mirror into a half-drop), which is also
  the better argument for the sandbox: those are model-written code, colour is a slider.
  The adjustment runs on the sampled print before the alpha threshold, so the cut-out edge is
  untouched at every setting.
- **Adjust in gamma space, not linear.** Hue, saturation and contrast are all defined on
  gamma-encoded values. A contrast pivot of 0.5 in linear sits at 0.21 sRGB and drags the
  whole print towards a colour nobody asked for. Saturation lerps against Rec.709 luma rather
  than HSV's S, because HSV saturation at 0 takes pure red to white instead of to grey.
- **One warm sandbox, not many.** GPU concurrency on this account is capped at one, so
  `create` reuses a running box rather than failing.
- **Placement is per garment, repeat is shared.** Height is measured against each garment's
  own length, so one shared number meant chest on the cropped tee and ankle on the trousers.
  Repeat stays shared because it is quoted in centimetres and normalised by texel density.
- **Control and param paths are checked against an allow-list.** The agent invented
  `trews.placement.height` unprompted, which would have produced a slider that moved and
  changed nothing. It is now told the target is unknown and asked again.

## The figure

Rebuilt by `scripts/figure_to_glb.py` (needs Blender + the MPFB2 add-on). Her spec, and it
is not up for rediscovery: skin `toigo_light_skin_with_natural_makeup` (the makeup is painted
into the map), hair `littleright_bobcut_hair` tinted `#3a2418` at gain ~1.2, eyes
`high-poly`, brows `eyebrow010`, lashes `eyelashes01`. Arms drop **12 degrees, not 28**:
28 is a render-only setting, and the garments were draped against the 12 degree body.

## Vocabulary

It is a **garment**, everywhere a user or a judge can see: the UI, the agent's replies, the
docs, the code comments. Never "cloth", never "fabric". The agent is told this in its prompt.

## Measured numbers, for the README and for stage

- Garment UVs: **0.00% stretched triangles** on both the cropped tee (10,102 tris) and the
  wide-leg trousers (31,234), 100% of UVs inside 0-1.
- Isolation: **BiRefNet 0.75s per image** on an RTX 5090, best of four models trialled.
- Transform: **~360ms executing inside the sandbox**, ~2s round trip from the browser
  including upload and download.
- Generation: **~35s** with `gpt-image-1-mini`, real transparency (about 70% fully clear,
  under 1% partial).
- Cold sandbox: **~2 minutes** to install and pull weights. A snapshot would make it ~5s, but
  snapshot creation 403s on this account.

## Traps, all paid for once already

- **`gpuType` goes inside `resources`.** At the top level it is silently ignored and you get
  an H100 at three times the price.
- **torch cannot be pip installed inside a Daytona sandbox.** `pypi.nvidia.com` is blocked, so
  the base image carries torch and CUDA already.
- **The pytorch image has no `curl`.** Health checks go through python's `urllib`.
- **`@daytonaio/sdk` needs `serverExternalPackages`.** It reaches for `form-data` through a
  dynamic require the bundler cannot follow, and file uploads fail without it.
- **The GLB exporter parks the Z-up to Y-up flip on the node.** Cloning only the geometry
  drops it and the garment lies flat. Bake `matrixWorld` in.
- **three only declares `vMapUv` when a map is bound.** Carry your own uv varying.
- **Textures need `flipY = false` and `SRGBColorSpace`,** or the print is upside down and
  washed out.
- **Cut-outs need an alpha threshold.** Transparent pixels carry black RGB, so mixing straight
  by alpha draws a dark rectangle round the motif.
- **A glTF export keeps textures and throws the node graph away.** MakeHuman's skin material
  and the desaturate-then-tint hair graph both vanished on export, which is why the skin is
  applied in the viewer and the hair tint is baked into `hair.png` offline. Do not fix a
  material in Blender and expect it to survive.
- **Hair silver is specular, not colour.** The hair map is nearly black (mean luminance 17
  of 255), so anything silver on screen is pure highlight. `MeshStandardMaterial` gives no
  way to turn the lobe down; use `MeshPhysicalMaterial` and cut `specularIntensity`. Lift the
  map with a gain before tinting or the hair reads as a void.
- **`alphaMap` reads the GREEN channel.** Feeding it a near-black hair map discards every
  fragment and the hair disappears. The map's own alpha is already the mask.
- **Never replace the eye material, only tune it.** MakeHuman's `high-poly` eye paints the
  iris on the INSIDE of the ball, read through a double-sided transparent cornea. Swap that
  material for anything opaque and you see the outer shell only, and she goes blind.
- **Hard-reload before judging any lighting or shader change.** Fast Refresh reuses the cached
  program (`customProgramCacheKey` is a constant) and the print renders as a grey stipple.
  Not a bug in the demo path, but it will cost you half an hour.
- **Playwright's screenshot times out on an animating canvas.** `preserveDrawingBuffer` is on,
  so grab `canvas.toDataURL()` instead. `shots/grab.sh` decodes it.

## Session log

### 2026-08-30, built

Repo created and the app built end to end. Working and exercised: the viewer, both print
mechanics, per-garment placement, colourway, the agent loop with six tools, generation
(transparent, ~35s), and GPU isolation (~3s round trip). Screenshots of every milestone in
`shots/` (gitignored); grab a fresh one with `shots/grab.sh`.

Vercel project is linked and all three keys are set on it, but **nothing is deployed yet**:
Caroline asked to work locally first.

Two Daytona tier limits worth raising with them: snapshot creation returns 403 on this key
(so a cold sandbox costs ~2 minutes instead of ~5 seconds, which only matters for recovery),
and GPU concurrency is capped at 1 (so no parallel fan-out, and no two users at once).

### 2026-08-30 (later), README audited and rewritten

Checked every claim in the README against the code. The technical arguments all held
(garment-space placement, body-wrapped repeat, the control allow-list, the sandbox lifecycle,
colour in the shader). Four things were stale, now fixed in the README:

- **Restyle was missing entirely.** `restyle_print`, `lib/blend.ts` and `/api/blend` shipped in
  `dcb18fb` but the README still said "two ways in". It is now three, with a section on writing
  the technique brief.
- **Sliders are beside the garment**, bottom right of the canvas (`Controls.tsx:78`), not under
  the chat. The same stale line still sits in `lib/agent.ts` and in the decision log above.
- **Deleting a print exists** (`ChatPanel.tsx:527`), so it came out of "not in it yet".
- **Options are documented** (keep button, thumbnails, one click to restore).

Rewritten in Caroline's voice per `~/.claude/skills/caroline-writing-voice/SKILL.md`, portfolio
register: first person, no em dashes, no semicolons, sentence case, short paragraphs.

**Two code issues found and left open** (README describes both honestly):

1. `save_option` is declared in `TOOLS` but has no branch in `runTool`, so the agent gets
   "no tool called save_option". The drop-in line is documented at `lib/options.ts:9`.
2. The system prompt still tells the agent repeat "breaks at the panel seams", which is the
   behaviour removed in `5196299`. The shader wraps the body with one seam at centre back.

### 2026-08-30 (later still), docs caught up with the build

Caroline rewrote the README opening (kept verbatim, typos only) and cut the technique-brief,
garment-space placement and "not in it yet" sections. Two facts from `1b1577a` and `5141a28`
folded into both README and PLAN.md:

- **`gpt-image-1.5`** via `NUNI_IMAGE_MODEL` in `.env.local`. The code default in both routes
  is still `gpt-image-1-mini`, so the README names both. The 35s generation figure was measured
  on mini and is labelled as such. Restyle now sends `input_fidelity: "high"`, which the mini
  model rejects, so the model swap is what makes restyle hold the drawing.
- **Choice controls.** `ControlSpec.kind` is `"slider" | "choice"`, used for placed against
  repeat. Docs say controls, not sliders.

PLAN.md's demo script rewritten to the app as built (restyle, keep, the toggle, both garments)
with a timing note, since two image calls eat over a minute of the three. State of play
refreshed. The rest of PLAN.md still says "cloth" throughout and describes repeat as living in
UV space, which is pre-build drift, left alone for now.
