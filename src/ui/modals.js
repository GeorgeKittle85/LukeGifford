// Modal dialogs: new game, weekly report, decisions, outcome, route planner,
// saves, settings and help.

import { AIRCRAFT, AIRCRAFT_ORDER, leaseDeposit } from '../data/aircraft.js';
import { AIRPORTS } from '../data/airports.js';
import { DIFFICULTIES } from '../data/rivals.js';
import { LOYALTY, WIN_CASH, WIN_TOP_ROUTES } from '../engine/constants.js';
import { canFly, getPair } from '../engine/network.js';
import { eligibleTypesFor, pairInfo, planesOf, suggestFare } from '../engine/selectors.js';
import { airlineDot, airportOption, fareControl, planeName } from './components.js';
import { button, clear, h, select } from './dom.js';
import { miles, money, num, pct } from './format.js';

let openCount = 0;

export function showModal({ title, content, actions = [], className = '', dismissable = true, onClose }) {
  const root = document.getElementById('modal-root');
  const previouslyFocused = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    openCount--;
    document.body.classList.toggle('modal-open', openCount > 0);
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    previouslyFocused?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation();
      close();
    }
  };
  const footer = actions.length
    ? h('div', { class: 'modal-actions' }, actions.map((a) => button(a.label, () => {
      const keep = a.onClick?.(close);
      if (keep !== true && a.close !== false) close();
    }, { class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, disabled: a.disabled })))
    : null;
  const dialog = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      h('h2', {}, title),
      dismissable ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕') : null),
    h('div', { class: 'modal-body' }, content),
    footer);
  const overlay = h('div', { class: 'modal-overlay', onmousedown: (e) => { if (e.target === overlay && dismissable) close(); } }, dialog);
  root.append(overlay);
  openCount++;
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => dialog.querySelector('input, select, .btn.primary, button')?.focus());
  return { close, dialog };
}

export function modalOpen() {
  return openCount > 0;
}

// ---------------------------------------------------------------------------
// New game

const HUB_NOTES = {
  ATL: { tag: 'Easy', note: 'No rival hub. Room to grow in the Southeast.' },
  JFK: { tag: 'Medium', note: 'Huge markets and a gateway to London, but Gridiron Global is based here.' },
  SFO: { tag: 'Medium', note: 'Tech money, Pacific gateway. The Kittle classic.' },
  LAX: { tag: 'Easy', note: 'Massive leisure demand; Gridiron Global runs a hub here too.' },
  ORD: { tag: 'Medium', note: "Central and busy. Gridiron Global's home base." },
  DFW: { tag: 'Medium', note: "Red Zone Airlines' home turf. Long legs to everywhere." },
  SEA: { tag: 'Medium', note: "Pacific Pylon's home. Smaller market, long routes." },
  DEN: { tag: 'Hard', note: "Blitz Air's fortress of cheap fares. Brave choice." },
};

