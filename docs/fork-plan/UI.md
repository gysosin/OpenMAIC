# OpenMAIC fork: house UI guide

Every UI story starts with: "Read `docs/fork-plan/UI.md` first and follow it exactly." Tokens live in `app/globals.css` (`:root` for light, `.dark` for dark). Components reference tokens, never raw colours. The layout is specified in `PLAN.md` D1 to D3; this file fixes the look.

Owner direction (wins over any skill below):

- Flat, vibrant colour. No gradients anywhere: no `linear-gradient`, `radial-gradient`, `conic-gradient`, no `bg-gradient-*`, no gradient text, no gradient chart fills.
- Dark is a comfortable deep black (not pure `#000`, not harsh). Light is a soft white (off-white canvas, soft near-black text). Borders are subtle.
- A theme picker, one collapse control per panel, monochrome icons with the accent only on the active item, a hover reaction on every control.
- Full width. Never wrap a page or panel in a centred `mx-auto max-w-*` column. Exceptions: dialogs, popovers, toasts, print layouts.

## 1. How the skills shaped this guide

| Skill | Applied as |
|---|---|
| design-taste-frontend (app-screen rules) | The classroom is an app screen: colour goes on data and on the one active item, not on chrome; surfaces are flat, separated by a 1px line or one tone step; the first screen shows the stage, its caption and the transport, not a hero. Navigation recedes (neutral active row, accent only on its icon). Honest data states (section 11). |
| taste-color, oklch-skill, `PALETTES.md` | All colours are written in OKLCH. Neutrals are true grey (chroma 0) taken from the PALETTES seed ramp (light canvas `#FAFAFA`, dark canvas about `#121212`). One accent (the existing brand violet, kept at its own hue 295.6). Semantic success, warning and danger each have surface, text, border and solid roles. Contrast was computed with the WCAG formula on the resolved colours (section 5). The 8 categorical colours are the PALETTES Okabe-Ito adaptations converted to OKLCH. |
| unslop (pass order: spacing, colour, icons, copy, type, layout, details, visuals, motion) | Sections 3 to 10 follow that order. Borders are quiet hairlines, no glows or coloured shadows, no emoji, sentence case, tabular numbers, nested radii, no looping motion. |
| ponytail | No new components or dependencies. Existing tokens kept; new tokens are additive. The shared components to reuse are listed in section 12. |

unslop was created by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)) and is licensed under CC BY 4.0; this guide adapts its pass order and rules. Keep this credit in any copy or adaptation.

## 2. Layout regions

From `PLAN.md` D1 and D2. Sizes are tokens in `:root`.

| Region | Size | Token | Notes |
|---|---|---|---|
| Top bar | 40 px high | `--topbar-h` | Back, title, language, theme, help. Spans stage and side panel. |
| Outline rail | 56 px (expands on hover or `[` to titles and thumbnails) | `--rail-w` | Scene number plus a type glyph. Active scene: accent icon and number, `bg-accent` row. |
| Stage | flexible, true 16:9, slide at 100% | none | `data-testid="stage-box"`. Letterbox only the stage, never the slide inside it. |
| Caption band | 56 px, reserved space | `--caption-h` | Never covers the slide. Max two lines, then truncate. Modes: band, float, pill, off. |
| Transport bar | 44 px | `--transport-h` | The only bar under the stage. |
| Side panel (Notes / Chat / Ask) | 320 to 560 px, resizable, persisted | `--side-panel-min`, `--side-panel-max` | Tabs via `components/ui/tabs.tsx`. |

Rules:

- The shell fills the viewport. Regions are resizable (`react-resizable-panels`) and use the full width; the stage grows, it is never centred in a fixed column.
- One collapse control per panel (a single chevron button in the panel header). No second toggle in the toolbar, no duplicate in the footer.
- Region separation is a 1px `border-border` line or one surface step (`bg-background` to `bg-surface`). No shadows between regions.
- No horizontal scroll at 1366 px. The stage is at least 60% of viewport height at 1920 x 928 with the side panel open.
- Focus mode (`F`): stage fills the window, caption band stays, transport appears on mouse move.

## 3. Spacing scale

4 px grid. Use Tailwind steps only: `0.5` (2, nudges inside small controls only), `1` (4), `2` (8), `3` (12), `4` (16), `5` (20), `6` (24), `8` (32), `10` (40), `12` (48). No arbitrary `mt-[13px]` values.

