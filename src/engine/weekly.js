// The weekly "turn": settle fixed costs, update reputation, rank every route,
// check win/lose, let the AI rivals move, roll next week's events.

import { AIRPORT_BY_CODE } from '../data/airports.js';
import { weeklyLease } from '../data/aircraft.js';
import { FUEL_MAX, FUEL_MEAN, FUEL_MIN, HISTORY_LIMIT } from './constants.js';
import { weeklyFixedCosts } from './economics.js';
import { computeMarket } from './market.js';
import { schedule } from './eventQueue.js';
import { rollWeeklyEvents } from './events.js';
import { marketFuelPrice } from './modifiers.js';
import { checkWeeklyObjectives, topAirline } from './objectives.js';
import { weeklyReputationDrift } from './reputation.js';
import { noise } from './rng.js';
import { runAi } from './ai.js';
import { emptyLedger } from './state.js';
import { MIN_PER_WEEK, weekIndex } from './time.js';

function computeStandings(state) {
  const byPair = {};
  for (const airlineId in state.ledger) {
    const pairPax = state.ledger[airlineId].pairPax;
    for (const key in pairPax) {
      (byPair[key] ||= []).push({ airlineId, pax: Math.round(pairPax[key]) });
    }
  }
  const standings = {};
  for (const key in byPair) {
    const list = byPair[key].sort((x, y) => y.pax - x.pax || (x.airlineId < y.airlineId ? -1 : 1));
    // Travelers who chose connections / unmodeled carriers this week (priced at the reference fare).
    const market = computeMarket(state, key);
    const others = Math.round(market.potential * market.outsideShare * (1 - market.refFare / market.maxFare));
    const total = list.reduce((s, x) => s + x.pax, 0) + others;
    standings[key] = { list, others, total };
  }
  return standings;
}

function summarize(state, airline, ledger, fixed, repChange, week) {
  const variable = Object.values(ledger.costs).reduce((s, v) => s + v, 0);
  const routes = [];
  for (const id in state.routes) {
    const route = state.routes[id];
    if (route.airlineId !== airline.id) continue;
    const rl = ledger.routes[id] || { pax: 0, legs: 0, seats: 0, revenue: 0, cost: 0, delays: 0, cancellations: 0 };
    let leaseAlloc = 0;
    for (const pid in state.planes) {
      const p = state.planes[pid];
      if (p.routeId === id && p.ownership === 'leased') leaseAlloc += weeklyLease(p.type);
    }
    const standing = state.standings[route.pair] || { list: [], others: 0, total: 0 };
    const mine = standing.list.find((x) => x.airlineId === airline.id);
    routes.push({
      routeId: id, pair: route.pair, a: route.a, b: route.b, fare: route.fare,
      pax: rl.pax, legs: rl.legs, seats: rl.seats,
      loadFactor: rl.seats ? rl.pax / rl.seats : 0,
      revenue: rl.revenue, cost: rl.cost, contribution: rl.revenue - rl.cost,
      profit: rl.revenue - rl.cost - leaseAlloc,
      delays: rl.delays, cancellations: rl.cancellations,
      share: standing.total && mine ? mine.pax / standing.total : 0,
      rank: mine ? standing.list.indexOf(mine) + 1 : 0,
      top: topAirline(standing) === airline.id,
    });
  }
  const operatingProfit = ledger.revenue - variable - fixed.total;
  const flights = ledger.onTime + ledger.delays;
  return {
    week,
    endT: state.now,
    cash: airline.cash,
    reputation: airline.reputation,
    repChange,
    revenue: ledger.revenue,
    costs: { ...ledger.costs, ...fixed },
    variableCosts: variable,
    fixedCosts: fixed.total,
    operatingProfit,
    oneOff: ledger.oneOff,
    pax: ledger.pax,
    legs: ledger.legs,
    ferryLegs: ledger.ferryLegs,
    seats: ledger.seats,
    loadFactor: ledger.seats ? ledger.pax / ledger.seats : 0,
    onTimeRate: flights ? ledger.onTime / flights : 1,
    delays: ledger.delays,
    cancellations: ledger.cancellations,
    bumped: ledger.bumped,
    routes,
    topRoutes: routes.filter((r) => r.top).length,
    fuelPrice: marketFuelPrice(state),
    fleet: Object.values(state.planes).filter((p) => p.airlineId === airline.id).length,
  };
}

function walkFuel(state) {
  const f = state.fuelPrice;
  const next = f + 0.12 * (FUEL_MEAN - f) + noise(state, 0.05 * f);
  state.fuelPrice = Math.round(Math.max(FUEL_MIN, Math.min(FUEL_MAX, next)) * 100) / 100;
}

export function handleWeekEnd(state, item, out) {
  const week = weekIndex(item.t - 1);
  state.standings = computeStandings(state);

  let humanReport = null;
  for (const airline of Object.values(state.airlines)) {
    const ledger = state.ledger[airline.id] || emptyLedger();
    const fixed = weeklyFixedCosts(state, airline);
    airline.cash -= fixed.total;
    ledger.fixed = { leases: fixed.leases, overhead: fixed.overhead, hubs: fixed.hubs, loyalty: fixed.loyalty };
    const repChange = weeklyReputationDrift(state, airline);
    const report = summarize(state, airline, ledger, fixed, repChange, week);
    airline.lastWeek = report;
    if (airline.id === state.humanAirlineId) {
      humanReport = report;
      report.events = state.activeEvents
        .filter((e) => e.startT < item.t && e.endT > item.t - MIN_PER_WEEK && e.type !== 'storm')
        .map((e) => ({ icon: e.icon, title: e.title }));
      report.storms = state.activeEvents.filter((e) => e.type === 'storm' && e.startT < item.t).map((e) => AIRPORT_BY_CODE[e.target].code);
      state.history.push(report);
      if (state.history.length > HISTORY_LIMIT) state.history.shift();
    }
  }

  checkWeeklyObjectives(state, out);
  runAi(state, out, week);
  walkFuel(state);

  for (const id of Object.keys(state.airlines)) state.ledger[id] = emptyLedger();
  rollWeeklyEvents(state, out);
  schedule(state, item.t + MIN_PER_WEEK, 'WEEK_END');
  if (humanReport) out.push({ type: 'weekReport', week, report: humanReport });
}
