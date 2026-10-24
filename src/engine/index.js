// Public engine API. Everything here is pure JavaScript with no DOM, no real
// clock and no Math.random, so the same module runs in the browser today and
// on a Node server if Kittle Skies ever goes online.
//
//   const state = createGame({ seed, startDate, airlineName, hub, difficulty });
//   const notes = advance(state, state.now + 30);       // simulate 30 game minutes
//   const { result, notes } = dispatch(state, command); // apply a player/AI command

import { applyCommand, COMMAND_TYPES } from './commands.js';
import { pop, schedule } from './eventQueue.js';
import { expireDecisions, handleEventEnd, handleEventStart, rollDailyWeather } from './events.js';
import { addLog } from './log.js';
import { checkCashWin } from './objectives.js';
import { handleArrive, handleDepart, handlePlaneReady } from './scheduler.js';
import { activeHoliday, MIN_PER_DAY, utcMs } from './time.js';
import { handleWeekEnd } from './weekly.js';

import { priceRivals } from './ai.js';
import { createInitialState } from './state.js';

export { SCHEMA_VERSION, HUMAN_ID } from './state.js';
export { COMMAND_TYPES };

function handleDayTick(state, item, out) {
  rollDailyWeather(state, out);
  expireDecisions(state, out);
  const today = activeHoliday(utcMs(state, item.t));
  const yesterday = activeHoliday(utcMs(state, item.t - MIN_PER_DAY));
  if (today && (!yesterday || yesterday.name !== today.name)) {
    addLog(state, out, { text: `${today.name}: travel demand is up ${Math.round((today.mult - 1) * 100)}% across the network.`, icon: '🎉', kind: 'event', important: true });
  }
  schedule(state, item.t + MIN_PER_DAY, 'DAY_TICK');
}

const HANDLERS = {
  PLANE_READY: handlePlaneReady,
  DEPART: handleDepart,
  ARRIVE: handleArrive,
  DAY_TICK: handleDayTick,
  WEEK_END: handleWeekEnd,
  EVENT_START: handleEventStart,
  EVENT_END: handleEventEnd,
};

// Process every queued event up to game minute `toT`. Stops early (leaving
// `state.now` at the moment it happened) if the game is won or lost, so the
// host can pause and show it.
export function advance(state, toT) {
  const out = [];
  if (state.outcome?.result === 'lost') return out;
  while (state.queue.length > 0 && state.queue[0].t <= toT) {
    const item = pop(state);
    if (item.t > state.now) state.now = item.t;
    const handler = HANDLERS[item.kind];
    if (handler) handler(state, item, out);
    if (item.kind === 'ARRIVE') checkCashWin(state, out);
    if (out.some((n) => n.type === 'outcome')) return out;
  }
  if (toT > state.now) state.now = toT;
  return out;
}

export function createGame(options = {}) {
  const state = createInitialState(options);
  priceRivals(state);
  return state;
}

export function dispatch(state, command) {
  const notes = [];
  const result = applyCommand(state, command, notes);
  if (result.ok) checkCashWin(state, notes);
  return { result, notes };
}
