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
- **Repeat scale is normalised by measured texel density.** The tee and the trousers are
  unwrapped into separate squares and differ by more than two to one, so an unnormalised
  repeat comes out twice the size on the legs.
- **One warm sandbox, not many.** GPU concurrency on this account is capped at one, so
  `create` reuses a running box rather than failing.
- **Placement is per garment, repeat is shared.** Height is measured against each garment's
  own length, so one shared number meant chest on the cropped tee and ankle on the trousers.
  Repeat stays shared because it is quoted in centimetres and normalised by texel density.
- **Control and param paths are checked against an allow-list.** The agent invented
  `trews.placement.height` unprompted, which would have produced a slider that moved and
  changed nothing. It is now told the target is unknown and asked again.

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
- **Playwright's screenshot times out on an animating canvas.** `preserveDrawingBuffer` is on,
  so grab `canvas.toDataURL()` instead. `shots/grab.sh` decodes it.

## Session log

### 2026-08-30 — built

Repo created and the app built end to end. Working and exercised: the viewer, both print
mechanics, per-garment placement, colourway, the agent loop with six tools, generation
(transparent, ~35s), and GPU isolation (~3s round trip). Screenshots of every milestone in
`shots/` (gitignored); grab a fresh one with `shots/grab.sh`.

Vercel project is linked and all three keys are set on it, but **nothing is deployed yet** —
Caroline asked to work locally first.

Two Daytona tier limits worth raising with them: snapshot creation returns 403 on this key
(so a cold sandbox costs ~2 minutes instead of ~5 seconds, which only matters for recovery),
and GPU concurrency is capped at 1 (so no parallel fan-out, and no two users at once).
