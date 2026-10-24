// Commands are the ONLY way to change the game state from outside the engine.
// The UI, the AI rivals, and (one day) a network server all go through
// `applyCommand`. Each command is a plain object like
//   { type: 'SET_FARE', airlineId: 'KS', routeId: 'R12', fare: 240 }
// and returns { ok: true, ...result } or { ok: false, error }.

import { AIRPORT_BY_CODE } from '../data/airports.js';
import {
  AIRCRAFT, LEASE_DELIVERY_MIN, PURCHASE_DELIVERY_MIN, leaseDeposit,
} from '../data/aircraft.js';
import {
  CAMPAIGNS, LOYALTY, MAINTENANCE_POLICIES, MAX_HUBS, OVERBOOKING_OPTIONS, SERVICE_LEVELS,
} from './constants.js';
import { schedule } from './eventQueue.js';
import { resolveDecision } from './events.js';
import { addLog, fmtMoney } from './log.js';
import { marketPrices } from './market.js';
import { PAIRS, canFly, getPair, pairKey } from './network.js';
import { disposePlane, kickPlane, ledgerFor } from './scheduler.js';
import { createPlane, createRoute } from './state.js';
import { MIN_PER_WEEK } from './time.js';

const fail = (error) => ({ ok: false, error });

function spend(state, airline, amount, label) {
  airline.cash -= amount;
  const ledger = ledgerFor(state, airline.id);
  ledger.oneOff.out += amount;
  ledger.oneOff.items.push({ label, amount: -amount });
}

export function clampFare(state, pair, fare) {
  const { maxFare } = marketPrices(state, pair);
  const n = Number(fare);
  if (!Number.isFinite(n)) return Math.round(maxFare * 0.5);
  return Math.round(Math.max(20, Math.min(maxFare, n)));
}

function reassign(state, plane, routeId) {
  plane.routeId = routeId;
  // Planes waiting at the gate (or idle) re-plan right away; planes in the air
  // or turning around pick up the change when they're next ready.
  if (['idle', 'scheduled', 'delayed'].includes(plane.status)) kickPlane(state, plane, state.now);
}

