#!/usr/bin/env node
// Headless balance harness: plays Kittle Skies with scripted strategies and
// reports how fast each one wins (or goes bankrupt). Used to tune
// src/engine/constants.js. Usage:
//   node scripts/balance-sim.mjs [weeks=104] [seeds=4] [hub=SFO] [difficulty=pro]

import { advance, createGame, dispatch } from '../src/engine/index.js';
import { AIRCRAFT, leaseDeposit, weeklyLease } from '../src/data/aircraft.js';
import { AIRPORT_BY_CODE } from '../src/data/airports.js';
import { HUMAN_ID } from '../src/engine/state.js';
import { PAIRS, canFly } from '../src/engine/network.js';
import * as sel from '../src/engine/selectors.js';
import { MIN_PER_WEEK } from '../src/engine/time.js';
import { LOYALTY, WIN_CASH } from '../src/engine/constants.js';

const [weeksArg = '104', seedsArg = '4', hubArg = 'SFO', diffArg = 'pro'] = process.argv.slice(2);
const WEEKS = Number(weeksArg);
const SEEDS = Number(seedsArg);

const cmd = (state, c) => dispatch(state, { airlineId: HUMAN_ID, ...c }).result;
let lossWeeks = {};

function myRoutes(state) {
  return sel.routesOf(state, HUMAN_ID);
}

function routeTypesIncludingDelivering(state, routeId) {
  return Object.values(state.planes).filter((p) => p.routeId === routeId && !p.pendingDisposal).map((p) => p.type);
}

function bestFare(state, route) {
  const types = routeTypesIncludingDelivering(state, route.id);
  return sel.suggestFare(state, HUMAN_ID, route.a, route.b, types);
}

function candidatePairs(state) {
  const me = state.airlines[HUMAN_ID];
  return Object.values(PAIRS).filter((p) => me.hubs.includes(p.a) || me.hubs.includes(p.b));
}

// Marginal weekly profit of adding one plane of `type` to a pair.
function marginalValue(state, pair, type) {
  const me = state.airlines[HUMAN_ID];
  const a = me.hubs.includes(pair.a) ? pair.a : pair.b;
  const b = a === pair.a ? pair.b : pair.a;
  const route = myRoutes(state).find((r) => r.pair === pair.key);
  const current = route ? routeTypesIncludingDelivering(state, route.id) : [];
  const before = current.length ? sel.estimateRoute(state, HUMAN_ID, a, b, sel.suggestFare(state, HUMAN_ID, a, b, current), current).contribution : 0;
  const withNew = [...current, type];
  const fare = sel.suggestFare(state, HUMAN_ID, a, b, withNew);
  const after = sel.estimateRoute(state, HUMAN_ID, a, b, fare, withNew).contribution;
  return { a, b, route, gain: after - before - weeklyLease(type), fare };
}

