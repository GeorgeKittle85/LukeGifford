// AI rival airlines. They don't cheat: every move goes through applyCommand,
// exactly like the player's clicks (and exactly like a future online player),
// and they plan with the same estimates the route planner shows the player.

import { AIRCRAFT, leaseDeposit, weeklyLease } from '../data/aircraft.js';
import { DIFFICULTIES } from '../data/rivals.js';
import { applyCommand } from './commands.js';
import { marketPrices } from './market.js';
import { PAIRS, canFly } from './network.js';
import { estimateRoute, routeTypes, suggestFare } from './selectors.js';

const FARE_STEP = 0.02; // coarser fare search than the player's planner, for speed

function difficulty(state) {
  return DIFFICULTIES[state.difficulty] || DIFFICULTIES.pro;
}

function planesOf(state, airlineId) {
  return Object.values(state.planes).filter((p) => p.airlineId === airlineId);
}

function targetFare(state, airline, route) {
  const types = routeTypes(state, route.id);
  if (!types.length) return route.fare;
  return suggestFare(state, airline.id, route.a, route.b, types, FARE_STEP) * airline.personality.priceBias;
}

// Called once when a game is created so rivals start with sensible prices.
export function priceRivals(state) {
  for (const route of Object.values(state.routes)) {
    const airline = state.airlines[route.airlineId];
    if (airline.controller !== 'ai') continue;
    applyCommand(state, { type: 'SET_FARE', airlineId: airline.id, routeId: route.id, fare: targetFare(state, airline, route) });
  }
}

function adjustFares(state, airline, out) {
  const aggression = airline.personality.aggression * difficulty(state).aiAggression;
  for (const route of Object.values(state.routes)) {
    if (route.airlineId !== airline.id) continue;
    const { maxFare } = marketPrices(state, PAIRS[route.pair]);
    let fare = route.fare + (targetFare(state, airline, route) - route.fare) * 0.5;

    // React when the player undercuts them and is winning the passengers.
    const humanRoute = Object.values(state.routes).find((x) => x.airlineId === state.humanAirlineId && x.pair === route.pair);
    if (humanRoute) {
      const list = state.standings[route.pair]?.list || [];
      const humanPax = list.find((s) => s.airlineId === state.humanAirlineId)?.pax ?? 0;
      const myPax = list.find((s) => s.airlineId === airline.id)?.pax ?? 0;
      if (humanRoute.fare < route.fare * 0.92 && humanPax > myPax) fare *= 1 - 0.04 * aggression;
    }
    fare = Math.max(maxFare * 0.3, Math.min(maxFare * 0.85, fare));
    if (Math.abs(fare - route.fare) >= 1) {
      applyCommand(state, { type: 'SET_FARE', airlineId: airline.id, routeId: route.id, fare }, out);
    }
  }
}

function currentProfit(state, airline, route) {
  if (!route) return 0;
  const types = routeTypes(state, route.id);
  if (!types.length) return 0;
  return estimateRoute(state, airline.id, route.a, route.b, route.fare, types).profit;
}

function bestExpansion(state, airline) {
  let best = null;
  for (const key in PAIRS) {
    const pair = PAIRS[key];
    if (!airline.hubs.includes(pair.a) && !airline.hubs.includes(pair.b)) continue;
    const a = airline.hubs.includes(pair.a) ? pair.a : pair.b;
    const b = a === pair.a ? pair.b : pair.a;
    const route = Object.values(state.routes).find((r) => r.airlineId === airline.id && r.pair === key);
    const existing = route ? routeTypes(state, route.id) : [];
    const before = currentProfit(state, airline, route);
    for (const type of Object.keys(AIRCRAFT)) {
      if (!canFly(type, pair.distance)) continue;
      if (airline.cash < leaseDeposit(type) * 3) continue;
      const types = [...existing, type];
      const fare = suggestFare(state, airline.id, a, b, types, FARE_STEP) * airline.personality.priceBias;
      const gain = estimateRoute(state, airline.id, a, b, fare, types).profit - before;
      if (gain > 40_000 && (!best || gain > best.gain)) best = { a, b, route, type, fare, gain };
    }
  }
  return best;
}

function expand(state, airline, out, week) {
  const diff = difficulty(state);
  if (week - airline.ai.lastExpandWeek < diff.aiExpandEveryWeeks) return;
  if (planesOf(state, airline.id).length >= airline.personality.maxFleet) return;
  if ((airline.lastWeek?.operatingProfit ?? 0) < 0) return;
  const best = bestExpansion(state, airline);
  if (!best) return;
  let routeId = best.route?.id;
  if (!routeId) {
    const res = applyCommand(state, { type: 'OPEN_ROUTE', airlineId: airline.id, a: best.a, b: best.b, fare: best.fare }, out);
    if (!res.ok) return;
    routeId = res.routeId;
  }
  const res = applyCommand(state, { type: 'LEASE_PLANE', airlineId: airline.id, aircraftType: best.type, location: best.a, routeId }, out);
  if (res.ok) airline.ai.lastExpandWeek = week;
}

function contract(state, airline, out) {
  const report = airline.lastWeek;
  if (!report) return;
  for (const r of report.routes) {
    const route = state.routes[r.routeId];
    if (!route) continue;
    const losing = r.legs > 0 && r.profit < 0;
    airline.ai.routeLossWeeks[r.routeId] = losing ? (airline.ai.routeLossWeeks[r.routeId] || 0) + 1 : 0;
    if (airline.ai.routeLossWeeks[r.routeId] < 4) continue;
    airline.ai.routeLossWeeks[r.routeId] = 0;
    // Return the plane with the biggest lease; close the route if it was the last one.
    const planes = planesOf(state, airline.id).filter((p) => p.routeId === route.id)
      .sort((x, y) => weeklyLease(y.type) - weeklyLease(x.type));
    if (planes[0]) applyCommand(state, { type: 'DISPOSE_PLANE', airlineId: airline.id, planeId: planes[0].id }, out);
    if (planes.length <= 1) applyCommand(state, { type: 'CLOSE_ROUTE', airlineId: airline.id, routeId: route.id }, out);
    return; // one cut per week
  }
}

function survive(state, airline, out) {
  if (airline.cash >= 0) return;
  const planes = planesOf(state, airline.id).sort((x, y) => weeklyLease(y.type) - weeklyLease(x.type));
  if (planes[0]) applyCommand(state, { type: 'DISPOSE_PLANE', airlineId: airline.id, planeId: planes[0].id }, out);
}

export function runAi(state, out, week) {
  for (const airline of Object.values(state.airlines)) {
    if (airline.controller !== 'ai') continue;
    adjustFares(state, airline, out);
    contract(state, airline, out);
    expand(state, airline, out, week);
    survive(state, airline, out);
  }
}
