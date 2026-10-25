// Save slots in the browser's localStorage.
//
// Any object with the same four async methods can replace this one, e.g. a
// cloud store that talks to a server once Kittle Skies goes online:
//   list() -> [{ slot, meta }]   load(slot) -> text | null
//   save(slot, text)             remove(slot)

import { readMeta } from './saveFormat.js';

const PREFIX = 'kittle-skies:save:';
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];

function storage() {
  try {
    const s = globalThis.localStorage;
    const probe = `${PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function createLocalStore() {
  const memory = new Map(); // fallback when localStorage is blocked (private mode etc.)
  const backend = storage();
  const get = (k) => (backend ? backend.getItem(k) : memory.get(k) ?? null);
  const set = (k, v) => (backend ? backend.setItem(k, v) : memory.set(k, v));
  const del = (k) => (backend ? backend.removeItem(k) : memory.delete(k));

  return {
    persistent: Boolean(backend),
    async list() {
      return SLOTS.map((slot) => {
        const text = get(PREFIX + slot);
        return { slot, meta: text ? readMeta(text) : null };
      });
    },
    async load(slot) {
      return get(PREFIX + slot);
    },
    async save(slot, text) {
      try {
        set(PREFIX + slot, text);
      } catch (err) {
        throw new Error(`Could not save (${err.name === 'QuotaExceededError' ? 'storage is full' : err.message}).`);
      }
    },
    async remove(slot) {
      del(PREFIX + slot);
    },
  };
}