| Use | Value |
|---|---|
| Inside a group (icon to label, label to value) | 4 to 8 |
| Between rows in a list | 2 to 4 (navigation rows), 8 (cards) |
| Panel padding | 12 to 16 (compact panels, side panel, rail), 20 to 24 (cards), 24 to 32 (page edges) |
| Between groups or sections | 24 above the section label, 8 below it |
| Row heights | rail and nav rows 32 to 36; transport controls 32; list rows in one list share one height |

Space inside a group is smaller than space between groups. Equal things get equal sizes.

## 4. Palette in OKLCH

Source of truth: `app/globals.css`. Switch is the `.dark` class on `<html>` (set by `lib/hooks/use-theme.tsx` and the pre-paint script in `app/layout.tsx`; stored under `localStorage.theme` as `light`, `dark` or `system`). The Tailwind variant is `dark:`.

Use the semantic classes (`bg-background`, `text-muted-foreground`, `bg-success-surface` ...). Never `#hex`, `rgb()`, `bg-gray-*` or `bg-purple-*` in new classroom chrome.

### Neutrals and text

| Role | Class | Light | Dark |
|---|---|---|---|
| Canvas (page, stage surround) | `bg-background` | `oklch(0.985 0 0)` (`#FAFAFA`) | `oklch(0.18 0 0)` (`#121212`) |
| Surface (panels, cards) | `bg-surface` / `bg-card` | `oklch(1 0 0)` | `oklch(0.215 0 0)` |
| Raised (popovers, menus, selected row base) | `bg-surface-raised` / `bg-popover` | `oklch(1 0 0)` | `oklch(0.265 0 0)` |
| Hover or quiet fill | `bg-muted`, `bg-secondary`, `bg-accent` | `0.965` / `0.965` / `0.955` | `0.265` / `0.265` / `0.30` |
| Text | `text-foreground` | `oklch(0.205 0 0)` (`#171717`) | `oklch(0.93 0 0)` |
| Muted text and icons | `text-muted-foreground` | `oklch(0.48 0 0)` | `oklch(0.74 0 0)` |
| Hairline border (decorative) | `border-border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 9%)` |
| Control outline (inputs you must find) | `border-border-strong` | `oklch(0.6 0 0)` | `oklch(0.55 0 0)` |

Note: in this app `accent` (shadcn) is a neutral hover fill, not the brand colour. The brand colour is `primary`.

### Accent (one, the existing violet)

| Role | Class | Light | Dark |
|---|---|---|---|
| Accent fill (primary button, selected) | `bg-primary` + `text-primary-foreground` | `oklch(0.494 0.228 295.6)` (`#722ed1`) | `oklch(0.569 0.231 297.6)` (`#8b47ea`) |
| Hover | `bg-primary-hover` | `oklch(0.44 0.22 295.6)` | `oklch(0.52 0.23 297.6)` |
| Subtle fill (active row background, chips) | `bg-primary-subtle` | `oklch(0.95 0.03 296)` | `oklch(0.28 0.07 296)` |
| Accent as text, link, active icon | `text-primary-text` | `oklch(0.494 0.228 295.6)` | `oklch(0.74 0.15 298)` |
| Focus ring | `ring-ring` | `oklch(0.494 0.228 295.6)` | `oklch(0.72 0.14 298)` |

Dark `primary-foreground` changed from near-black to near-white: white on the dark accent is 4.8:1, near-black was lower.

### Semantic (status only: correct, wrong, warning)

Each has `surface` (background), `text`, `border`, and a `solid` with its foreground.

| Meaning | Surface / text / border | Solid + on-solid |
|---|---|---|
| Success (correct) | `bg-success-surface text-success-text border-success-border` | `bg-success text-success-foreground` |
| Warning | `bg-warning-surface text-warning-text border-warning-border` | `bg-warning text-warning-foreground` |
| Danger (wrong, error) | `bg-danger-surface text-danger-text border-danger-border` | `bg-destructive text-white` |

Always pair the colour with an icon or word; colour never carries meaning alone. Do not reuse these as categorical series.

### Categorical palette (demos, charts)

`--series-1` to `--series-8` (classes `bg-series-1`, `text-series-1`, `fill-series-1` ...). Stable identity: series N keeps its hue across themes, filters and sorting. Default to six; use seven or eight only when needed; beyond eight group or facet.

