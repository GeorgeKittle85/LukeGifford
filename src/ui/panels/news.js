// News tab: the game log, newest first.

import { liveEvents } from '../../engine/selectors.js';
import { button, h } from '../dom.js';
import { duration, shortTime, week } from '../format.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'My airline' },
  { id: 'events', label: 'Events' },
  { id: 'rivals', label: 'Rivals' },
];

export const newsPanel = {
  id: 'news',
  label: 'News',
  icon: '📰',
  hotkey: 'n',
  render(ctx, params) {
    const state = ctx.state;
    const filter = params.filter || 'all';
    const hub = ctx.me.hubs[0];
    const entries = [...state.log].reverse().filter((e) => {
      if (filter === 'mine') return e.airlineId === ctx.me.id;
      if (filter === 'events') return e.kind === 'event' || e.kind === 'decision';
      if (filter === 'rivals') return e.airlineId && e.airlineId !== ctx.me.id;
      return true;
    });
    const live = liveEvents(state).filter((e) => e.type !== 'mechanical' && e.type !== 'viral');

    return h('div', {},
      h('div', { class: 'panel-head' }, h('h2', {}, 'News & events')),
      live.length ? h('div', { class: 'live-events' },
        h('h3', {}, 'Happening now'),
        h('ul', { class: 'plain' }, live.map((e) => h('li', {}, `${e.icon} ${e.title}`, h('span', { class: 'muted small' }, ` · ${duration(e.remaining)} left`))))) : null,
      h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter news' }, FILTERS.map((f) => button(f.label, () => ctx.openPanel('news', { filter: f.id }), { class: `btn small ${filter === f.id ? 'primary' : 'ghost'}` }))),
      entries.length
        ? h('ul', { class: 'plain log' }, entries.map((e) => h('li', { class: `log-${e.kind}` },
          h('span', { class: 'log-icon', 'aria-hidden': 'true' }, e.icon || '•'),
          h('div', {}, h('div', {}, e.text), h('div', { class: 'muted small' }, `Week ${week(e.t)} · ${shortTime(state, hub, e.t)}`)))))
        : h('p', { class: 'muted' }, 'Nothing here yet.'));
  },
  liveKey(ctx, params) {
    return `${params.filter || ''}#${ctx.state.log.length}#${ctx.state.log[ctx.state.log.length - 1]?.t ?? 0}#${ctx.state.activeEvents.length}`;
  },
};
