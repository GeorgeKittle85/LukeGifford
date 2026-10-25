// Standings tab: win progress, rival airlines, and who leads each route.

import { MIN_TOP_ROUTE_PAX, TOP_ROUTE_SHARE, WIN_CASH, WIN_TOP_ROUTES } from '../../engine/constants.js';
import { objectives, pairStandings, rivalSummaries } from '../../engine/selectors.js';
import { airlineDot } from '../components.js';
import { h } from '../dom.js';
import { money, num, pct } from '../format.js';

const STYLE_LABEL = { legacy: 'Legacy carrier', lowcost: 'Ultra-low-cost', regional: 'Regional powerhouse', premium: 'Boutique premium' };

export const rivalsPanel = {
  id: 'rivals',
  label: 'Standings',
  icon: '🏆',
  hotkey: 'v',
  render(ctx) {
    const state = ctx.state;
    const me = ctx.me;
    const obj = objectives(state);
    const standings = pairStandings(state).filter((s) => s.list.some((x) => x.airlineId === me.id) || s.top);
    const name = (id) => state.airlines[id]?.name ?? id;

    return h('div', {},
      h('div', { class: 'panel-head' }, h('h2', {}, 'Standings')),
      h('div', { class: 'objectives' },
        h('div', { class: 'objective' },
          h('div', {}, h('strong', {}, `Cash: ${money(obj.cash)} / ${money(WIN_CASH)}`)),
          h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: `${Math.max(0, Math.min(100, (obj.cash / WIN_CASH) * 100))}%` } }))),
        h('div', { class: 'objective' },
          h('div', {}, h('strong', {}, `Top airline on ${obj.topRoutes} / ${WIN_TOP_ROUTES} routes`)),
          h('div', { class: 'progress' }, h('div', { class: 'progress-fill gold', style: { width: `${(Math.min(obj.topRoutes, WIN_TOP_ROUTES) / WIN_TOP_ROUTES) * 100}%` } })),
          h('div', { class: 'muted small' }, `To lead a route you need the most passengers that week, at least ${num(MIN_TOP_ROUTE_PAX)}, and at least ${pct(TOP_ROUTE_SHARE)} of everyone flying it (connections included).`))),

      h('h3', {}, 'Rival airlines'),
      h('div', { class: 'rival-grid' }, rivalSummaries(state).map((r) => h('div', { class: 'rival-card', style: { borderColor: r.color } },
        h('div', { class: 'rival-head' }, airlineDot(r.color), h('strong', {}, r.name)),
        h('div', { class: 'muted small' }, `${STYLE_LABEL[r.tagline] || ''} · hubs ${r.hubs.join(', ')}`),
        h('dl', { class: 'specs' },
          h('dt', {}, 'Fleet'), h('dd', {}, r.fleet),
          h('dt', {}, 'Routes'), h('dd', {}, r.routes),
          h('dt', {}, 'Passengers last wk'), h('dd', {}, num(r.weeklyPax)),
          h('dt', {}, 'Reputation'), h('dd', {}, r.reputation.toFixed(0)),
          h('dt', {}, 'Routes led'), h('dd', {}, r.topRoutes))))),

      h('h3', {}, 'Route leaders (last week)'),
      standings.length
        ? h('table', { class: 'table compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Route'), h('th', {}, 'Leader'), h('th', { class: 'num' }, 'Your pax'), h('th', { class: 'num' }, 'Your share'))),
          h('tbody', {}, standings.map((s) => {
            const mine = s.list.find((x) => x.airlineId === me.id);
            return h('tr', { class: s.top === me.id ? 'me' : '' },
              h('td', {}, s.key.replace('-', '–')),
              h('td', {}, s.top ? [airlineDot(state.airlines[s.top].color), ' ', name(s.top), s.top === me.id ? ' 🏆' : ''] : h('span', { class: 'muted' }, 'Nobody dominates')),
              h('td', { class: 'num' }, mine ? num(mine.pax) : '—'),
              h('td', { class: 'num' }, mine ? pct(mine.pax / s.total) : '—'));
          })))
        : h('p', { class: 'muted small' }, 'Standings appear after your first weekly report.'));
  },
  liveKey(ctx) {
    return `${ctx.state.history.length}#${Math.floor(ctx.me.cash / 100_000)}`;
  },
};
