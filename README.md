# nuni

**A print studio for garments. Say what you want, and it lands on the garment in 3D with the controls you asked for.**

Built in one day at the Daytona HackSprint, London, 30 August 2026.

---

## Why this exists

A print is judged on the body. At size, in the right place, sitting in the folds. That is the
only view that tells you whether it works.

Almost every tool a print designer has hands them the opposite: a flat rectangle in Photoshop,
then a mockup, a photograph of a model with the artwork nudged onto it by hand. Every option is
another manual composite. Scale, position and colourway are all guesses until sampling comes
back. For a high end label that is dozens of iterations, done by hand, on a picture of a body
rather than a body.

nuni starts from the garment instead. You describe the print, it gets made or cut out, it goes
onto a simulated garment on a 3D figure, and then the tool builds you the exact controls you
asked for. Not a panel of forty sliders. The two or three you said you wanted.

## Three moves, and that is the app

**1. Get a print.** Two ways in, and they are not interchangeable.

*Generate* invents one from a description. It comes back already transparent, so it goes
straight onto the garment. About 35 seconds.

*Isolate* takes a photo of your own artwork and cuts the motif out of it. This runs a
segmentation model on a GPU and it emits a **mask, applied to your own pixels**. Nothing is
redrawn. For a print designer that distinction is the whole ballgame, and it is exactly why a
generative model is the wrong tool for this step and the right tool one step earlier.

The agent picks the isolation model and says which and why in one clause: `birefnet` for hard
edges, screen prints and vectors, anything with a clean outline. `birefnet-matting` for
painterly, watercolour and airbrushed work, where a hard cut destroys the quality you are
borrowing.

**2. Put it on the garment.** Two mechanics, genuinely different.

*Placement* is a specific graphic, in a specific spot, at a specific size. Like a band t-shirt.
Most fashion print is placed, so this is the default.

*Repeat* tiles the motif across the whole garment, all over, wallpapered.

**3. Tune it.** You say what you want to play with, and the sliders appear under the chat.
Dragging them is instant and browser side. Nothing round trips.

Colour is part of that. Hue, saturation, brightness and contrast are applied in the shader as
the print is drawn, so they run at frame rate and never rewrite the artwork. Drag the hue back
to zero and you have the original colours exactly, to the pixel.

---

## The four ideas worth stealing

### The controls are written at runtime, by the model

This is the backbone of the interaction, not a detail. There is no fixed control panel in the
app. The agent calls `add_controls` with a spec (label, a dotted path into the params object,
min, max, step, unit) and the slider materialises. Ask for size and you get size. Ask to play
with the repeat scale and rotation and you get two.

The alternative, which is what every chat image tool does today, is prompt, look, prompt again.
That loop is slow and it is imprecise, because language is a terrible way to say "about six
percent bigger". A slider is not.

The one hard part is that a slider bound to a path that does not exist would move and change
nothing, which is the worst possible failure in front of an audience. Early on the agent
invented `trews.placement.height` unprompted. Control targets are now checked against an
allow-list, and an invented one comes back as an error the agent has to correct.

### Placement lives in garment space, never UV space

The obvious way to put a graphic on a mesh is to place it in UV space. It is also wrong here.

These garments are simulated from real sewing patterns, so their UV layout **is** the pattern:
a packed square of front panel, back panel, sleeves, waistband. A UV coordinate of 0.5, 0.42
is not the middle of the chest. It is whichever panel happens to sit at that spot in the
packing, which is different on every garment.

So placement is projected through the garment's own bounding box in the shader instead: across
and up, in the garment's own local space, on the side facing the front. "Centred, a hand below
the neck" then means the same thing on the tee and on the trousers, and the numbers transfer
between them.

Height is still measured against each garment's own length, so placement is stored **per
garment**. One shared number meant chest on the cropped tee and ankle on the trousers.

### Repeat wraps the body, it does not tile the UV square

Same reasoning, other end. Tiling the UV square restarts the motif at every panel edge, which
puts a hard seam straight down the centre front where the two front panels meet. No printed
garment looks like that.

The repeat is wrapped around the body's vertical axis instead: arc length across, height up.
That gives one seam, at centre back, which is where a real garment has one. The tile is quoted
in centimetres and divided by the mesh's own measurements, so a 14cm repeat is 14cm on the tee
and 14cm on the trousers.

### The model writes the image code, and the sandbox runs it

Placement moves a print around a garment. A **transform** rewrites the print's own pixels:
posterise it to four flat colours, halftone it, threshold it to a stencil, mirror it into a
half-drop tile.

The line between the two is drawn on feel, not on capability. Anything a designer expects to
drag, colour included, stays in the browser at frame rate. Anything that genuinely rewrites the
artwork goes to the sandbox and comes back as a new print.

There is no menu of effects. The agent writes real Python against the print, gets `SRC`, `DST`,
PIL, numpy and a dict of whatever parameters it chose to expose, and each of those parameters
becomes a slider that re-runs the code as you drag. If the code throws, the traceback goes back
to the agent, which fixes it and calls again. The original print is never destroyed; the result
arrives as a new one in the list.

---

## Where Daytona earns its place

Two jobs, and the second one is the stronger.

**Running code a language model just wrote.** This genuinely cannot happen anywhere else. Not
in the browser, where it would execute inside the user's page. Not on the app server, where it
would execute next to the API keys. It needs somewhere disposable that does not care whether
the code is hostile or simply wrong. That is the whole product feature above, and it only
exists because there is a sandbox to put it in.

