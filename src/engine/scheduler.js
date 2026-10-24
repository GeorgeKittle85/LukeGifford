// Aircraft movement: every assigned plane shuttles between its route's two
// airports, departing as soon as it is turned around (and the 06:00-24:00
// departure window allows). Driven by three queue events:
//
//   PLANE_READY  plane is on the ground and free: plan its next departure
//   DEPART       scheduled departure: roll disruptions, board, take off
//   ARRIVE       flight lands: book revenue and costs, start turnaround
//
// Every PLANE_READY / DEPART carries the plane's `token`. Re-planning a plane
// bumps the token, which silently cancels any stale queue entries for it.

import { AIRCRAFT, LEASE_RETURN_FEE_MONTHS, RESALE_HAIRCUT } from '../data/aircraft.js';
import {
  BUMP_COMPENSATION, LONG_DELAY_COMP_PER_PAX, MAINTENANCE_POLICIES, NO_SHOW_RANGE,
  NO_SHOW_REVENUE_SHARE, REPUTATION,
} from './constants.js';
import { legCost, planeMarketValue } from './economics.js';
import { schedule } from './eventQueue.js';
import { addLog, fmtMoney } from './log.js';
import { bookedPerLeg, effectiveFare } from './market.js';
import { airportCancelChance, airportDelayMult } from './modifiers.js';
import { airport, blockMinutes, getPair } from './network.js';
import { adjustReputation } from './reputation.js';
import { chance, noise, randRange, random } from './rng.js';
import { emptyLedger, newId } from './state.js';
import { nextAllowedDeparture } from './time.js';

const SAME_ROUTE_SPACING = 30; // minutes between two departures of one route from one airport
const CANCEL_RETRY_MIN = 180;
const BASE_DELAY_CHANCE = 0.07;

export function ledgerFor(state, airlineId) {
  if (!state.ledger[airlineId]) state.ledger[airlineId] = emptyLedger();
  return state.ledger[airlineId];
}

function routeLedger(ledger, routeId) {
  if (!ledger.routes[routeId]) {
    ledger.routes[routeId] = { pax: 0, legs: 0, seats: 0, revenue: 0, cost: 0, delays: 0, cancellations: 0 };
  }
  return ledger.routes[routeId];
}

// Ask the scheduler to (re)plan a plane at time t.
export function kickPlane(state, plane, t = state.now) {
  plane.token++;
  schedule(state, Math.ceil(t), 'PLANE_READY', { planeId: plane.id, token: plane.token });
}

export function handlePlaneReady(state, item, out) {
  const plane = state.planes[item.planeId];
  if (!plane || plane.token !== item.token) return;
  const t = item.t;

  if (plane.status === 'delivering') {
    plane.status = 'idle';
    out.push({ type: 'delivered', planeId: plane.id, airlineId: plane.airlineId });
    if (state.airlines[plane.airlineId].controller === 'human') {
      addLog(state, out, { text: `${AIRCRAFT[plane.type].name} ${plane.tail} delivered at ${plane.location}.`, icon: '🛬', kind: 'fleet', airlineId: plane.airlineId, important: true });
    }
  }
  if (plane.pendingDisposal) {
    disposePlane(state, plane, out);
    return;
  }
  if (plane.groundedUntil > t) {
    plane.status = 'grounded';
    plane.token++;
    schedule(state, plane.groundedUntil, 'PLANE_READY', { planeId: plane.id, token: plane.token });
    return;
  }
  const route = plane.routeId ? state.routes[plane.routeId] : null;
  if (!route) {
    plane.routeId = null;
    plane.status = 'idle';
    plane.nextDep = null;
    return;
  }

  const from = plane.location;
  let to;
  let ferry = false;
  if (from === route.a) to = route.b;
  else if (from === route.b) to = route.a;
  else {
    // Reposition empty to whichever end of the route is closer.
    ferry = true;
    to = getPair(from, route.a).distance <= getPair(from, route.b).distance ? route.a : route.b;
  }

  let depT = nextAllowedDeparture(state, airport(from), t);
  if (!ferry) {
    const last = route.lastDep[from];
    if (last !== undefined && depT < last + SAME_ROUTE_SPACING && depT > last - SAME_ROUTE_SPACING) {
      depT = last + SAME_ROUTE_SPACING;
    }
    route.lastDep[from] = depT;
  }

  plane.status = 'scheduled';
  plane.nextDep = { schedT: depT, from, to, ferry, delay: 0, rolled: false, routeId: route.id };
  plane.token++;
  schedule(state, depT, 'DEPART', { planeId: plane.id, token: plane.token });
}

