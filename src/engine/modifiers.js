// Read-only helpers that turn active events into multipliers. Kept separate
// from events.js (which spawns/resolves events) to avoid import cycles.

import { FUEL_MEAN } from './constants.js';

export function isActive(e, t) {
  return e.startT <= t && t < e.endT;
}

export function activeEvents(state, t = state.now) {
  return state.activeEvents.filter((e) => isActive(e, t));
}

function product(list, field) {
  return list.reduce((acc, e) => acc * (e.effects[field] ?? 1), 1);
}

export function pairDemandMult(state, a, b, t = state.now) {
  const events = activeEvents(state, t).filter((e) =>
    e.scope === 'global' || (e.scope === 'airport' && (e.target === a || e.target === b)));
  return product(events, 'demandMult');
}

export function airportDelayMult(state, code, t = state.now) {
  const events = activeEvents(state, t).filter((e) =>
    e.scope === 'global' || (e.scope === 'airport' && e.target === code));
  return product(events, 'delayMult');
}

export function airportCancelChance(state, code, t = state.now) {
  let p = 0;
  for (const e of activeEvents(state, t)) {
    if (e.scope === 'airport' && e.target === code && e.effects.cancelChance) {
      p = 1 - (1 - p) * (1 - e.effects.cancelChance);
    }
  }
  return p;
}

export function airportFeeMult(state, code, t = state.now) {
  const events = activeEvents(state, t).filter((e) => e.scope === 'airport' && e.target === code);
  return product(events, 'feeMult');
}

export function stormAt(state, code, t = state.now) {
  return activeEvents(state, t).find((e) => e.type === 'storm' && e.target === code) || null;
}

export function marketFuelPrice(state, t = state.now) {
  const events = activeEvents(state, t).filter((e) => e.scope === 'global');
  return state.fuelPrice * product(events, 'fuelMult');
}

export function airlineFuelPrice(state, airline, t = state.now) {
  if (airline.fuelHedge && t < airline.fuelHedge.untilT) return airline.fuelHedge.price;
  return marketFuelPrice(state, t);
}

// Fares drift up when fuel is expensive: airlines pass part of it on.
export function fuelFareFactor(state, t = state.now) {
  return 1 + 0.3 * (marketFuelPrice(state, t) / FUEL_MEAN - 1);
}

export function fareWarMult(state, airlineId, pairKey, t = state.now) {
  const e = activeEvents(state, t).find((x) => x.type === 'fareWar' && x.target === pairKey && x.airlineId === airlineId);
  return e ? e.effects.fareCut : 1;
}

export function campaignMult(state, airlineId, t = state.now) {
  const c = state.airlines[airlineId]?.campaign;
  return c && t < c.untilT ? c.demandMult : 1;
}