**GPU segmentation with a model chosen at runtime.** The isolation model is picked from the
user's words and the artwork in front of them, not fixed at build time, and both candidates are
resident in the same process. That needs a GPU and a torch stack, and installing one takes
minutes, far longer than a serverless request lives.

So the lifecycle is split three ways: `create` returns as soon as the box exists, `install`
uploads the server and kicks setup off detached, and `status` polls with a readable step until
the server inside answers `/health`. One sandbox is warmed in the background the moment the page
loads, while the person is still deciding what they want, and it stays alive for the session
with the weights resident. The first cut-out is free because it already happened. Every one
after it is about three seconds, door to door, including the upload.

Images go through the sandbox filesystem rather than its public preview URL, so there is no
token to juggle and the artwork never leaves the private network.

Two things that cost us real time, written down so they cost someone else less:

- **`gpuType` belongs inside `resources`.** At the top level it is silently ignored and you are
  handed an H100 at three times the price of the card you asked for.
- **torch is not pip installable from inside the sandbox network**, because `pypi.nvidia.com` is
  blocked. The base image carries torch and CUDA, and setup only adds the model stack on top.

Two limits worth flagging back to Daytona: snapshot creation returned 403 on this key, so a cold
box costs about two minutes instead of about five seconds, and GPU concurrency is capped at one,
which rules out parallel fan out.

---

## The garment and the figure

Both are open source assets, prepared before the event, and neither was generated on the day.

The garments are simulated, not modelled, by **[GarmentCode](https://github.com/maria-korosteleva/GarmentCode)**
(code MIT, dataset CC BY-SA 4.0). The pattern is drafted, the garment is draped on the body,
and the result is brought into Blender, scaled to metres, given vertex normals the simulation
OBJ does not carry, and exported as GLB. Two garments ship: a cropped tee and wide leg trousers.
Adding a third is a Blender export and one line in the viewer.

The figure is **[MakeHuman](http://www.makehumancommunity.org/)** via the MPFB2 Blender add-on
(assets CC0), exported with her eyes, brows, lashes and hair.

Dense geometry and clean UVs both matter, for three separate reasons. Faceted garments read as
cheap, immediately. The print needs folds and curvature to sit on, or it looks pasted. And UVs
interpolate linearly across a triangle, so a few large triangles on a curve will warp the
texture no matter how good the unwrap is. There is no performance cost at this scale, since
there is one figure on screen.

---

## How it fits together

```
app/page.tsx            chat on the left, canvas filling the rest
components/ChatPanel    runs the agent loop and executes every tool
components/Viewer       R3F canvas, lighting, camera, the figure
components/Garment      the shader. placement in garment space, repeat around the body
components/Controls     renders whatever sliders the agent asked for
lib/agent.ts            system prompt and the tool definitions
lib/store.ts            one zustand store, params + controls + prints
lib/daytona.ts          sandbox image, setup script, GPU preference order
sandbox/server.py       FastAPI server inside the box, models resident
scripts/to_glb.py       Blender, simulated garments to GLB
scripts/figure_to_glb.py  Blender + MPFB2, the figure to GLB
```

**The agent loop runs on the client.** Each request to `/api/chat` is one turn and one turn
only. The client runs the tool, then calls again with the result. That keeps every serverless
request short, and it means the panel can narrate a cut-out while it is still in flight.

The tool surface is deliberately small: `set_params`, `add_controls`, `clear_controls`,
`set_colours`, `generate_print`, `isolate_print`, `transform_print`. If someone asks for the
change now and the dial afterwards, the agent calls two of them in one turn.

| Layer | Tech |
| --- | --- |
| App | Next 16 (app router, Turbopack) · React 19 · TypeScript · Tailwind 4 · zustand |
| 3D | React Three Fiber 9 · drei 10 · three · custom GLSL injected into `MeshStandardMaterial` |
| Agent | Anthropic SDK, Claude Sonnet, client-side tool loop |
| Images | OpenAI `gpt-image-1-mini`, transparent PNG straight onto the garment |
| Sandbox | Daytona SDK, GPU box on `pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime` |
| Isolation | BiRefNet and BiRefNet-matting, FastAPI, weights resident |
| Assets | GarmentCode simulation and MakeHuman, prepared in Blender |

---

## Running it

```bash
npm install
npm run dev          # localhost:3000
```

`.env.local` needs three keys:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
DAYTONA_API_KEY=
```

Optional: `NUNI_MODEL` and `NUNI_IMAGE_MODEL` to swap either model without touching code.

Rebuilding the garments or the figure needs Blender, and is not required to run the app:

```bash
blender --background --python scripts/to_glb.py
```

---

## What is not in it yet

- **Deleting a print, or re-cutting one with the other model.** The print list holds everything
  and switching between them works, but it only grows.
- **A third and fourth silhouette.** The pipeline handles it, we ran out of hours.
- **Cutting a graphic to the pattern piece**, so the artwork is drawn for the panel it sits on
  rather than placed on top of it. That is the real end of this road, and it is a roadmap item,
  not a day's work.
- **Sketch to 3D garment generation.** Deliberately not doing it. A prepared library of
  simulated garments beats anything we could generate in a day, and the simulation is the part
  that makes the print sit correctly.
