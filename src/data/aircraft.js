// Aircraft catalog. Figures are "realistic-ish": typical seat counts, ranges and
// fuel burn for each type, with 2025-2026 market lease rates and values rather
// than (heavily discounted) list prices.
//
// fuelGph       US gallons of jet fuel burned per block hour
// crewPerHr     pilots + cabin crew cost per block hour (USD)
// maintPerHr    maintenance reserve per block hour (USD)
// opsPerHr      ground staff, station rent, insurance and IT per block hour (USD)
// turnMin       minimum turnaround time on the ground (minutes)
// mtowKlb       max take-off weight in thousands of lb (landing fees scale with it)
// leaseMonthly  monthly lease rate (USD); leasing needs a 2-month deposit
// price         purchase price (USD)
// reliability   1.0 = average dispatch reliability; higher means fewer delays

export const AIRCRAFT = {
  E175: {
    id: 'E175', name: 'Embraer E175', short: 'E175', category: 'Regional jet',
    seats: 76, cruiseMph: 515, rangeMi: 2300, fuelGph: 460, crewPerHr: 520, maintPerHr: 400, opsPerHr: 320,
    turnMin: 35, mtowKlb: 89, leaseMonthly: 140_000, price: 30_000_000, reliability: 1.0,
    blurb: 'Cheap to run, small cabin. Your rookie contract.',
  },
  A220: {
    id: 'A220', name: 'Airbus A220-300', short: 'A220', category: 'Small narrowbody',
    seats: 140, cruiseMph: 525, rangeMi: 3900, fuelGph: 590, crewPerHr: 1250, maintPerHr: 700, opsPerHr: 1100,
    turnMin: 40, mtowKlb: 149, leaseMonthly: 290_000, price: 42_000_000, reliability: 0.95,
    blurb: 'Most fuel-efficient seat in the sky. Great mid-size workhorse.',
  },
  B38M: {
    id: 'B38M', name: 'Boeing 737-8', short: '737-8', category: 'Narrowbody',
    seats: 172, cruiseMph: 530, rangeMi: 4000, fuelGph: 710, crewPerHr: 1500, maintPerHr: 800, opsPerHr: 1250,
    turnMin: 45, mtowKlb: 182, leaseMonthly: 380_000, price: 55_000_000, reliability: 1.0,
    blurb: 'The every-down player. Busy domestic routes and short transatlantic hops.',
  },
  A21N: {
    id: 'A21N', name: 'Airbus A321neo (LR)', short: 'A321neo', category: 'Large narrowbody',
    seats: 200, cruiseMph: 530, rangeMi: 4600, fuelGph: 790, crewPerHr: 1650, maintPerHr: 850, opsPerHr: 1400,
    turnMin: 50, mtowKlb: 214, leaseMonthly: 440_000, price: 66_000_000, reliability: 1.0,
    blurb: 'Most seats in a single aisle. Long legs reach London from the East Coast.',
  },
  B77W: {
    id: 'B77W', name: 'Boeing 777-300ER (used)', short: '777-300ER', category: 'Large widebody',
    seats: 380, cruiseMph: 560, rangeMi: 8400, fuelGph: 2300, crewPerHr: 2600, maintPerHr: 1600, opsPerHr: 1800,
    turnMin: 100, mtowKlb: 775, leaseMonthly: 700_000, price: 45_000_000, reliability: 0.88,
    blurb: 'A 12-year-old giant. Cheap lease, thirsty engines. Huge yards after the catch on packed routes.',
  },
  B789: {
    id: 'B789', name: 'Boeing 787-9', short: '787-9', category: 'Widebody',
    seats: 300, cruiseMph: 560, rangeMi: 8700, fuelGph: 1700, crewPerHr: 2300, maintPerHr: 1100, opsPerHr: 1700,
    turnMin: 90, mtowKlb: 561, leaseMonthly: 1_150_000, price: 150_000_000, reliability: 1.0,
    blurb: 'Efficient long-haul flagship. Pricey, but it sips fuel across oceans.',
  },
};

export const AIRCRAFT_ORDER = ['E175', 'A220', 'B38M', 'A21N', 'B77W', 'B789'];

export const LEASE_DEPOSIT_MONTHS = 2;
export const LEASE_RETURN_FEE_MONTHS = 1;
export const LEASE_DELIVERY_MIN = 2 * 24 * 60;
export const PURCHASE_DELIVERY_MIN = 3 * 24 * 60;
// Owned aircraft lose value each week; resale also takes a broker haircut.
export const WEEKLY_DEPRECIATION = 0.0015;
export const RESALE_HAIRCUT = 0.9;

export function weeklyLease(type) {
  return (AIRCRAFT[type].leaseMonthly * 12) / 52;
}

export function leaseDeposit(type) {
  return AIRCRAFT[type].leaseMonthly * LEASE_DEPOSIT_MONTHS;
}
