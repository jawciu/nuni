# nuni

Say what you want on the cloth, and it builds you the controls to put it there.

nuni is a print studio for clothes. You talk to it, it makes or cuts out a print, drops it
onto simulated cloth in 3D, and then hands you the exact dials you asked for. Not a panel of
forty sliders. The two or three you said you wanted to play with.

---

## The idea

Most print tools give you a flat rectangle and a mockup. That is not how a print gets judged.
A print is judged on the body, at size, sitting in the folds, from three feet away.

So nuni starts from the garment. The cloth is simulated, the print is painted into the
material's albedo, and the lighting multiplies over it. Move the print and the folds move
with it. It never reads as a decal.

The second idea is that the interface should not be fixed. When someone says "let me play
with the scale", the right response is a scale slider, right now, with a sensible range.
The agent decides which controls exist. That is the whole interaction model.

---

## Three moves, and that is the app

**1. Get a print.** Two ways in, and they are not interchangeable.

- *Generate.* Describe it, a model draws it, it comes back already transparent and goes
  straight onto the cloth.
- *Isolate.* Upload a photo of your own artwork and cut the motif out of it. This runs a
  segmentation model that emits a **mask**, applied to your own pixels. Nothing is redrawn.
  For a print designer that distinction is the entire point, which is why a generative model
  is the wrong tool here and the right tool one step earlier.

The agent picks the isolation model and says why in one clause: `birefnet` for hard edges,
screen prints, vectors, anything with a clean outline. `birefnet-matting` for painterly,
watercolour and airbrushed work, where a hard cut destroys the quality you are borrowing.

**2. Put it on the cloth.** Two mechanics, genuinely different.

- *Placement* is a specific graphic, in a specific spot, at a specific size. Like a band
  t-shirt. Most fashion print is placed, so this is the default. Placement lives in **garment
  space**, not UV space, so "centred, a hand below the neck" lands in the same place on the
  tee and on the trousers, and the numbers transfer between them.
- *Repeat* tiles the motif across the cloth and breaks at the panel seams, the way real
  printed cloth does. Repeat lives in UV space, because the UVs *are* the sewing pattern.

Texel density is measured off each mesh rather than hand tuned, so a 14cm repeat is 14cm on
the tee and 14cm on the trousers. They are unwrapped into separate squares and differ by more
than two to one.

**3. Tune it.** The agent calls `add_controls` and the sliders appear under the chat, bound
to a dotted path into the params object. Dragging them is instant and browser side. Nothing
round trips.

---

## The model and the cloth

Garments come from a library. We use **GarmentCode** for the pattern and the simulated
garment, and **Blender** to bring it in, scale it to metres, fix the normals and export GLB.
The result is a pre-rendered 3D model per silhouette, sitting in `public/assets/`.

Currently three: `body`, `tee`, `trews`. Adding a fourth is a Blender export and one line in
the viewer, not a code change.

Why it has to be dense geometry and clean UVs, both:

- Faceted garments read as cheap, immediately.
- The print needs folds and curvature to sit on, or it looks pasted.
- UVs interpolate linearly across a triangle, so a few large triangles on a curve will warp
  the texture no matter how good the unwrap is.

There is no performance cost at this scale. One figure on screen.

---

## How it fits together

```
app/page.tsx            chat on the left, canvas on the right
components/ChatPanel    runs the agent loop and executes tools
components/Viewer       R3F canvas, lighting, camera, contact shadow
components/Garment      the shader. placement in garment space, repeat in UV space
components/Controls     renders whatever sliders the agent asked for
lib/agent.ts            system prompt and tool definitions
lib/store.ts            one zustand store, params + controls + prints
lib/daytona.ts          sandbox image, setup script, GPU preference order
sandbox/server.py       FastAPI isolation server, models resident
scripts/to_glb.py       Blender, garment library to GLB
```

The agent loop runs **on the client**. Each request to `/api/chat` is one turn and one turn
only. The client runs the tool, then calls again with the result. That keeps every serverless
request short, and it means the panel can say what it is doing while a cut-out is in flight.

Four tools, and no more: `set_params`, `add_controls`, `generate_print`, `isolate_print`
(plus `clear_controls`). If someone asks for the change now and the dial afterwards, the
agent calls two of them in one turn.

---

## Where the sandbox earns its place

Isolation needs a GPU and a torch model stack. Installing that takes minutes, which is far
longer than a serverless request lives. So the work is split three ways:

- `create` returns as soon as the box exists.
- `install` uploads the server and kicks setup off detached.
- `status` polls, reporting a readable step, until the server inside answers `/health`.

One sandbox is warmed in the background the moment the page loads, while the person is still
deciding what they want, and it stays alive for the session with the weights resident. The
first cut-out is free because it already happened. Every one after it is sub-second.

Images go through the sandbox filesystem, not its public preview URL, so there is no token to
juggle and the artwork never leaves the private network.

Two things that cost us time and are worth writing down:

- `gpuType` belongs **inside** `resources`. At the top level it is silently ignored and you
  are handed an H100 at three times the price of the card you asked for.
- torch is not pip installable from inside the sandbox network, so the base image carries
  torch and CUDA and we only add the model stack on top.

---

## State of play

Working:

- 3D viewer, three meshes, cloth lighting, orbit, contact shadow
- placement and repeat shaders, garment space projection, measured texel density
- agent loop with all five tools, agent-authored sliders
- print generation, transparent, straight onto the cloth
- GPU sandbox lifecycle, warm on load, status with readable steps
- isolation with model choice and a stated reason

Next, in order:

1. **Second silhouette in the demo path.** Trousers are loaded but the default target is the
   tee alone. Prove "put it on the trousers too" on stage.
2. **Print list polish.** The thumbnails work, switching between prints works, but there is
   no way to delete one or re-cut with the other model.
3. **Colourway.** Garment colour is hardcoded per mesh. One tool call away from being agent
   controlled, and it is the cheapest way to make the screen change dramatically.
4. **Repeat offset controls.** Wired end to end but never exercised in the demo.

Deliberately not doing:

- Sketch to 3D generation. Too expensive for the time we have, and the library is better.
- Point and click editing on the mesh. The sliders are the interaction model, adding a second
  one weakens it.
- Engineered print, where the graphic is cut to the pattern piece. Roadmap, not today.

---

## The demo, three minutes

1. Open on the figure. Say one line about the cloth being simulated, then stop talking about it.
2. "Generate a print of koi carp in bleached indigo and put it on the tee." It appears.
3. "Let me play with the size." The slider materialises. Drag it. This is the moment.
4. Upload a photo of real artwork. "Cut the flowers out of this." It picks the matting model
   and says why. The artwork survives, which is the point.
5. "Tile it across everything instead." Placement to repeat, tee to both garments, one line.

Do not say "engineered print". Say "placement", or "like a band t-shirt", and let the visual
contrast between wallpapered and placed do the explaining.

---

## Risks, and what we do instead

| Risk | Fallback |
| --- | --- |
| No GPU available in the region | Fall back to CPU isolation, slower but it still cuts |
| Sandbox setup runs long on the day | The generate path needs no sandbox at all, lead with it |
| Image model rejects a prompt | Openers are pre-written and known good |
| Mesh looks faceted after an export | Normals are recomputed on load, check before the demo |

---

## Running it

```bash
npm install
npm run dev
```

`.env.local` needs `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `DAYTONA_API_KEY`. Rebuilding
the garment library needs Blender:

```bash
blender --background --python scripts/to_glb.py
```
