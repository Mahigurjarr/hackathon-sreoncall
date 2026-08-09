# Chart templates

React + inline SVG. **No chart library** — the console ships zero chart dependencies on
purpose, and every form below is under 40 lines without one. The working reference
implementation of most of these is `web/src/components/Overview.jsx`.

Shared imports assumed: nothing but React. Colours come from the validated list in `SKILL.md`.

## Contents

- [Stat tile](#stat-tile) — the default; use this unless change-over-time is the question
- [Sparkline](#sparkline) — trend inside a tile
- [Sorted horizontal bars](#sorted-horizontal-bars) — "which service is worst"
- [Share bar](#share-bar) — one ratio, 0–100%
- [Line over time](#line-over-time) — one axis, one series
- [Caption block](#caption-block) — the mandatory plain-language sentence

---

## Caption block

**Write this first.** A chart without it is not finished (SKILL.md, "the caption is the
chart"). It is agent-authored prose, so it renders through `CitedText` and keeps its `[E#]`
chips.

```jsx
<div className="mb-2">
  <CitedText text={caption} onCite={onCite} className="t-body text-foreground" />
  {sub && <p className="mt-0.5 t-label text-muted-text-2">{sub}</p>}
</div>
```

## Stat tile

The default form. A number, a word, and a status dot answer "is this fine?" better than any
plot. No axes, no gridlines.

```jsx
function StatTile({ label, value, unit, tone = "var(--muted-text)", note }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full" style={{ background: tone }} />
        <span className="t-micro text-muted-text-2">{label}</span>
      </div>
      <p className="mt-1 font-mono text-foreground" style={{ fontSize: "1.375rem", lineHeight: 1.1 }}>
        {value}
        {unit && <span className="ml-1 t-label text-muted-text-2">{unit}</span>}
      </p>
      {note && <p className="mt-0.5 t-label text-muted-text-2">{note}</p>}
    </div>
  );
}
```

The number is the one place the type scale is deliberately exceeded — a hero number is a
different role from body text. Keep it to this single use.

## Sparkline

Trend without axes. No labels, no grid, no tooltip on the line itself — it lives inside a tile
that already carries the number.

```jsx
function Sparkline({ points, color = "#3d8fc4", w = 96, h = 24 }) {
  if (!points?.length) return null;
  const max = Math.max(...points, 0.0001);
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - (p / max) * h}`)
    .join(" L ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`M ${d}`} fill="none" stroke={color} strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

## Sorted horizontal bars

"Which service is worst." Sorted by value, labels on the left where they are readable, value
direct-labelled at the end of each bar so no legend is needed.

Rules: 4px rounded data-end anchored to the baseline; 2px gap between bars; grid recessive or
absent.

```jsx
function BarRow({ label, value, max, display, color }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span className="w-32 shrink-0 truncate text-right font-mono t-label text-muted-text">{label}</span>
      <div className="h-3 flex-1 rounded-sm bg-surface-2">
        <div className="h-full rounded-sm transition-[width] duration-300"
             style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-16 shrink-0 font-mono t-label text-muted-text-2">{display}</span>
    </div>
  );
}
```

## Share bar

One ratio on a fixed 0–100% domain — the domain is fixed so a 2% failure never renders as a
full bar. Ratio, never raw counts.

```jsx
function ShareBar({ ratio, color = "var(--severity-critical)" }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="img"
         aria-label={`${(ratio * 100).toFixed(1)} percent`}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: color }} />
    </div>
  );
}
```

## Line over time

One y-axis. Always. Two measures of different scale become two charts, never two axes.

```jsx
function Line({ series, w = 480, h = 120, color = "#3d8fc4" }) {
  const max = Math.max(...series, 0.0001);
  const pts = series.map((v, i) => [(i / (series.length - 1)) * w, h - (v / max) * h]);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="var(--border)" strokeWidth="1" />
      <path d={`M ${pts.map((p) => p.join(",")).join(" L ")}`} fill="none"
            stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
```

Add the crosshair + tooltip layer before shipping (`dataviz/references/interaction.md`) — a
line chart without hover is incomplete.
