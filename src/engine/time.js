// Game clock + real-world calendar helpers.
//
// Game time `t` is measured in minutes since `state.epochMs`, which is Monday
// 00:00 local time at the player's starting hub. Weekly settlements happen
// every 10,080 minutes from the epoch. All calendar math works in UTC
// milliseconds so it is deterministic and independent of the browser's locale.

export const MIN_PER_HOUR = 60;
export const MIN_PER_DAY = 24 * 60;
export const MIN_PER_WEEK = 7 * MIN_PER_DAY;

// Departures are allowed from 06:00 to 23:59 local airport time.
export const CURFEW_OPEN_MIN = 6 * 60;

const DAY_MS = 86_400_000;

export function utcMs(state, t) {
  return state.epochMs + t * 60_000;
}

export function weekIndex(t) {
  return Math.floor(t / MIN_PER_WEEK) + 1;
}

// Day of month for the n-th `weekday` (0 = Sunday) of `month` (0-11).
function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function lastWeekday(year, month, weekday) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const diff = (lastDay.getUTCDay() - weekday + 7) % 7;
  return lastDay.getUTCDate() - diff;
}

export function isDst(rule, tz, ms) {
  if (rule === 'none') return false;
  const year = new Date(ms).getUTCFullYear();
  if (rule === 'US') {
    // 2nd Sunday in March 02:00 local standard -> 1st Sunday in November 02:00 local daylight
    const start = Date.UTC(year, 2, nthWeekday(year, 2, 0, 2), 2 - tz);
    const end = Date.UTC(year, 10, nthWeekday(year, 10, 0, 1), 2 - (tz + 1));
    return ms >= start && ms < end;
  }
  if (rule === 'UK') {
    // last Sunday in March 01:00 UTC -> last Sunday in October 01:00 UTC
    const start = Date.UTC(year, 2, lastWeekday(year, 2, 0), 1);
    const end = Date.UTC(year, 9, lastWeekday(year, 9, 0), 1);
    return ms >= start && ms < end;
  }
  return false;
}

export function utcOffsetHours(airport, ms) {
  return airport.tz + (isDst(airport.dst, airport.tz, ms) ? 1 : 0);
}

// Wall-clock time at an airport, returned as a Date whose UTC fields read as local time.
export function localDate(airport, ms) {
  return new Date(ms + utcOffsetHours(airport, ms) * 3_600_000);
}

export function localMinuteOfDay(airport, ms) {
  const d = localDate(airport, ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

// Earliest time >= t at which a flight may depart `airport`.
export function nextAllowedDeparture(state, airport, t) {
  const minute = localMinuteOfDay(airport, utcMs(state, t));
  if (minute >= CURFEW_OPEN_MIN) return t;
  return Math.ceil(t + (CURFEW_OPEN_MIN - minute));
}

// Epoch for a new game: Monday 00:00 local time at the hub on/after `startIso`.
export function computeEpoch(startIso, hubAirport) {
  const [y, m, d] = startIso.split('-').map(Number);
  let ms = Date.UTC(y, m - 1, d);
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  const daysToMonday = (8 - dow) % 7;
  ms += daysToMonday * DAY_MS;
  return ms - utcOffsetHours(hubAirport, ms) * 3_600_000;
}

// ---------------------------------------------------------------------------
// Seasonality + holidays (US travel calendar; applied network-wide)

const MONTHLY_SEASON = [0.86, 0.88, 1.0, 0.98, 1.02, 1.1, 1.13, 1.06, 0.92, 0.97, 0.95, 1.03];

function holidayWindows(year) {
  const thanksgiving = nthWeekday(year, 10, 4, 4);
  const memorial = lastWeekday(year, 4, 1);
  const labor = nthWeekday(year, 8, 1, 1);
  return [
    { id: 'thanksgiving', name: 'Thanksgiving rush', mult: 1.3,
      from: Date.UTC(year, 10, thanksgiving - 2), to: Date.UTC(year, 10, thanksgiving + 5) },
    { id: 'winter', name: 'Holiday season travel', mult: 1.22,
      from: Date.UTC(year, 11, 19), to: Date.UTC(year + 1, 0, 4) },
    { id: 'winter-prev', name: 'Holiday season travel', mult: 1.22,
      from: Date.UTC(year - 1, 11, 19), to: Date.UTC(year, 0, 4) },
    { id: 'july4', name: 'Independence Day getaway', mult: 1.12,
      from: Date.UTC(year, 6, 1), to: Date.UTC(year, 6, 7) },
    { id: 'memorial', name: 'Memorial Day weekend', mult: 1.15,
      from: Date.UTC(year, 4, memorial - 3), to: Date.UTC(year, 4, memorial + 1) },
    { id: 'labor', name: 'Labor Day weekend', mult: 1.12,
      from: Date.UTC(year, 8, labor - 3), to: Date.UTC(year, 8, labor + 1) },
    { id: 'springbreak', name: 'Spring break', mult: 1.08,
      from: Date.UTC(year, 2, 7), to: Date.UTC(year, 2, 30) },
  ];
}

export function activeHoliday(ms) {
  const year = new Date(ms).getUTCFullYear();
  for (const h of holidayWindows(year)) {
    if (ms >= h.from && ms < h.to) return h;
  }
  return null;
}

export function seasonFactor(ms) {
  const month = new Date(ms).getUTCMonth();
  const holiday = activeHoliday(ms);
  return MONTHLY_SEASON[month] * (holiday ? holiday.mult : 1);
}
