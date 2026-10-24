import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORT_BY_CODE } from '../src/data/airports.js';
import { bearing, distanceMiles, greatCirclePath, interpolate } from '../src/engine/geo.js';
import {
  activeHoliday, computeEpoch, isDst, localMinuteOfDay, nextAllowedDeparture, seasonFactor, utcOffsetHours,
} from '../src/engine/time.js';

const SFO = AIRPORT_BY_CODE.SFO;
const JFK = AIRPORT_BY_CODE.JFK;
const NRT = AIRPORT_BY_CODE.NRT;
const LHR = AIRPORT_BY_CODE.LHR;

test('great-circle distances match published figures', () => {
  assert.ok(Math.abs(distanceMiles(SFO, JFK) - 2586) < 20, 'SFO-JFK ~2,586 mi');
  assert.ok(Math.abs(distanceMiles(JFK, LHR) - 3451) < 25, 'JFK-LHR ~3,451 mi');
  assert.ok(Math.abs(distanceMiles(SFO, NRT) - 5130) < 40, 'SFO-NRT ~5,130 mi');
});

test('interpolation endpoints and bearings are sane', () => {
  const start = interpolate(SFO, JFK, 0);
  const end = interpolate(SFO, JFK, 1);
  assert.ok(Math.abs(start.lat - SFO.lat) < 1e-6 && Math.abs(end.lon - JFK.lon) < 1e-6);
  const b = bearing(SFO, JFK);
  assert.ok(b > 45 && b < 90, `SFO->JFK heads east-northeast (got ${b})`);
});

test('trans-Pacific path has continuous longitudes across the antimeridian', () => {
  const path = greatCirclePath(SFO, NRT, 64);
  for (let i = 1; i < path.length; i++) {
    assert.ok(Math.abs(path[i].lon - path[i - 1].lon) < 30, 'no 360-degree jumps');
  }
  assert.ok(path[path.length - 1].lon < -180, 'Tokyo is reached by going west past -180');
});

test('US and UK daylight saving rules (2026)', () => {
  // US DST 2026: March 8 -> November 1. UK: March 29 -> October 25.
  assert.equal(isDst('US', -8, Date.UTC(2026, 2, 7, 12)), false);
  assert.equal(isDst('US', -8, Date.UTC(2026, 2, 9, 12)), true);
  assert.equal(isDst('US', -8, Date.UTC(2026, 9, 31, 12)), true);
  assert.equal(isDst('US', -8, Date.UTC(2026, 10, 2, 12)), false);
  assert.equal(isDst('UK', 0, Date.UTC(2026, 2, 28, 12)), false);
  assert.equal(isDst('UK', 0, Date.UTC(2026, 6, 1, 12)), true);
  assert.equal(isDst('none', 9, Date.UTC(2026, 6, 1, 12)), false);
  assert.equal(utcOffsetHours(SFO, Date.UTC(2026, 6, 1)), -7);
  assert.equal(utcOffsetHours(NRT, Date.UTC(2026, 6, 1)), 9);
});

test('epoch is Monday midnight at the hub', () => {
  const epoch = computeEpoch('2026-10-28', SFO); // a Wednesday
  // Next Monday is Nov 2, 2026 (after DST ends): 00:00 PST = 08:00 UTC
  assert.equal(epoch, Date.UTC(2026, 10, 2, 8));
  assert.equal(localMinuteOfDay(SFO, epoch), 0);
});

test('departure curfew holds flights until 06:00 local', () => {
  const state = { epochMs: computeEpoch('2026-11-02', SFO) };
  // t = 120 is 02:00 local at SFO -> wait until 06:00 (t = 360)
  assert.equal(nextAllowedDeparture(state, SFO, 120), 360);
  // 10:00 local departs immediately
  assert.equal(nextAllowedDeparture(state, SFO, 600), 600);
  // JFK is 3 hours ahead: 03:00 at SFO is 06:00 at JFK
  assert.equal(nextAllowedDeparture(state, JFK, 180), 180);
});

test('holidays and seasons', () => {
  const thanksgiving2026 = Date.UTC(2026, 10, 26, 12); // Thursday Nov 26
  assert.equal(activeHoliday(thanksgiving2026)?.id, 'thanksgiving');
  assert.ok(seasonFactor(thanksgiving2026) > seasonFactor(Date.UTC(2026, 10, 10)));
  assert.ok(seasonFactor(Date.UTC(2027, 6, 15)) > seasonFactor(Date.UTC(2027, 1, 15)), 'July beats February');
});
