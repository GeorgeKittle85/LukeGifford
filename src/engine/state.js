// Game state creation. The state is a plain JSON-serializable object: no class
// instances, functions, Maps or Dates. That keeps saves trivial and lets a
// future server ship the exact same object to clients.

import { AIRPORT_BY_CODE } from '../data/airports.js';
import { AIRCRAFT, leaseDeposit } from '../data/aircraft.js';
import { DIFFICULTIES, RIVALS } from '../data/rivals.js';
import {
  FUEL_START, START_CASH, START_REPUTATION, STARTER_AIRCRAFT,
} from './constants.js';
import { schedule } from './eventQueue.js';
import { pairKey, PAIRS } from './network.js';
import { randInt, seedFromString } from './rng.js';
import { computeEpoch, MIN_PER_DAY, MIN_PER_WEEK } from './time.js';
import { marketPrices } from './market.js';

export const SCHEMA_VERSION = 1;
export const HUMAN_ID = 'KS';

export function newId(state, prefix) {
  return `${prefix}${state.nextId++}`;
}

export function emptyLedger() {
  return {
    revenue: 0,
    costs: { fuel: 0, crew: 0, maintenance: 0, ops: 0, airport: 0, service: 0, distribution: 0, compensation: 0, other: 0 },
    fixed: { leases: 0, overhead: 0, hubs: 0, loyalty: 0 },
    oneOff: { in: 0, out: 0, items: [] },
    pax: 0, legs: 0, ferryLegs: 0, seats: 0, onTime: 0, delays: 0, cancellations: 0, bumped: 0,
    routes: {},
    pairPax: {},
  };
}

function makeAirline(def) {
  return {
    id: def.id,
    code: def.code,
    name: def.name,
    color: def.color,
    controller: def.controller,
    cash: def.cash,
    reputation: def.reputation,
    hubs: [...def.hubs],
    settings: { ...def.settings },
    upgrades: { loyalty: false },
    crewCostMult: 1,
    fuelHedge: null,
    campaign: null,
    warning: false,
    nextFlightBase: 100,
    personality: def.personality || null,
    ai: def.controller === 'ai' ? { lastExpandWeek: 0, routeLossWeeks: {} } : null,
    lastWeek: null,
    totals: { pax: 0, revenue: 0, legs: 0 },
  };
}

export function createPlane(state, airlineId, typeId, { location, ownership = 'leased', tail = null, status = 'idle' }) {
  const airline = state.airlines[airlineId];
  const id = newId(state, 'PL');
  const number = state.nextId + 100;
  const plane = {
    id,
    airlineId,
    type: typeId,
    tail: tail || `N${number}${airline.code}`,
    ownership,
    deposit: ownership === 'leased' ? leaseDeposit(typeId) : 0,
    purchasePrice: ownership === 'owned' ? AIRCRAFT[typeId].price : 0,
    acquiredAt: state.now,
    status,
    location,
    routeId: null,
    flightId: null,
    nextDep: null,
    groundedUntil: 0,
    pendingDisposal: null,
    token: 0,
    stats: { legs: 0, hours: 0, pax: 0, revenue: 0 },
  };
  state.planes[id] = plane;
  return plane;
}

export function createRoute(state, airlineId, a, b, fare) {
  const airline = state.airlines[airlineId];
  const id = newId(state, 'R');
  const key = pairKey(a, b);
  const route = {
    id,
    airlineId,
    pair: key,
    a, // hub-side endpoint
    b,
    fare: Math.round(fare),
    flightBase: airline.nextFlightBase,
    openedAt: state.now,
    lastDep: {},
  };
  airline.nextFlightBase += 2;
  state.routes[id] = route;
  return route;
}

export function createInitialState(options = {}) {
  const {
    seed = 'kittle-skies',
    startDate = '2026-10-26',
    airlineName = 'Kittle Skies',
    hub = 'SFO',
    difficulty = 'pro',
  } = options;
  if (!AIRPORT_BY_CODE[hub] || AIRPORT_BY_CODE[hub].country !== 'US') throw new Error(`Invalid starting hub ${hub}`);
  if (!DIFFICULTIES[difficulty]) throw new Error(`Unknown difficulty ${difficulty}`);

  const state = {
    schemaVersion: SCHEMA_VERSION,
    seed: String(seed),
    rng: seedFromString(String(seed)),
    nextId: 1,
    nextSeq: 1,
    startDate,
    epochMs: computeEpoch(startDate, AIRPORT_BY_CODE[hub]),
    now: 5 * 60, // Monday 05:00 at the hub
    difficulty,
    fuelPrice: FUEL_START,
    humanAirlineId: HUMAN_ID,
    airlines: {},
    planes: {},
    routes: {},
    flights: {},
    queue: [],
    activeEvents: [],
    decisions: [],
    ledger: {},
    history: [],
    standings: {},
    log: [],
    outcome: null,
    dynasty: false,
  };

  // The player: one leased regional jet, one hub, $1M.
  state.airlines[HUMAN_ID] = makeAirline({
    id: HUMAN_ID, code: 'KS', name: String(airlineName).slice(0, 40) || 'Kittle Skies', color: '#f5c542',
    controller: 'human', cash: START_CASH, reputation: START_REPUTATION, hubs: [hub],
    settings: { serviceLevel: 'standard', maintenance: 'standard', overbooking: 0.05 },
  });
  state.airlines[HUMAN_ID].nextFlightBase = 84; // first route flies KS85 / KS86
  createPlane(state, HUMAN_ID, STARTER_AIRCRAFT, { location: hub, tail: 'N85KS' });

  // Rivals: same rules, pre-existing networks.
  const diff = DIFFICULTIES[difficulty];
  for (const def of RIVALS) {
    const airline = makeAirline({ ...def, controller: 'ai' });
    airline.personality = { ...def.personality, maxFleet: Math.round(def.personality.maxFleet * diff.aiFleetScale) };
    state.airlines[def.id] = airline;
    const routesByPair = {};
    def.fleet.forEach((entry, i) => {
      const [a, b] = entry.route;
      const key = pairKey(a, b);
      if (!PAIRS[key]) throw new Error(`Bad rival route ${key}`);
      let route = routesByPair[key];
      if (!route) {
        // Placeholder fare; priceRivals() sets real prices once fleets exist.
        route = createRoute(state, def.id, a, b, marketPrices(state, PAIRS[key]).refFare);
        routesByPair[key] = route;
      }
      const plane = createPlane(state, def.id, entry.type, { location: i % 2 === 0 ? a : b });
      plane.routeId = route.id;
    });
  }

  for (const id of Object.keys(state.airlines)) state.ledger[id] = emptyLedger();

  // Kick off every assigned plane with a little stagger so they don't all launch at once.
  for (const plane of Object.values(state.planes)) {
    if (!plane.routeId) continue;
    plane.token++;
    schedule(state, state.now + randInt(state, 0, 180), 'PLANE_READY', { planeId: plane.id, token: plane.token });
  }

  schedule(state, MIN_PER_DAY, 'DAY_TICK');
  schedule(state, MIN_PER_WEEK, 'WEEK_END');
  return state;
}
