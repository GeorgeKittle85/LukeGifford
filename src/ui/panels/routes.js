// Routes tab: list of your routes, and a detail view per route with the fare
// slider, assigned planes, and the competition.

import { AIRCRAFT } from '../../data/aircraft.js';
import { canFly } from '../../engine/network.js';
import { pairInfo, planesOf, planesOnRoute, routesOf, routeTypes } from '../../engine/selectors.js';
import { airlineDot, emptyState, fareControl, planeName, planeStatus } from '../components.js';
import { button, h, select } from '../dom.js';
import { miles, money, num, pct } from '../format.js';

function lastWeekFor(ctx, routeId) {
  return ctx.me.lastWeek?.routes.find((r) => r.routeId === routeId) || null;
}

function routeList(ctx) {
  const routes = routesOf(ctx.state, ctx.me.id);
  const header = h('div', { class: 'panel-head' },
    h('h2', {}, `Your routes (${routes.length})`),
    button('+ New route', () => ctx.openPlanner(), { class: 'btn primary small' }));
  if (!routes.length) {
    return h('div', {}, header, emptyState(
      'No routes yet. Pick a city pair from your hub, set a fare, and assign your E175. Tip: click any airport on the map.',
      button('Plan your first route', () => ctx.openPlanner(), { class: 'btn primary' })));
  }
  return h('div', {}, header,
    h('ul', { class: 'cards' }, routes.map((route) => {
      const lw = lastWeekFor(ctx, route.id);
      const planes = planesOnRoute(ctx.state, route.id);
      const info = pairInfo(ctx.state, route.a, route.b);
      return h('li', {},
        h('button', { type: 'button', class: 'card route-card', onclick: () => ctx.openPanel('routes', { routeId: route.id }) },
          h('div', { class: 'card-top' },
            h('strong', {}, `${route.a} ⇄ ${route.b}`),
            lw?.top ? h('span', { class: 'badge', title: 'Top airline on this route last week' }, '🏆 Top') : null,
            h('span', { class: 'muted small' }, miles(info.distance))),
          h('div', { class: 'card-grid' },
            h('span', {}, h('span', { class: 'muted' }, 'Fare '), `$${route.fare}`),
            h('span', {}, h('span', { class: 'muted' }, 'Planes '), planes.length ? planes.map((p) => AIRCRAFT[p.type].short).join(', ') : h('span', { class: 'neg' }, 'none')),
            h('span', {}, h('span', { class: 'muted' }, 'Last wk '), lw ? h('span', { class: lw.profit >= 0 ? 'pos' : 'neg' }, money(lw.profit, { sign: true })) : '—'),
            h('span', {}, h('span', { class: 'muted' }, 'Full '), lw?.legs ? pct(lw.loadFactor) : '—'))));
    })));
}

