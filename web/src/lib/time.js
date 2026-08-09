// One rule: every timestamp this app shows is UTC, labelled as UTC, never the viewer's local
// timezone. An on-call engineer in one timezone and a judge/reviewer in another must read the
// exact same clock time off this screen — `toLocaleTimeString()` with no `timeZone` silently
// renders in whichever timezone the browser happens to be in, which makes "when did this
// start" a different answer depending on who's looking. Every incident timestamp already
// stored is `new Date().toISOString()` (UTC internally); this file is only about display.

const TIME_OPTS = { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false };
const SHORT_TIME_OPTS = { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false };
const DATETIME_OPTS = { ...TIME_OPTS, year: "numeric", month: "short", day: "2-digit" };

export function formatUtcTime(iso) {
  if (!iso) return "—";
  return `${new Date(iso).toLocaleTimeString("en-GB", TIME_OPTS)} UTC`;
}

export function formatUtcShortTime(iso) {
  if (!iso) return "—";
  return `${new Date(iso).toLocaleTimeString("en-GB", SHORT_TIME_OPTS)} UTC`;
}

export function formatUtcDateTime(iso) {
  if (!iso) return "—";
  return `${new Date(iso).toLocaleString("en-GB", DATETIME_OPTS)} UTC`;
}

// "2h 14m", "45m", "3d 2h" — whichever two units matter most. Downtime read by a human should
// answer "how bad was it" in one glance, not force them to subtract two ISO strings.
export function formatDuration(ms) {
  if (ms == null || ms < 0 || Number.isNaN(ms)) return "—";
  const totalMin = Math.round(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return "<1m";
}
