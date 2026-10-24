// News feed / event log. Entries live in state (capped) and are also pushed to
// the `out` notification list so the host can toast the important ones.

import { LOG_LIMIT } from './constants.js';

export function addLog(state, out, { text, kind = 'info', icon = '', airlineId = null, important = false }) {
  const entry = { t: Math.floor(state.now), text, kind, icon, airlineId };
  state.log.push(entry);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  if (out) out.push({ type: 'log', entry, important });
  return entry;
}

export function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
  if (v >= 1e3) return `${sign}$${Math.round(v / 1e3)}k`;
  return `${sign}$${Math.round(v)}`;
}
