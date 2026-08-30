# `restyle_print`, the merge sheet

Everything here is written to be pasted. Three pieces:

1. the tool definition, into the `TOOLS` array in `lib/agent.ts`
2. the system-prompt section, into `SYSTEM` in `lib/agent.ts`
3. one import and one line in `components/ChatPanel.tsx`

`SYSTEM` is a template literal, so a stray backtick in pasted text ends the string. Section 2
below is written **without any backticks at all** for exactly that reason. Paste it as it is
and nothing needs escaping.

---

## 1. Tool definition

A new member of `TOOLS`, immediately after `isolate_print` so the three ways a print gets made
sit together.

```ts
  {
    name: "restyle_print",
    description:
      "Remake a motif in a different craft: as embroidery, watercolour, a screen print, beadwork, bleached, whatever they name. Holds the shape and the composition and changes only how it looks made. Comes back transparent, ready for the garment. Use it when they name a technique, not when they name a subject.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The technique brief, written to a maker rather than a model. Say to hold the shape, pose and composition of the supplied image and change only how it is made. Then name the craft's own tells: the marks, the direction of them, how the light sits, how an edge behaves. Name the palette. End by demanding the motif alone on a fully transparent background, no ground, no garment, no mockup, no drop shadow.",
        },
        label: { type: "string", description: "two or three words, for the print list" },
        source: {
          type: "string",
          enum: ["reference", "print"],
          description:
            "Which image carries the shape. 'reference' is the photo they uploaded, 'print' is the one currently on the garment. Defaults to the reference when there is one.",
        },
        techniqueFromReference: {
          type: "boolean",
          description:
            "Hand the uploaded photo in as a second image, a swatch of the craft rather than a motif. Only with source 'print'. Use when they point at a photo and say make it like this.",
        },
        why: { type: "string", description: "one clause on what the technique does to it" },
      },
      required: ["prompt", "label"],
    },
  },
```

---

## 2. System prompt

Replace the existing **Two ways a print gets made** heading and its two bullets with
everything between the two markers below. The isolation-model paragraph that currently
follows that list stays exactly where it is, underneath the new text.

<!-- ================= PASTE FROM HERE ================= -->

## Three ways a print gets made

- **generate_print** invents one from a description. It comes back already transparent, so it
  goes straight onto the garment.
- **isolate_print** cuts a motif out of a photo they uploaded. Only possible when a reference
  image exists. It produces a mask applied to their own pixels, so their artwork survives
  untouched, which is why you never generate when they asked you to cut something out.
- **restyle_print** remakes a motif in another craft: their drawing as embroidery, their
  photograph as a watercolour, their flowers screen printed. It holds the shape and the
  composition and redraws the surface. Reach for it the moment they name a technique.

Which of the three is decided by what the sentence is about, and they are not
interchangeable:

- a **subject**, and nothing of theirs involved, is generate_print. "a print of koi carp."
- **their artwork, kept**, is isolate_print. "cut the flowers out of this."
- **their artwork, remade**, is restyle_print. "make this as embroidery."

If they upload a photo and name a technique in the same breath, that is one restyle_print
call, not an isolation followed by anything. Restyling redraws the pixels, so say so in your
line: it is their composition made again in another craft, not their photograph.

When a print is already on the garment and they name a technique, restyle that one, with
source "print". When they point at an uploaded photo and say make it like this, the photo is
the technique and the print is the shape: source "print" with techniqueFromReference true.

### Writing the brief

The brief is the whole quality of this tool, so write a real one. Four moves, in order.

1. **Hold the drawing.** Open by saying to keep the shape, pose, composition and proportions
   of the supplied image exactly, and to change only how it is made. Without that sentence
   you get a different rose.
2. **Name the craft's tells**, never its name. "Embroidery" returns a photograph of a jumper.
   The direction of the stitches, the sheen of the floss, the raised edge, the single strand
   visible at this scale returns thread. Three or four physical details, every one of them
   something a hand did.
3. **Name the palette**, two or three colours. Left open, a technique drags its own colours in
   and a pale motif comes back nearly black.
4. **Demand the transparency**, in a full sentence, by naming what you do not want: the motif
   alone on a fully transparent background, no ground, no fabric, no paper, no hoop, no
   garment, no mockup, no drop shadow, nothing under it and nothing behind it. This is the
   instruction that fails most often, and it fails by inventing a small patch of ground
   beneath the motif rather than a whole background, so name that too when the motif is an
   object that would ordinarily stand on something.

Two things that go wrong. A technique flattens the light and dark of the original, so if the
motif had a pale belly against a dark back, say to keep that division. And a rich technique
comes back dark, so look at the garment underneath and call set_colours in the same turn when
the print is about to disappear into it.

### Technique briefs

Working starting points. Adapt them to the motif, do not paste them.

- **embroidery**: dense satin stitch, the stitch direction following the form, thread with a
  soft sheen and never a gloss, outlines in stem stitch sitting raised above the fill and
  casting a hairline of self-shadow, individual floss strands visible at this scale, a tight
  satin-stitch border at the outer edge.
- **watercolour**: transparent washes on rough cotton paper, pooling and drying darker at the
  edge, granulation where the pigment settles into the tooth of the paper, wet-into-wet
  bleeds where two shapes meet, a few places where the wash breaks and the paper shows
  through. No outline, no ink, no pencil.
- **screen print**: two or three flat spot colours and no more, each a solid unmodulated area
  of ink with no gradient and no shading, separated the way a printer separates a photograph
  into plates with the darkest pulled last, the plates registered about a millimetre off so a
  sliver of the colour beneath shows along one side, the grain of the mesh visible in the
  flats, a few pinholes, one patch where the squeegee ran dry.
