import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch, HUMAN_ID } from '../src/engine/index.js';
import { AIRCRAFT, leaseDeposit } from '../src/data/aircraft.js';
import { WIN_CASH } from '../src/engine/constants.js';
import { computeMarket, repDemandFactor } from '../src/engine/market.js';
import { PAIRS, legsPerWeekEstimate, pairKey } from '../src/engine/network.js';
import * as sel from '../src/engine/selectors.js';
import { localMinuteOfDay, MIN_PER_WEEK, utcMs } from '../src/engine/time.js';
import { airport } from '../src/engine/network.js';

const newGame = (opts = {}) => createGame({ seed: 'test-seed', startDate: '2026-10-26', hub: 'SFO', ...opts });
const cmd = (state, c) => dispatch(state, { airlineId: HUMAN_ID, ...c }).result;

function starterOnRoute(state, a = 'SFO', b = 'DFW') {
  const plane = sel.planesOf(state, HUMAN_ID)[0];
  const { routeId } = cmd(state, { type: 'OPEN_ROUTE', a, b });
  cmd(state, { type: 'ASSIGN_PLANE', planeId: plane.id, routeId });
  return { plane, routeId };
}

test('new game matches the pitch: one plane, one hub, $1M', () => {
  const s = newGame();
  const me = s.airlines[HUMAN_ID];
  assert.equal(me.cash, 1_000_000);
  assert.deepEqual(me.hubs, ['SFO']);
  assert.equal(sel.planesOf(s, HUMAN_ID).length, 1);
  assert.equal(Object.keys(PAIRS).length, 45, '10 airports -> 45 city pairs');
  assert.ok(Object.values(s.airlines).filter((a) => a.controller === 'ai').length >= 3, 'has AI rivals');
});

