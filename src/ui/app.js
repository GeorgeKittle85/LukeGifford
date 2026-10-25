// App shell: wires the host, the map, the top bar, the side panel and the
// dialogs together. The UI only reads state and sends commands via the host.

import { AIRCRAFT } from '../data/aircraft.js';
import { AIRPORT_BY_CODE } from '../data/airports.js';
import { stormAt } from '../engine/modifiers.js';
import { getPair } from '../engine/network.js';
import { airlineDot } from './components.js';
import { button, clear, h } from './dom.js';
import { duration, money, shortTime } from './format.js';
import { installEasterEggs } from './easterEggs.js';
import { installKeyboard } from './keyboard.js';
import { createMapView } from './map/mapView.js';
import {
  decisionModal, helpModal, modalOpen, newGameModal, outcomeModal, plannerModal, savesModal, settingsModal, weeklyReportModal,
} from './modals.js';
import { createTopbar } from './topbar.js';
import { financePanel } from './panels/finance.js';
import { fleetPanel } from './panels/fleet.js';
import { marketPanel } from './panels/market.js';
import { newsPanel } from './panels/news.js';
import { rivalsPanel } from './panels/rivals.js';
import { routesPanel } from './panels/routes.js';
import { upgradesPanel } from './panels/upgrades.js';

const PANELS = [routesPanel, fleetPanel, marketPanel, financePanel, upgradesPanel, rivalsPanel, newsPanel];
const PREFS_KEY = 'kittle-skies:prefs';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

