// Read-only views of the state for the UI (and, later, for network clients).
// Nothing in here mutates state.

import { AIRCRAFT, weeklyLease } from '../data/aircraft.js';
import { NO_SHOW_RANGE, NO_SHOW_REVENUE_SHARE, WIN_CASH, WIN_TOP_ROUTES } from './constants.js';
import { legCost, planeMarketValue, weeklyFixedCosts } from './economics.js';
import { greatCirclePath, interpolate, bearing } from './geo.js';
import { activePlanesOnRoute, computeMarket, routeCapacity } from './market.js';
import { activeEvents } from './modifiers.js';
import { DEMAND_LEVEL_LABELS, PAIRS, airport, canFly, getPair, pairKey } from './network.js';
import { topAirline, topRouteCount } from './objectives.js';
import { reputationTarget } from './reputation.js';

export function human(state) {
  return state.airlines[state.humanAirlineId];
}

export function routesOf(state, airlineId) {
  return Object.values(state.routes).filter((r) => r.airlineId === airlineId);
}

export function planesOf(state, airlineId) {
  return Object.values(state.planes).filter((p) => p.airlineId === airlineId);
}

export function planesOnRoute(state, routeId) {
  return Object.values(state.planes).filter((p) => p.routeId === routeId);
}

const COMPETITION_LABELS = ['None', 'Low', 'Medium', 'High', 'Intense'];

export function competitionLevel(market, excludeAirlineId) {
  const rivalSeats = market.offers.filter((o) => o.airlineId !== excludeAirlineId).reduce((s, o) => s + o.seats, 0);
  const ratio = rivalSeats / Math.max(1, market.potential * 0.5);
  const level = rivalSeats === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.8 ? 3 : 4;
  return { level, label: COMPETITION_LABELS[level], rivalSeats };
}

// Everything the route planner needs to know about a city pair.
export function pairInfo(state, a, b, airlineId = state.humanAirlineId) {
  const key = pairKey(a, b);
  const pair = PAIRS[key];
  const market = computeMarket(state, key);
  const myRoute = Object.values(state.routes).find((r) => r.airlineId === airlineId && r.pair === key) || null;
  const offers = market.offers.map((o) => {
    const al = state.airlines[o.airlineId];
    return {
      airlineId: o.airlineId, name: al.name, color: al.color, fare: o.fare, legs: o.legs, seats: o.seats,
      share: o.share, booked: o.booked, loadFactor: o.seats ? Math.min(1, o.booked / o.seats) : 0,
    };
  }).sort((x, y) => y.booked - x.booked);
  return {
    key, pair,
    distance: pair.distance,
    demandLevel: pair.demandLevel,
    demandLabel: DEMAND_LEVEL_LABELS[pair.demandLevel],
    potential: market.potential,
    maxFare: market.maxFare,
    refFare: market.refFare,
    outsideShare: market.outsideShare,
    competition: competitionLevel(market, airlineId),
    offers,
    myRoute,
    standing: state.standings[key] || null,
  };
}

// Weekly estimate for flying a pair at `fare` with the given aircraft types.
export function estimateRoute(state, airlineId, a, b, fare, planeTypes) {
  const airline = state.airlines[airlineId];
  const key = pairKey(a, b);
  const existing = Object.values(state.routes).find((r) => r.airlineId === airlineId && r.pair === key);
  const market = computeMarket(state, key, { hypothetical: { airlineId, fare, planeTypes, routeId: existing?.id } });
  const offer = market.offers.find((o) => o.hypothetical);
  const empty = { legs: 0, seats: 0, booked: 0, pax: 0, loadFactor: 0, revenue: 0, costs: 0, contribution: 0, leases: 0, profit: 0, share: 0, maxFare: market.maxFare, refFare: market.refFare };
  if (!offer) return empty;

  const noShow = (NO_SHOW_RANGE[0] + NO_SHOW_RANGE[1]) / 2;
  let revenue = 0, costs = 0, pax = 0, leases = 0;
  for (const type of new Set(planeTypes)) {
    const count = planeTypes.filter((t) => t === type).length;
    const typeCap = routeCapacity(state, { a, b }, [type]);
    const legs = typeCap.legs * count;
    const bookedPerLeg = offer.legs ? offer.booked / offer.legs : 0;
    const shows = bookedPerLeg * (1 - noShow);
    const flown = Math.min(shows, AIRCRAFT[type].seats);
    const legRevenue = flown * fare + bookedPerLeg * noShow * fare * NO_SHOW_REVENUE_SHARE;
    const c = legCost(state, airline, type, a, b, flown, legRevenue);
    revenue += legRevenue * legs;
    costs += c.total * legs;
    pax += flown * legs;
    leases += weeklyLease(type) * count;
  }
  const contribution = revenue - costs;
  return {
    legs: offer.legs,
    seats: offer.seats,
    booked: offer.booked,
    pax,
    loadFactor: offer.seats ? pax / offer.seats : 0,
    revenue,
    costs,
    contribution,
    leases,
    profit: contribution - leases,
    share: offer.share,
    maxFare: market.maxFare,
    refFare: market.refFare,
  };
}

