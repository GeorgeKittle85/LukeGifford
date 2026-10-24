// Static network data derived from the airport list: every city pair with its
// distance, gravity-model demand and fare ceiling. Nothing here is stored in
// saves; it is recomputed from data on load.

import { AIRPORTS, AIRPORT_BY_CODE } from '../data/airports.js';
import { AIRCRAFT } from '../data/aircraft.js';
import { distanceMiles } from './geo.js';
import { DEMAND_SCALE } from './constants.js';
import { nextAllowedDeparture } from './time.js';

export function pairKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function marketMass(ap) {
  return ap.pop * (0.55 * ap.business + 0.45 * ap.tourism);
}

function distanceFactor(miles) {
  const short = miles < 500 ? 0.55 + 0.45 * (miles / 500) : 1; // people drive short trips
  const long = miles > 1200 ? (1200 / miles) ** 0.3 : 1;
  return short * long;
}

function buildPairs() {
  const pairs = {};
  for (let i = 0; i < AIRPORTS.length; i++) {
    for (let j = i + 1; j < AIRPORTS.length; j++) {
      const A = AIRPORTS[i], B = AIRPORTS[j];
      const key = pairKey(A.code, B.code);
      const [a, b] = key.split('-');
      const distance = distanceMiles(A, B);
      const intlCount = (A.country !== 'US') + (B.country !== 'US');
      const intlFactor = intlCount === 0 ? 1 : intlCount === 1 ? 0.75 : 0.6;
      const baseDemand = Math.round(DEMAND_SCALE * Math.sqrt(marketMass(A) * marketMass(B)) * distanceFactor(distance) * intlFactor);
      // Fare ceiling tapers with distance: long-haul yields less per mile.
      const fare = 120 + 0.26 * Math.min(distance, 1500)
        + 0.22 * Math.max(0, Math.min(distance, 4000) - 1500)
        + 0.18 * Math.max(0, distance - 4000);
      pairs[key] = {
        key, a, b,
        distance: Math.round(distance),
        baseDemand,
        maxFare: Math.round(fare),
        international: intlCount > 0,
      };
    }
  }
  // Demand levels by quartile so the UI can say Low / Medium / High / Very high.
  const sorted = Object.values(pairs).map((p) => p.baseDemand).sort((x, y) => x - y);
  const q = (f) => sorted[Math.floor(f * (sorted.length - 1))];
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  for (const p of Object.values(pairs)) {
    p.demandLevel = p.baseDemand >= q3 ? 3 : p.baseDemand >= q2 ? 2 : p.baseDemand >= q1 ? 1 : 0;
  }
  return pairs;
}

export const PAIRS = buildPairs();
export const DEMAND_LEVEL_LABELS = ['Low', 'Medium', 'High', 'Very high'];

export function getPair(a, b) {
  return PAIRS[pairKey(a, b)];
}

export function airport(code) {
  return AIRPORT_BY_CODE[code];
}

// Block time (gate to gate) in minutes for an aircraft type over a distance.
export function blockMinutes(typeId, miles) {
  const type = AIRCRAFT[typeId];
  return Math.round(35 + ((miles * 1.05) / type.cruiseMph) * 60);
}

export function canFly(typeId, miles) {
  return AIRCRAFT[typeId].rangeMi >= miles;
}

// Estimated one-way legs per week a single plane flies shuttling a<->b under
// the 06:00 departure curfew. Simulated once per (type, pair) and cached.
const legsCache = new Map();
const REFERENCE_EPOCH = Date.UTC(2026, 0, 5); // a Monday in standard time

export function legsPerWeekEstimate(typeId, a, b) {
  const cacheKey = `${typeId}|${pairKey(a, b)}`;
  const cached = legsCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const pair = getPair(a, b);
  const block = blockMinutes(typeId, pair.distance);
  const turn = AIRCRAFT[typeId].turnMin;
  const fakeState = { epochMs: REFERENCE_EPOCH };
  const week = 7 * 24 * 60;
  // Run two weeks and count the second so the start position doesn't bias it.
  let t = 0, at = a, legs = 0;
  while (t < 2 * week) {
    const dep = nextAllowedDeparture(fakeState, AIRPORT_BY_CODE[at], t);
    if (dep >= 2 * week) break;
    if (dep >= week) legs++;
    t = dep + block + turn;
    at = at === a ? b : a;
  }
  const result = Math.max(1, legs);
  legsCache.set(cacheKey, result);
  return result;
}