export function createApp(root, { host, storagePersistent }) {
  const prefs = { autoPauseWeekly: true, autoPauseDecisions: true, showRivals: true, showRivalRoutes: false, showNight: true, ...loadPrefs() };
  host.setSetting('autoPauseWeekly', prefs.autoPauseWeekly);
  host.setSetting('autoPauseDecisions', prefs.autoPauseDecisions);

  let activePanel = 'routes';
  let panelParams = {};
  let lastKey = '';
  let interacting = false;
  const modalQueue = [];
  const openModals = [];

  // ---- context shared with panels and modals -------------------------------
  const ctx = {
    host,
    storagePersistent,
    get state() { return host.state; },
    get me() { return host.state.airlines[host.state.humanAirlineId]; },
    run(command) {
      const res = host.dispatch(command);
      if (!res.ok) toast(res.error, 'error');
      return res;
    },
    toast: (text, kind) => toast(text, kind),
    openPanel(id, params = {}) {
      activePanel = id;
      panelParams = params;
      renderPanel(true);
    },
    openPlanner(opts) { track(plannerModal(ctx, opts || {})); },
    openMenu(which) { openMenu(which); },
    setSetting(key, value) {
      host.setSetting(key, value);
      prefs[key] = value;
      savePrefs(prefs);
    },
    setMapOption(key, value) {
      map.setOption(key, value, host.state);
      if (key !== 'kittleMode') {
        prefs[key] = value;
        savePrefs(prefs);
      }
    },
    closeTopModal() { openModals.pop()?.close(); },
    closeAllModals() { while (openModals.length) openModals.pop().close(); },
    map: null,
  };

  function track(modal) {
    openModals.push(modal);
    const original = modal.close;
    modal.close = () => {
      const i = openModals.indexOf(modal);
      if (i >= 0) openModals.splice(i, 1);
      original();
    };
    return modal;
  }

  // ---- layout ---------------------------------------------------------------
  const topbar = createTopbar(ctx, { onMenu: (w) => openMenu(w) });
  const mapEl = h('div', { id: 'map', class: 'map', role: 'application', 'aria-label': 'World map with airports and flights' });
  const netBadge = h('div', { class: 'net-badge', hidden: true }, 'Offline map: showing built-in outlines');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panelBody = h('div', { class: 'panel-body', role: 'tabpanel' });
  const panel = h('aside', { class: 'panel', 'aria-label': 'Airline management' }, tabs, panelBody);
  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  clear(root).append(topbar.el, h('main', { class: 'layout' }, h('div', { class: 'map-wrap' }, mapEl, netBadge), panel), toasts);

  for (const p of PANELS) {
    tabs.append(button(h('span', {}, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, p.icon), h('span', { class: 'tab-label' }, p.label)), () => ctx.openPanel(p.id, {}), {
      class: 'tab', role: 'tab', dataset: { panel: p.id }, title: `${p.label} (${p.hotkey.toUpperCase()})`,
    }));
  }

  panel.addEventListener('pointerdown', () => { interacting = true; });
  window.addEventListener('pointerup', () => { setTimeout(() => { interacting = false; }, 150); });

  // ---- map ----------------------------------------------------------------
  const map = createMapView(mapEl, {
    renderAirportPopup,
    renderFlightPopup,
    onNetworkStatus: (status) => { netBadge.hidden = status !== 'offline'; },
  });
  ctx.map = map;
  for (const key of ['showRivals', 'showRivalRoutes', 'showNight']) map.setOption(key, prefs[key]);
  new ResizeObserver(() => map.invalidate()).observe(mapEl);

  function renderAirportPopup(code) {
    const state = host.state;
    const me = ctx.me;
    const ap = AIRPORT_BY_CODE[code];
    const isHub = me.hubs.includes(code);
    const rivals = Object.values(state.airlines).filter((a) => a.controller === 'ai' && a.hubs.includes(code));
    const storm = stormAt(state, code);
    const actions = [];
    if (!isHub) {
      for (const hub of me.hubs) {
        const existing = Object.values(state.routes).find((r) => r.airlineId === me.id && r.pair === getPair(hub, code).key);
        actions.push(existing
          ? button(`Manage ${hub}–${code}`, () => { map.map.closePopup(); ctx.openPanel('routes', { routeId: existing.id }); }, { class: 'btn small' })
          : button(`Plan ${hub} → ${code}`, () => { map.map.closePopup(); ctx.openPlanner({ from: hub, to: code }); }, { class: 'btn small primary' }));
      }
    } else {
      actions.push(button('Plan a route from here', () => { map.map.closePopup(); ctx.openPlanner({ from: code }); }, { class: 'btn small primary' }));
    }
    actions.push(button('Explore market', () => { map.map.closePopup(); ctx.openPanel('market', { origin: code }); }, { class: 'btn small ghost' }));
    return h('div', { class: 'popup' },
      h('div', { class: 'popup-title' }, `${ap.code} · ${ap.city}`),
      h('div', { class: 'muted small' }, ap.name),
      h('div', { class: 'small' }, `Local time ${shortTime(state, code, state.now)}`),
      isHub ? h('div', { class: 'tag tag-easy' }, 'Your hub') : null,
      rivals.length ? h('div', { class: 'small' }, 'Rival hub: ', rivals.map((r) => [airlineDot(r.color), ` ${r.name} `])) : null,
      storm ? h('div', { class: 'small warn' }, `⛈ ${storm.title} (${duration(storm.endT - state.now)} left)`) : null,
      h('div', { class: 'popup-actions' }, actions));
  }

  function renderFlightPopup(flightId) {
    const state = host.state;
    const f = state.flights[flightId];
    if (!f) return h('div', { class: 'popup' }, 'This flight has landed.');
    const airline = state.airlines[f.airlineId];
    const type = AIRCRAFT[f.type];
    const plane = state.planes[f.planeId];
    return h('div', { class: 'popup' },
      h('div', { class: 'popup-title' }, airlineDot(airline.color), ` ${f.flightNo} · ${f.from} → ${f.to}`),
      h('div', { class: 'muted small' }, `${airline.name} · ${type.name}${plane ? ` · ${plane.tail}` : ''}`),
      f.ferry ? h('div', { class: 'small' }, 'Repositioning flight (no passengers)') : h('div', { class: 'small' }, `${f.pax} of ${type.seats} seats filled · fare $${Math.round(f.fare)}`),
      h('div', { class: 'small' }, `Departed ${shortTime(state, f.from, f.depT)}${f.delay >= 15 ? ` (${duration(f.delay)} late)` : ''} · lands ${shortTime(state, f.to, f.arrT)}`),
      f.airlineId === ctx.me.id ? h('div', { class: 'small pos' }, `Ticket revenue ${money(f.revenue)}`) : null);
  }

  // ---- panel rendering --------------------------------------------------------
  function renderPanel(force = false) {
    if (!host.state) return;
    const def = PANELS.find((p) => p.id === activePanel) || PANELS[0];
    const key = def.liveKey(ctx, panelParams);
    if (!force) {
      if (key === lastKey) return;
      const focused = panelBody.contains(document.activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
      if (interacting || focused) return;
    }
    lastKey = key;
    for (const t of tabs.children) {
      const on = t.dataset.panel === def.id;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    }
    const scroll = force ? 0 : panelBody.scrollTop;
    try {
      clear(panelBody).append(def.render(ctx, panelParams));
    } catch (err) {
      console.error(err);
      clear(panelBody).append(h('p', { class: 'neg' }, `Something went wrong drawing this tab: ${err.message}`));
    }
    panelBody.scrollTop = scroll;
  }

  // ---- toasts -----------------------------------------------------------------
  function toast(text, kind = 'info') {
    const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
    toasts.append(t);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => t.classList.add('leaving'), kind === 'error' ? 5000 : 4000);
    setTimeout(() => t.remove(), kind === 'error' ? 5600 : 4600);
  }

  // ---- dialogs -------------------------------------------------------------------
  function enqueue(open) {
    modalQueue.push(open);
    pumpModals();
  }

  function pumpModals() {
    if (modalOpen() || !modalQueue.length) return;
    const open = modalQueue.shift();
    const modal = open();
    if (modal) track(modal);
  }

  function openMenu(which) {
    if (which === 'saves') track(savesModal(ctx));
    else if (which === 'settings') track(settingsModal(ctx));
    else if (which === 'help') track(helpModal());
    else if (which === 'new') {
      host.pause();
      track(newGameModal(ctx));
    }
  }

  // A decision may wait in the queue behind the weekly report (whose "Back to
  // work" resumes the clock), so pause again when it actually opens.
  function showDecision(decision) {
    if (!host.state.decisions.some((x) => x.id === decision.id)) return null; // already resolved
    if (host.settings.autoPauseDecisions) host.pause();
    return decisionModal(ctx, decision);
  }

  function handleNotes(notes) {
    for (const n of notes) {
      if (n.type === 'log' && n.important) toast(`${n.entry.icon ? `${n.entry.icon} ` : ''}${n.entry.text}`);
      else if (n.type === 'weekReport' && host.settings.autoPauseWeekly) enqueue(() => weeklyReportModal(ctx, n.report, { onClose: () => setTimeout(pumpModals, 0) }));
      else if (n.type === 'weekReport') toast(`Week ${n.week}: operating profit ${money(n.report.operatingProfit, { sign: true })}`);
      else if (n.type === 'decision') {
        const d = host.state.decisions.find((x) => x.id === n.decisionId);
        if (d) enqueue(() => showDecision(d));
      } else if (n.type === 'outcome') enqueue(() => outcomeModal(ctx, n.outcome));
    }
  }

  // ---- host events ------------------------------------------------------------
  host.subscribe((event) => {
    switch (event.type) {
      case 'loaded':
        ctx.closeAllModals();
        modalQueue.length = 0;
        map.rebuild(host.state);
        map.focusAirport(ctx.me.hubs[0], 4);
        activePanel = 'routes';
        panelParams = {};
        renderPanel(true);
        topbar.update();
        if (event.reason === 'new' && !host.state.history.length) {
          toast(`Welcome to ${ctx.me.name}! Open your first route from ${ctx.me.hubs[0]}, then press ▶ (1x or faster).`);
        }
        if (host.state.outcome && !host.state.dynasty) enqueue(() => outcomeModal(ctx, host.state.outcome));
        for (const d of host.state.decisions) enqueue(() => showDecision(d));
        break;
      case 'changed':
        map.refreshRoutes(host.state);
        renderPanel(true);
        break;
      case 'notes':
        handleNotes(event.notes);
        if (event.notes.some((n) => n.type === 'log' && ['route', 'fleet', 'upgrade'].includes(n.entry.kind))) map.refreshRoutes(host.state);
        break;
      case 'error':
        toast(event.message, 'error');
        break;
      default:
        break;
    }
  });

  // ---- render loop --------------------------------------------------------------
  let lastPanelCheck = 0;
  let lastTopbar = 0;
  host.subscribe((event) => {
    if (event.type !== 'frame' || !host.state) return;
    map.frame(host.state);
    const now = performance.now();
    if (now - lastTopbar > 100) {
      topbar.update();
      lastTopbar = now;
    }
    if (now - lastPanelCheck > 500) {
      renderPanel(false);
      pumpModals();
      lastPanelCheck = now;
    }
  });

  installKeyboard(ctx, PANELS);
  installEasterEggs(ctx, topbar.brand);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && host.state) host.saveSlot('auto');
  });

  return {
    ctx,
    async boot() {
      const saves = await host.listSaves();
      const auto = saves.find((s) => s.slot === 'auto' && s.meta);
      host.start();
      const continueGame = async () => {
        try {
          await host.loadSlot('auto');
        } catch (err) {
          toast(`Could not load the autosave: ${err.message}`, 'error');
          track(newGameModal(ctx));
        }
      };
      track(newGameModal(ctx, auto ? { continueMeta: auto.meta, onContinue: continueGame } : {}));
    },
  };
}
