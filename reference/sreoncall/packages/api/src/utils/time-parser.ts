/**
 * Parse and format human-friendly time estimate strings.
 *
 * Supported formats: 30m, 1h, 2d, 1w, 1.5h, 2h30m
 * Units: m = minutes, h = hours, d = days (8h), w = weeks (40h)
 */

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 8;
const DAYS_PER_WEEK = 5;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR; // 480
const MINUTES_PER_WEEK = DAYS_PER_WEEK * MINUTES_PER_DAY; // 2400

const TIME_PATTERN = /^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/i;
const COMPOUND_PATTERN = /^(\d+)\s*h\s*(\d+)\s*m$/i;

export function parseTimeEstimate(raw: string): number {
  const input = raw.trim().toLowerCase();
  if (!input) {
    throw new Error('Time estimate cannot be empty');
  }

  // Try compound format: "2h30m"
  const compound = COMPOUND_PATTERN.exec(input);
  if (compound) {
    const hours = parseInt(compound[1], 10);
    const minutes = parseInt(compound[2], 10);
    if (minutes >= 60) {
      throw new Error('Minutes in compound format must be less than 60');
    }
    return hours * MINUTES_PER_HOUR + minutes;
  }

  // Try single-unit format: "30m", "1.5h", "2d", "1w"
  const match = TIME_PATTERN.exec(input);
  if (!match) {
    throw new Error(
      `Invalid time estimate "${raw}". Use formats like: 30m, 1h, 2d, 1w, 1.5h, 2h30m`,
    );
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (value <= 0) {
    throw new Error('Time estimate must be greater than zero');
  }

  switch (unit) {
    case 'm':
      return Math.round(value);
    case 'h':
      return Math.round(value * MINUTES_PER_HOUR);
    case 'd':
      return Math.round(value * MINUTES_PER_DAY);
    case 'w':
      return Math.round(value * MINUTES_PER_WEEK);
    default:
      throw new Error(`Unknown time unit "${unit}"`);
  }
}

export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0m';

  if (minutes >= MINUTES_PER_WEEK && minutes % MINUTES_PER_WEEK === 0) {
    return `${minutes / MINUTES_PER_WEEK}w`;
  }
  if (minutes >= MINUTES_PER_DAY && minutes % MINUTES_PER_DAY === 0) {
    return `${minutes / MINUTES_PER_DAY}d`;
  }
  if (minutes >= MINUTES_PER_HOUR && minutes % MINUTES_PER_HOUR === 0) {
    return `${minutes / MINUTES_PER_HOUR}h`;
  }
  if (minutes >= MINUTES_PER_HOUR) {
    const h = Math.floor(minutes / MINUTES_PER_HOUR);
    const m = minutes % MINUTES_PER_HOUR;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}
