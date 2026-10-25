// Number, money and time formatting for the UI.

import { AIRPORT_BY_CODE } from '../data/airports.js';
import { localDate, utcMs, utcOffsetHours, weekIndex } from '../engine/time.js';

export function money(n, { sign = false, exact = false } = {}) {
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0;
  const v = Math.abs(n);
  let body;
  if (exact) body = `$${Math.round(v).toLocaleString('en-US')}`;
  else if (v >= 1e9) body = `$${(v / 1e9).toFixed(2)}B`;
  else if (v >= 1e6) body = `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : v >= 1e7 ? 1 : 2).replace(/\.0+$/, '')}M`;
  else if (v >= 1e4) body = `$${Math.round(v / 1e3)}K`;
  else if (v >= 1e3) body = `$${(v / 1e3).toFixed(1)}K`;
  else body = `$${Math.round(v)}`;
  if (neg) return `-${body}`;
  return sign ? `+${body}` : body;
}

export function num(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
}

export function pct(f, digits = 0) {
  return Number.isFinite(f) ? `${(f * 100).toFixed(digits)}%` : '—';
}

export function miles(n) {
  return `${Math.round(n).toLocaleString('en-US')} mi`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function tzLabel(ap, ms) {
  const off = utcOffsetHours(ap, ms);
  const us = { '-8': 'PST', '-7': ap.tz === -8 ? 'PDT' : 'MST', '-6': ap.tz === -7 ? 'MDT' : 'CST', '-5': ap.tz === -6 ? 'CDT' : 'EST', '-4': 'EDT' };
  if (ap.country === 'US') return us[String(off)] || `UTC${off}`;
  if (ap.code === 'LHR') return off === 1 ? 'BST' : 'GMT';
  if (ap.code === 'NRT') return 'JST';
  return `UTC${off >= 0 ? '+' : ''}${off}`;
}

// "Mon Oct 26 · 05:00 PST"
export function clockAt(state, airportCode, t = state.now) {
  const ap = AIRPORT_BY_CODE[airportCode];
  const ms = utcMs(state, t);
  const d = localDate(ap, ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    date: `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
    time: `${hh}:${mm}`,
    zone: tzLabel(ap, ms),
  };
}

export function shortTime(state, airportCode, t) {
  const c = clockAt(state, airportCode, t);
  return `${c.time} ${c.zone}`;
}

export function week(t) {
  return weekIndex(t);
}

export function duration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const d = Math.floor(m / 1440);
  const hrs = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (d > 0) return `${d}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}m`;
}
