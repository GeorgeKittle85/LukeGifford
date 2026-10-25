// Seeded, serializable random numbers (mulberry32). The generator state lives
// in `state.rng`, so a saved game resumes the exact same random sequence and a
// server can replay a game deterministically from its seed + command log.

export function seedFromString(text) {
  // FNV-1a hash -> uint32
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function random(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(state, min, max) {
  return min + (max - min) * random(state);
}

export function randInt(state, min, maxInclusive) {
  return Math.floor(randRange(state, min, maxInclusive + 1));
}

export function chance(state, p) {
  return random(state) < p;
}

export function pick(state, list) {
  return list[Math.floor(random(state) * list.length)];
}

export function pickWeighted(state, entries, weightOf) {
  const total = entries.reduce((sum, e) => sum + weightOf(e), 0);
  if (total <= 0) return null;
  let roll = random(state) * total;
  for (const e of entries) {
    roll -= weightOf(e);
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}

// Approximately normal noise (Irwin-Hall with 3 samples), mean 0, sd ~ spread/2.
export function noise(state, spread) {
  return ((random(state) + random(state) + random(state)) / 1.5 - 1) * spread;
}
