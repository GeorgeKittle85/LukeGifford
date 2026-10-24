// Random events: weekly deck draws, daily weather, and player decisions.

import { AIRPORTS, AIRPORT_BY_CODE, WEATHER_INTENSITY, WEATHER_LABELS } from '../data/airports.js';
import { AIRCRAFT } from '../data/aircraft.js';
import { DECISION_TYPES, EVENT_TYPES } from '../data/eventCatalog.js';
import { DIFFICULTIES } from '../data/rivals.js';
import { schedule } from './eventQueue.js';
import { addLog, fmtMoney } from './log.js';
import { marketFuelPrice } from './modifiers.js';
import { adjustReputation } from './reputation.js';
import { chance, pick, pickWeighted, randInt, randRange } from './rng.js';
import { kickPlane, ledgerFor } from './scheduler.js';
import { newId } from './state.js';
import { MIN_PER_DAY, MIN_PER_HOUR, MIN_PER_WEEK, utcMs, weekIndex } from './time.js';

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

function eventRate(state) {
  return (DIFFICULTIES[state.difficulty] || DIFFICULTIES.pro).eventRate;
}

function pctText(mult) {
  return `${Math.round(Math.abs(mult - 1) * 100)}%`;
}

function addEvent(state, event) {
  const e = { id: newId(state, 'EV'), ...event };
  state.activeEvents.push(e);
  schedule(state, e.startT, 'EVENT_START', { eventId: e.id });
  schedule(state, e.endT, 'EVENT_END', { eventId: e.id });
  return e;
}

function groundPlane(state, plane, untilT) {
  plane.groundedUntil = Math.max(plane.groundedUntil, untilT);
  if (['idle', 'scheduled', 'delayed', 'turnaround'].includes(plane.status)) kickPlane(state, plane, state.now);
}

function humanPlanes(state) {
  return Object.values(state.planes).filter((p) => p.airlineId === state.humanAirlineId && p.status !== 'delivering');
}

// ---------------------------------------------------------------------------
// Weekly deck

function buildDeckEvent(state, typeId, startT) {
  const def = EVENT_TYPES[typeId];
  const days = def.durationDays ? randRange(state, def.durationDays[0], def.durationDays[1]) : 0;
  const endT = Math.round(startT + days * MIN_PER_DAY);
  const human = state.airlines[state.humanAirlineId];

  switch (typeId) {
    case 'fuelSpike':
    case 'fuelDrop': {
      const m = randRange(state, def.fuelMult[0], def.fuelMult[1]);
      return { type: typeId, scope: 'global', startT, endT, icon: def.icon, title: def.title, text: fill(def.text, { pct: pctText(m) }), effects: { fuelMult: m } };
    }
    case 'slowdown': {
      const m = randRange(state, def.demandMult[0], def.demandMult[1]);
      return { type: typeId, scope: 'global', startT, endT, icon: def.icon, title: def.title, text: fill(def.text, { pct: pctText(m) }), effects: { demandMult: m } };
    }
    case 'atc': {
      const m = randRange(state, def.delayMult[0], def.delayMult[1]);
      return { type: typeId, scope: 'global', startT, endT, icon: def.icon, title: def.title, text: def.text, effects: { delayMult: m } };
    }
    case 'travelSurge':
    case 'conference':
    case 'bigGame': {
      const ap = pick(state, AIRPORTS);
      const m = randRange(state, def.demandMult[0], def.demandMult[1]);
      const vars = { city: ap.city, pct: pctText(m) };
      return { type: typeId, scope: 'airport', target: ap.code, startT, endT, icon: def.icon, title: fill(def.title, vars), text: fill(def.text, vars), effects: { demandMult: m } };
    }
    case 'feeHike': {
      const ap = pick(state, AIRPORTS);
      const m = randRange(state, def.feeMult[0], def.feeMult[1]);
      const vars = { city: ap.city, pct: pctText(m) };
      return { type: typeId, scope: 'airport', target: ap.code, startT, endT, icon: def.icon, title: fill(def.title, vars), text: fill(def.text, vars), effects: { feeMult: m } };
    }
    case 'fareWar': {
      // A rival attacks a pair the player flies.
      const humanPairs = new Set(Object.values(state.routes).filter((r) => r.airlineId === human.id).map((r) => r.pair));
      const targets = Object.values(state.routes).filter((r) => r.airlineId !== human.id && humanPairs.has(r.pair));
      if (!targets.length) return null;
      const route = pick(state, targets);
      const rival = state.airlines[route.airlineId];
      const cut = randRange(state, def.fareCut[0], def.fareCut[1]);
      const vars = { rival: rival.name, route: `${route.a}–${route.b}`, pct: pctText(cut) };
      return { type: typeId, scope: 'route', target: route.pair, airlineId: rival.id, startT, endT, icon: def.icon, title: fill(def.title, vars), text: fill(def.text, vars), effects: { fareCut: cut } };
    }
    case 'mechanical': {
      const planes = humanPlanes(state);
      if (!planes.length) return null;
      const plane = pick(state, planes);
      const hours = randInt(state, def.groundedHours[0], def.groundedHours[1]);
      const cost = Math.round(randRange(state, def.cost[0], def.cost[1]) / 1000) * 1000;
      const vars = { tail: `${plane.tail} (${AIRCRAFT[plane.type].short})`, hours, cost: fmtMoney(cost) };
      return { type: typeId, scope: 'plane', target: plane.id, startT, endT: startT + hours * MIN_PER_HOUR, icon: def.icon, title: def.title, text: fill(def.text, vars), effects: { cost } };
    }
    case 'viral': {
      const rep = randInt(state, def.rep[0], def.rep[1]);
      return { type: typeId, scope: 'airline', target: human.id, startT, endT: startT + MIN_PER_HOUR, icon: def.icon, title: def.title, text: fill(def.text, { rep }), effects: { rep } };
    }
    default:
      return null;
  }
}