const strategies = {
  // Starter jet on the best route, fares tuned weekly, nothing else.
  passive(state, week) {
    if (week === 0) {
      const plane = sel.planesOf(state, HUMAN_ID)[0];
      let best = null;
      for (const pair of candidatePairs(state)) {
        if (!canFly(plane.type, pair.distance)) continue;
        const v = marginalValue(state, pair, plane.type);
        if (!best || v.gain > best.gain) best = { ...v, pair };
      }
      const res = cmd(state, { type: 'OPEN_ROUTE', a: best.a, b: best.b, fare: best.fare });
      cmd(state, { type: 'ASSIGN_PLANE', planeId: plane.id, routeId: res.routeId });
    }
    for (const r of myRoutes(state)) cmd(state, { type: 'SET_FARE', routeId: r.id, fare: bestFare(state, r) });
  },

  // A sensible tycoon: grows when an investment pays back fast, keeps a cash
  // cushion, opens a second hub and a loyalty program when rich enough, and
  // stops investing once the $10M finish line is in sight.
  sensible(state, week) {
    strategies.passive(state, week);
    const me = state.airlines[HUMAN_ID];
    const last = me.lastWeek;
    const fixed = sel.weeklyBurn(state, HUMAN_ID).total;
    const reserve = Math.max(300_000, fixed * 3);
    const weeklyProfit = last ? last.operatingProfit : 0;
    if (me.cash + weeklyProfit * 6 >= WIN_CASH) return; // coast to the finish

    // Idle planes go to their best route.
    for (const plane of sel.planesOf(state, HUMAN_ID)) {
      if (plane.routeId || plane.status === 'delivering') continue;
      let best = null;
      for (const pair of candidatePairs(state)) {
        if (!canFly(plane.type, pair.distance)) continue;
        const v = marginalValue(state, pair, plane.type);
        if (!best || v.gain > best.gain) best = { ...v, pair };
      }
      if (best && best.gain > 0) {
        const routeId = best.route ? best.route.id : cmd(state, { type: 'OPEN_ROUTE', a: best.a, b: best.b, fare: best.fare }).routeId;
        cmd(state, { type: 'ASSIGN_PLANE', planeId: plane.id, routeId });
      }
    }

    // Cut planes on routes that keep losing money.
    for (const r of last?.routes || []) {
      const key = r.routeId;
      lossWeeks[key] = r.legs > 0 && r.profit < 0 ? (lossWeeks[key] || 0) + 1 : 0;
      if (lossWeeks[key] >= 3) {
        const victim = sel.planesOnRoute(state, key).sort((x, y) => weeklyLease(y.type) - weeklyLease(x.type))[0];
        if (victim) cmd(state, { type: 'DISPOSE_PLANE', planeId: victim.id });
        lossWeeks[key] = 0;
      }
    }

    // Lease at most one plane a week: the best payback.
    let best = null;
    for (const pair of candidatePairs(state)) {
      for (const type of Object.keys(AIRCRAFT)) {
        if (!canFly(type, pair.distance)) continue;
        const deposit = leaseDeposit(type);
        if (me.cash - deposit < reserve) continue;
        const v = marginalValue(state, pair, type);
        const payback = deposit / Math.max(1, v.gain);
        if (v.gain > 15_000 && payback < 10 && (!best || payback < best.payback)) best = { ...v, pair, type, payback };
      }
    }
    if (best) {
      const routeId = best.route ? best.route.id : cmd(state, { type: 'OPEN_ROUTE', a: best.a, b: best.b, fare: best.fare }).routeId;
      cmd(state, { type: 'LEASE_PLANE', aircraftType: best.type, location: best.a, routeId });
    }

    if (!me.upgrades.loyalty && sel.planesOf(state, HUMAN_ID).length >= 6 && me.cash > LOYALTY.setupCost + reserve * 2) {
      cmd(state, { type: 'BUY_LOYALTY' });
    }
    if (me.hubs.length === 1 && me.cash > 3_000_000 + reserve * 2) {
      // Open the hub with the most promising unserved pairs.
      let bestHub = null;
      for (const code of Object.keys(AIRPORT_BY_CODE)) {
        if (me.hubs.includes(code) || me.cash < AIRPORT_BY_CODE[code].hubCost + reserve * 2) continue;
        let score = 0;
        for (const pair of Object.values(PAIRS)) {
          if (pair.a !== code && pair.b !== code) continue;
          const other = pair.a === code ? pair.b : pair.a;
          if (me.hubs.includes(other)) continue;
          const est = sel.estimateRoute(state, HUMAN_ID, code, other, sel.suggestFare(state, HUMAN_ID, code, other, ['A220']), ['A220']);
          score += Math.max(0, est.profit);
        }
        if (!bestHub || score > bestHub.score) bestHub = { code, score };
      }
      if (bestHub && bestHub.score > 400_000) cmd(state, { type: 'OPEN_HUB', airport: bestHub.code });
    }
  },

  // Leases everything it can afford, dumps fares, never keeps a cushion.
  reckless(state, week) {
    const me = state.airlines[HUMAN_ID];
    const pairs = candidatePairs(state);
    for (;;) {
      const pair = pairs[(week * 7 + Object.keys(state.planes).length) % pairs.length];
      const type = canFly('B38M', pair.distance) ? 'B38M' : 'B789';
      if (me.cash < leaseDeposit(type)) break;
      const a = me.hubs.includes(pair.a) ? pair.a : pair.b;
      const b = a === pair.a ? pair.b : pair.a;
      let route = myRoutes(state).find((r) => r.pair === pair.key);
      if (!route) route = state.routes[cmd(state, { type: 'OPEN_ROUTE', a, b }).routeId];
      cmd(state, { type: 'LEASE_PLANE', aircraftType: type, location: a, routeId: route.id });
    }
    for (const plane of sel.planesOf(state, HUMAN_ID)) {
      if (!plane.routeId && myRoutes(state)[0]) cmd(state, { type: 'ASSIGN_PLANE', planeId: plane.id, routeId: myRoutes(state)[0].id });
    }
    for (const r of myRoutes(state)) {
      cmd(state, { type: 'SET_FARE', routeId: r.id, fare: PAIRS[r.pair].maxFare * 0.3 });
    }
  },
};