| # | Hue | Light | Dark |
|---|---|---|---|
| 1 | Blue | `oklch(0.532 0.131 244)` | `oklch(0.681 0.113 248)` |
| 2 | Orange | `oklch(0.568 0.127 66)` | `oklch(0.775 0.144 68.7)` |
| 3 | Teal | `oklch(0.514 0.106 166.8)` | `oklch(0.746 0.138 166.9)` |
| 4 | Yellow | `oklch(0.572 0.118 98.7)` | `oklch(0.902 0.172 105)` |
| 5 | Vermilion | `oklch(0.545 0.158 44.4)` | `oklch(0.727 0.139 40.4)` |
| 6 | Purple-pink | `oklch(0.562 0.13 340.6)` | `oklch(0.773 0.089 341.2)` |
| 7 | Sky | `oklch(0.579 0.093 217.5)` | `oklch(0.796 0.096 220.9)` |
| 8 | Neutral | `oklch(0.464 0 0)` | `oklch(0.789 0 0)` |

Marks only: do not use as small text. Add direct labels plus a distinct marker or dash per series (blue and sky, orange and yellow are close); put a 1px surface-coloured separator between adjacent bars or slices. `--chart-1` to `--chart-5` alias series 1 to 5. Ordered data uses one hue stepped in lightness; signed data uses two hues with a neutral midpoint; never a rainbow.

### Contrast (computed with the WCAG 2 formula on the resolved colours)

| Pair | Light | Dark |
|---|---|---|
| Text on canvas | 17.2 | 12.5 to 15.3 |
| Muted text on canvas | 6.3 | 6.6 to 8.2 |
| Accent text on canvas | 6.7 | 6.3 to 7.8 |
| Primary foreground on accent fill | 7.1 | 4.8 |
| Control outline on canvas | 3.8 | 3.2 to 3.9 |
| Success, warning, danger text on own surface | 6.6 to 7.3 | 7.7 to 8.9 |
| Series marks on canvas | 4.0 to 6.7 | 5.4 or more |

All text pairs are at least 4.5:1, all control outlines and marks at least 3:1. Re-run the check if a token changes. Hairline `--border` is decorative and deliberately below 3:1; use `border-border-strong` where the edge is the only cue.

## 5. Type scale

Font: Inter Variable (`font-sans`, already loaded in `app/layout.tsx`). One family; `font-mono` (Geist Mono) only for figures, code and keycaps. Two weights: 400 and 500 (600 for rare emphasis). Hierarchy comes from size and colour, not weight. No italic emphasis, no gradient text, no uppercase tracked labels, no negative tracking on small text.

| Use | Class | Size / line |
|---|---|---|
| Page or lesson title (top bar) | `text-base font-medium` | 16 / 24 |
| Panel title, section heading | `text-sm font-medium` | 14 / 20 |
| Body, transcript, notes | `text-sm` | 14 / 20 |
| Secondary, labels, rail titles | `text-xs text-muted-foreground` | 12 / 16 |
| Caption band | `text-base` (fullscreen `text-lg`) | 16 / 24 |
| Large figure (score, step count) | `text-2xl font-medium tabular-nums` | 24 / 32 |

Floor: no text below 12 px; keycaps and tiny meta may be 11. Sentence case everywhere. Numbers use `tabular-nums`, one format per screen. Mobile inputs keep the 16 px floor already in `globals.css`.

## 6. Radius and elevation

- Radius comes from `--radius` (10 px): controls `rounded-md` (8), cards `rounded-lg` (10), panels and dialogs `rounded-xl` (14). Inner radius = outer minus padding, never below 4. Not everything is a pill.
- Elevation: none on panels and cards (hairline or surface step). Popovers, menus and dialogs may carry `shadow-md` (neutral). Never coloured shadows or glows. In dark, depth is surface steps plus hairlines.

## 7. Icons

- Set: `lucide-react` only. One size and stroke: 16 px (`size-4`) in dense chrome, 18 px in the rail and transport bar, stroke 1.5 (use `strokeWidth={1.5}` where the default 2 looks heavy).
- Colour: `text-muted-foreground` by default, `text-foreground` on hover, `text-primary-text` only on the active item (current scene, current tab, active tool). Never a per-icon colour, never an icon in a tinted circle.
- Icon boxes have a fixed width per row so labels align; gap to label 8.
- No emoji in the interface. Categories that need a colour get a small status dot.
- Icon-only buttons need `aria-label` and a tooltip (`components/ui/tooltip.tsx`).

## 8. States

