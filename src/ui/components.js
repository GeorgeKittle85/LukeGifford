// Shared UI pieces: fare slider with live estimate, plane status text, etc.

import { AIRCRAFT } from '../data/aircraft.js';
import { AIRPORT_BY_CODE } from '../data/airports.js';
import { estimateRoute, suggestFare } from '../engine/selectors.js';
import { h } from './dom.js';
import { duration, money, num, pct, shortTime } from './format.js';

export function airlineDot(color) {
  return h('span', { class: 'dot', style: { background: color }, 'aria-hidden': 'true' });
}

export function planeName(plane) {
  return `${plane.tail} · ${AIRCRAFT[plane.type].short}`;
}

export function planeStatus(state, plane) {
  const t = state.now;
  switch (plane.status) {
    case 'delivering': return `Delivering to ${plane.location}`;
    case 'idle': return `Idle at ${plane.location}`;
    case 'turnaround': return `Turning around at ${plane.location}`;
    case 'scheduled': {
      const nd = plane.nextDep;
      return nd ? `Departs ${nd.from} → ${nd.to} at ${shortTime(state, nd.from, nd.schedT)}${nd.ferry ? ' (repositioning)' : ''}` : `At ${plane.location}`;
    }
    case 'delayed': {
      const nd = plane.nextDep;
      return nd ? `Delayed at ${nd.from} (+${duration(nd.delay)})` : `Delayed at ${plane.location}`;
    }
    case 'flying': {
      const f = state.flights[plane.flightId];
      return f ? `${f.flightNo} ${f.from} → ${f.to}, lands in ${duration(f.arrT - t)}` : 'In flight';
    }
    case 'grounded': return `Grounded at ${plane.location} for ${duration(plane.groundedUntil - t)}`;
    default: return plane.status;
  }
}

export function airportOption(code) {
  const ap = AIRPORT_BY_CODE[code];
  return { value: code, label: `${code} · ${ap.city}` };
}

// Fare slider + live weekly estimate for flying a pair with given plane types.
// onCommit(fare) fires when the player lets go of the slider (or picks the
// suggested fare); live numbers update while dragging.
export function fareControl(ctx, { a, b, types, fare, onCommit, compact = false }) {
  const state = ctx.state;
  const me = ctx.me;
  const est0 = estimateRoute(state, me.id, a, b, fare, types);
  const maxFare = Math.floor(est0.maxFare);
  const minFare = Math.max(20, Math.round(maxFare * 0.15));
  let current = Math.min(maxFare, Math.max(minFare, Math.round(fare)));

  const readout = h('strong', { class: 'fare-readout' }, `$${current}`);
  const refNote = h('span', { class: 'muted small' }, `typical fare ~$${Math.round(est0.refFare)}, nobody flies at $${maxFare}`);
  const slider = h('input', { type: 'range', min: minFare, max: maxFare, step: 1, value: current, 'aria-label': 'Ticket price' });
  const cells = {};
  const cell = (key, label) => {
    cells[key] = h('div', { class: 'est-value' }, '—');
    return h('div', { class: 'est' }, h('div', { class: 'est-label' }, label), cells[key]);
  };
  const grid = h('div', { class: `est-grid${compact ? ' compact' : ''}` },
    cell('pax', 'Passengers / wk'),
    cell('lf', 'Load factor'),
    cell('share', 'Market share'),
    cell('revenue', 'Revenue / wk'),
    cell('costs', 'Flight costs / wk'),
    cell('profit', 'Profit / wk after leases'));

  let pending = false;
  const update = () => {
    pending = false;
    if (!types.length) {
      for (const k of Object.keys(cells)) cells[k].textContent = '—';
      cells.profit.textContent = 'Assign a plane';
      return;
    }
    const est = estimateRoute(ctx.state, me.id, a, b, current, types);
    cells.pax.textContent = num(est.pax);
    cells.lf.textContent = pct(est.loadFactor);
    cells.share.textContent = pct(est.share);
    cells.revenue.textContent = money(est.revenue);
    cells.costs.textContent = money(est.costs);
    cells.profit.textContent = money(est.profit, { sign: true });
    cells.profit.className = `est-value ${est.profit >= 0 ? 'pos' : 'neg'}`;
    cells.lf.className = `est-value ${est.loadFactor < 0.6 ? 'neg' : ''}`;
  };
  const schedule = () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(update);
    }
  };
  slider.addEventListener('input', () => {
    current = Number(slider.value);
    readout.textContent = `$${current}`;
    schedule();
  });
  slider.addEventListener('change', () => onCommit?.(current));

  const suggestBtn = h('button', {
    type: 'button',
    class: 'btn small ghost',
    disabled: !types.length,
    title: 'Fare that maximizes weekly profit for the planes on this route',
    onclick: () => {
      current = suggestFare(ctx.state, me.id, a, b, types);
      slider.value = current;
      readout.textContent = `$${current}`;
      update();
      onCommit?.(current);
    },
  }, 'Use suggested fare');

  update();
  return {
    el: h('div', { class: 'fare-control' },
      h('div', { class: 'fare-row' }, h('label', {}, 'Ticket price ', readout), suggestBtn),
      slider,
      refNote,
      grid),
    get fare() { return current; },
    setTypes(next) {
      types = next;
      update();
      suggestBtn.disabled = !types.length;
    },
  };
}

export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('p', {}, text), action || null);
}