export function newGameModal(ctx, { continueMeta, onContinue } = {}) {
  let hub = 'SFO';
  let difficulty = 'pro';
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const nameInput = h('input', { type: 'text', value: 'Kittle Skies', maxlength: 40, 'aria-label': 'Airline name' });
  const dateInput = h('input', { type: 'date', value: iso, 'aria-label': 'Start date' });
  const hubGrid = h('div', { class: 'hub-grid', role: 'radiogroup', 'aria-label': 'Starting hub' });
  const renderHubs = () => {
    clear(hubGrid);
    for (const ap of AIRPORTS.filter((a) => a.country === 'US')) {
      const info = HUB_NOTES[ap.code];
      hubGrid.append(h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': hub === ap.code ? 'true' : 'false',
        class: `hub-card${hub === ap.code ? ' selected' : ''}`,
        onclick: () => { hub = ap.code; renderHubs(); },
      },
      h('div', { class: 'hub-card-top' }, h('strong', {}, ap.code), h('span', { class: `tag tag-${info.tag.toLowerCase()}` }, info.tag)),
      h('div', { class: 'hub-city' }, ap.city),
      h('div', { class: 'muted small' }, info.note)));
    }
  };
  renderHubs();
  const diffSelect = select(Object.values(DIFFICULTIES).map((d) => ({ value: d.id, label: `${d.label}: ${d.blurb}` })), difficulty, (v) => { difficulty = v; });

  const content = h('div', { class: 'new-game' },
    h('p', { class: 'lead' }, 'You start with one leased Embraer E175, one hub airport, and $1,000,000. Open routes, set fares, lease bigger jets, and grow without going bankrupt.'),
    h('p', { class: 'muted' }, `Win by reaching ${money(WIN_CASH)} in cash, or by becoming the top airline on ${WIN_TOP_ROUTES} routes. Every week is a turn; 1 real minute = 30 game minutes at 1x speed.`),
    h('div', { class: 'form-row' }, h('label', {}, 'Airline name', nameInput), h('label', {}, 'Start date', dateInput)),
    h('h3', {}, 'Choose your hub'),
    hubGrid,
    h('div', { class: 'form-row' }, h('label', {}, 'Difficulty', diffSelect)),
    continueMeta ? h('p', { class: 'muted small' }, `Saved game found: ${continueMeta.airlineName}, week ${continueMeta.week}, ${money(continueMeta.cash)} cash.`) : null);

  const actions = [];
  if (continueMeta) actions.push({ label: 'Continue saved game', onClick: () => onContinue?.() });
  actions.push({
    label: 'Start airline',
    primary: true,
    onClick: () => {
      ctx.host.newGame({
        seed: `ks-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        startDate: /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) ? dateInput.value : iso,
        airlineName: nameInput.value.trim() || 'Kittle Skies',
        hub,
        difficulty,
      });
    },
  });
  return showModal({ title: 'Kittle Skies: new airline', content, actions, className: 'wide', dismissable: Boolean(ctx.state) });
}

// ---------------------------------------------------------------------------
// Weekly report

function tipsFor(ctx, report) {
  const tips = [];
  const state = ctx.state;
  const idle = planesOf(state, ctx.me.id).filter((p) => p.status === 'idle' && !p.routeId);
  if (idle.length) tips.push(`${idle.length} plane${idle.length > 1 ? 's are' : ' is'} sitting idle. Idle jets still cost lease money: assign ${idle.length > 1 ? 'them' : 'it'} to a route.`);
  for (const r of report.routes) {
    if (r.legs === 0) continue;
    if (r.loadFactor < 0.6) tips.push(`${r.a}–${r.b} flew only ${pct(r.loadFactor)} full. Try a lower fare or a smaller plane.`);
    else if (r.loadFactor > 0.96 && r.profit > 0) tips.push(`${r.a}–${r.b} is packed (${pct(r.loadFactor)}). You can probably raise the fare or add capacity.`);
  }
  if (report.reputation < 45) tips.push('Reputation is slipping. Better service, premium maintenance or less overbooking will help.');
  if (report.operatingProfit < 0 && report.cash < -report.operatingProfit * 3) tips.push('At this burn rate you have only a few weeks of cash left. Cut losing routes or return idle planes.');
  return tips.slice(0, 4);
}

export function weeklyReportModal(ctx, report, { onClose } = {}) {
  const c = report.costs;
  const rows = [
    ['Ticket revenue', report.revenue],
    ['Fuel', -c.fuel], ['Crew', -c.crew], ['Maintenance', -c.maintenance], ['Ground ops & insurance', -c.ops],
    ['Airport fees', -c.airport], ['Service & catering', -c.service], ['Sales & distribution', -c.distribution],
    ['Compensation & repairs', -(c.compensation + c.other)],
    ['Aircraft leases', -c.leases], ['Overhead', -c.overhead], ['Extra hubs', -c.hubs], ['Loyalty program', -c.loyalty],
  ].filter(([, v]) => Math.abs(v) >= 1);
  const tips = tipsFor(ctx, report);
  const autoPause = h('input', { type: 'checkbox', checked: ctx.host.settings.autoPauseWeekly, onchange: (e) => ctx.setSetting('autoPauseWeekly', e.target.checked) });

  const content = h('div', { class: 'report' },
    h('div', { class: 'stat-row' },
      h('div', { class: 'hero' }, h('div', { class: 'stat-label' }, 'Operating profit'), h('div', { class: `hero-value ${report.operatingProfit >= 0 ? 'pos' : 'neg'}` }, money(report.operatingProfit, { sign: true }))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Cash'), h('div', { class: 'stat-value' }, money(report.cash))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Passengers'), h('div', { class: 'stat-value' }, num(report.pax))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Load factor'), h('div', { class: 'stat-value' }, pct(report.loadFactor))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'On time'), h('div', { class: 'stat-value' }, pct(report.onTimeRate))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Reputation'), h('div', { class: 'stat-value' }, `${report.reputation.toFixed(0)} (${report.repChange >= 0 ? '+' : ''}${report.repChange.toFixed(1)})`))),
    tips.length ? h('div', { class: 'tips' }, h('h3', {}, 'Coach\'s notes'), h('ul', {}, tips.map((t) => h('li', {}, t)))) : null,
    h('div', { class: 'report-cols' },
      h('div', {},
        h('h3', {}, 'Profit & loss'),
        h('table', { class: 'table' }, h('tbody', {}, rows.map(([label, v]) => h('tr', {}, h('td', {}, label), h('td', { class: `num ${v < 0 ? 'neg' : ''}` }, money(v))))),
          h('tfoot', {}, h('tr', {}, h('th', {}, 'Operating profit'), h('th', { class: `num ${report.operatingProfit < 0 ? 'neg' : 'pos'}` }, money(report.operatingProfit, { sign: true }))))),
        report.oneOff.items.length ? h('div', { class: 'muted small' }, 'One-off items (not in operating profit): ', report.oneOff.items.map((i) => `${i.label} ${money(i.amount, { sign: true })}`).join(' · ')) : null),
      h('div', {},
        h('h3', {}, 'Routes'),
        report.routes.length
          ? h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Route'), h('th', { class: 'num' }, 'Pax'), h('th', { class: 'num' }, 'Full'), h('th', { class: 'num' }, 'Profit'), h('th', { class: 'num' }, 'Share'))),
            h('tbody', {}, report.routes.map((r) => h('tr', {},
              h('td', {}, `${r.a}–${r.b}`, r.top ? h('span', { class: 'badge', title: 'Top airline on this route' }, ' 🏆') : null),
              h('td', { class: 'num' }, num(r.pax)),
              h('td', { class: 'num' }, r.legs ? pct(r.loadFactor) : '—'),
              h('td', { class: `num ${r.profit < 0 ? 'neg' : 'pos'}` }, money(r.profit, { sign: true })),
              h('td', { class: 'num' }, pct(r.share))))))
          : h('p', { class: 'muted' }, 'No routes yet. Open one from the Routes tab.'),
        report.events?.length ? h('div', {}, h('h3', {}, 'This week'), h('ul', { class: 'plain' }, report.events.map((e) => h('li', {}, `${e.icon} ${e.title}`)))) : null)),
    h('label', { class: 'check' }, autoPause, ' Pause the game for each weekly report'));

  return showModal({
    title: `Week ${report.week} report`,
    content,
    className: 'wide',
    onClose,
    actions: [{ label: 'Back to work', primary: true, onClick: () => ctx.host.resume() }],
  });
}

// ---------------------------------------------------------------------------
// Decisions and outcome

export function decisionModal(ctx, decision) {
  return showModal({
    title: `${decision.icon} ${decision.title}`,
    content: h('div', {}, h('p', {}, decision.text), h('p', { class: 'muted small' }, 'If you don\'t answer in a few days, the first option is chosen for you.')),
    dismissable: true,
    actions: decision.options.map((o, i) => ({
      label: o.label,
      primary: i === decision.options.length - 1,
      onClick: () => {
        const res = ctx.run({ type: 'RESOLVE_DECISION', decisionId: decision.id, optionId: o.id });
        if (res.ok) ctx.host.resume();
      },
    })),
  });
}

export function outcomeModal(ctx, outcome) {
  const won = outcome.result === 'won';
  return showModal({
    title: won ? '🏆 Dynasty secured!' : 'Grounded for good',
    content: h('div', { class: 'outcome' },
      h('p', { class: 'lead' }, outcome.text),
      h('p', { class: 'muted' }, won
        ? `You did it in week ${outcome.week}. Like a reliable tight end, you built it one first down at a time. Keep playing to grow your dynasty, or start a new airline.`
        : 'Every great franchise has a rebuilding year. Load a save or start a new airline.')),
    dismissable: false,
    actions: won
      ? [
        { label: 'New airline', onClick: () => newGameModal(ctx) },
        { label: 'Keep playing', primary: true, onClick: () => { ctx.run({ type: 'CONTINUE_DYNASTY' }); ctx.host.resume(); } },
      ]
      : [
        { label: 'Load a save', onClick: () => savesModal(ctx) },
        { label: 'New airline', primary: true, onClick: () => newGameModal(ctx) },
      ],
  });
}

// ---------------------------------------------------------------------------
// Route planner

export function plannerModal(ctx, { from, to } = {}) {
  const me = ctx.me;
  let a = from && me.hubs.includes(from) ? from : me.hubs[0];
  let b = to && to !== a ? to : AIRPORTS.find((ap) => ap.code !== a).code;
  if (from && to && me.hubs.includes(to) && !me.hubs.includes(from)) { a = to; b = from; }
  let chosen = new Set();
  let leaseType = '';
  let fareCtl = null;
  const body = h('div', { class: 'planner' });

  const idlePlanes = () => planesOf(ctx.state, me.id).filter((p) => !p.routeId && !p.pendingDisposal);

  const render = () => {
    clear(body);
    const existing = Object.values(ctx.state.routes).find((r) => r.airlineId === me.id && r.pair === getPair(a, b).key);
    const info = pairInfo(ctx.state, a, b);
    const eligible = eligibleTypesFor(a, b);
    const types = () => [...[...chosen].map((id) => ctx.state.planes[id]?.type).filter(Boolean), ...(leaseType ? [leaseType] : [])];

    body.append(
      h('div', { class: 'form-row' },
        h('label', {}, 'From (your hub)', select(me.hubs.map(airportOption), a, (v) => { a = v; if (b === a) b = AIRPORTS.find((x) => x.code !== a).code; chosen = new Set(); render(); })),
        h('label', {}, 'To', select(AIRPORTS.filter((x) => x.code !== a).map((x) => airportOption(x.code)), b, (v) => { b = v; chosen = new Set(); render(); }))),
      h('div', { class: 'pair-facts' },
        h('div', {}, h('span', { class: 'muted' }, 'Distance '), h('strong', {}, miles(info.distance))),
        h('div', {}, h('span', { class: 'muted' }, 'Demand '), h('strong', {}, info.demandLabel)),
        h('div', {}, h('span', { class: 'muted' }, 'Competition '), h('strong', {}, info.competition.label)),
        h('div', {}, h('span', { class: 'muted' }, 'Typical fare '), h('strong', {}, money(info.refFare)))),
      info.offers.length
        ? h('table', { class: 'table compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Airline'), h('th', { class: 'num' }, 'Fare'), h('th', { class: 'num' }, 'Flights/wk'), h('th', { class: 'num' }, 'Seats/wk'))),
          h('tbody', {}, info.offers.map((o) => h('tr', {}, h('td', {}, airlineDot(o.color), ' ', o.name), h('td', { class: 'num' }, `$${Math.round(o.fare)}`), h('td', { class: 'num' }, num(o.legs)), h('td', { class: 'num' }, num(o.seats))))))
        : h('p', { class: 'muted small' }, 'No modeled airline flies this route yet. Open field!'),
    );

    if (existing) {
      body.append(h('p', { class: 'notice' }, 'You already fly this route. ', button('Open route', () => { ctx.closeTopModal(); ctx.openPanel('routes', { routeId: existing.id }); }, { class: 'btn small' })));
      return;
    }

    const planeList = h('div', { class: 'checklist' });
    const idle = idlePlanes();
    if (!idle.length) planeList.append(h('p', { class: 'muted small' }, 'You have no unassigned planes.'));
    for (const p of idle) {
      const ok = canFly(p.type, info.distance);
      planeList.append(h('label', { class: `check${ok ? '' : ' disabled'}` },
        h('input', { type: 'checkbox', disabled: !ok, checked: chosen.has(p.id), onchange: (e) => { if (e.target.checked) chosen.add(p.id); else chosen.delete(p.id); fareCtl?.setTypes(types()); } }),
        ` ${planeName(p)}`, ok ? '' : h('span', { class: 'muted small' }, ` (range ${num(AIRCRAFT[p.type].rangeMi)} mi)`)));
    }
    const leaseSelect = select([{ value: '', label: 'Don\'t lease a new plane' }, ...AIRCRAFT_ORDER.filter((t) => eligible.includes(t)).map((t) => ({
      value: t, label: `${AIRCRAFT[t].name}: ${money(leaseDeposit(t))} deposit`, disabled: me.cash < leaseDeposit(t),
    }))], leaseType, (v) => { leaseType = v; fareCtl?.setTypes(types()); });

    const initial = types().length ? suggestFare(ctx.state, me.id, a, b, types()) : Math.round(info.refFare);
    fareCtl = fareControl(ctx, { a, b, types: types(), fare: initial });
    body.append(
      h('h3', {}, 'Planes'), planeList,
      h('label', {}, 'Lease a new plane for this route (arrives in 2 days)', leaseSelect),
      h('h3', {}, 'Price'), fareCtl.el);
  };
  render();

  const modal = showModal({
    title: 'Plan a route',
    content: body,
    className: 'wide',
    actions: [
      { label: 'Cancel' },
      {
        label: 'Open route',
        primary: true,
        onClick: () => {
          const res = ctx.run({ type: 'OPEN_ROUTE', a, b, fare: fareCtl?.fare, planeIds: [...chosen] });
          if (!res.ok) return true;
          if (leaseType) ctx.run({ type: 'LEASE_PLANE', aircraftType: leaseType, location: a, routeId: res.routeId });
          ctx.toast(`Route ${a}–${b} is open.`);
          ctx.openPanel('routes', { routeId: res.routeId });
          return false;
        },
      },
    ],
  });
  return modal;
}

// ---------------------------------------------------------------------------
// Saves, settings, help

export function savesModal(ctx) {
  const body = h('div', { class: 'saves' });
  const render = async () => {
    const list = await ctx.host.listSaves();
    clear(body);
    body.append(h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Slot'), h('th', {}, 'Saved game'), h('th', {}, ''))),
      h('tbody', {}, list.map(({ slot, meta }) => h('tr', {},
        h('td', {}, slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(-1)}`),
        h('td', {}, meta ? `${meta.airlineName} · week ${meta.week} · ${money(meta.cash)}${meta.outcome ? ` · ${meta.outcome}` : ''}` : h('span', { class: 'muted' }, 'Empty'),
          meta?.savedAt ? h('div', { class: 'muted small' }, new Date(meta.savedAt).toLocaleString()) : null),
        h('td', { class: 'actions' },
          slot !== 'auto' && ctx.state ? button('Save here', async () => { await ctx.host.saveSlot(slot); ctx.toast('Game saved.'); render(); }, { class: 'btn small' }) : null,
          meta ? button('Load', async () => {
            try { await ctx.host.loadSlot(slot); ctx.closeAllModals(); ctx.toast('Game loaded.'); } catch (err) { ctx.toast(err.message, 'error'); }
          }, { class: 'btn small primary' }) : null))))));
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { ctx.host.importSave(await file.text()); ctx.closeAllModals(); ctx.toast('Save imported.'); } catch (err) { ctx.toast(err.message, 'error'); }
    } });
    body.append(h('div', { class: 'modal-inline-actions' },
      ctx.state ? button('Export save file', () => {
        const blob = new Blob([ctx.host.exportSave()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = h('a', { href: url, download: `kittle-skies-week${Math.floor(ctx.state.now / 10080) + 1}.json` });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, { class: 'btn' }) : null,
      button('Import save file', () => fileInput.click(), { class: 'btn' }),
      fileInput),
    ctx.storagePersistent ? null : h('p', { class: 'notice' }, 'Browser storage is unavailable (private mode?). Saves last only until you close this tab; use Export to keep them.'));
  };
  render();
  return showModal({ title: 'Save & load', content: body, actions: [{ label: 'Close' }] });
}

export function settingsModal(ctx) {
  const toggle = (label, checked, onChange) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), ` ${label}`);
  const content = h('div', { class: 'settings' },
    h('h3', {}, 'Game'),
    toggle('Pause for each weekly report', ctx.host.settings.autoPauseWeekly, (v) => ctx.setSetting('autoPauseWeekly', v)),
    toggle('Pause when a decision is needed', ctx.host.settings.autoPauseDecisions, (v) => ctx.setSetting('autoPauseDecisions', v)),
    h('h3', {}, 'Map'),
    toggle('Show rival planes', ctx.map.getOption('showRivals'), (v) => ctx.setMapOption('showRivals', v)),
    toggle('Show rival routes', ctx.map.getOption('showRivalRoutes'), (v) => ctx.setMapOption('showRivalRoutes', v)),
    toggle('Show day / night shading', ctx.map.getOption('showNight'), (v) => ctx.setMapOption('showNight', v)));
  return showModal({ title: 'Settings', content, actions: [{ label: 'Done', primary: true }] });
}