- **beadwork and sequins**: worked in sequins and bugle beads on a dense embroidered ground,
  each sequin catching the light at its own angle so the surface glitters unevenly, beads
  laid following the direction of the form, couched metallic thread along the outlines.
- **bleached or discharge**: the colour eaten out of the ground rather than laid onto it,
  edges soft and creeping where the paste crept, the boundary going warm and foxed, uneven
  strength across the motif, some passages gone to bone and some barely touched.
- **lino cut**: cut from a block, everything reduced to solid black and bare paper with no
  greys, the gouge marks visible as ragged white flecks inside the black, edges chipped where
  the blade left the line, ink heavy and slightly uneven across the flats.

### Worked examples

Their linocut koi, as embroidery. source "print", label "koi embroidered".

    Redraw the supplied artwork as a hand-embroidered patch. Hold its exact shape, pose and
    composition: same silhouette, same internal divisions, same proportions. Change only how
    it is made. Work every filled area in dense satin stitch with the stitch direction
    following the form, along the body and radiating out along each fin, so the light catches
    each block of thread differently. Thread has a soft sheen, never a gloss. Outlines are
    worked in stem stitch and sit raised above the fill, casting a hairline of self-shadow so
    the edges read as built up rather than drawn. Individual floss strands are visible at this
    scale and the outer edge is a tight satin-stitch border. Indigo and off-white floss, no
    other colours. The embroidery alone on a fully transparent background: no fabric ground,
    no hoop, no garment, no mockup, no drop shadow, nothing behind it or around it.

Their photograph of forget-me-nots, screen printed. source "reference", label "flowers
screened".

    Redraw the supplied photograph as a hand-pulled screen print of the same flowers. Hold the
    shape, the count and the arrangement of the blooms exactly as they sit in the photograph.
    Change only how it is made. Three flat spot colours and no more, each one a solid
    unmodulated area of ink with no gradient and no shading, reduced the way a printer
    separates a photograph into plates, the darkest pulled last. Register the plates slightly
    off, about a millimetre of slip, so a sliver of the colour beneath shows along one side of
    each shape. The ink sits on the surface with the grain of the mesh just visible in the
    flats, a few pinholes, and one patch at an edge where the squeegee ran dry. Ink colours:
    deep indigo, a chalky bleached white, one warm ochre. Discard the photograph's background
    entirely. The print alone on a fully transparent background: no paper, no garment, no
    mockup, no drop shadow, nothing behind it or around it.

The print on the garment, remade in the craft of a photo they uploaded. source "print",
techniqueFromReference true, label "koi beaded". Say which image is which, because nothing
else tells the model them apart.

    The first image is the motif. The second image is a technique reference only: take how it
    is made from it, never its shapes. Remake the motif in that technique, holding its
    silhouette, pose and internal divisions exactly. The whole motif is worked in sequins and
    bugle beads on a dense hand-embroidered ground, each sequin catching the light at its own
    angle so the surface glitters unevenly, beads following the direction of the form, the
    same dark jewel palette as the reference. The beadwork alone on a fully transparent
    background: no fabric ground, no backing cloth, no garment, no mockup, no drop shadow,
    nothing behind it or around it.

<!-- ================= PASTE TO HERE ================= -->

---

## 3. ChatPanel

Import at the top:

```ts
import { runRestylePrint } from "@/lib/blend";
```

One branch inside `runTool`, alongside the others:

```ts
    if (name === "restyle_print") return runRestylePrint(refB64.current, input);
```

Nothing else changes. `lib/blend.ts` reads and writes the store itself, sets `busy` with its
own status line, and clears any stale `transform` so a leftover slider cannot re-run old
python against a print that has just been replaced.

Worth adding to the context object in `turn()` if it is cheap, so the agent stops guessing
which print it is restyling: it already gets `prints` and `hasReference`, which is enough.

---

## Measured, not assumed

`gpt-image-1-mini` through `images.edit`, 1024x1024, quality high, five runs on 30 August:
36.3s, 35.3s, 31.9s, 34.3s, 33.6s round trip. Budget the same 35 seconds as `generate_print`.

Transparency is real in all five. 63 to 86 percent of pixels at alpha 0, under 2.5 percent
partial, all four corners exactly 0 every time, and no halo when composited over white.

PNG, JPEG and WebP inputs all work. The route sniffs the magic bytes and names the multipart
part accordingly, because a mislabelled part is rejected on format and the error does not say
that is what happened.

`input_fidelity: "high"` is the parameter that holds the drawing hardest, and
`gpt-image-1-mini` is the one model that does not accept it. The route sends it only when
`NUNI_IMAGE_MODEL` is not a mini model, so pointing that env var at `gpt-image-1.5` is the
one-line upgrade if a shape comes back too loose on the day.

The transparency instruction is the one that slips. A lino-cut test on a photograph of a
drink came back clean everywhere except a stippled patch of ground under the base of the
glass, which the brief had asked against in general terms but not by name. Anything that
would ordinarily stand on a surface needs "nothing under it" said explicitly.

One quality caveat, honestly. Embroidery, screen print and beadwork all came back convincing
on the mini model. Watercolour came back the weakest of the four: the wash and the bleed are
there, but the granulation and the broken washes asked for in the brief did not appear, and it
reads closer to a clean botanical illustration than to wet paint. If watercolour has to be the
one on stage, lean harder on the granulation and dry-brush language, or use a different
technique for the demo.
