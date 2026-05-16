# Icon Unification — Design

**Date:** 2026-05-16
**Status:** Approved (design)
**Component:** CSV Grid Editor webview

## Problem

The extension's iconography is visibly inconsistent. Icons do not look like
one set: some are larger than others, and at small sizes the column-header
filter glyph is nearly indistinguishable from the sort-ascending arrow.

Root cause: **five different icon sources** are used at once.

| Source | Used in | Size | Style |
|--------|---------|------|-------|
| Codicons (VS Code icon font) | Toolbar buttons | 16 px | Clean, consistent |
| Hand-rolled inline SVG | AG Grid column header (sort, filter, expand arrows) | 8–10 / 13 px | Coarse polygons, mixed scale |
| Unicode characters | AG Grid menu & pagination (`⋮ ☰ ✕ ✓ ⇤ ⇥ ‹ › …`) | font-dependent | No control |
| Ad-hoc inline SVG | Profile panel dock buttons | 14 px | Bespoke rectangles |
| Emoji | Preview banner (`🔍`) | platform emoji | Platform-dependent |

The toolbar (Codicons) is already good. The inconsistency comes entirely
from the other four sources.

## Goals

- All icons come from **one family**: VS Code Codicons.
- One deliberate size scale — not the ad-hoc mix that exists today.
- The filter glyph is clearly distinct from the sort-ascending glyph.
- No new asset downloads: the Codicon font (`media/codicon.ttf` +
  `codicon.css`) is already bundled and contains every glyph needed.

## Non-Goals

- No change to toolbar icons — they are already Codicons and consistent.
- No change to icon *behavior* (what each button does), except the unsort
  indicator (see below).
- No custom-designed icons. Codicons covers every required symbol.
- No redesign of the extension's marketplace `icon.png`.

## Approach

Replace every non-Codicon icon source with Codicons — VS Code's native icon
language, already bundled, covering every glyph the grid needs.

Two rendering forms of the same Codicon glyphs are used:

- **Codicon font** (`<i class="codicon codicon-NAME">`) for the toolbar,
  profile dock buttons and banners — simple flex containers where the font
  sizes and centres correctly.
- **Inline SVG built from the Codicon path data** for AG Grid header icons
  (sort, filter, menu, chevrons, …). The Codicon *font* does not size or
  centre predictably inside AG Grid's nested header layout; an `<svg>` with
  an explicit size does. Both forms render the identical glyph, so the grid
  still shares one visual icon family.

## Icon Mapping

### 1 · Column header & grid icons

Replaces the hand-rolled SVG and Unicode glyphs in
`src/webview/grid/builder.ts` (the `icons:` block).

| Function | Current | New Codicon |
|----------|---------|-------------|
| Sort ascending | 9×9 triangle SVG | `triangle-up` |
| Sort descending | 9×9 triangle SVG | `triangle-down` |
| Sort unsorted | faint double-triangle SVG | **removed** — see below |
| Filter active | 10×10 funnel SVG | `filter` (outlined funnel — clearly distinct from the solid sort triangle) |
| Column menu | `⋮` | `kebab-vertical` |
| Column list | `☰` | `list-flat` |
| Check | `✓` | `check` |
| Cancel | `✕` | `close` |
| Expand arrows (`smallUp/Down/Left/Right`) | 8×8 triangle SVGs | `chevron-up` / `chevron-down` / `chevron-left` / `chevron-right` |
| Pagination (`first/last/previous/next`) | `⇤ ⇥ ‹ ›` | `chevron-left` / `chevron-right` for prev/next; first/last reuse the same chevrons. (AG Grid built-in pagination is not enabled in this extension — these are mapped defensively.) |
| Loading | `…` | `loading` with the `codicon-modifier-spin` class (animated) |

### 2 · Profile panel dock buttons

Replaces the ad-hoc `<svg><rect>…` markup in `src/webview.ts` (the three
`.profile-dock-btn` buttons).

| Function | Current | New Codicon |
|----------|---------|-------------|
| Dock left | bespoke rect SVG | `layout-sidebar-left` |
| Dock bottom | bespoke rect SVG | `layout-panel` |
| Dock right | bespoke rect SVG | `layout-sidebar-right` |

### 3 · Preview banner

| Function | Current | New Codicon |
|----------|---------|-------------|
| Head/Tail/preview-mode banner | `🔍` emoji (`&#x1F50D;`) | `eye` |

### 4 · Toolbar — unchanged

All toolbar buttons already use Codicons and stay as-is: `discard`, `redo`,
`arrow-both`, `filter-filled`, `zoom-out`, `zoom-in`, `graph`, `search`,
`list-ordered`, `files`, `export`, `arrow-up`, `arrow-down`, `close`.

## Size System

One family, with a deliberate hierarchy (this is intentional structure, not
the ad-hoc inconsistency being removed):

| Context | Size |
|---------|------|
| Toolbar buttons | 16 px |
| Grid / column-header icons | 12 px |
| Banner icons (preview, duplicate) | 14 px |

Toolbar/banner sizes are set via `font-size` on the `.codicon` element;
grid-icon size is the `width`/`height` of the inline `<svg>`, set in the
`.ag-icon > svg` rule. All in `media/webview.css`.

## Unsort Indicator — Removed

Today a sortable-but-unsorted column shows a faint double-triangle.
Decision: **remove it entirely.** The sort arrow appears only once a column
is actually sorted. This is the cleaner, more modern behavior and avoids a
third triangle-like glyph competing with the filter funnel.

Implementation: omit `sortUnSort` from the AG Grid `icons` config (or set it
to an empty string).

## Affected Files

- `src/webview/grid/builder.ts` — rewrite the `icons:` config block (lines ~151–169).
- `src/webview.ts` — replace the three dock-button SVGs (lines ~182–184) and
  the preview-banner emoji (line ~99) with `<i class="codicon …">` markup.
- `media/webview.css` — add/adjust `font-size` rules so Codicons render at
  13 px inside AG Grid header/grid contexts and 14 px in banners; ensure the
  dock buttons size their Codicons correctly.

The bundled `media/codicon.css` already defines every glyph used here
(`triangle-up/down`, `filter`, `kebab-vertical`, `list-flat`, `check`,
`close`, `chevron-*`, `loading` + `codicon-modifier-spin`,
`layout-sidebar-left/right`, `layout-panel`, `eye`) — no font update needed.

## Verification

- Build the extension and open a CSV file.
- Column header: sort a column → `triangle-up`/`triangle-down` appear; an
  unsorted sortable column shows no glyph; the filter icon is a funnel,
  visibly different from the sort triangle.
- Open a column menu / set-filter list → `kebab-vertical`, `list-flat`,
  `check`, `close`, chevrons all render as Codicons (no Unicode fallback,
  no tofu boxes).
- Open the Column Profile panel → dock-left/bottom/right buttons show
  `layout-*` Codicons.
- Open a >10 MB file as Head/Tail preview → banner shows the `eye` Codicon,
  not an emoji.
- Visually confirm: no glyph in the grid is noticeably larger/smaller than
  its neighbors beyond the defined 16/14/13 px scale.
- Check in both a dark and a light VS Code theme (icons use `currentColor`).
