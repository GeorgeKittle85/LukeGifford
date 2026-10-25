// The ten airports on the Kittle Skies map.
//
// pop       catchment population (millions): the share of the metro area that
//           actually flies from this airport (NYC also has LGA/EWR, Tokyo has HND...)
// business  business-travel pull (1.0 = average)
// tourism   leisure-travel pull (1.0 = average)
// tz / dst  standard UTC offset (hours) and daylight-saving rule ('US' | 'UK' | 'none')
// feeIndex  how expensive the airport is for landing/handling (1.0 = average)
// hubCost   one-time cost to open a hub here (USD)
// weather   which storm types can hit this airport, by month (1-12)

export const AIRPORTS = [
  {
    code: 'SFO', name: 'San Francisco International', city: 'San Francisco', country: 'US',
    lat: 37.6213, lon: -122.3790, tz: -8, dst: 'US',
    pop: 6.0, business: 1.35, tourism: 1.15, feeIndex: 1.2, hubCost: 3_200_000,
    weather: [{ type: 'fog', months: [6, 7, 8, 9], weight: 1.2 }, { type: 'rain', months: [12, 1, 2, 3], weight: 0.8 }],
  },
  {
    code: 'LAX', name: 'Los Angeles International', city: 'Los Angeles', country: 'US',
    lat: 33.9416, lon: -118.4085, tz: -8, dst: 'US',
    pop: 9.5, business: 1.1, tourism: 1.35, feeIndex: 1.1, hubCost: 3_400_000,
    weather: [{ type: 'rain', months: [12, 1, 2], weight: 0.5 }],
  },
  {
    code: 'SEA', name: 'Seattle-Tacoma International', city: 'Seattle', country: 'US',
    lat: 47.4502, lon: -122.3088, tz: -8, dst: 'US',
    pop: 4.2, business: 1.15, tourism: 1.0, feeIndex: 1.0, hubCost: 2_600_000,
    weather: [{ type: 'rain', months: [10, 11, 12, 1, 2, 3], weight: 1.0 }, { type: 'snow', months: [12, 1, 2], weight: 0.4 }],
  },
  {
    code: 'DEN', name: 'Denver International', city: 'Denver', country: 'US',
    lat: 39.8561, lon: -104.6737, tz: -7, dst: 'US',
    pop: 3.6, business: 1.15, tourism: 1.3, feeIndex: 0.9, hubCost: 2_400_000,
    weather: [{ type: 'snow', months: [11, 12, 1, 2, 3, 4], weight: 1.4 }, { type: 'thunder', months: [6, 7, 8], weight: 0.7 }],
  },
  {
    code: 'DFW', name: 'Dallas/Fort Worth International', city: 'Dallas', country: 'US',
    lat: 32.8998, lon: -97.0403, tz: -6, dst: 'US',
    pop: 6.8, business: 1.15, tourism: 0.85, feeIndex: 0.9, hubCost: 2_800_000,
    weather: [{ type: 'thunder', months: [4, 5, 6, 7, 8], weight: 1.3 }, { type: 'ice', months: [1, 2], weight: 0.5 }],
  },
  {
    code: 'ORD', name: "Chicago O'Hare International", city: 'Chicago', country: 'US',
    lat: 41.9742, lon: -87.9073, tz: -6, dst: 'US',
    pop: 7.8, business: 1.3, tourism: 1.0, feeIndex: 1.05, hubCost: 3_000_000,
    weather: [{ type: 'snow', months: [11, 12, 1, 2, 3], weight: 1.5 }, { type: 'thunder', months: [6, 7, 8], weight: 0.8 }],
  },
  {
    code: 'ATL', name: 'Hartsfield-Jackson Atlanta International', city: 'Atlanta', country: 'US',
    lat: 33.6407, lon: -84.4277, tz: -5, dst: 'US',
    pop: 6.3, business: 1.1, tourism: 0.95, feeIndex: 0.85, hubCost: 2_600_000,
    weather: [{ type: 'thunder', months: [5, 6, 7, 8, 9], weight: 1.4 }, { type: 'ice', months: [1, 2], weight: 0.3 }],
  },
  {
    code: 'JFK', name: 'John F. Kennedy International', city: 'New York', country: 'US',
    lat: 40.6413, lon: -73.7781, tz: -5, dst: 'US',
    pop: 9.0, business: 1.5, tourism: 1.4, feeIndex: 1.35, hubCost: 4_000_000,
    weather: [{ type: 'snow', months: [12, 1, 2, 3], weight: 1.2 }, { type: 'thunder', months: [6, 7, 8], weight: 0.9 }, { type: 'hurricane', months: [8, 9, 10], weight: 0.25 }],
  },
  {
    code: 'LHR', name: 'London Heathrow', city: 'London', country: 'GB',
    lat: 51.4700, lon: -0.4543, tz: 0, dst: 'UK',
    pop: 10.0, business: 1.5, tourism: 1.45, feeIndex: 1.6, hubCost: 5_000_000,
    weather: [{ type: 'fog', months: [11, 12, 1, 2], weight: 1.0 }, { type: 'wind', months: [10, 11, 12, 1, 2, 3], weight: 0.8 }],
  },
  {
    code: 'NRT', name: 'Tokyo Narita International', city: 'Tokyo', country: 'JP',
    lat: 35.7720, lon: 140.3929, tz: 9, dst: 'none',
    pop: 14.0, business: 1.35, tourism: 1.3, feeIndex: 1.4, hubCost: 4_800_000,
    weather: [{ type: 'typhoon', months: [8, 9, 10], weight: 1.0 }, { type: 'snow', months: [1, 2], weight: 0.3 }],
  },
];

export const AIRPORT_BY_CODE = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

export const WEATHER_LABELS = {
  fog: 'Dense fog',
  rain: 'Heavy rain',
  snow: 'Snowstorm',
  ice: 'Ice storm',
  thunder: 'Thunderstorms',
  hurricane: 'Hurricane',
  typhoon: 'Typhoon',
  wind: 'High winds',
};

// How hard each storm type hits operations (multiplies the rolled severity).
export const WEATHER_INTENSITY = {
  fog: 0.6, rain: 0.5, snow: 1.0, ice: 1.0, thunder: 0.8, hurricane: 1.4, typhoon: 1.3, wind: 0.6,
};