function routeDetail(ctx, route) {
  const state = ctx.state;
  const me = ctx.me;
  const info = pairInfo(state, route.a, route.b);
  const planes = planesOnRoute(state, route.id);
  const lw = lastWeekFor(ctx, route.id);
  const fareCtl = fareControl(ctx, {
    a: route.a, b: route.b, types: routeTypes(state, route.id), fare: route.fare,
    onCommit: (fare) => ctx.run({ type: 'SET_FARE', routeId: route.id, fare }),
  });
  const spare = planesOf(state, me.id).filter((p) => !p.routeId && !p.pendingDisposal && canFly(p.type, info.distance));

  return h('div', { class: 'route-detail' },
    h('div', { class: 'panel-head' },
      button('← Routes', () => ctx.openPanel('routes', {}), { class: 'btn ghost small' }),
      h('h2', {}, `${route.a} ⇄ ${route.b}`),
      button('Show on map', () => ctx.map.focusAirport(route.b, 4), { class: 'btn ghost small' })),
    h('div', { class: 'pair-facts' },
      h('div', {}, h('span', { class: 'muted' }, 'Distance '), h('strong', {}, miles(info.distance))),
      h('div', {}, h('span', { class: 'muted' }, 'Demand '), h('strong', {}, info.demandLabel)),
      h('div', {}, h('span', { class: 'muted' }, 'Competition '), h('strong', {}, info.competition.label)),
      h('div', {}, h('span', { class: 'muted' }, 'Flight numbers '), h('strong', {}, `${me.code}${route.flightBase + 1} / ${me.code}${route.flightBase + 2}`))),
    lw ? h('div', { class: 'stat-row small' },
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Last week profit'), h('div', { class: `stat-value ${lw.profit >= 0 ? 'pos' : 'neg'}` }, money(lw.profit, { sign: true }))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Passengers'), h('div', { class: 'stat-value' }, num(lw.pax))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Load factor'), h('div', { class: 'stat-value' }, pct(lw.loadFactor))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Market share'), h('div', { class: 'stat-value' }, `${pct(lw.share)}${lw.top ? ' 🏆' : ''}`))) : null,

    h('h3', {}, 'Price'),
    fareCtl.el,

    h('h3', {}, `Planes on this route (${planes.length})`),
    planes.length
      ? h('ul', { class: 'plain list' }, planes.map((p) => h('li', { class: 'list-row' },
        h('div', {}, h('strong', {}, planeName(p)), h('div', { class: 'muted small' }, planeStatus(state, p))),
        button('Remove', () => ctx.run({ type: 'ASSIGN_PLANE', planeId: p.id, routeId: null }), { class: 'btn small ghost' }))))
      : h('p', { class: 'neg small' }, 'No planes assigned: this route is not flying.'),
    h('div', { class: 'inline-form' },
      spare.length
        ? select([{ value: '', label: 'Add an idle plane…' }, ...spare.map((p) => ({ value: p.id, label: planeName(p) }))], '', (planeId) => {
          if (planeId) ctx.run({ type: 'ASSIGN_PLANE', planeId, routeId: route.id });
        }, { 'aria-label': 'Add a plane to this route' })
        : h('span', { class: 'muted small' }, 'No idle planes in range. '),
      button('Lease a plane…', () => ctx.openPanel('fleet', { leaseFor: route.id }), { class: 'btn small' })),

    h('h3', {}, 'Competition'),
    info.offers.length
      ? h('table', { class: 'table compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Airline'), h('th', { class: 'num' }, 'Fare'), h('th', { class: 'num' }, 'Flights/wk'), h('th', { class: 'num' }, 'Est. full'))),
        h('tbody', {}, info.offers.map((o) => h('tr', { class: o.airlineId === me.id ? 'me' : '' },
          h('td', {}, airlineDot(o.color), ' ', o.name),
          h('td', { class: 'num' }, `$${Math.round(o.fare)}`),
          h('td', { class: 'num' }, num(o.legs)),
          h('td', { class: 'num' }, pct(o.loadFactor))))))
      : h('p', { class: 'muted small' }, 'Nobody else flies this route nonstop.'),
    h('p', { class: 'muted small' }, `About ${pct(info.outsideShare)} of travelers on this market take connections or carriers not shown here.`),

    h('div', { class: 'danger-zone' },
      button('Close route', () => {
        if (window.confirm(`Close ${route.a}–${route.b}? Its planes become idle.`)) {
          ctx.run({ type: 'CLOSE_ROUTE', routeId: route.id });
          ctx.openPanel('routes', {});
        }
      }, { class: 'btn danger small' })));
}

export const routesPanel = {
  id: 'routes',
  label: 'Routes',
  icon: '🛫',
  hotkey: 'r',
  render(ctx, params) {
    const route = params.routeId ? ctx.state.routes[params.routeId] : null;
    return route && route.airlineId === ctx.me.id ? routeDetail(ctx, route) : routeList(ctx);
  },
  liveKey(ctx, params) {
    const s = ctx.state;
    const mine = Object.values(s.planes).filter((p) => p.airlineId === ctx.me.id);
    const planesKey = mine.map((p) => `${p.id}:${p.routeId}:${p.status}`).join('|');
    const routesKey = Object.values(s.routes).filter((r) => r.airlineId === ctx.me.id).map((r) => `${r.id}:${r.fare}`).join('|');
    return `${params.routeId || ''}#${s.history.length}#${routesKey}#${planesKey}`;
  },
};