function rollDelay(state, airline, plane, from, to) {
  const type = AIRCRAFT[plane.type];
  const policy = MAINTENANCE_POLICIES[airline.settings.maintenance];
  const weather = Math.max(airportDelayMult(state, from), airportDelayMult(state, to));
  const p = Math.min(0.85, (BASE_DELAY_CHANCE / type.reliability) * policy.delayMult * weather);
  if (!chance(state, p)) return 0;
  const minutes = 15 + Math.floor(-Math.log(1 - random(state) * 0.999) * 35 * Math.sqrt(weather));
  return Math.min(minutes, 6 * 60);
}

export function handleDepart(state, item, out) {
  const plane = state.planes[item.planeId];
  if (!plane || plane.token !== item.token || !plane.nextDep) return;
  const t = item.t;
  const nd = plane.nextDep;
  const airline = state.airlines[plane.airlineId];

  // Assignment changed (or route closed) while waiting at the gate: re-plan.
  if (plane.routeId !== nd.routeId || !state.routes[nd.routeId] || plane.pendingDisposal) {
    kickPlane(state, plane, t);
    return;
  }
  const route = state.routes[nd.routeId];
  const ledger = ledgerFor(state, airline.id);

  if (!nd.rolled) {
    nd.rolled = true;
    const cancelP = nd.ferry ? 0 : 1 - (1 - airportCancelChance(state, nd.from)) * (1 - airportCancelChance(state, nd.to));
    if (cancelP > 0 && chance(state, cancelP)) {
      const flightNo = flightNumber(airline, route, nd.from);
      ledger.cancellations++;
      routeLedger(ledger, route.id).cancellations++;
      adjustReputation(state, airline, -REPUTATION.cancellation);
      if (airline.controller === 'human') {
        addLog(state, out, { text: `${flightNo} ${nd.from}→${nd.to} cancelled due to weather.`, icon: '✖', kind: 'ops', airlineId: airline.id });
      }
      plane.status = 'turnaround';
      plane.nextDep = null;
      kickPlane(state, plane, t + CANCEL_RETRY_MIN);
      return;
    }
    const delay = rollDelay(state, airline, plane, nd.from, nd.to);
    if (delay > 0) {
      nd.delay = delay;
      plane.status = 'delayed';
      schedule(state, t + delay, 'DEPART', { planeId: plane.id, token: plane.token });
      return;
    }
  }

  // Board and take off.
  const type = AIRCRAFT[plane.type];
  const pair = getPair(nd.from, nd.to);
  const block = blockMinutes(plane.type, pair.distance);
  let booked = 0, noShows = 0, bumped = 0, pax = 0, revenue = 0, fare = 0;
  if (!nd.ferry) {
    fare = effectiveFare(state, route, t);
    const capacity = Math.floor(type.seats * (1 + airline.settings.overbooking));
    const expected = bookedPerLeg(state, route, t);
    booked = Math.max(0, Math.min(capacity, Math.round(expected * (1 + noise(state, 0.12)))));
    noShows = Math.round(booked * randRange(state, NO_SHOW_RANGE[0], NO_SHOW_RANGE[1]));
    const showUps = booked - noShows;
    bumped = Math.max(0, showUps - type.seats);
    pax = showUps - bumped;
    revenue = pax * fare + noShows * fare * NO_SHOW_REVENUE_SHARE;
  }

  const flight = {
    id: newId(state, 'F'),
    planeId: plane.id,
    airlineId: airline.id,
    routeId: route.id,
    type: plane.type,
    flightNo: nd.ferry ? `${airline.code}${route.flightBase}F` : flightNumber(airline, route, nd.from),
    from: nd.from,
    to: nd.to,
    depT: t,
    arrT: t + block,
    schedT: nd.schedT,
    delay: nd.delay,
    ferry: nd.ferry,
    pax, booked, noShows, bumped, fare, revenue,
  };
  state.flights[flight.id] = flight;
  plane.status = 'flying';
  plane.flightId = flight.id;
  plane.nextDep = null;
  schedule(state, flight.arrT, 'ARRIVE', { flightId: flight.id });
}

export function flightNumber(airline, route, from) {
  return `${airline.code}${route.flightBase + (from === route.a ? 1 : 2)}`;
}

