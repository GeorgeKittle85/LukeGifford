// Tuning knobs for the simulation. Balanced with scripts/balance-sim.mjs.

export const START_CASH = 1_000_000;
export const STARTER_AIRCRAFT = 'E175';
export const START_REPUTATION = 60;

export const WIN_CASH = 10_000_000;
export const WIN_TOP_ROUTES = 5;
// A "top airline" route must carry at least this many passengers that week.
export const MIN_TOP_ROUTE_PAX = 1000;
// ...and at least this share of everyone flying the route, including
// connecting itineraries and carriers that aren't modeled.
export const TOP_ROUTE_SHARE = 0.4;

export const MAX_HUBS = 3;
export const HUB_WEEKLY_UPKEEP = 85_000;

export const OVERHEAD_BASE = 25_000;
export const OVERHEAD_PER_PLANE = 5_000;

// Gravity-model scale: weekly two-way passengers at a fare of $0.
export const DEMAND_SCALE = 3500;

export const FUEL_START = 4.4; // USD/gal, Gulf Coast spot in Oct 2026
export const FUEL_MEAN = 4.0; // long-run level the weekly random walk reverts toward
export const FUEL_MIN = 2.2;
export const FUEL_MAX = 7.5;

export const SERVICE_LEVELS = {
  basic: { id: 'basic', label: 'Basic', perPax: 4, repTarget: 45, blurb: 'Buy-on-board snacks. Cheap, and passengers notice.' },
  standard: { id: 'standard', label: 'Standard', perPax: 9, repTarget: 58, blurb: 'Free snacks and drinks, friendly crews.' },
  premium: { id: 'premium', label: 'Premium', perPax: 20, repTarget: 72, blurb: 'Hot meals, extra legroom, lounge-style care.' },
};

export const MAINTENANCE_POLICIES = {
  budget: { id: 'budget', label: 'Budget', costMult: 0.78, delayMult: 1.6, blurb: 'Defer what you can. Cheaper, more delays.' },
  standard: { id: 'standard', label: 'Standard', costMult: 1.0, delayMult: 1.0, blurb: 'Follow the manual.' },
  premium: { id: 'premium', label: 'Premium', costMult: 1.3, delayMult: 0.6, blurb: 'Spare parts at every station. Rarely late.' },
};

export const OVERBOOKING_OPTIONS = [0, 0.05, 0.1, 0.15];
export const NO_SHOW_RANGE = [0.04, 0.1];
export const NO_SHOW_REVENUE_SHARE = 0.5; // non-refundable share kept from no-shows
export const BUMP_COMPENSATION = 450;
export const LONG_DELAY_COMP_PER_PAX = 60; // vouchers for 3h+ delays
export const DISTRIBUTION_COST_SHARE = 0.08; // card fees, booking systems, commissions

export const LOYALTY = {
  setupCost: 1_500_000,
  weeklyCost: 40_000,
  perPax: 2.5,
  shareBonus: 1.12,
  repBonus: 5,
};

export const CAMPAIGNS = {
  regional: { id: 'regional', label: 'Regional ad blitz', cost: 250_000, weeks: 3, demandMult: 1.08 },
  national: { id: 'national', label: 'National TV campaign', cost: 750_000, weeks: 4, demandMult: 1.18 },
};

export const REPUTATION = {
  drift: 0.15, // weekly pull toward the target
  onTime: 0.012,
  delayPerHour: 0.05,
  cancellation: 0.6,
  bumpedPerPax: 0.05,
  bumpedCapPerFlight: 1.5,
  pricePenaltyRatio: 1.3, // fares above 1.3x the reference fare annoy people
};

export const SPEEDS = [0, 1, 5, 15, 60, 120];
// 1x = 30 game minutes per real minute.
export const GAME_MINUTES_PER_REAL_SECOND = 0.5;

export const LOG_LIMIT = 250;
export const HISTORY_LIMIT = 260;
