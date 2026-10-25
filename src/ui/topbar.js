// Top bar: clock, speed controls, key numbers, menu. Built once and updated
// in place every frame (cheap textContent writes only).

import { WIN_CASH, WIN_TOP_ROUTES } from '../engine/constants.js';
import { marketFuelPrice } from '../engine/modifiers.js';
import { objectives } from '../engine/selectors.js';
import { button, h } from './dom.js';
import { clockAt, money, week } from './format.js';

const SPEED_LABELS = ['Pause', '1x', '5x', '15x', '60x', '120x'];
const SPEED_TITLES = ['Pause (Space)', '1x: 1 real min = 30 game min (key 1)', '5x (key 2)', '15x (key 3)', '60x (key 4)', '120x: 1 game hour per second (key 5)'];

export function createTopbar(ctx, { onMenu }) {
  const el = (cls, text = '') => h('span', { class: cls }, text);
  const refs = {
    date: el('clock-date'),
    time: el('clock-time'),
    week: el('clock-week'),
    cash: el('kv-value'),
    profit: el('kv-value'),
    rep: el('kv-value'),
    fuel: el('kv-value'),
    goal: el('kv-value'),
  };
  const pauseIcon = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');
    for (const x of [2, 7]) {
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      Object.entries({ x, y: 1, width: 3, height: 10, rx: 1, fill: 'currentColor' }).forEach(([k, v]) => r.setAttribute(k, v));
      svg.append(r);
    }
    return svg;
  };
  const speedButtons = SPEED_LABELS.map((label, i) => button(i === 0 ? pauseIcon() : label, () => ctx.host.setSpeed(i), {
    class: 'speed-btn', title: SPEED_TITLES[i], 'aria-label': SPEED_TITLES[i], 'aria-pressed': 'false',
  }));
  const kv = (label, ref, title) => h('div', { class: 'kv', title }, h('span', { class: 'kv-label' }, label), ref);

  const root = h('header', { class: 'topbar' },
    h('div', { class: 'brand', title: 'Kittle Skies' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '✈'), h('span', { class: 'brand-name' }, 'KITTLE', h('b', {}, 'SKIES'))),
    h('div', { class: 'clock', 'aria-live': 'off' }, h('div', {}, refs.time, ' ', refs.date), refs.week),
    h('div', { class: 'speeds', role: 'group', 'aria-label': 'Game speed' }, speedButtons),
    h('div', { class: 'kvs' },
      kv('Cash', refs.cash, 'Cash on hand'),
      kv('Last week', refs.profit, 'Operating profit last week'),
      kv('Reputation', refs.rep, 'Reputation (0-100)'),
      kv('Fuel', refs.fuel, 'Jet fuel price per gallon'),
      kv('Goal', refs.goal, `Win: ${money(WIN_CASH)} cash or top airline on ${WIN_TOP_ROUTES} routes`)),
    h('nav', { class: 'menu', 'aria-label': 'Game menu' },
      button('💾', () => onMenu('saves'), { class: 'icon-btn', title: 'Save & load', 'aria-label': 'Save and load' }),
      button('⚙', () => onMenu('settings'), { class: 'icon-btn', title: 'Settings', 'aria-label': 'Settings' }),
      button('?', () => onMenu('help'), { class: 'icon-btn', title: 'How to play', 'aria-label': 'How to play' }),
      button('New', () => onMenu('new'), { class: 'btn small ghost', title: 'Start a new airline' })));

  let last = {};
  const set = (key, text, cls) => {
    if (last[key] !== text) {
      refs[key].textContent = text;
      last[key] = text;
    }
    if (cls !== undefined && last[`${key}-cls`] !== cls) {
      refs[key].className = `kv-value ${cls}`;
      last[`${key}-cls`] = cls;
    }
  };

  return {
    el: root,
    brand: root.querySelector('.brand'),
    update() {
      const state = ctx.state;
      if (!state) return;
      const me = ctx.me;
      const c = clockAt(state, me.hubs[0]);
      set('time', `${c.time} ${c.zone}`);
      set('date', c.date);
      set('week', `Week ${week(state.now)} · ${me.hubs[0]} local time`);
      set('cash', money(me.cash), me.cash < 0 ? 'neg' : '');
      const lw = me.lastWeek;
      set('profit', lw ? money(lw.operatingProfit, { sign: true }) : '—', lw ? (lw.operatingProfit >= 0 ? 'pos' : 'neg') : '');
      set('rep', `${Math.round(me.reputation)}`, me.reputation >= 60 ? 'pos' : me.reputation < 35 ? 'neg' : 'warn');
      set('fuel', `$${marketFuelPrice(state).toFixed(2)}`);
      const obj = objectives(state);
      set('goal', `${Math.max(0, Math.round((obj.cash / WIN_CASH) * 100))}% · 🏆${obj.topRoutes}/${WIN_TOP_ROUTES}`);
      speedButtons.forEach((b, i) => {
        const on = ctx.host.speedIndex === i;
        if (b.getAttribute('aria-pressed') !== String(on)) {
          b.setAttribute('aria-pressed', String(on));
          b.classList.toggle('active', on);
        }
      });
    },
  };
}