export function rollWeeklyEvents(state, out) {
  const rate = eventRate(state);
  const weekStart = state.now;
  const deck = Object.entries(EVENT_TYPES).filter(([, d]) => d.weight > 0);
  for (let slot = 0; slot < 3; slot++) {
    if (!chance(state, 0.42 * rate)) continue;
    const [typeId] = pickWeighted(state, deck, ([, d]) => d.weight);
    // Don't stack the same global event type.
    if (EVENT_TYPES[typeId].scope === 'global' && state.activeEvents.some((e) => e.type === typeId)) continue;
    const startT = weekStart + randInt(state, 0, MIN_PER_WEEK - MIN_PER_DAY);
    const event = buildDeckEvent(state, typeId, startT);
    if (event) addEvent(state, event);
  }
  maybeCreateDecision(state, out);
}

// ---------------------------------------------------------------------------
// Daily weather

export function rollDailyWeather(state, out) {
  const rate = eventRate(state);
  const month = new Date(utcMs(state, state.now)).getUTCMonth() + 1;
  for (const ap of AIRPORTS) {
    if (state.activeEvents.some((e) => e.type === 'storm' && e.target === ap.code)) continue;
    for (const w of ap.weather) {
      if (!w.months.includes(month)) continue;
      if (!chance(state, 0.03 * w.weight * rate)) continue;
      const severity = Math.min(1.2, randRange(state, 0.3, 1) * WEATHER_INTENSITY[w.type]);
      const startT = state.now + randInt(state, 0, 12 * MIN_PER_HOUR);
      const hours = randRange(state, EVENT_TYPES.storm.durationHours[0], EVENT_TYPES.storm.durationHours[1]);
      const label = WEATHER_LABELS[w.type];
      addEvent(state, {
        type: 'storm', weather: w.type, scope: 'airport', target: ap.code, severity,
        startT, endT: Math.round(startT + hours * MIN_PER_HOUR), icon: EVENT_TYPES.storm.icon,
        title: `${label} at ${ap.code}`,
        text: `${label} in ${ap.city}: expect delays${severity > 0.6 ? ' and cancellations' : ''}.`,
        effects: { delayMult: 1 + 2.2 * severity, cancelChance: Math.min(0.45, 0.28 * severity * severity), demandMult: 1 - 0.08 * severity },
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Queue handlers

export function handleEventStart(state, item, out) {
  const e = state.activeEvents.find((x) => x.id === item.eventId);
  if (!e) return;
  const human = state.airlines[state.humanAirlineId];
  if (e.type === 'mechanical') {
    const plane = state.planes[e.target];
    if (!plane) return;
    groundPlane(state, plane, e.endT);
    human.cash -= e.effects.cost;
    ledgerFor(state, human.id).costs.other += e.effects.cost;
  } else if (e.type === 'viral') {
    adjustReputation(state, human, e.effects.rep);
  }
  const important = e.type !== 'storm' || isHumanAirport(state, e.target);
  addLog(state, out, { text: `${e.title}. ${e.text}`, icon: e.icon, kind: 'event', important });
}

function isHumanAirport(state, code) {
  const human = state.airlines[state.humanAirlineId];
  if (human.hubs.includes(code)) return true;
  return Object.values(state.routes).some((r) => r.airlineId === human.id && (r.a === code || r.b === code));
}

export function handleEventEnd(state, item, out) {
  const idx = state.activeEvents.findIndex((x) => x.id === item.eventId);
  if (idx < 0) return;
  const [e] = state.activeEvents.splice(idx, 1);
  if (e.type === 'fuelSpike' || e.type === 'slowdown' || e.type === 'fareWar') {
    addLog(state, out, { text: `${e.title} is over.`, icon: '✔', kind: 'event' });
  }
}

// ---------------------------------------------------------------------------
// Decisions

function maybeCreateDecision(state, out) {
  const human = state.airlines[state.humanAirlineId];
  if (state.outcome?.result === 'lost') return;
  if (state.decisions.length > 0) return;
  if (!chance(state, 0.3 * eventRate(state))) return;
  const week = weekIndex(state.now);
  const options = Object.entries(DECISION_TYPES).filter(([, d]) => week >= d.minWeek);
  const picked = pickWeighted(state, options, ([, d]) => d.weight);
  if (!picked) return;
  const [typeId, def] = picked;
  const planes = humanPlanes(state);
  const params = {};
  if (typeId === 'charter') {
    if (!planes.length) return;
    const plane = pick(state, planes);
    params.planeId = plane.id;
    params.tail = `${plane.tail} (${AIRCRAFT[plane.type].short})`;
    params.amountValue = Math.round(randRange(state, 150_000, 320_000) * (AIRCRAFT[plane.type].seats / 120) ** 0.5 / 1000) * 1000;
  } else if (typeId === 'sponsorship') {
    params.amountValue = Math.round(randRange(state, 200_000, 550_000) / 1000) * 1000;
  } else if (typeId === 'fuelHedge') {
    params.priceValue = Math.round(marketFuelPrice(state) * randRange(state, 0.94, 1.0) * 100) / 100;
    params.amountValue = Math.round(randRange(state, 120_000, 240_000) / 1000) * 1000;
  }
  const vars = {
    tail: params.tail,
    amount: params.amountValue ? fmtMoney(params.amountValue) : '',
    price: params.priceValue ? `$${params.priceValue.toFixed(2)}` : '',
  };
  const decision = {
    id: newId(state, 'D'),
    type: typeId,
    airlineId: human.id,
    icon: def.icon,
    title: def.title,
    text: fill(def.text, vars),
    options: def.options.map((o) => ({ id: o.id, label: fill(o.label, vars) })),
    params,
    createdT: state.now,
    expiresT: state.now + def.expiresDays * MIN_PER_DAY,
  };
  state.decisions.push(decision);
  out.push({ type: 'decision', decisionId: decision.id });
  addLog(state, out, { text: `Decision needed: ${decision.title}.`, icon: decision.icon, kind: 'decision', airlineId: human.id });
}

export function resolveDecision(state, decision, optionId, out) {
  state.decisions = state.decisions.filter((d) => d.id !== decision.id);
  const airline = state.airlines[decision.airlineId];
  const ledger = ledgerFor(state, airline.id);
  const p = decision.params;
  let text = '';
  switch (`${decision.type}:${optionId}`) {
    case 'unionRaise:accept':
      airline.crewCostMult *= 1.08;
      adjustReputation(state, airline, 3);
      text = 'Raise approved. Crews are fired up.';
      break;
    case 'unionRaise:refuse':
      if (chance(state, 0.4)) {
        adjustReputation(state, airline, -6);
        for (const plane of Object.values(state.planes)) {
          if (plane.airlineId === airline.id) groundPlane(state, plane, state.now + 2 * MIN_PER_DAY);
        }
        text = 'The union walks out! Your fleet is grounded for 2 days.';
      } else {
        text = 'The union grumbles but stays on the job.';
      }
      break;
    case 'charter:accept': {
      const plane = state.planes[p.planeId];
      airline.cash += p.amountValue;
      ledger.oneOff.in += p.amountValue;
      ledger.oneOff.items.push({ label: 'Charter contract', amount: p.amountValue });
      if (plane) groundPlane(state, plane, state.now + 2 * MIN_PER_DAY);
      text = `Charter booked: +${fmtMoney(p.amountValue)}. Go team!`;
      break;
    }
    case 'sponsorship:accept':
      airline.cash += p.amountValue;
      ledger.oneOff.in += p.amountValue;
      ledger.oneOff.items.push({ label: 'Livery sponsorship', amount: p.amountValue });
      adjustReputation(state, airline, -2);
      text = `Neon livery deal signed: +${fmtMoney(p.amountValue)}.`;
      break;
    case 'fuelHedge:accept':
      airline.cash -= p.amountValue;
      ledger.oneOff.out += p.amountValue;
      ledger.oneOff.items.push({ label: 'Fuel hedge fee', amount: -p.amountValue });
      airline.fuelHedge = { price: p.priceValue, untilT: state.now + 8 * MIN_PER_WEEK };
      text = `Fuel locked at $${p.priceValue.toFixed(2)}/gal for 8 weeks.`;
      break;
    default:
      text = 'Offer declined.';
  }
  addLog(state, out, { text: `${decision.title}: ${text}`, icon: decision.icon, kind: 'decision', airlineId: airline.id });
}

export function expireDecisions(state, out) {
  for (const d of [...state.decisions]) {
    if (state.now >= d.expiresT) resolveDecision(state, d, d.options[0].id, out);
  }
}

export function airportName(code) {
  return AIRPORT_BY_CODE[code]?.city ?? code;
}
