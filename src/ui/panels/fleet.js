// Fleet tab: your planes and the aircraft market (lease or buy).

import { AIRCRAFT, AIRCRAFT_ORDER, leaseDeposit, weeklyLease } from '../../data/aircraft.js';
import { planeMarketValue } from '../../engine/economics.js';
import { canFly, getPair } from '../../engine/network.js';
import { planesOf, routesOf } from '../../engine/selectors.js';
import { airportOption, emptyState, planeName, planeStatus } from '../components.js';
import { button, h, select } from '../dom.js';
import { money, num } from '../format.js';

function routeOptions(ctx, plane) {
  return [
    { value: '', label: 'Unassigned' },
    ...routesOf(ctx.state, ctx.me.id).map((r) => ({
      value: r.id,
      label: `${r.a}–${r.b}${canFly(plane.type, getPair(r.a, r.b).distance) ? '' : ' (out of range)'}`,
      disabled: !canFly(plane.type, getPair(r.a, r.b).distance),
    })),
  ];
}

function fleetList(ctx) {
  const planes = planesOf(ctx.state, ctx.me.id);
  if (!planes.length) return emptyState('You have no aircraft. Lease one below to get flying again.');
  return h('ul', { class: 'plain list' }, planes.map((p) => {
    const type = AIRCRAFT[p.type];
    const value = p.ownership === 'owned' ? planeMarketValue(ctx.state, p) : p.deposit;
    const disposeLabel = p.ownership === 'leased' ? 'Return' : 'Sell';
    return h('li', { class: 'list-row fleet-row' },
      h('div', { class: 'grow' },
        h('div', {}, h('strong', {}, planeName(p)), h('span', { class: 'muted small' }, ` · ${type.seats} seats · ${p.ownership}`)),
        h('div', { class: 'muted small' }, p.pendingDisposal ? 'Leaving the fleet after landing' : planeStatus(ctx.state, p)),
        h('div', { class: 'muted small' }, `${num(p.stats.legs)} flights · ${num(p.stats.pax)} passengers`)),
      h('div', { class: 'fleet-actions' },
        select(routeOptions(ctx, p), p.routeId || '', (routeId) => ctx.run({ type: 'ASSIGN_PLANE', planeId: p.id, routeId: routeId || null }), { 'aria-label': `Route for ${p.tail}`, disabled: p.pendingDisposal }),
        button(disposeLabel, () => {
          const msg = p.ownership === 'leased'
            ? `Return ${p.tail} to the lessor? You get ${money(Math.max(0, p.deposit - type.leaseMonthly))} of the deposit back.`
            : `Sell ${p.tail} for about ${money(value * 0.9)}?`;
          if (window.confirm(msg)) ctx.run({ type: 'DISPOSE_PLANE', planeId: p.id });
        }, { class: 'btn small ghost', disabled: p.pendingDisposal })));
  }));
}

function market(ctx, params) {
  const me = ctx.me;
  let hub = me.hubs[0];
  const leaseFor = params.leaseFor ? ctx.state.routes[params.leaseFor] : null;
  if (leaseFor) hub = leaseFor.a;
  const hubPicker = me.hubs.length > 1
    ? h('label', { class: 'inline' }, 'Deliver to ', select(me.hubs.map(airportOption), hub, (v) => { hub = v; }))
    : null;
  return h('div', {},
    h('div', { class: 'panel-head' }, h('h2', {}, 'Aircraft market'), hubPicker),
    leaseFor ? h('p', { class: 'notice' }, `New planes will be assigned to ${leaseFor.a}–${leaseFor.b} on delivery (if in range).`) : null,
    h('div', { class: 'market-grid' }, AIRCRAFT_ORDER.map((id) => {
      const t = AIRCRAFT[id];
      const deposit = leaseDeposit(id);
      const inRange = !leaseFor || canFly(id, getPair(leaseFor.a, leaseFor.b).distance);
      return h('div', { class: `ac-card${inRange ? '' : ' dim'}` },
        h('div', { class: 'ac-head' }, h('strong', {}, t.name), h('span', { class: 'muted small' }, t.category)),
        h('p', { class: 'small' }, t.blurb),
        h('dl', { class: 'specs' },
          h('dt', {}, 'Seats'), h('dd', {}, t.seats),
          h('dt', {}, 'Range'), h('dd', {}, `${num(t.rangeMi)} mi`),
          h('dt', {}, 'Fuel burn'), h('dd', {}, `${num(t.fuelGph)} gal/hr`),
          h('dt', {}, 'Lease'), h('dd', {}, `${money(t.leaseMonthly)}/mo (${money(weeklyLease(id))}/wk)`),
          h('dt', {}, 'Deposit'), h('dd', {}, money(deposit)),
          h('dt', {}, 'Buy'), h('dd', {}, money(t.price)),
          t.cabinYield > 1 ? [h('dt', {}, 'Premium cabins'), h('dd', {}, `+${Math.round((t.cabinYield - 1) * 100)}% revenue/pax`)] : null),
        h('div', { class: 'ac-actions' },
          button('Lease', () => {
            const res = ctx.run({ type: 'LEASE_PLANE', aircraftType: id, location: hub, routeId: inRange ? params.leaseFor : undefined });
            if (res.ok) ctx.toast(`${t.short} leased. Delivery in 2 days.`);
          }, { class: 'btn small primary', disabled: me.cash < deposit, title: me.cash < deposit ? `Need ${money(deposit)}` : '' }),
          button('Buy', () => {
            if (window.confirm(`Buy a ${t.name} for ${money(t.price)}? No lease payments, but it ties up a lot of cash.`)) {
              const res = ctx.run({ type: 'BUY_PLANE', aircraftType: id, location: hub });
              if (res.ok) ctx.toast(`${t.short} purchased. Delivery in 3 days.`);
            }
          }, { class: 'btn small', disabled: me.cash < t.price })));
    })));
}

export const fleetPanel = {
  id: 'fleet',
  label: 'Fleet',
  icon: '✈',
  hotkey: 'f',
  render(ctx, params) {
    const planes = planesOf(ctx.state, ctx.me.id);
    return h('div', {},
      h('div', { class: 'panel-head' }, h('h2', {}, `Your fleet (${planes.length})`)),
      fleetList(ctx),
      market(ctx, params));
  },
  liveKey(ctx, params) {
    const mine = Object.values(ctx.state.planes).filter((p) => p.airlineId === ctx.me.id);
    return `${params.leaseFor || ''}#${Math.floor(ctx.me.cash / 50_000)}#${mine.map((p) => `${p.id}:${p.routeId}:${p.status}:${p.location}:${p.stats.legs}`).join('|')}#${Object.keys(ctx.state.routes).length}`;
  },
};
