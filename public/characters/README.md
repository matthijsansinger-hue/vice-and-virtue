# Character art assets

The customizable player "character" is composited in-browser from the PNG layers
in this folder. Options live in `src/lib/character.ts` (single source of truth);
the renderer is `src/components/CharacterAvatar.tsx`.

Shown two ways from the same layers: the profile widget shows the whole figure
(`variant="full"`), and the round badge crops the **top ~30%** (head + shoulders).

## Layers (back → front), all 512 × 768 transparent PNGs

| Layer | File | Tinted? | Notes |
|---|---|---|---|
| Body | `base/<gender>.png` | **skin tone** | A body-only figure (bald, underwear), white-fill / black-line. Tinted to the chosen skin tone. |
| Bottom | `outfit/<id>.png` | no | e.g. `skirt.png` (belt + skirt + leggings). `none` = bare. |
| Shoes | `outfit/<id>.png` | no | e.g. `boots.png`. |
| Top | `outfit/<id>.png` | no | e.g. `tunic.png` (shirt + belt), drawn over the bottom. |
| Hair | `hair/<gender>-<style>.png` | **hair colour** | Per-gender (pre-fitted to that head). `short`, `long`, `dreads_long`, `dreads_short`; `none` = bald. |

**Tinting** = a `<canvas>` multiply in `CharacterAvatar` (white → colour, black lines
stay dark, transparent bg preserved), cached by src+colour. Reliable across browsers
— it replaced a CSS mask+blend approach that didn't render. So the body + hair art
must be **white-fill with opaque interiors**, only the outer background transparent.

The customizer (`CharacterCreator`) shows: **Gender · Skin tone · Hairstyle · Hair
colour · Top · Bottom · Shoes**. Eye colour is the only picker still hidden (`SHOW.eyes`).

## How the current art was generated

Source art in `~/Downloads` (`Male/Female character basic template.png`, the four
`* hairstyle for character.png`, and `outfit for character.png`). A one-off Pillow
pipeline:
1. **Strip background** — flood-fill the outer near-white to transparent from the
   edges, keeping enclosed interiors opaque (so they tint).
2. **Bodies** → scaled to 512×768.
3. **Hair** → bg-stripped, cropped, then scaled + positioned onto each gender's head
   (measured per gender) → `hair/<gender>-<style>.png`.
4. **Attire** → bg-stripped, then split by horizontal bands into top (tunic+belt),
   bottom (skirt+leggings), shoes (boots), each kept at its canvas position → resized.

To add art later: add the id to the relevant list in `src/lib/character.ts` and
re-run the matching step (hair = strip + head-fit; attire = strip + band + resize).

## Coming next (each unlocks a picker — tell me when the art's ready)

- **Eye colour** — a separate iris overlay per gender (`eyes/<gender>.png`) aligned
  over the body's eyes; then I flip `SHOW.eyes` on in `CharacterCreator`.
- **More attire / hairstyles** — drop another piece in `outfit/` or `hair/` and add
  its id to `TOPS`/`BOTTOMS`/`SHOES`/`HAIRSTYLES`.
