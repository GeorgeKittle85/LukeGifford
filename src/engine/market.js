// Passenger demand model.
//
// For every city pair:
//   potential  = baseDemand x season x events                (people who'd fly at $0)
//   airline i  = potential x share_i x (1 - fare_i / maxFare) x reputation x campaigns
//
// The (1 - fare / maxFare) term is the pitch's simple demand curve. Shares are
// split by attractiveness (frequency, fare vs. the reference fare, reputation,
// loyalty, hub presence) against each other AND against an "outside option":
// connecting itineraries and carriers that aren't modeled. That outside option
// is what stops a lone small jet from charging the max fare on a huge market.
// Passengers who can't get a seat partly spill to airlines with empty seats.

import { AIRCRAFT } from '../data/aircraft.js';
import { DIFFICULTIES } from '../data/rivals.js';
import { LOYALTY } from './constants.js';
import { PAIRS, legsPerWeekEstimate } from './network.js';
import { seasonFactor, utcMs } from './time.js';
import { campaignMult, fareWarMult, fuelFareFactor, pairDemandMult } from './modifiers.js';

const FREQ_EXPONENT = 0.45;
const PRICE_EXPONENT = 2.5;
const OUTSIDE_STRENGTH = 2.5;
const SPILL_RECAPTURE = 0.6;

export function repDemandFactor(rep) {
  return 0.6 + (rep / 100) * 0.67; // 60 -> 1.0, 20 -> 0.73, 90 -> 1.2
}

function repShareFactor(rep) {
  return 0.6 + (rep / 100) * 0.8;
}

// Planes that are actually flying a route (not delivering, grounded, or leaving).
export function activePlanesOnRoute(state, routeId) {
  const list = [];
  for (const id in state.planes) {
    const p = state.planes[id];
    if (p.routeId === routeId && p.status !== 'delivering' && !p.pendingDisposal) list.push(p);
  }
  return list;
}

export function routeCapacity(state, route, planeTypes = null) {
  const types = planeTypes ?? activePlanesOnRoute(state, route.id).map((p) => p.type);
  let legs = 0, seats = 0;
  for (const type of types) {
    const l = legsPerWeekEstimate(type, route.a, route.b);
    legs += l;
    seats += l * AIRCRAFT[type].seats;
  }
  return { legs, seats, types };
}

export function effectiveFare(state, route, t = state.now) {
  return route.fare * fareWarMult(state, route.airlineId, route.pair, t);
}

export function marketPrices(state, pair, t = state.now) {
  const maxFare = pair.maxFare * fuelFareFactor(state, t);
  return { maxFare, refFare: maxFare * 0.5 };
}

// hypothetical: { airlineId, fare, planeTypes } replaces (or adds) that airline's
// offer on the pair. Used for fare previews and route planning.
export function computeMarket(state, key, { t = state.now, hypothetical = null } = {}) {
  const pair = PAIRS[key];
  const { maxFare, refFare } = marketPrices(state, pair, t);
  const difficulty = DIFFICULTIES[state.difficulty] || DIFFICULTIES.pro;
  const potential = pair.baseDemand * seasonFactor(utcMs(state, t)) * pairDemandMult(state, pair.a, pair.b, t);

  const offers = [];
  for (const id in state.routes) {
    const route = state.routes[id];
    if (route.pair !== key) continue;
    if (hypothetical && route.airlineId === hypothetical.airlineId) continue;
    const cap = routeCapacity(state, route);
    if (cap.legs === 0) continue;
    offers.push({ routeId: route.id, airlineId: route.airlineId, fare: effectiveFare(state, route, t), legs: cap.legs, seats: cap.seats });
  }
  if (hypothetical && hypothetical.planeTypes.length > 0) {
    const cap = routeCapacity(state, { id: null, a: pair.a, b: pair.b }, hypothetical.planeTypes);
    offers.push({ routeId: hypothetical.routeId ?? null, airlineId: hypothetical.airlineId, fare: hypothetical.fare, legs: cap.legs, seats: cap.seats, hypothetical: true });
  }

  const outside = OUTSIDE_STRENGTH * Math.sqrt(pair.baseDemand / 7000) * (pair.international ? 0.7 : 1);
  let totalAttract = outside;
  for (const o of offers) {
    const airline = state.airlines[o.airlineId];
    const hub = airline.hubs.includes(pair.a) || airline.hubs.includes(pair.b) ? 1.08 : 1;
    const loyalty = airline.upgrades.loyalty ? LOYALTY.shareBonus : 1;
    o.attract = Math.pow(o.legs / 14, FREQ_EXPONENT)
      * repShareFactor(airline.reputation)
      * Math.pow(refFare / Math.max(1, o.fare), PRICE_EXPONENT)
      * hub * loyalty;
    totalAttract += o.attract;
  }

  for (const o of offers) {
    const airline = state.airlines[o.airlineId];
    o.share = o.attract / totalAttract;
    const curve = Math.max(0, 1 - o.fare / maxFare);
    const human = airline.controller === 'human' ? difficulty.humanDemand : 1;
    o.demand = potential * o.share * curve * repDemandFactor(airline.reputation) * campaignMult(state, o.airlineId, t) * human;
    o.capacity = o.seats * (1 + airline.settings.overbooking);
    o.booked = Math.min(o.demand, o.capacity);
  }

  // One round of spill: unserved passengers try airlines with spare seats.
  const spilled = offers.reduce((s, o) => s + Math.max(0, o.demand - o.capacity), 0) * SPILL_RECAPTURE;
  if (spilled > 0) {
    const open = offers.filter((o) => o.booked < o.capacity);
    const openAttract = open.reduce((s, o) => s + o.attract, 0);
    for (const o of open) {
      o.booked = Math.min(o.capacity, o.booked + (spilled * o.attract) / openAttract);
    }
  }

  return {
    pair, maxFare, refFare, potential, outsideShare: outside / totalAttract, offers,
  };
}

// Expected booked passengers per one-way leg for a route right now.
export function bookedPerLeg(state, route, t = state.now) {
  const market = computeMarket(state, route.pair, { t });
  const offer = market.offers.find((o) => o.routeId === route.id);
  if (!offer || offer.legs === 0) return 0;
  return offer.booked / offer.legs;
}