// Fare that maximizes weekly contribution (revenue minus flight costs).
export function suggestFare(state, airlineId, a, b, planeTypes, step = 0.01) {
  const { maxFare } = computeMarket(state, pairKey(a, b));
  if (!planeTypes.length) return Math.round(maxFare * 0.5);
  let best = { fare: maxFare * 0.5, value: -Infinity };
  for (let f = 0.25; f <= 0.9; f += step) {
    const fare = Math.round(maxFare * f);
    const est = estimateRoute(state, airlineId, a, b, fare, planeTypes);
    if (est.contribution > best.value) best = { fare, value: est.contribution };
  }
  return best.fare;
}

export function routeTypes(state, routeId) {
  return activePlanesOnRoute(state, routeId).map((p) => p.type);
}

export function eligibleTypesFor(a, b) {
  const pair = getPair(a, b);
  return Object.keys(AIRCRAFT).filter((t) => canFly(t, pair.distance));
}

export function objectives(state) {
  const me = human(state);
  return {
    cash: me.cash,
    cashTarget: WIN_CASH,
    topRoutes: topRouteCount(state.standings, me.id),
    topTarget: WIN_TOP_ROUTES,
    warning: me.warning,
    outcome: state.outcome,
  };
}

export function netWorth(state, airlineId) {
  const airline = state.airlines[airlineId];
  let assets = 0;
  for (const p of planesOf(state, airlineId)) {
    assets += p.ownership === 'owned' ? planeMarketValue(state, p) : p.deposit;
  }
  return airline.cash + assets;
}

export function weeklyBurn(state, airlineId) {
  return weeklyFixedCosts(state, state.airlines[airlineId]);
}

export function repTarget(state, airlineId) {
  return reputationTarget(state, state.airlines[airlineId]);
}

export function liveEvents(state) {
  return activeEvents(state).map((e) => ({ ...e, remaining: e.endT - state.now }));
}

export function upcomingOrActiveStorms(state) {
  return state.activeEvents.filter((e) => e.type === 'storm' && e.endT > state.now);
}

export function rivalSummaries(state) {
  return Object.values(state.airlines)
    .filter((a) => a.controller === 'ai')
    .map((a) => ({
      id: a.id, name: a.name, color: a.color, hubs: a.hubs, reputation: a.reputation,
      fleet: planesOf(state, a.id).length,
      routes: routesOf(state, a.id).length,
      weeklyPax: a.lastWeek?.pax ?? 0,
      topRoutes: topRouteCount(state.standings, a.id),
      tagline: a.personality?.style,
    }));
}

export function pairStandings(state) {
  return Object.entries(state.standings).map(([key, standing]) => ({
    key, ...standing, top: topAirline(standing),
  })).sort((x, y) => x.key.localeCompare(y.key));
}

// Where a flight is right now (for the map).
export function flightPosition(flight, t) {
  const from = airport(flight.from);
  const to = airport(flight.to);
  const progress = Math.max(0, Math.min(1, (t - flight.depT) / (flight.arrT - flight.depT)));
  const pos = interpolate(from, to, progress);
  const ahead = interpolate(from, to, Math.min(1, progress + 0.01));
  const heading = progress >= 0.99 ? bearing(interpolate(from, to, 0.98), to) : bearing(pos, ahead);
  return { lat: pos.lat, lon: pos.lon, heading, progress };
}

export function routePath(a, b) {
  return greatCirclePath(airport(a), airport(b));
}
