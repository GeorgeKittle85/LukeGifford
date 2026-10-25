// Upgrades tab: more hubs, loyalty program, marketing campaigns.

import { AIRPORTS } from '../../data/airports.js';
import { CAMPAIGNS, HUB_WEEKLY_UPKEEP, LOYALTY, MAX_HUBS } from '../../engine/constants.js';
import { button, h } from '../dom.js';
import { duration, money, pct } from '../format.js';

export const upgradesPanel = {
  id: 'upgrades',
  label: 'Upgrades',
  icon: '⬆',
  hotkey: 'u',
  render(ctx) {
    const state = ctx.state;
    const me = ctx.me;
    const campaign = me.campaign && state.now < me.campaign.untilT ? me.campaign : null;
    const rivalHubs = {};
    for (const a of Object.values(state.airlines)) if (a.controller === 'ai') for (const hub of a.hubs) (rivalHubs[hub] ||= []).push(a.name);

    return h('div', {},
      h('div', { class: 'panel-head' }, h('h2', {}, 'Upgrades')),

      h('section', { class: 'upgrade' },
        h('h3', {}, `Hubs (${me.hubs.length}/${MAX_HUBS})`),
        h('p', { class: 'muted small' }, `Every route must start at one of your hubs, so a new hub unlocks a whole new set of routes. Hubs also get cheaper airport fees. Each extra hub costs ${money(HUB_WEEKLY_UPKEEP)}/week to run.`),
        h('ul', { class: 'plain list' }, AIRPORTS.map((ap) => {
          const mine = me.hubs.includes(ap.code);
          return h('li', { class: 'list-row' },
            h('div', { class: 'grow' }, h('strong', {}, `${ap.code} · ${ap.city}`),
              rivalHubs[ap.code] ? h('div', { class: 'muted small' }, `Rival hub: ${rivalHubs[ap.code].join(', ')}`) : null),
            mine
              ? h('span', { class: 'badge' }, 'Your hub')
              : button(`Open hub · ${money(ap.hubCost)}`, () => {
                if (window.confirm(`Open a hub in ${ap.city} for ${money(ap.hubCost)} (+${money(HUB_WEEKLY_UPKEEP)}/week)?`)) ctx.run({ type: 'OPEN_HUB', airport: ap.code });
              }, { class: 'btn small', disabled: me.hubs.length >= MAX_HUBS || me.cash < ap.hubCost }));
        }))),

      h('section', { class: 'upgrade' },
        h('h3', {}, 'Kittle Club loyalty program'),
        h('p', { class: 'muted small' }, `Frequent flyers stick with you: +${pct(LOYALTY.shareBonus - 1)} attractiveness on every route and +${LOYALTY.repBonus} reputation target. Costs ${money(LOYALTY.setupCost)} to launch, then ${money(LOYALTY.weeklyCost)}/week plus $${LOYALTY.perPax} per passenger.`),
        me.upgrades.loyalty
          ? h('span', { class: 'badge' }, 'Active')
          : button(`Launch · ${money(LOYALTY.setupCost)}`, () => ctx.run({ type: 'BUY_LOYALTY' }), { class: 'btn primary small', disabled: me.cash < LOYALTY.setupCost })),

      h('section', { class: 'upgrade' },
        h('h3', {}, 'Marketing'),
        campaign ? h('p', { class: 'notice' }, `Campaign running: demand +${pct(campaign.demandMult - 1)} for ${duration(campaign.untilT - state.now)} more.`) : null,
        h('div', { class: 'market-grid' }, Object.values(CAMPAIGNS).map((c) => h('div', { class: 'ac-card' },
          h('strong', {}, c.label),
          h('p', { class: 'small' }, `+${pct(c.demandMult - 1)} demand on all your routes for ${c.weeks} weeks.`),
          button(`Run · ${money(c.cost)}`, () => ctx.run({ type: 'START_CAMPAIGN', campaign: c.id }), { class: 'btn small', disabled: Boolean(campaign) || me.cash < c.cost }))))));
  },
  liveKey(ctx) {
    const me = ctx.me;
    return `${me.hubs.join(',')}#${me.upgrades.loyalty}#${Math.floor(me.cash / 100_000)}#${me.campaign?.untilT ?? 0}#${Math.floor(ctx.state.now / 1440)}`;
  },
};
