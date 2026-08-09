---
name: sreoncall-charts
description: How to visualise fleet telemetry in the SREonCall console so a NON-TECHNICAL reader understands it — chart type selection, the validated series palette, plain-language captions, and ready-to-use templates (sparkline, stat tile, rate-over-time, error-ratio, service comparison, availability band, distribution). Use this skill whenever adding or changing any chart, graph, plot, sparkline, stat tile, gauge, meter, or dashboard panel anywhere under web/, whenever rendering a metric visually rather than as text, and whenever someone asks to "show", "visualise", "graph", or "make sense of" telemetry — even if they don't say the word "chart". Read it before writing chart code, not after.
---

# Charts for SREonCall

Built on the general `dataviz` skill — its procedure, six colour checks, and mark specs apply
here unchanged. **This file supplies the parameters for this product and one extra rule
`dataviz` does not have**, because our reader is different.

## The extra rule: the caption is the chart

The person reading this console at 3am may not be the engineer who built the service. A
manager, a founder, a support lead — someone who can read a board but cannot read PromQL —
must be able to look at any panel and know whether things are fine.

So **every chart ships with a one-sentence, plain-language headline stating what it means**,
placed *above* the plot, in `.t-body`. The chart is the evidence; the sentence is the finding.

| Don't | Do |
|---|---|
| `error_ratio: 0.247` | **Checkout is failing about 1 in 4 requests.** |
| `calls/s 0.00, series absent` | **otelcol-contrib has stopped reporting entirely.** |
| `p95 latency 2431ms` | **Checkout takes ~2.4s at its slowest — about 5× yesterday.** |
| "Traffic trend" | **Traffic is steady; nothing has changed since this morning.** |

Rules for the sentence:

- Lead with the **subject and the verdict**, not the metric name.
- Use ratios and comparisons a person feels: "1 in 4", "5× slower than yesterday", "stopped".
- Give the number a **reference point**. A bare number means nothing to a non-expert; "2.4s,
  normally 0.5s" means something.
- **Never state a verdict the data doesn't support.** If the reading is ambiguous, the
  sentence says so: "Too little traffic to tell yet."
- The sentence is **written by the agent**, not templated in the component — it is a claim,
  so it carries `[E#]` citations and renders through `CitedText` like every other claim.

A chart without this sentence is not finished.

## Colour parameters for this product

`dataviz` says colour comes last and must be computed. These values were produced by running
its validator against our dark surface — **do not eyeball replacement values, re-run the
script**:

```
node <dataviz>/scripts/validate_palette.js "<hexes>" --mode dark --surface "#151922"
```

### Categorical series (validated — all six checks PASS)

Fixed order. Never cycle; a 7th series folds into "Other" or becomes small multiples.

| # | Hex | Reads as |
|---|---|---|
| 1 | `#3d8fc4` | blue |
| 2 | `#c9527c` | rose |
| 3 | `#6ba830` | green |
| 4 | `#8a54c4` | violet |
| 5 | `#c47a2c` | amber |
| 6 | `#189e83` | teal |

Validator result on surface `#151922`: lightness band PASS · chroma floor PASS · CVD
separation PASS (worst adjacent ΔE 10.7 protan) · normal-vision floor PASS (ΔE 20.2) ·
contrast PASS. Re-run before changing any value.

### Status colours — reserved, never used as a series

Reuse the console's severity tokens (`--severity-critical/high/medium/low/ok`). They mean
state, never identity. They always ship with a label or icon, never colour alone.

### Sequential (magnitude)

One hue, light→dark, from the brand mint: `#d3f0e8 → #8fd9c8 → #4fae99 → #2c7a6a → #17463d`.

### Diverging (better/worse than baseline)

`#c9527c` (worse) ←→ neutral `#4a5262` ←→ `#189e83` (better). Never a hue at the midpoint.

## Form selection for telemetry

Pick by the data's job, per `dataviz/references/choosing-a-form.md`. For our metrics:

| Question the reader has | Form | Notes |
|---|---|---|
| "Is it up right now?" | **Stat tile + status dot** | Not a chart. A number and a word beat a plot |
| "Is it getting worse?" | **Sparkline** in the tile | Trend without axes; no gridlines, no labels |
| "How has traffic moved?" | **Line, one axis** | Never dual-axis — that is the #1 chart mistake |
| "What share is failing?" | **Error-ratio area, 0–100%** | Ratio, not raw counts; a fixed 0–1 domain |
| "Which service is worst?" | **Horizontal bar, sorted** | Sorted by value, labels on the left, readable |
| "Is it normal for this hour?" | **Line + baseline band** | The band is yesterday's range; the line is now |
| "Where is the time going?" | **Stacked bar with 2px gaps** | Max 6 segments, then "Other" |

**Default to the stat tile.** Most questions this console answers are "is this fine?", and a
number with a plain sentence answers that better than any plot. Reach for a plot only when
*change over time* or *comparison* is the actual question.

## Non-negotiables inherited from `dataviz`

- One y-axis. Never two.
- Colour follows the entity, never its rank — filtering must not repaint survivors.
- Legend present for ≥2 series; ≤4 series also directly labelled. Identity is never
  colour-alone.
- Text wears text tokens, never the series colour.
- Thin marks, 2px lines, ≥8px markers, 2px surface gap between adjacent fills.
- Hover layer by default: crosshair + tooltip on line/area, per-mark tooltip on bar/dot.
- Respect `prefers-reduced-motion`; chart entry animation ≤300ms, ease-out, no overshoot.

## Templates

Copy-paste starting points for each form, in this project's stack (React + inline SVG, no
chart library — the console ships zero chart dependencies on purpose):
[references/templates.md](references/templates.md).

## Before you ship a chart

- [ ] A plain-language sentence sits above it, agent-written and cited
- [ ] The form matches the reader's actual question (default: stat tile)
- [ ] Series colours come from the validated list, in fixed order
- [ ] Status colours are not used for identity
- [ ] One y-axis
- [ ] Legend and/or direct labels present for ≥2 series
- [ ] Hover tooltip exists
- [ ] Checked against `dataviz/references/anti-patterns.md`
- [ ] Rendered and eyeballed — the validator checks colour, not layout
