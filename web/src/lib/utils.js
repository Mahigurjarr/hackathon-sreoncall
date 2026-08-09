import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Failing requests are only ever measured as a RATE (errors per second, from span metrics), so
// any count over a window is an estimate — and "2.9 failed requests" is not something a reader
// can picture. Round to whole requests, but never round a real failure down to "0": a fleet
// erroring slowly still reads as broken, and "<1" says that honestly where "0" would lie.
// Every caller must pair this with the window it covers ("· 5 min"), or the number means
// nothing.
export function formatFailureCount(value) {
  if (!Number.isFinite(value)) return "—";
  if (value <= 0) return "0";
  if (value < 1) return "<1";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toString();
}
