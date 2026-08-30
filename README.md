# nuni

**A print studio for garments. Say what you want, and it lands on the garment in 3D with the
controls you asked for.**

---

## Why I built it

In fashion, print designers need to visualise how their ideas will look on the garments before
production. This process takes a lot of idea generation, option creation and tweaking.

For years this work has been done in Photoshop, where designers upload images and manually edit
and manoeuvre them on a photograph of a model or a sketch.

This process is extremely inefficient and lacks the 3D aspect. Recently I was talking to a
friend who is a print designer. She's now trying to use ChatGPT for this purpose. She loves it
for idea generation but is frustrated by natural language when it comes to tweaking, like
positioning, colour and size changes.

That's why I built nuni.

nuni is a new gen tool that blends 3D, gen AI and user-demanded controls to unlock a new,
flexible and speedy design process for fashion print designers.

## What it sits between

The two tools I actually use pull in opposite directions.

| | Good at | Clunky at |
| --- | --- | --- |
| Photoshop | Exact control. Nudge a motif two millimetres, change one colour, hit the thing I pictured. Every tweak is reversible and mine. | Making anything new. Mixing two styles, building a technique by hand, trying a fifth colourway. All of it is manual, all of it is flat, and none of it is on a body. |
| Nano Banana, ChatGPT and the rest | Ideas and generation. "Make this image in the style of this one" is one sentence and it works. | Tweaking. Moving a motif, resizing it, changing one colour all go back through words, and what comes back is a new image. My own artwork gets redrawn instead of edited. |

nuni does both. Generate or restyle in a sentence, then drag real sliders, on the garment in 3D.
Isolation keeps my own pixels, colour is non-destructive, and every look can be kept and
returned to. Generation stays in language, where language works, and precision moves onto
sliders.

## What it does

### 1. Get a print

Three ways in, and they do different jobs.

**Generate** invents one from a description. It comes back already transparent, so it goes
straight onto the garment. About 35 seconds.

**Isolate** takes a photo of my own artwork and cuts the motif out of it. A segmentation model
runs on a GPU and returns a mask, applied to my own pixels. Nothing is redrawn, which is why a
generative model is the wrong tool for this step and the right tool one step earlier.

The agent picks the isolation model and says which and why in one clause. `birefnet` for hard
edges, screen prints and vectors, anything with a clean outline. `birefnet-matting` for
painterly, watercolour and airbrushed work, where a hard cut destroys the quality I am
borrowing.

**Restyle** remakes a motif in another craft. My drawing as embroidery, my photograph as a
watercolour, my flowers screen printed. It holds the shape, the pose and the composition and
redraws only the surface. The shape can come from the uploaded photo or from the print already
on the garment, and a second photo can carry the technique in place of words.

### 2. Put it on the garment

**Placement** is a specific graphic, in a specific spot, at a specific size. Like a band
t-shirt. Most fashion print is placed, so this is the default.

**Repeat** tiles the motif across the whole garment, all over, wallpapered.

### 3. Tune it

I say what I want to play with, and the sliders appear beside the garment, bottom right of the
canvas. Dragging them is instant and browser side. Nothing round trips.

Colour is part of that. Hue, saturation, brightness and contrast are applied in the shader as
the print is drawn, so they run at frame rate and never rewrite the artwork. Drag the hue back
to zero and the original colours come back exactly, to the pixel.

### 4. Keep it

A print designer builds a range and then lays it out to choose from. The keep button holds the
look on the garment as a thumbnail, bottom left, with the print, the placement, the colour
adjustment and both garment colours. One click puts the whole look back,
so everything is free to move afterwards.

---

## What I would build the same way again

### The controls are written at runtime, by the model

This is the backbone of the whole interaction. There is no fixed control panel in the app.
The agent calls `add_controls` with a spec (label, a dotted path into the params
object, min, max, step, unit) and the slider materialises. Ask for size and you get size. Ask
to play with the repeat scale and rotation and you get two.

The alternative, which is what every chat image tool does today, is prompt, look, prompt again.
That loop is slow and it is imprecise, because language is a bad way to say "about six percent
bigger". A slider says it in one drag.

The hard part is that a slider bound to a path that does not exist would move and change
nothing. Early on the agent invented `trews.placement.height` unprompted. Control targets are
now checked against an allow-list, and an invented one comes back as an error the agent has to
correct.


### Repeat wraps the body

Tiling the UV square restarts the motif at every panel edge, which puts a hard seam straight
down the centre front where the two front panels meet. No printed garment looks like that.

The repeat is wrapped around the body's vertical axis instead, arc length across and height up.
That gives one seam, at centre back, which is where a real garment has one. The tile is quoted
in centimetres and divided by the mesh's own measurements, so a 14cm repeat is 14cm on the tee
and 14cm on the trousers.

### The model writes the image code, and the sandbox runs it

Placement moves a print around a garment. A **transform** rewrites the print's own pixels.
Posterise it to four flat colours, halftone it, threshold it to a stencil, mirror it into a
half-drop tile.

Feel decides which is which. Anything a designer expects to drag, colour included, stays in
the browser at frame rate. Anything that genuinely rewrites the artwork goes to the sandbox and
comes back as a new print.

