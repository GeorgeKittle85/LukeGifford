// Fictional AI airlines. They play by exactly the same rules as the player:
// every route must touch one of their hubs, planes are leased, and they issue
// the same commands through the engine.
//
// personality.priceBias   multiplier on the profit-maximizing fare (budget < 1 < premium)
// personality.aggression  how hard they react when undercut
// personality.maxFleet    soft cap on fleet size (scaled by difficulty)

export const RIVALS = [
  {
    id: 'GG', code: 'GG', name: 'Gridiron Global Airways', color: '#5b8def',
    hubs: ['ORD', 'JFK', 'LAX'], cash: 60_000_000, reputation: 62,
    settings: { serviceLevel: 'standard', maintenance: 'standard', overbooking: 0.05 },
    personality: { style: 'legacy', priceBias: 1.0, aggression: 0.8, maxFleet: 20 },
    tagline: 'The old-guard legacy carrier. Big network, big overhead.',
    fleet: [
      { type: 'B38M', route: ['ORD', 'JFK'] },
      { type: 'A21N', route: ['ORD', 'LAX'] },
      { type: 'B38M', route: ['ORD', 'SFO'] },
      { type: 'A220', route: ['ORD', 'ATL'] },
      { type: 'E175', route: ['ORD', 'DFW'] },
      { type: 'A21N', route: ['JFK', 'LAX'] },
      { type: 'A21N', route: ['JFK', 'SFO'] },
      { type: 'B789', route: ['JFK', 'LHR'] },
      { type: 'B38M', route: ['JFK', 'ATL'] },
      { type: 'E175', route: ['LAX', 'SFO'] },
      { type: 'B789', route: ['LAX', 'NRT'] },
      { type: 'E175', route: ['LAX', 'SEA'] },
    ],
  },
  {
    id: 'BZ', code: 'BZ', name: 'Blitz Air', color: '#ff8a3d',
    hubs: ['DEN'], cash: 12_000_000, reputation: 50,
    settings: { serviceLevel: 'basic', maintenance: 'budget', overbooking: 0.1 },
    personality: { style: 'lowcost', priceBias: 0.9, aggression: 1.2, maxFleet: 12 },
    tagline: 'Ultra-low-cost and always rushing the passer. Cheap fares, few frills.',
    fleet: [
      { type: 'B38M', route: ['DEN', 'LAX'] },
      { type: 'A220', route: ['DEN', 'SFO'] },
      { type: 'A220', route: ['DEN', 'ORD'] },
      { type: 'A220', route: ['DEN', 'ATL'] },
      { type: 'A21N', route: ['DEN', 'JFK'] },
    ],
  },
  {
    id: 'RZ', code: 'RZ', name: 'Red Zone Airlines', color: '#b56cff',
    hubs: ['DFW'], cash: 20_000_000, reputation: 58,
    settings: { serviceLevel: 'standard', maintenance: 'standard', overbooking: 0.05 },
    personality: { style: 'regional', priceBias: 0.97, aggression: 1.0, maxFleet: 11 },
    tagline: 'Texas-sized ambition, strongest when the field gets short.',
    fleet: [
      { type: 'B38M', route: ['DFW', 'LAX'] },
      { type: 'A220', route: ['DFW', 'ATL'] },
      { type: 'B38M', route: ['DFW', 'JFK'] },
      { type: 'E175', route: ['DFW', 'DEN'] },
      { type: 'B789', route: ['DFW', 'LHR'] },
    ],
  },
  {
    id: 'PP', code: 'PP', name: 'Pacific Pylon', color: '#2ec4b6',
    hubs: ['SEA'], cash: 25_000_000, reputation: 66,
    settings: { serviceLevel: 'premium', maintenance: 'premium', overbooking: 0 },
    personality: { style: 'premium', priceBias: 1.06, aggression: 0.6, maxFleet: 10 },
    tagline: 'Boutique Northwest carrier. Polished service, premium prices.',
    fleet: [
      { type: 'E175', route: ['SEA', 'SFO'] },
      { type: 'E175', route: ['SEA', 'LAX'] },
      { type: 'B789', route: ['SEA', 'NRT'] },
      { type: 'E175', route: ['SEA', 'DEN'] },
      { type: 'B38M', route: ['SEA', 'ORD'] },
      { type: 'A21N', route: ['SEA', 'JFK'] },
    ],
  },
];

export const DIFFICULTIES = {
  rookie: {
    id: 'rookie', label: 'Rookie', blurb: 'Gentle rivals, fewer surprises.',
    aiAggression: 0.5, aiExpandEveryWeeks: 5, aiFleetScale: 0.8, eventRate: 0.7, humanDemand: 1.1,
  },
  pro: {
    id: 'pro', label: 'Pro', blurb: 'The intended experience.',
    aiAggression: 1.0, aiExpandEveryWeeks: 3, aiFleetScale: 1.0, eventRate: 1.0, humanDemand: 1.0,
  },
  allpro: {
    id: 'allpro', label: 'All-Pro', blurb: 'Rivals blitz every down. Storms love you.',
    aiAggression: 1.5, aiExpandEveryWeeks: 2, aiFleetScale: 1.3, eventRate: 1.35, humanDemand: 0.92,
  },
};
