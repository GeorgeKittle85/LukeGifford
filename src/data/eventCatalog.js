// Random events. Each weekly settlement rolls a handful of these; storms are
// also rolled daily per airport based on the season (see airports.js weather).
// Ranges are [min, max] and rolled uniformly.

export const EVENT_TYPES = {
  storm: {
    icon: '⛈', scope: 'airport', weight: 0, // weather is rolled daily, not from the weekly deck
    durationHours: [10, 40],
  },
  fuelSpike: {
    icon: '⛽', scope: 'global', weight: 1.0, durationDays: [7, 21], fuelMult: [1.1, 1.3],
    title: 'Fuel price spike',
    text: 'The defense is stacking the box: refinery outages push jet fuel up {pct}.',
  },
  fuelDrop: {
    icon: '🛢', scope: 'global', weight: 0.8, durationDays: [7, 28], fuelMult: [0.8, 0.92],
    title: 'Fuel prices ease',
    text: 'A crude glut drops jet fuel {pct}. Enjoy the open field.',
  },
  travelSurge: {
    icon: '🧳', scope: 'airport', weight: 1.0, durationDays: [4, 10], demandMult: [1.2, 1.45],
    title: 'Travel surge in {city}',
    text: 'A festival and a heat wave of bookings: demand to and from {city} is up {pct}.',
  },
  conference: {
    icon: '🎤', scope: 'airport', weight: 0.6, durationDays: [3, 6], demandMult: [1.25, 1.5],
    title: 'Big conference in {city}',
    text: 'A major industry conference fills hotels in {city}. Business demand is up {pct}.',
  },
  bigGame: {
    icon: '🏈', scope: 'airport', weight: 0.25, durationDays: [3, 5], demandMult: [1.6, 1.9],
    title: 'The Big Game comes to {city}',
    text: 'Championship weekend in {city}! Fans flood in. Demand up {pct}.',
  },
  slowdown: {
    icon: '📉', scope: 'global', weight: 0.35, durationDays: [21, 42], demandMult: [0.88, 0.95],
    title: 'Economic slowdown',
    text: 'Consumers tighten their belts. Network-wide demand falls {pct}.',
  },
  atc: {
    icon: '🗼', scope: 'global', weight: 0.5, durationDays: [2, 6], delayMult: [1.5, 2.2],
    title: 'Air traffic control staffing shortage',
    text: 'Short-staffed towers mean flow control everywhere. Expect delays.',
  },
  feeHike: {
    icon: '🧾', scope: 'airport', weight: 0.4, durationDays: [21, 42], feeMult: [1.2, 1.4],
    title: '{city} raises airport fees',
    text: 'The airport authority in {city} hikes landing and handling fees {pct}.',
  },
  mechanical: {
    icon: '🔧', scope: 'plane', weight: 0.8, groundedHours: [24, 72], cost: [60_000, 240_000],
    title: 'Aircraft grounded',
    text: '{tail} is grounded for unscheduled repairs ({hours}h, {cost}).',
  },
  fareWar: {
    icon: '⚔', scope: 'route', weight: 0.6, durationDays: [10, 21], fareCut: [0.7, 0.82],
    title: 'Fare war on {route}',
    text: '{rival} slashes fares on {route} by {pct}. Hold the line or match them?',
  },
  viral: {
    icon: '📣', scope: 'airline', weight: 0.3, rep: [3, 6],
    title: 'You went viral!',
    text: "A gate agent's touchdown spike celebration after an on-time departure goes viral. Reputation +{rep}.",
  },
};

// Events that ask the player to choose. Unanswered decisions resolve to the
// first option after `expiresDays`.
export const DECISION_TYPES = {
  unionRaise: {
    icon: '🤝', weight: 0.5, minWeek: 4, expiresDays: 5,
    title: 'Crew union asks for a raise',
    text: 'Pilots and flight attendants want an 8% raise. Accepting raises crew costs for good but boosts morale. Refusing risks a strike.',
    options: [
      { id: 'accept', label: 'Accept the raise (+8% crew cost, +3 reputation)' },
      { id: 'refuse', label: 'Refuse (40% chance of a 2-day strike, -6 reputation)' },
    ],
  },
  charter: {
    icon: '🏟', weight: 0.6, minWeek: 2, expiresDays: 3,
    title: 'Charter request',
    text: 'A college football team wants to charter one of your planes for a road game. They pay {amount}, but {tail} will be away for 2 days.',
    options: [
      { id: 'decline', label: 'Decline politely' },
      { id: 'accept', label: 'Accept the charter (+{amount})' },
    ],
  },
  sponsorship: {
    icon: '🎨', weight: 0.4, minWeek: 3, expiresDays: 4,
    title: 'Livery sponsorship offer',
    text: 'An energy-drink brand offers {amount} to paint one plane in neon green. Some passengers will find it tacky.',
    options: [
      { id: 'decline', label: 'Decline (keep the classy look)' },
      { id: 'accept', label: 'Take the money (+{amount}, -2 reputation)' },
    ],
  },
  fuelHedge: {
    icon: '🏦', weight: 0.5, minWeek: 2, expiresDays: 4,
    title: 'Fuel hedge offer',
    text: 'A bank offers to lock your fuel price at {price}/gal for 8 weeks for a {amount} fee. A hedge protects you from spikes but costs you if prices fall.',
    options: [
      { id: 'decline', label: 'Decline, ride the market' },
      { id: 'accept', label: 'Lock it in (fee {amount})' },
    ],
  },
};