| State | Rule |
|---|---|
| Default | Muted icon or text on transparent. |
| Hover | Quick fill step: `hover:bg-muted` (neutral) and text to `foreground`; primary buttons `hover:bg-primary-hover`. No scale, no lift, nothing moving more than a few px. Every control has one. |
| Active / selected | Neutral surface step (`bg-accent`) or `bg-primary-subtle`, plus accent icon (`text-primary-text`). Not a bright pill, not a coloured side bar. |
| Pressed | `active:scale-[0.98]` on buttons only. |
| Focus-visible | 2 px ring in `ring-ring` with 2 px offset (`focus-visible:ring-2`; the `Button` component already does this). Never remove it. |
| Disabled | `opacity-50`, `pointer-events-none`, `aria-disabled`; label still readable. |
| Loading | Skeleton with the same frame as the content (`animate-pulse` allowed on skeletons only), or a spinner inside the button. |
| Error | `border-danger-border bg-danger-surface text-danger-text` plus an icon and a plain sentence with the fix. |

## 9. Motion

Tokens: `--duration-fast` 120 ms, `--duration-base` 200 ms, `--duration-enter` 280 ms, `--ease-ui` `cubic-bezier(0.2, 0, 0, 1)`.

- Hover and press: `--duration-fast`. Panels, tabs, menus: `--duration-base`. Entering content: `--duration-enter` (short fade and rise of at most 8 px).
- Transition only named properties: `transition-colors`, `transition-opacity`, `transition-[transform,opacity]`. Never `transition-all`; never animate width, height, top, left, margin or blur. Panel resize is driven by the drag, not animated.
- No looping motion except live indicators (speaking bars, recording dot) and skeletons. No bouncy springs, parallax, breathing glows, shimmer.
- `prefers-reduced-motion: reduce` removes every non-essential transition and animation.

## 10. Copy

Short labels (`Search`, not `Search anything...`). No exclamation marks, greetings, hype words or emoji. Labels, buttons and captions end without a period; full sentences keep theirs. A change names what it compares to. Mock and test data look real.

## 11. Data-state checklist

A UI story is not done until each state below has been forced with a fixture and checked in both themes:

- [ ] Counts: 0, 1, 2, 4, 20 (and 40 scenes for the rail). Empty keeps its frame and says what to do next.
- [ ] Long text: a 120-character title, a 600-character caption, a long unbroken word, CJK. Truncate with `truncate` or `line-clamp-2`; never push the layout.
- [ ] Large numbers and zeros: zero prints `0`, missing prints a grey dash.
- [ ] Loading: skeleton with the final frame; no layout jump when data arrives.
- [ ] Error: message, retry, no raw stack text.
- [ ] Interaction: keyboard focus visible on every control; hover and active states; disabled.
- [ ] Theme: light, dark, and `system` resolved both ways; no raw colour left behind in the other theme.
- [ ] Width: no horizontal scroll, no centred max-width column.

Screenshot sizes (taken on the dev VM, never the laptop): 1920 x 1080 and 1366 x 768, each in light and dark. Seed with the Playwright pattern in `e2e/tests/stage-fit.spec.ts` (`seedServerDocument`, set the theme with `page.addInitScript(() => localStorage.setItem('theme', 'dark'))`). Name files `<story>-<state>-<theme>-<width>.png`.

## 12. Reuse, do not re-create

| Need | Reuse |
|---|---|
| Buttons, icon buttons | `components/ui/button.tsx` (`variant`, `size="icon-sm"`, `icon-xs`) |
| Tabs (side panel) | `components/ui/tabs.tsx` |
| Tooltips on icon buttons | `components/ui/tooltip.tsx` |
| Menus, popovers, dialogs | `dropdown-menu.tsx`, `popover.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `hover-card.tsx` |
| Inputs, select, switch, slider | `input.tsx`, `textarea.tsx`, `select.tsx`, `switch.tsx`, `slider.tsx` |
| Scrolling regions | `scroll-area.tsx` |
| Dividers | `separator.tsx` |
| Toasts | `sonner.tsx` |
| Progress | `progress.tsx`, `circular-progress.tsx` |
| Resizable regions | `react-resizable-panels` (see `components/scene-renderers/pbl/v3/workbench-split.tsx`) |
| Theme picker | `components/site-header/theme-toggle.tsx` and `lib/hooks/use-theme.tsx` (`useTheme`: `light`, `dark`, `system`) |
| Classroom rail and header | `components/stage/page-rail.tsx`, `scene-sidebar.tsx`, `header-controls.tsx` |
| Class merging | `cn` from `lib/utils` |

Known debt, owned by later stories: the classroom chrome still uses raw `gray-*`, `purple-*`, `slate-*` classes and about 81 gradient usages in `components/{stage,roundtable,chat,canvas,edit,classroom,scene-renderers}` (story 2.5 removes them). `components/site-header/theme-toggle.tsx` itself uses raw colours. When a story touches a file, move that file's colours to the tokens above.
