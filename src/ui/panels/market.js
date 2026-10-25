// Market tab: explore every city pair from an airport before committing.

import { AIRPORTS, AIRPORT_BY_CODE } from '../../data/airports.js';
import { pairInfo } from '../../engine/selectors.js';
import { airlineDot, airportOption } from '../components.js';
import { button, h, select } from '../dom.js';
import { miles, money, pct } from '../format.js';

export const marketPanel = {
  id: 'market',
  label: 'Market',
  icon: '🗺',
  hotkey: 'm',
  render(ctx, params) {
    const me = ctx.me;
    const origin = params.origin && AIRPORT_BY_CODE[params.origin] ? params.origin : me.hubs[0];
    const ap = AIRPORT_BY_CODE[origin];
    const isHub = me.hubs.includes(origin);
    const rows = AIRPORTS.filter((x) => x.code !== origin).map((dest) => ({ dest, info: pairInfo(ctx.state, origin, dest.code) }))
      .sort((x, y) => y.info.potential - x.info.potential);

    return h('div', {},
      h('div', { class: 'panel-head' },
        h('h2', {}, 'Market explorer'),
        select(AIRPORTS.map((x) => airportOption(x.code)), origin, (v) => ctx.openPanel('market', { origin: v }), { 'aria-label': 'Origin airport' })),
      h('p', { class: 'muted small' }, `${ap.name}. ${isHub ? 'This is your hub.' : 'Not your hub: routes from here need a hub here (Upgrades tab) unless the other end is your hub.'}`),
      h('table', { class: 'table compact market-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'To'), h('th', { class: 'num' }, 'Distance'), h('th', {}, 'Demand'), h('th', {}, 'Competition'),
          h('th', { class: 'num' }, 'Typical fare'), h('th', {}, ''))),
        h('tbody', {}, rows.map(({ dest, info }) => {
          const canPlan = isHub || me.hubs.includes(dest.code);
          return h('tr', { class: info.myRoute ? 'me' : '' },
            h('td', {}, h('strong', {}, dest.code), h('div', { class: 'muted small' }, dest.city)),
            h('td', { class: 'num' }, miles(info.distance)),
            h('td', {}, h('span', { class: `level level-${info.demandLevel}` }, info.demandLabel)),
            h('td', {},
              info.competition.label,
              h('div', { class: 'tiny-dots' }, info.offers.filter((o) => o.airlineId !== me.id).map((o) => airlineDot(o.color)))),
            h('td', { class: 'num' }, money(info.refFare)),
            h('td', { class: 'actions' },
              info.myRoute
                ? button('Manage', () => ctx.openPanel('routes', { routeId: info.myRoute.id }), { class: 'btn small' })
                : button('Plan', () => ctx.openPlanner({ from: origin, to: dest.code }), { class: 'btn small primary', disabled: !canPlan, title: canPlan ? '' : 'Needs a hub at one end' })));
        }))),
      h('p', { class: 'muted small' }, `Demand levels compare all 45 city pairs. Typical fare is half the fare at which nobody flies; it moves with fuel prices. Connecting and unmodeled carriers take roughly ${pct(rows[0]?.info.outsideShare ?? 0)} of travelers on the biggest market here.`));
  },
  liveKey(ctx, params) {
    return `${params.origin || ''}#${ctx.state.history.length}#${Object.keys(ctx.state.routes).length}#${ctx.me.hubs.join(',')}`;
  },
};