const handlers = {
  OPEN_ROUTE(state, airline, cmd, out) {
    let { a, b } = cmd;
    if (!AIRPORT_BY_CODE[a] || !AIRPORT_BY_CODE[b] || a === b) return fail('Pick two different airports.');
    if (!airline.hubs.includes(a)) [a, b] = [b, a];
    if (!airline.hubs.includes(a)) return fail('Every route must start at one of your hubs.');
    const key = pairKey(a, b);
    const existing = Object.values(state.routes).find((r) => r.airlineId === airline.id && r.pair === key);
    if (existing) return fail('You already fly this route.');
    const pair = PAIRS[key];
    const fare = cmd.fare != null ? clampFare(state, pair, cmd.fare) : Math.round(marketPrices(state, pair).refFare);
    const route = createRoute(state, airline.id, a, b, fare);
    addLog(state, out, {
      text: airline.controller === 'human'
        ? `Opened route ${a}–${b} (${pair.distance.toLocaleString('en-US')} mi) at $${fare}.`
        : `${airline.name} launches ${a}–${b}.`,
      icon: '🛫', kind: 'route', airlineId: airline.id,
    });
    for (const planeId of cmd.planeIds || []) {
      const plane = state.planes[planeId];
      if (plane && plane.airlineId === airline.id && canFly(plane.type, pair.distance)) reassign(state, plane, route.id);
    }
    return { ok: true, routeId: route.id };
  },

  CLOSE_ROUTE(state, airline, cmd, out) {
    const route = state.routes[cmd.routeId];
    if (!route || route.airlineId !== airline.id) return fail('Route not found.');
    for (const plane of Object.values(state.planes)) {
      if (plane.routeId === route.id) reassign(state, plane, null);
    }
    delete state.routes[route.id];
    addLog(state, out, {
      text: airline.controller === 'human' ? `Closed route ${route.a}–${route.b}.` : `${airline.name} drops ${route.a}–${route.b}.`,
      icon: '🚫', kind: 'route', airlineId: airline.id,
    });
    return { ok: true };
  },

  SET_FARE(state, airline, cmd) {
    const route = state.routes[cmd.routeId];
    if (!route || route.airlineId !== airline.id) return fail('Route not found.');
    route.fare = clampFare(state, PAIRS[route.pair], cmd.fare);
    return { ok: true, fare: route.fare };
  },

  ASSIGN_PLANE(state, airline, cmd) {
    const plane = state.planes[cmd.planeId];
    if (!plane || plane.airlineId !== airline.id) return fail('Plane not found.');
    if (plane.pendingDisposal) return fail('That plane is leaving the fleet.');
    if (cmd.routeId == null) {
      reassign(state, plane, null);
      return { ok: true };
    }
    const route = state.routes[cmd.routeId];
    if (!route || route.airlineId !== airline.id) return fail('Route not found.');
    const pair = PAIRS[route.pair];
    if (!canFly(plane.type, pair.distance)) {
      return fail(`${AIRCRAFT[plane.type].short} range (${AIRCRAFT[plane.type].rangeMi.toLocaleString('en-US')} mi) is too short for ${pair.distance.toLocaleString('en-US')} mi.`);
    }
    reassign(state, plane, route.id);
    return { ok: true };
  },

  LEASE_PLANE(state, airline, cmd, out) {
    const type = AIRCRAFT[cmd.aircraftType];
    if (!type) return fail('Unknown aircraft type.');
    const location = cmd.location || airline.hubs[0];
    if (!airline.hubs.includes(location)) return fail('Aircraft are delivered to one of your hubs.');
    const deposit = leaseDeposit(type.id);
    if (airline.cash < deposit) return fail(`You need ${fmtMoney(deposit)} for the lease deposit.`);
    spend(state, airline, deposit, `Lease deposit ${type.short}`);
    const plane = createPlane(state, airline.id, type.id, { location, ownership: 'leased', status: 'delivering' });
    if (cmd.routeId && state.routes[cmd.routeId]?.airlineId === airline.id && canFly(type.id, PAIRS[state.routes[cmd.routeId].pair].distance)) {
      plane.routeId = cmd.routeId;
    }
    plane.token++;
    schedule(state, state.now + LEASE_DELIVERY_MIN, 'PLANE_READY', { planeId: plane.id, token: plane.token });
    addLog(state, out, {
      text: airline.controller === 'human'
        ? `Leased a ${type.name} (${plane.tail}). Deposit ${fmtMoney(deposit)}; delivery in 2 days.`
        : `${airline.name} leases a ${type.short}.`,
      icon: '✍', kind: 'fleet', airlineId: airline.id,
    });
    return { ok: true, planeId: plane.id };
  },

  BUY_PLANE(state, airline, cmd, out) {
    const type = AIRCRAFT[cmd.aircraftType];
    if (!type) return fail('Unknown aircraft type.');
    const location = cmd.location || airline.hubs[0];
    if (!airline.hubs.includes(location)) return fail('Aircraft are delivered to one of your hubs.');
    if (airline.cash < type.price) return fail(`You need ${fmtMoney(type.price)} to buy a ${type.short}.`);
    spend(state, airline, type.price, `Purchase ${type.short}`);
    const plane = createPlane(state, airline.id, type.id, { location, ownership: 'owned', status: 'delivering' });
    plane.token++;
    schedule(state, state.now + PURCHASE_DELIVERY_MIN, 'PLANE_READY', { planeId: plane.id, token: plane.token });
    addLog(state, out, {
      text: `Bought a ${type.name} (${plane.tail}) for ${fmtMoney(type.price)}; delivery in 3 days.`,
      icon: '💰', kind: 'fleet', airlineId: airline.id,
    });
    return { ok: true, planeId: plane.id };
  },

  DISPOSE_PLANE(state, airline, cmd, out) {
    const plane = state.planes[cmd.planeId];
    if (!plane || plane.airlineId !== airline.id) return fail('Plane not found.');
    if (plane.pendingDisposal) return fail('Already leaving the fleet.');
    if (plane.status === 'flying') {
      plane.pendingDisposal = true;
      plane.routeId = null;
      return { ok: true, deferred: true };
    }
    disposePlane(state, plane, out);
    return { ok: true };
  },

  OPEN_HUB(state, airline, cmd, out) {
    const ap = AIRPORT_BY_CODE[cmd.airport];
    if (!ap) return fail('Unknown airport.');
    if (airline.hubs.includes(ap.code)) return fail('That is already your hub.');
    if (airline.hubs.length >= MAX_HUBS) return fail(`You can run at most ${MAX_HUBS} hubs.`);
    if (airline.cash < ap.hubCost) return fail(`Opening a hub at ${ap.code} costs ${fmtMoney(ap.hubCost)}.`);
    spend(state, airline, ap.hubCost, `New hub ${ap.code}`);
    airline.hubs.push(ap.code);
    addLog(state, out, {
      text: airline.controller === 'human' ? `Opened a new hub in ${ap.city} (${ap.code}).` : `${airline.name} opens a hub at ${ap.code}.`,
      icon: '🏢', kind: 'upgrade', airlineId: airline.id, important: airline.controller === 'human',
    });
    return { ok: true };
  },

  SET_SETTING(state, airline, cmd) {
    const { key, value } = cmd;
    if (key === 'serviceLevel' && SERVICE_LEVELS[value]) airline.settings.serviceLevel = value;
    else if (key === 'maintenance' && MAINTENANCE_POLICIES[value]) airline.settings.maintenance = value;
    else if (key === 'overbooking' && OVERBOOKING_OPTIONS.includes(Number(value))) airline.settings.overbooking = Number(value);
    else return fail('Invalid setting.');
    return { ok: true };
  },

  BUY_LOYALTY(state, airline, cmd, out) {
    if (airline.upgrades.loyalty) return fail('You already run a loyalty program.');
    if (airline.cash < LOYALTY.setupCost) return fail(`Launching a loyalty program costs ${fmtMoney(LOYALTY.setupCost)}.`);
    spend(state, airline, LOYALTY.setupCost, 'Loyalty program launch');
    airline.upgrades.loyalty = true;
    addLog(state, out, {
      text: airline.controller === 'human' ? 'Launched the Kittle Club loyalty program. Frequent flyers rejoice!' : `${airline.name} launches a loyalty program.`,
      icon: '💳', kind: 'upgrade', airlineId: airline.id, important: airline.controller === 'human',
    });
    return { ok: true };
  },

  START_CAMPAIGN(state, airline, cmd, out) {
    const c = CAMPAIGNS[cmd.campaign];
    if (!c) return fail('Unknown campaign.');
    if (airline.campaign && state.now < airline.campaign.untilT) return fail('A campaign is already running.');
    if (airline.cash < c.cost) return fail(`That campaign costs ${fmtMoney(c.cost)}.`);
    spend(state, airline, c.cost, c.label);
    airline.campaign = { id: c.id, demandMult: c.demandMult, untilT: state.now + c.weeks * MIN_PER_WEEK };
    addLog(state, out, { text: `${c.label} launched: demand +${Math.round((c.demandMult - 1) * 100)}% for ${c.weeks} weeks.`, icon: '📺', kind: 'upgrade', airlineId: airline.id });
    return { ok: true };
  },

  RESOLVE_DECISION(state, airline, cmd, out) {
    const decision = state.decisions.find((d) => d.id === cmd.decisionId && d.airlineId === airline.id);
    if (!decision) return fail('That decision is no longer open.');
    if (!decision.options.some((o) => o.id === cmd.optionId)) return fail('Invalid option.');
    resolveDecision(state, decision, cmd.optionId, out);
    return { ok: true };
  },

  CONTINUE_DYNASTY(state) {
    if (state.outcome?.result !== 'won') return fail('You have not won yet.');
    state.dynasty = true;
    return { ok: true };
  },
};

export const COMMAND_TYPES = Object.keys(handlers);

export function applyCommand(state, cmd, out = []) {
  if (!cmd || typeof cmd !== 'object' || !handlers[cmd.type]) return fail('Unknown command.');
  const airline = state.airlines[cmd.airlineId];
  if (!airline) return fail('Unknown airline.');
  if (state.outcome?.result === 'lost' && airline.controller === 'human') return fail('Your airline has gone bankrupt.');
  try {
    return handlers[cmd.type](state, airline, cmd, out);
  } catch (err) {
    return fail(`Command failed: ${err.message}`);
  }
}

// Exposed for the route planner UI.
export function routeRangeOk(typeId, a, b) {
  return canFly(typeId, getPair(a, b).distance);
}