There is no menu of effects. The agent writes real Python against the print, gets `SRC`, `DST`,
PIL, numpy and a dict of whatever parameters it chose to expose, and each of those parameters
becomes a slider that re-runs the code as you drag. If the code throws, the traceback goes back
to the agent, which fixes it and calls again. The original print is never destroyed, and the
result arrives as a new one in the list.

---

## Where Daytona earns its place

Two jobs, and the second one is the stronger.

**Running code a language model just wrote.** This cannot happen anywhere else. Not in the
browser, where it would execute inside the user's page, and not on the app server, where it
would execute next to the API keys. It needs somewhere disposable that does not care whether
the code is hostile or simply wrong. That is the whole product feature above, and it only
exists because there is a sandbox to put it in.

**GPU segmentation with a model chosen at runtime.** The isolation model is picked from the
user's words and the artwork in front of them, and both sets of weights are already on the box.
That needs a GPU and a torch stack, and installing one takes minutes, far longer than a
serverless request lives.

So the lifecycle is split three ways. `create` returns as soon as the box exists, `install`
uploads the server and kicks setup off detached, and `status` polls with a readable step until
the server inside answers `/health`. One sandbox is warmed in the background the moment the
page loads, while the person is still deciding what they want, and it stays alive for the
session with the weights resident. The first cut-out costs nothing because it already happened.
Every one after it is about three seconds, including the upload.

Images go through the sandbox filesystem rather than its public preview URL, so there is no
token to juggle and the artwork never leaves the private network.

Two things that cost me real time, written down so they cost someone else less.

- **`gpuType` belongs inside `resources`.** At the top level it is silently ignored and you are
  handed an H100 at three times the price of the card you asked for.
- **torch is not pip installable from inside the sandbox network**, because `pypi.nvidia.com`
  is blocked. The base image carries torch and CUDA, and setup only adds the model stack on top.

Two limits worth flagging back to Daytona. Snapshot creation returned 403 on this key, so a
cold box costs about two minutes instead of about five seconds, and GPU concurrency is capped
at one, which rules out parallel fan out.

---

## The garment and the figure

Both are open source assets, prepared before the event, and neither was generated on the day.

The garments are simulated, not modelled, by
**[GarmentCode](https://github.com/maria-korosteleva/GarmentCode)** (code MIT, dataset
CC BY-SA 4.0). The pattern is drafted, the garment is draped on the body, and the result is
brought into Blender, scaled to metres, given the vertex normals the simulation OBJ does not
carry, and exported as GLB. Two garments ship, a cropped tee and wide leg trousers. Adding a
third is a Blender export and one line in the viewer.

The figure is **[MakeHuman](http://www.makehumancommunity.org/)** via the MPFB2 Blender add-on
(assets CC0), exported with her eyes, brows, lashes and hair.

Dense geometry and clean UVs both matter, for three separate reasons. Faceted garments read as
cheap, immediately. The print needs folds and curvature to sit on, or it looks pasted. And UVs
interpolate linearly across a triangle, so a few large triangles on a curve will warp the
texture however good the unwrap is. There is no performance cost at this scale, since there is
one figure on screen.

---

## How it fits together

```
app/page.tsx              chat on the left, canvas filling the rest
app/api/*                 chat, generate, blend, isolate, transform, sandbox
components/ChatPanel      runs the agent loop and executes every tool
components/Viewer         R3F canvas, lighting, camera, the figure
components/Garment        the shader. placement in garment space, repeat around the body
components/Controls       renders whatever sliders the agent asked for
components/Options        the kept looks, and the button that keeps one
lib/agent.ts              system prompt and the tool definitions
lib/store.ts              one zustand store, params, controls, prints and kept looks
lib/blend.ts              restyle, the same motif re-rendered in another craft
lib/options.ts            keeping a look, and the thumbnail read off the drawing buffer
lib/daytona.ts            sandbox image, setup script, GPU preference order
sandbox/server.py         FastAPI server inside the box, weights resident
scripts/to_glb.py         Blender, simulated garments to GLB
scripts/figure_to_glb.py  Blender + MPFB2, the figure to GLB
```

**The agent loop runs on the client.** Each request to `/api/chat` is one turn and one turn
only. The client runs the tool, then calls again with the result. That keeps every serverless
request short, and it means the panel can narrate a cut-out while it is still in flight.

The tool surface is deliberately small. `set_params`, `add_controls`, `clear_controls`,
`set_colours`, `generate_print`, `isolate_print`, `restyle_print` and `transform_print`. If
someone asks for the change now and the dial afterwards, the agent calls two of them in one
turn. A ninth, `save_option`, keeps the look on the garment as a thumbnail.

| Layer | Tech |
| --- | --- |
| App | Next 16 (app router, Turbopack) · React 19 · TypeScript · Tailwind 4 · zustand |
| 3D | React Three Fiber 9 · drei 10 · three · custom GLSL injected into `MeshStandardMaterial` |
| Agent | Anthropic SDK, Claude Sonnet, client-side tool loop |
| Images | OpenAI `gpt-image-1-mini`, generate and edit, transparent PNG straight onto the garment |
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

