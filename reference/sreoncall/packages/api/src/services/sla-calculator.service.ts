import { BusinessHours } from '../models/sla-config.model';

interface DaySchedule {
  day: number; // 0=Sunday, 6=Saturday
  start: string; // HH:mm
  end: string;   // HH:mm
}

/**
 * Convert a Date to a date in the given timezone, returning components.
 */
function toTimezone(date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; dayOfWeek: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '0';

  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
  };
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h, minutes: m };
}

function getScheduleForDay(schedule: DaySchedule[], dayOfWeek: number): DaySchedule | undefined {
  return schedule.find((s) => s.day === dayOfWeek);
}

function isHoliday(date: Date, timezone: string, holidays: Array<{ date: string; name: string }>): boolean {
  if (holidays.length === 0) return false;
  const tz = toTimezone(date, timezone);
  const dateStr = `${tz.year}-${String(tz.month).padStart(2, '0')}-${String(tz.day).padStart(2, '0')}`;
  return holidays.some((h) => h.date === dateStr);
}

/**
 * Compute a deadline by walking forward only during business hours.
 * Returns the deadline Date in UTC.
 */
export function computeBusinessHoursDeadline(
  startTime: Date,
  durationMinutes: number,
  businessHours: BusinessHours,
): Date {
  const { timezone, schedule, holidays } = businessHours;
  let remainingMinutes = durationMinutes;

  // Walk forward minute by minute efficiently — advance day by day
  let cursor = new Date(startTime.getTime());

  while (remainingMinutes > 0) {
    const tz = toTimezone(cursor, timezone);
    const daySched = getScheduleForDay(schedule, tz.dayOfWeek);

    if (!daySched || isHoliday(cursor, timezone, holidays)) {
      // Skip to next day 00:00 in timezone
      cursor = new Date(cursor.getTime() + (24 * 60 - tz.hour * 60 - tz.minute) * 60_000);
      continue;
    }

    const start = parseTime(daySched.start);
    const end = parseTime(daySched.end);
    const startMinOfDay = start.hours * 60 + start.minutes;
    const endMinOfDay = end.hours * 60 + end.minutes;
    const currentMinOfDay = tz.hour * 60 + tz.minute;

    if (currentMinOfDay < startMinOfDay) {
      // Before business hours — advance to start
      cursor = new Date(cursor.getTime() + (startMinOfDay - currentMinOfDay) * 60_000);
      continue;
    }

    if (currentMinOfDay >= endMinOfDay) {
      // After business hours — advance to next day
      cursor = new Date(cursor.getTime() + (24 * 60 - currentMinOfDay) * 60_000);
      continue;
    }

    // Within business hours
    const availableMinutes = endMinOfDay - currentMinOfDay;

    if (remainingMinutes <= availableMinutes) {
      cursor = new Date(cursor.getTime() + remainingMinutes * 60_000);
      remainingMinutes = 0;
    } else {
      remainingMinutes -= availableMinutes;
      cursor = new Date(cursor.getTime() + availableMinutes * 60_000);
      // Will loop and skip to next business day
    }
  }

  return cursor;
}

/**
 * Count only business minutes between two timestamps.
 */
export function computeElapsedBusinessMinutes(
  startTime: Date,
  endTime: Date,
  businessHours: BusinessHours,
): number {
  const { timezone, schedule, holidays } = businessHours;
  let totalMinutes = 0;
  let cursor = new Date(startTime.getTime());

  while (cursor < endTime) {
    const tz = toTimezone(cursor, timezone);
    const daySched = getScheduleForDay(schedule, tz.dayOfWeek);

    if (!daySched || isHoliday(cursor, timezone, holidays)) {
      cursor = new Date(cursor.getTime() + (24 * 60 - tz.hour * 60 - tz.minute) * 60_000);
      continue;
    }

    const start = parseTime(daySched.start);
    const end = parseTime(daySched.end);
    const startMinOfDay = start.hours * 60 + start.minutes;
    const endMinOfDay = end.hours * 60 + end.minutes;
    const currentMinOfDay = tz.hour * 60 + tz.minute;

    if (currentMinOfDay < startMinOfDay) {
      cursor = new Date(cursor.getTime() + (startMinOfDay - currentMinOfDay) * 60_000);
      continue;
    }

    if (currentMinOfDay >= endMinOfDay) {
      cursor = new Date(cursor.getTime() + (24 * 60 - currentMinOfDay) * 60_000);
      continue;
    }

    // Within business hours — count until end of business day or endTime
    const endTz = toTimezone(endTime, timezone);
    const endMinOfDayForEnd = endTz.hour * 60 + endTz.minute;

    // Check if endTime is on the same calendar day
    const sameDay = tz.year === endTz.year && tz.month === endTz.month && tz.day === endTz.day;

    let countUntilMin: number;
    if (sameDay && endMinOfDayForEnd <= endMinOfDay) {
      countUntilMin = endMinOfDayForEnd;
    } else {
      countUntilMin = endMinOfDay;
    }

    const minutesThisBlock = Math.max(0, countUntilMin - currentMinOfDay);
    totalMinutes += minutesThisBlock;
    cursor = new Date(cursor.getTime() + (countUntilMin - currentMinOfDay) * 60_000);
  }

  return totalMinutes;
}

/**
 * Check if a timestamp falls within business hours.
 */
export function isWithinBusinessHours(
  timestamp: Date,
  businessHours: BusinessHours,
): boolean {
  const { timezone, schedule, holidays } = businessHours;

  if (isHoliday(timestamp, timezone, holidays)) return false;

  const tz = toTimezone(timestamp, timezone);
  const daySched = getScheduleForDay(schedule, tz.dayOfWeek);
  if (!daySched) return false;

  const start = parseTime(daySched.start);
  const end = parseTime(daySched.end);
  const currentMinOfDay = tz.hour * 60 + tz.minute;
  const startMinOfDay = start.hours * 60 + start.minutes;
  const endMinOfDay = end.hours * 60 + end.minutes;

  return currentMinOfDay >= startMinOfDay && currentMinOfDay < endMinOfDay;
}
