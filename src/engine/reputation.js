// Reputation (0-100). Each flight nudges it (on-time +, delays/cancellations/
// bumping -) and every week it drifts toward a target set by service level,
// loyalty program, and whether your fares feel fair.

import { LOYALTY, REPUTATION, SERVICE_LEVELS } from './constants.js';
import { activePlanesOnRoute, marketPrices } from './market.js';
import { PAIRS } from './network.js';

export function adjustReputation(state, airline, delta) {
  airline.reputation = Math.max(0, Math.min(100, airline.reputation + delta));
}

export function reputationTarget(state, airline) {
  let target = SERVICE_LEVELS[airline.settings.serviceLevel].repTarget;
  if (airline.upgrades.loyalty) target += LOYALTY.repBonus;

  // Price-gouging penalty, weighted by how many planes fly each route.
  let weight = 0, penalty = 0;
  for (const id in state.routes) {
    const route = state.routes[id];
    if (route.airlineId !== airline.id) continue;
    const planes = activePlanesOnRoute(state, route.id).length;
    if (!planes) continue;
    const { refFare } = marketPrices(state, PAIRS[route.pair]);
    const ratio = route.fare / refFare;
    weight += planes;
    if (ratio > REPUTATION.pricePenaltyRatio) penalty += planes * Math.min(15, (ratio - REPUTATION.pricePenaltyRatio) * 25);
  }
  if (weight > 0) target -= penalty / weight;
  return Math.max(5, Math.min(95, target));
}

export function weeklyReputationDrift(state, airline) {
  const before = airline.reputation;
  const target = reputationTarget(state, airline);
  adjustReputation(state, airline, (target - airline.reputation) * REPUTATION.drift);
  return airline.reputation - before;
}
