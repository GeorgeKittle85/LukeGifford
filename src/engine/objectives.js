// Win / lose conditions.
//   Win:  $10M cash, or top airline (most passengers that week) on 5 routes.
//   Lose: cash below $0 at two weekly settlements in a row.

import { MIN_TOP_ROUTE_PAX, TOP_ROUTE_SHARE, WIN_CASH, WIN_TOP_ROUTES } from './constants.js';
import { addLog, fmtMoney } from './log.js';
import { weekIndex } from './time.js';

// standing: { list: [{ airlineId, pax }] sorted by pax desc, others, total }
// where `others` are travelers on connecting itineraries / unmodeled carriers.
export function topAirline(standing) {
  if (!standing || !standing.list.length) return null;
  const [first, second] = standing.list;
  if (first.pax < MIN_TOP_ROUTE_PAX) return null;
  if (second && second.pax >= first.pax) return null;
  if (first.pax < TOP_ROUTE_SHARE * standing.total) return null;
  return first.airlineId;
}

export function topRouteCount(standings, airlineId) {
  let n = 0;
  for (const key in standings) if (topAirline(standings[key]) === airlineId) n++;
  return n;
}

function setOutcome(state, out, outcome) {
  state.outcome = { ...outcome, t: state.now, week: weekIndex(state.now - 1) };
  out.push({ type: 'outcome', outcome: state.outcome });
}

export function checkCashWin(state, out) {
  if (state.outcome) return;
  const human = state.airlines[state.humanAirlineId];
  if (human.cash >= WIN_CASH) {
    setOutcome(state, out, { result: 'won', reason: 'cash', text: `You reached ${fmtMoney(WIN_CASH)} in cash. Dynasty secured!` });
    addLog(state, out, { text: `Victory! ${human.name} hit ${fmtMoney(WIN_CASH)} in cash.`, icon: '🏆', kind: 'outcome', important: true });
  }
}

export function checkWeeklyObjectives(state, out) {
  const human = state.airlines[state.humanAirlineId];
  const tops = topRouteCount(state.standings, human.id);
  if (!state.outcome && tops >= WIN_TOP_ROUTES) {
    setOutcome(state, out, { result: 'won', reason: 'routes', text: `You are the top airline on ${tops} routes. Nobody can cover you!` });
    addLog(state, out, { text: `Victory! ${human.name} leads ${tops} routes.`, icon: '🏆', kind: 'outcome', important: true });
  }
  checkCashWin(state, out);

  if (human.cash < 0) {
    if (human.warning) {
      setOutcome(state, out, { result: 'lost', reason: 'bankrupt', text: `${human.name} ran out of money two weeks in a row and has filed for bankruptcy.` });
      addLog(state, out, { text: `${human.name} is bankrupt.`, icon: '💀', kind: 'outcome', important: true });
    } else {
      human.warning = true;
      addLog(state, out, { text: `Cash is negative (${fmtMoney(human.cash)}). Get back above $0 by next week or the airline goes bankrupt!`, icon: '⚠', kind: 'warning', important: true });
    }
  } else {
    human.warning = false;
  }
}
