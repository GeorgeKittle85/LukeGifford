// Finances tab: cash, charts, last week's P&L, and operating policies.

import { MAINTENANCE_POLICIES, OVERBOOKING_OPTIONS, SERVICE_LEVELS, WIN_CASH } from '../../engine/constants.js';
import { marketFuelPrice } from '../../engine/modifiers.js';
import { netWorth, repTarget, weeklyBurn } from '../../engine/selectors.js';
import { cashChart, profitChart, repMeter } from '../charts.js';
import { h, select } from '../dom.js';
import { duration, money, num, pct } from '../format.js';

function policyRow(ctx, label, key, options, value, blurb) {
  return h('div', { class: 'policy' },
    h('label', {}, label, select(options, value, (v) => ctx.run({ type: 'SET_SETTING', key, value: v }), { 'aria-label': label })),
    h('div', { class: 'muted small' }, blurb));
}

export const financePanel = {
  id: 'finance',
  label: 'Finances',
  icon: '$',
  hotkey: '$',
  render(ctx) {
    const state = ctx.state;
    const me = ctx.me;
    const history = state.history.slice(-26);
    const burn = weeklyBurn(state, me.id);
    const fuel = marketFuelPrice(state);
    const hedge = me.fuelHedge && state.now < me.fuelHedge.untilT ? me.fuelHedge : null;
    const lw = me.lastWeek;

    return h('div', { class: 'finance' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Finances')),
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Cash'), h('div', { class: `stat-value ${me.cash < 0 ? 'neg' : ''}` }, money(me.cash))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Net worth'), h('div', { class: 'stat-value' }, money(netWorth(state, me.id)))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Fixed costs / wk'), h('div', { class: 'stat-value' }, money(burn.total))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Jet fuel'), h('div', { class: 'stat-value' }, `$${fuel.toFixed(2)}/gal`),
          hedge ? h('div', { class: 'stat-delta' }, `Hedged at $${hedge.price.toFixed(2)} for ${duration(hedge.untilT - state.now)}`) : null)),
      h('div', { class: 'progress-block' },
        h('div', { class: 'muted small' }, `Progress to ${money(WIN_CASH)}`),
        h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: `${Math.max(0, Math.min(100, (me.cash / WIN_CASH) * 100))}%` } }))),

      h('h3', {}, 'Weekly operating profit'),
      profitChart(history.map((r) => ({ label: `W${r.week}`, value: r.operatingProfit })), money),
      h('h3', {}, 'Cash balance'),
      cashChart(history.map((r) => ({ label: `W${r.week}`, value: r.cash })), money, { value: WIN_CASH, label: `Goal ${money(WIN_CASH)}` }),
      history.length ? h('details', { class: 'table-view' },
        h('summary', {}, 'Show as a table'),
        h('table', { class: 'table compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Week'), h('th', { class: 'num' }, 'Revenue'), h('th', { class: 'num' }, 'Op. profit'), h('th', { class: 'num' }, 'Cash'), h('th', { class: 'num' }, 'Pax'))),
          h('tbody', {}, [...history].reverse().map((r) => h('tr', {},
            h('td', {}, `W${r.week}`), h('td', { class: 'num' }, money(r.revenue)),
            h('td', { class: `num ${r.operatingProfit < 0 ? 'neg' : 'pos'}` }, money(r.operatingProfit, { sign: true })),
            h('td', { class: 'num' }, money(r.cash)), h('td', { class: 'num' }, num(r.pax))))))) : null,

      lw ? h('div', {},
        h('h3', {}, `Week ${lw.week} at a glance`),
        h('table', { class: 'table compact' }, h('tbody', {},
          h('tr', {}, h('td', {}, 'Revenue'), h('td', { class: 'num' }, money(lw.revenue))),
          h('tr', {}, h('td', {}, 'Flight costs'), h('td', { class: 'num neg' }, money(-lw.variableCosts))),
          h('tr', {}, h('td', {}, 'Leases, overhead, hubs, loyalty'), h('td', { class: 'num neg' }, money(-lw.fixedCosts))),
          h('tr', {}, h('th', {}, 'Operating profit'), h('th', { class: `num ${lw.operatingProfit < 0 ? 'neg' : 'pos'}` }, money(lw.operatingProfit, { sign: true }))),
          h('tr', {}, h('td', {}, 'Load factor / on-time'), h('td', { class: 'num' }, `${pct(lw.loadFactor)} / ${pct(lw.onTimeRate)}`))))) : null,

      h('h3', {}, 'Operating policies'),
      h('div', { class: 'rep-line' }, 'Reputation ', repMeter(me.reputation), h('span', { class: 'muted small' }, ` drifting toward ${repTarget(state, me.id).toFixed(0)}`)),
      policyRow(ctx, 'Service level', 'serviceLevel',
        Object.values(SERVICE_LEVELS).map((s) => ({ value: s.id, label: `${s.label} ($${s.perPax}/passenger)` })),
        me.settings.serviceLevel, SERVICE_LEVELS[me.settings.serviceLevel].blurb),
      policyRow(ctx, 'Maintenance', 'maintenance',
        Object.values(MAINTENANCE_POLICIES).map((m) => ({ value: m.id, label: `${m.label} (${pct(m.costMult)} cost)` })),
        me.settings.maintenance, MAINTENANCE_POLICIES[me.settings.maintenance].blurb),
      policyRow(ctx, 'Overbooking', 'overbooking',
        OVERBOOKING_OPTIONS.map((o) => ({ value: o, label: o === 0 ? 'None' : `Sell ${pct(o)} extra seats` })),
        me.settings.overbooking, 'Some passengers never show up. Overbooking fills those seats, but bumped passengers cost $450 each and dent your reputation.'));
  },
  liveKey(ctx) {
    const me = ctx.me;
    return `${ctx.state.history.length}#${Math.floor(me.cash / 25_000)}#${Math.round(me.reputation)}#${JSON.stringify(me.settings)}#${ctx.state.fuelPrice}`;
  },
};