test('state is plain JSON (round-trips losslessly)', () => {
  const s = newGame();
  advance(s, s.now + 3 * 24 * 60);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('demand curve: higher fares mean fewer passengers', () => {
  const s = newGame();
  const low = sel.estimateRoute(s, HUMAN_ID, 'SFO', 'ATL', 250, ['B38M']);
  const high = sel.estimateRoute(s, HUMAN_ID, 'SFO', 'ATL', 450, ['B38M']);
  assert.ok(high.booked < low.booked);
  const none = sel.estimateRoute(s, HUMAN_ID, 'SFO', 'ATL', high.maxFare, ['B38M']);
  assert.equal(Math.round(none.booked), 0, 'nobody flies at the max fare');
});

test('monopoly demand follows baseDemand x (1 - fare/maxFare)', () => {
  const s = newGame();
  const key = pairKey('SFO', 'ATL'); // no rival flies this pair at the start
  const m1 = computeMarket(s, key, { hypothetical: { airlineId: HUMAN_ID, fare: 200, planeTypes: ['B789', 'B789', 'B789'] } });
  const m2 = computeMarket(s, key, { hypothetical: { airlineId: HUMAN_ID, fare: 300, planeTypes: ['B789', 'B789', 'B789'] } });
  const o1 = m1.offers.find((o) => o.hypothetical);
  const o2 = m2.offers.find((o) => o.hypothetical);
  // Removing the share effect, demand / share is linear in fare.
  const k1 = o1.demand / o1.share / (1 - 200 / m1.maxFare);
  const k2 = o2.demand / o2.share / (1 - 300 / m2.maxFare);
  assert.ok(Math.abs(k1 - k2) / k1 < 1e-9);
  assert.ok(repDemandFactor(20) < repDemandFactor(60) && repDemandFactor(60) < repDemandFactor(90), 'low reputation lowers demand');
});

test('bigger jets carry more seats per week than small ones', () => {
  const small = legsPerWeekEstimate('E175', 'SFO', 'DFW') * AIRCRAFT.E175.seats;
  const big = legsPerWeekEstimate('B38M', 'SFO', 'DFW') * AIRCRAFT.B38M.seats;
  assert.ok(big > small * 1.8);
});

test('commands are validated', () => {
  const s = newGame();
  assert.equal(cmd(s, { type: 'OPEN_ROUTE', a: 'JFK', b: 'ORD' }).ok, false, 'routes must touch a hub');
  const { routeId } = cmd(s, { type: 'OPEN_ROUTE', a: 'SFO', b: 'NRT' });
  assert.ok(routeId);
  assert.equal(cmd(s, { type: 'OPEN_ROUTE', a: 'NRT', b: 'SFO' }).ok, false, 'no duplicate routes');
  const plane = sel.planesOf(s, HUMAN_ID)[0];
  assert.equal(cmd(s, { type: 'ASSIGN_PLANE', planeId: plane.id, routeId }).ok, false, 'E175 cannot reach Tokyo');
  assert.equal(cmd(s, { type: 'LEASE_PLANE', aircraftType: 'B789', location: 'SFO' }).ok, false, '787 deposit exceeds $1M');
  assert.equal(cmd(s, { type: 'OPEN_HUB', airport: 'ATL' }).ok, false, 'hub too expensive');
  assert.equal(dispatch(s, { type: 'SET_FARE', airlineId: 'GG', routeId, fare: 1 }).result.ok, false, 'cannot touch another airline\'s route');
  assert.equal(cmd(s, { type: 'NOT_A_COMMAND' }).ok, false);
});

test('leasing charges the deposit and delivers in 2 days', () => {
  const s = newGame();
  const res = cmd(s, { type: 'LEASE_PLANE', aircraftType: 'E175', location: 'SFO' });
  assert.ok(res.ok);
  assert.equal(s.airlines[HUMAN_ID].cash, 1_000_000 - leaseDeposit('E175'));
  assert.equal(s.planes[res.planeId].status, 'delivering');
  advance(s, s.now + 2 * 24 * 60 + 1);
  assert.equal(s.planes[res.planeId].status, 'idle');
});

test('an assigned plane flies, earns revenue, and respects the curfew', () => {
  const s = newGame();
  const { plane, routeId } = starterOnRoute(s);
  const departures = [];
  let t = s.now;
  const end = s.now + 3 * 24 * 60;
  while (t < end) {
    t += 10;
    advance(s, t);
    for (const f of Object.values(s.flights)) {
      if (f.airlineId === HUMAN_ID && !departures.some((d) => d.id === f.id)) departures.push(f);
    }
  }
  assert.ok(departures.length >= 10, `flew ${departures.length} legs in 3 days`);
  for (const f of departures) {
    assert.equal(f.routeId, routeId);
    const local = localMinuteOfDay(airport(f.from), utcMs(s, f.depT));
    assert.ok(local >= 6 * 60, `departed ${f.from} at local minute ${local}`);
  }
  assert.ok(s.ledger[HUMAN_ID].revenue > 0);
  assert.ok(plane.stats.legs > 0);
});

test('weekly settlement produces a report and charges fixed costs', () => {
  const s = newGame();
  starterOnRoute(s);
  const notes = advance(s, MIN_PER_WEEK + 1);
  const report = notes.find((n) => n.type === 'weekReport');
  assert.ok(report, 'week report emitted');
  assert.equal(s.history.length, 1);
  assert.ok(report.report.costs.leases > 0 && report.report.costs.overhead > 0);
  assert.ok(report.report.pax > 0);
});

test('same seed + same commands = identical game (deterministic)', () => {
  const play = () => {
    const s = newGame({ seed: 'determinism' });
    starterOnRoute(s, 'SFO', 'ORD');
    advance(s, MIN_PER_WEEK);
    cmd(s, { type: 'LEASE_PLANE', aircraftType: 'E175', location: 'SFO' });
    advance(s, 3 * MIN_PER_WEEK + 1);
    return JSON.stringify(s);
  };
  assert.equal(play(), play());
});

test('a saved game continues exactly like the original', () => {
  const a = newGame({ seed: 'save-load' });
  starterOnRoute(a);
  advance(a, MIN_PER_WEEK + 500);
  const b = JSON.parse(JSON.stringify(a));
  advance(a, 3 * MIN_PER_WEEK);
  advance(b, 3 * MIN_PER_WEEK);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('reaching $10M cash wins', () => {
  const s = newGame();
  starterOnRoute(s);
  s.airlines[HUMAN_ID].cash = WIN_CASH - 1;
  let won = null;
  for (let i = 0; i < 200 && !won; i++) {
    const notes = advance(s, s.now + 60);
    won = notes.find((n) => n.type === 'outcome');
  }
  assert.equal(s.outcome?.result, 'won');
  assert.equal(s.outcome.reason, 'cash');
});

test('negative cash at two settlements in a row is bankruptcy', () => {
  const s = newGame();
  s.airlines[HUMAN_ID].cash = -5_000_000;
  advance(s, MIN_PER_WEEK + 1);
  assert.equal(s.airlines[HUMAN_ID].warning, true);
  assert.equal(s.outcome, null);
  advance(s, 2 * MIN_PER_WEEK + 1);
  assert.equal(s.outcome?.result, 'lost');
  assert.equal(cmd(s, { type: 'SET_SETTING', key: 'serviceLevel', value: 'premium' }).ok, false, 'no commands after bankruptcy');
});

test('returning a leased plane refunds the deposit minus a fee', () => {
  const s = newGame();
  const plane = sel.planesOf(s, HUMAN_ID)[0];
  const before = s.airlines[HUMAN_ID].cash;
  assert.ok(cmd(s, { type: 'DISPOSE_PLANE', planeId: plane.id }).ok);
  assert.equal(s.planes[plane.id], undefined);
  assert.equal(s.airlines[HUMAN_ID].cash, before + leaseDeposit('E175') - AIRCRAFT.E175.leaseMonthly);
});

test('AI rivals keep operating for a season without crashing the sim', () => {
  const s = newGame({ seed: 'ai-season' });
  starterOnRoute(s);
  for (let w = 1; w <= 12 && !s.outcome; w++) advance(s, w * MIN_PER_WEEK + 1);
  const rivals = sel.rivalSummaries(s);
  assert.ok(rivals.some((r) => r.fleet > 0), 'rivals still fly');
  assert.ok(s.queue.length < 500, 'event queue stays bounded');
});
