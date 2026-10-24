// Per-flight costs and weekly fixed costs.

import { AIRCRAFT, WEEKLY_DEPRECIATION, weeklyLease } from '../data/aircraft.js';
import {
  DISTRIBUTION_COST_SHARE, HUB_WEEKLY_UPKEEP, LOYALTY, MAINTENANCE_POLICIES,
  OVERHEAD_BASE, OVERHEAD_PER_PLANE, SERVICE_LEVELS,
} from './constants.js';
import { airport, blockMinutes, getPair } from './network.js';
import { airlineFuelPrice, airportFeeMult } from './modifiers.js';

const LANDING_FEE_PER_KLB = 4.2;
const HUB_FEE_DISCOUNT = 0.85;

function feeFactor(state, airline, code) {
  const ap = airport(code);
  return ap.feeIndex * airportFeeMult(state, code) * (airline.hubs.includes(code) ? HUB_FEE_DISCOUNT : 1);
}

// Cost breakdown for one leg. `revenue` is needed for distribution costs.
export function legCost(state, airline, typeId, from, to, pax, revenue) {
  const type = AIRCRAFT[typeId];
  const pair = getPair(from, to);
  const hours = blockMinutes(typeId, pair.distance) / 60;
  const loadFactor = Math.min(1, pax / type.seats);
  const policy = MAINTENANCE_POLICIES[airline.settings.maintenance];
  const service = SERVICE_LEVELS[airline.settings.serviceLevel];
  const fromAp = airport(from);

  const fuel = type.fuelGph * hours * airlineFuelPrice(state, airline) * (0.92 + 0.08 * loadFactor);
  const crew = type.crewPerHr * hours * airline.crewCostMult;
  const maintenance = type.maintPerHr * hours * policy.costMult;
  const ops = type.opsPerHr * hours;
  const landing = type.mtowKlb * LANDING_FEE_PER_KLB * feeFactor(state, airline, to);
  const handling = (250 + 0.9 * type.seats) * feeFactor(state, airline, from);
  const paxCharges = pax * 5 * fromAp.feeIndex * airportFeeMult(state, from) * (fromAp.country === 'US' ? 1 : 4);
  const catering = pax * service.perPax * (1 + hours / 5);
  const distribution = revenue * DISTRIBUTION_COST_SHARE;
  const loyalty = airline.upgrades.loyalty ? pax * LOYALTY.perPax : 0;

  const costs = {
    fuel,
    crew,
    maintenance,
    ops,
    airport: landing + handling + paxCharges,
    service: catering + loyalty,
    distribution,
  };
  costs.total = fuel + crew + maintenance + ops + costs.airport + costs.service + distribution;
  return costs;
}

export function weeklyFixedCosts(state, airline) {
  let leases = 0, planes = 0;
  for (const id in state.planes) {
    const p = state.planes[id];
    if (p.airlineId !== airline.id) continue;
    planes++;
    if (p.ownership === 'leased') leases += weeklyLease(p.type);
  }
  const overhead = OVERHEAD_BASE + OVERHEAD_PER_PLANE * planes;
  const hubs = HUB_WEEKLY_UPKEEP * Math.max(0, airline.hubs.length - 1);
  const loyalty = airline.upgrades.loyalty ? LOYALTY.weeklyCost : 0;
  return { leases, overhead, hubs, loyalty, total: leases + overhead + hubs + loyalty };
}

export function planeMarketValue(state, plane) {
  if (plane.ownership !== 'owned') return 0;
  const weeks = Math.max(0, (state.now - plane.acquiredAt) / (7 * 24 * 60));
  return plane.purchasePrice * Math.pow(1 - WEEKLY_DEPRECIATION, weeks);
}