export function handleArrive(state, item, out) {
  const flight = state.flights[item.flightId];
  if (!flight) return;
  delete state.flights[flight.id];
  const plane = state.planes[flight.planeId];
  const airline = state.airlines[flight.airlineId];
  if (!airline) return;
  const ledger = ledgerFor(state, airline.id);
  const typeId = flight.type;

  const costs = legCost(state, airline, typeId, flight.from, flight.to, flight.pax, flight.revenue);
  const compensation = flight.bumped * BUMP_COMPENSATION + (flight.delay >= 180 ? flight.pax * LONG_DELAY_COMP_PER_PAX : 0);
  airline.cash += flight.revenue - costs.total - compensation;

  ledger.revenue += flight.revenue;
  for (const k of ['fuel', 'crew', 'maintenance', 'ops', 'airport', 'service', 'distribution']) ledger.costs[k] += costs[k];
  ledger.costs.compensation += compensation;
  if (flight.ferry) {
    ledger.ferryLegs++;
  } else {
    ledger.legs++;
    ledger.pax += flight.pax;
    ledger.seats += AIRCRAFT[typeId].seats;
    ledger.bumped += flight.bumped;
    const pairKeyId = getPair(flight.from, flight.to).key;
    ledger.pairPax[pairKeyId] = (ledger.pairPax[pairKeyId] || 0) + flight.pax;
    airline.totals.pax += flight.pax;
    airline.totals.legs++;
  }
  airline.totals.revenue += flight.revenue;
  if (state.routes[flight.routeId]) {
    const rl = routeLedger(ledger, flight.routeId);
    rl.revenue += flight.revenue;
    rl.cost += costs.total + compensation;
    if (!flight.ferry) {
      rl.pax += flight.pax;
      rl.legs++;
      rl.seats += AIRCRAFT[typeId].seats;
      if (flight.delay >= 15) rl.delays++;
    }
  }

  // Reputation: punctuality and bumping.
  if (!flight.ferry) {
    if (flight.delay < 15) {
      ledger.onTime++;
      adjustReputation(state, airline, REPUTATION.onTime);
    } else {
      ledger.delays++;
      adjustReputation(state, airline, -REPUTATION.delayPerHour * Math.min(3, flight.delay / 60));
    }
    if (flight.bumped > 0) {
      adjustReputation(state, airline, -Math.min(REPUTATION.bumpedCapPerFlight, flight.bumped * REPUTATION.bumpedPerPax));
      if (airline.controller === 'human' && flight.bumped >= 5) {
        addLog(state, out, { text: `${flight.flightNo} overbooked: ${flight.bumped} passengers bumped (${fmtMoney(flight.bumped * BUMP_COMPENSATION)} in compensation).`, icon: '🎟', kind: 'ops', airlineId: airline.id });
      }
    }
  }

  if (!plane) return;
  plane.location = flight.to;
  plane.flightId = null;
  plane.stats.legs++;
  plane.stats.hours += (flight.arrT - flight.depT) / 60;
  plane.stats.pax += flight.pax;
  plane.stats.revenue += flight.revenue;
  if (plane.pendingDisposal) {
    disposePlane(state, plane, out);
    return;
  }
  plane.status = 'turnaround';
  kickPlane(state, plane, flight.arrT + AIRCRAFT[typeId].turnMin);
}

// Return a leased plane or sell an owned one.
export function disposePlane(state, plane, out) {
  const airline = state.airlines[plane.airlineId];
  const ledger = ledgerFor(state, airline.id);
  let amount;
  let text;
  if (plane.ownership === 'leased') {
    amount = Math.max(0, plane.deposit - AIRCRAFT[plane.type].leaseMonthly * LEASE_RETURN_FEE_MONTHS);
    text = `Returned ${plane.tail} (${AIRCRAFT[plane.type].short}) to the lessor. Deposit refund ${fmtMoney(amount)}.`;
  } else {
    amount = planeMarketValue(state, plane) * RESALE_HAIRCUT;
    text = `Sold ${plane.tail} (${AIRCRAFT[plane.type].short}) for ${fmtMoney(amount)}.`;
  }
  airline.cash += amount;
  ledger.oneOff.in += amount;
  ledger.oneOff.items.push({ label: plane.ownership === 'leased' ? `Lease return ${plane.tail}` : `Sale ${plane.tail}`, amount });
  delete state.planes[plane.id];
  addLog(state, out, { text: airline.controller === 'human' ? text : `${airline.name} retires ${plane.tail} (${AIRCRAFT[plane.type].short}).`, icon: '📤', kind: 'fleet', airlineId: airline.id });
}