export function helpModal() {
  const content = h('div', { class: 'help' },
    h('h3', {}, 'The goal'),
    h('p', {}, `Grow from one jet and $1M to ${money(WIN_CASH)} in cash, or become the top airline on ${WIN_TOP_ROUTES} routes (most passengers that week and at least 40% of everyone flying the route). If cash is below $0 at two weekly settlements in a row, you go bankrupt.`),
    h('h3', {}, 'Time'),
    h('p', {}, 'The clock runs in real-ish time: at 1x, one real minute is 30 game minutes. Use the speed buttons (or keys 1–5, Space to pause) to fast-forward. Every Monday the week settles like a turn: leases and overhead are paid and you get a report.'),
    h('h3', {}, 'Routes & prices'),
    h('p', {}, 'Every route must start at one of your hubs. Higher fares earn more per seat but fill fewer seats: passengers = demand × (1 − fare / max fare), split with rivals and connecting carriers by price, frequency and reputation. The fare slider shows a live weekly estimate; "Use suggested fare" picks the most profitable price for your planes.'),
    h('h3', {}, 'Planes'),
    h('p', {}, 'Assigned planes shuttle back and forth all day, departing between 06:00 and midnight local time. Small jets are cheap but carry few people; big jets burn more fuel but rack up yards after the catch on busy routes. Leasing needs a two-month deposit; returning a plane refunds it minus a one-month fee.'),
    h('h3', {}, 'Reputation & events'),
    h('p', {}, 'Delays, cancellations and bumped passengers hurt reputation; on-time flights, better service and a loyalty program help. Low reputation lowers demand. Watch for storms, fuel spikes, holiday rushes and decisions that need your call.'),
    h('h3', {}, 'Upgrades'),
    h('p', {}, `Open more hubs (up to 3) to unlock new routes, launch a loyalty program (${money(LOYALTY.setupCost)}), or run ad campaigns.`),
    h('h3', {}, 'Keyboard'),
    h('p', {}, 'Space: pause/resume · 1–5: speed · R/F/M/$/U/V/N: switch tabs · P: plan a route · ?: help'));
  return showModal({ title: 'How to play', content, className: 'wide', actions: [{ label: 'Let\'s fly', primary: true }] });
}
