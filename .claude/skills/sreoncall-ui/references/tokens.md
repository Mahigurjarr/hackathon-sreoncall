# Tokens — exact values

Canonical source is `web/src/index.css`. This file mirrors it so you can pick a value without
loading the stylesheet. **If they ever disagree, `index.css` wins** — fix this file.

## Ground and elevation

| Token | Hex | Tailwind | Use |
|---|---|---|---|
| `--background` | `#0e1116` | `bg-background` | The page. Warm near-black, never `#000` (OLED smear) |
| `--surface` | `#151922` | `bg-surface` | Panels, cards resting on the page |
| `--surface-2` | `#1c212c` | `bg-surface-2` | Raised: selected rows, code blocks, inputs |
| `--surface-3` | `#242b39` | `bg-surface-3` | Rare. Popovers over an already-raised surface |
| `--border` | `#232a37` | `border-border` | Default hairline |
| `--border-strong` | `#333c4d` | `border-border-strong` | Emphasised edge, scrollbar thumb |

The body also carries two very low-opacity radial washes (mint top-left, periwinkle
bottom-right, both < 5%) so panels don't read as one flat plane. Don't add more.

## Text

| Token | Hex | Tailwind | Use |
|---|---|---|---|
| `--foreground` | `#e9ecf2` | `text-foreground` | Primary content |
| `--muted-text` | `#98a2b3` | `text-muted-text` | Secondary prose, labels |
| `--muted-text-2` | `#6b7484` | `text-muted-text-2` | Metadata, timestamps, eyebrows |

Three steps. There is no fourth — reaching for one produces gray-on-gray.

## Brand

| Token | Hex | Use |
|---|---|---|
| `--signal` | `#8fd9c8` | The agent itself. Brand chrome, primary CTA, citation chips, focus ring |
| `--signal-foreground` | `#0b1614` | Text on a solid signal fill |
| `--signal-dim` | `rgba(143,217,200,0.13)` | Signal-tinted background wash |

Mint, not the AI-purple/blue-glow default and not a lifted brand colour — grounded in the
subject: this is telemetry, a live *signal* the agent watches.

## Severity — pastel family

| Level | Hex | `-bg` | Reads as |
|---|---|---|---|
| `critical` | `#eda5a5` | 11% | dusty rose |
| `high` | `#edbe9a` | 11% | apricot |
| `medium` | `#e3d3a0` | 11% | sand |
| `low` | `#a8c3e6` | 11% | periwinkle |
| `ok` | `#a5cfae` | 10% | sage |

All five are desaturated and light so they sit calmly on a dark ground while staying
distinguishable from each other. Contrast on `--surface` (`#151922`):

- `#eda5a5` → ~8.9:1 · `#edbe9a` → ~10.5:1 · `#e3d3a0` → ~11.6:1
- `#a8c3e6` → ~8.6:1 · `#a5cfae` → ~9.4:1 · `#8fd9c8` → ~10.9:1

All clear WCAG AA (4.5:1) for body text and AAA for large text. Their `-bg` variants are
backgrounds only — never put body text directly on one without a foreground token on top.

## Type scale

The complete scale. Five steps, defined as utility classes in `index.css`.

| Class | Size | Weight | Use |
|---|---|---|---|
| `.t-display` | 17px / 1.45 | 550 | The headline of the thing you're looking at |
| `.t-title` | 13px / 1.4 | 550 | Section headers inside a panel |
| `.t-body` | 13px / 1.65 | 400 | Prose, RCA text, summaries |
| `.t-label` | 11px / 1.45 | 400 | Field labels, metadata, secondary lines |
| `.t-micro` | 10px / 1.3 | 560, uppercase, `0.055em` | Eyebrows, status pills |

Never write an arbitrary `text-[Npx]`. If none of the five fits, the layout is wrong.

Fonts are **Geist Sans** and **Geist Mono**, bundled via `@fontsource` — deliberately not
Google Fonts, because the container must render identically with no network. Use `font-mono`
for anything an operator would copy or grep: service names, incident/evidence ids, branch
names, queries.

## Radius and spacing

`--radius: 0.625rem` (10px). Use `rounded-md` for controls, `rounded-lg` for panels.

Spacing is dense-dashboard scale: prefer `gap-1.5 / 2 / 3`, padding `p-2.5 / 3 / 3.5 / 4`.
Anything above `p-6` inside a panel is almost certainly wrong for this density.

## Motion

| Name | Duration | Easing | Use |
|---|---|---|---|
| `breathe` | 4.5s loop | ease-in-out | Healthy service cell. Opacity 0.4 → 0.85 |
| `cell-in` | 320ms | `cubic-bezier(.16,1,.3,1)` | Fleet cell entry, staggered 22ms by index |
| disclosure | 200ms | default ease | Expand/collapse height + opacity |
| hover/colour | 150–200ms | ease-out | All colour and background transitions |

Never animate `width`/`height` on a list. Never use overshoot easing on informational UI.
`prefers-reduced-motion` is handled globally — don't re-implement it per component.