function run(strategyName, seed) {
  lossWeeks = {};
  const state = createGame({ seed, hub: hubArg, difficulty: diffArg, startDate: '2026-10-26' });
  const strat = strategies[strategyName];
  const trace = [];
  let wonWeek = null;
  let minCash = Infinity;
  for (let week = 0; week < WEEKS; week++) {
    // Decisions get resolved with the default option by the engine itself.
    strat(state, week);
    const target = (week + 1) * MIN_PER_WEEK + 1;
    while (state.now < target) {
      const notes = advance(state, target);
      const outcome = notes.find((n) => n.type === 'outcome');
      if (outcome && state.outcome.result === 'won' && wonWeek === null) {
        wonWeek = `${week + 1}(${state.outcome.reason})`;
        dispatch(state, { type: 'CONTINUE_DYNASTY', airlineId: HUMAN_ID });
      }
      if (state.outcome?.result === 'lost') break;
    }
    const me = state.airlines[HUMAN_ID];
    minCash = Math.min(minCash, me.cash);
    trace.push({ week: week + 1, cash: me.cash, profit: me.lastWeek?.operatingProfit ?? 0, fleet: sel.planesOf(state, HUMAN_ID).length, rep: me.reputation, tops: sel.objectives(state).topRoutes });
    if (state.outcome?.result === 'lost') break;
  }
  return { strategyName, seed, wonWeek, lost: state.outcome?.result === 'lost' ? state.outcome.week : null, minCash, trace, state };
}

const fmt = (n) => `${(n / 1e6).toFixed(2)}M`;

for (const name of process.env.BALANCE_TRACE ? [] : ['passive', 'sensible', 'reckless']) {
  const results = [];
  for (let i = 0; i < SEEDS; i++) results.push(run(name, `balance-${i}`));
  console.log(`\n=== ${name} (${hubArg}, ${diffArg}) ===`);
  for (const r of results) {
    const t = r.trace;
    const at = (w) => t[Math.min(t.length, w) - 1];
    const snap = [4, 12, 26, 52, 78, 104].filter((w) => w <= t.length)
      .map((w) => `w${w}: ${fmt(at(w).cash)} (${at(w).fleet}✈, p/wk ${fmt(at(w).profit)}, top ${at(w).tops}, rep ${at(w).rep.toFixed(0)})`).join(' | ');
    console.log(`${r.seed}: won ${r.wonWeek ?? '-'} lost ${r.lost ?? '-'} minCash ${fmt(r.minCash)}\n   ${snap}`);
  }
}

// BALANCE_TRACE=sensible node scripts/balance-sim.mjs 60 1 SFO  -> week-by-week log
if (process.env.BALANCE_TRACE) {
  const r = run(process.env.BALANCE_TRACE, 'balance-0');
  for (const t of r.trace) console.log(`w${t.week} cash ${fmt(t.cash)} profit ${fmt(t.profit)} fleet ${t.fleet} rep ${t.rep.toFixed(0)} tops ${t.tops}`);
}
