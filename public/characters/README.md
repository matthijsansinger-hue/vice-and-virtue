# Character art assets

The customizable player "character" is composited in-browser from the PNG layers
in this folder. The option lists live in `src/lib/character.ts` (the single source
of truth) and the renderer is `src/components/CharacterAvatar.tsx`.

The art is a **full-body portrait**. It's shown two ways from the same layers:
- the profile **"Edit character" widget** shows the whole figure, head to toe;
- the round **badge avatar** (banners, lobby rows, leaderboard, friends, …) crops
  the **top ~30%** to frame the head + shoulders.

**Until a layer's PNG exists, a procedural SVG silhouette stands in for it** (colored
from the catalog), so the feature works and stays testable while you produce art.
Drop the real PNGs in and they override the placeholder layer by layer.

## How layers stack

Back → front: **base → eyes → outfit → hair**.

| Layer | File | Color via | Notes |
|---|---|---|---|
| Base | `base/<gender>-<skin>.png` | pre-baked per tone | Opaque full body — head, torso, arms, hands, legs, feet. **Draw the eyes blank/white** — the irises come from the eye layer. |
| Eyes | `eyes/<gender>.png` | **runtime tint** | Grayscale irises only, transparent elsewhere, aligned over the base's eyes. |
| Outfit | `outfit/<gender>-<outfit>.png` | baked into the art | Full clothing (top + legs + shoes) over the body. Full color. |
| Hair | `hair/<style>.png` | **runtime tint** | Grayscale hair, transparent elsewhere. On top so long styles fall over the shoulders. |

## Framing (important)

- **512 × 1024 px** (portrait, 1:2), transparent PNG.
- **Identical canvas + alignment on every layer** so they register when stacked.
- One standing figure, **centered horizontally**, **feet near the bottom**, a small
  margin above the head.
- Keep the **head + shoulders inside the top ~30%** of the canvas (roughly the top
  300 px) — the round badge crops to that region, so the face must sit up there and
  be centered. (If you move the head, adjust `BADGE_CROP` in `CharacterAvatar.tsx`.)

## Tinting (hair + eyes)

Hair and eye **color** are applied at runtime by multiplying the chosen color
through the grayscale art. So draw these layers in **grey, not black**: pure white
takes the full tint, mid-grey gives a shaded tint, black stays dark. One grey PNG
per hairstyle / eye covers every color — adding a new color is just a hex in
`character.ts`, no new art.

## Files to produce

Derived from the current catalog (edit the lists in `character.ts` to change these).

**Base — 12** (`base/<gender>-<skin>.png`): for each gender `male`, `female` ×
skin `porcelain`, `fair`, `light`, `tan`, `brown`, `deep`.

**Eyes — 2** (`eyes/<gender>.png`): `male`, `female`. *(grayscale, tinted)*

**Outfit — 10** (`outfit/<gender>-<outfit>.png`): for each gender × outfit
`tunic`, `robe`, `armor`, `noble`, `peasant`.

**Hair — 5** (`hair/<style>.png`): `short`, `medium`, `long`, `curly`, `ponytail`.
*(grayscale, tinted; `none`/Bald needs no file)*

**Total ≈ 29 PNGs.** Hair colors (`black, brown, blonde, auburn, grey, red`) and
eye colors (`brown, blue, green, hazel, grey`) are config-only — no art per color.
