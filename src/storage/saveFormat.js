// Versioned save files. A save is a small JSON envelope around the engine
// state, so the same format works for browser storage today and for a cloud
// save service later.
//
// When the state shape changes, bump SCHEMA_VERSION in engine/state.js and add
// a step to MIGRATIONS that upgrades a save from the previous version.

import { SCHEMA_VERSION } from '../engine/state.js';

export const SAVE_FORMAT = 'kittle-skies-save';

// MIGRATIONS[n] upgrades a version-n state to version n+1.
const MIGRATIONS = {};

export function serialize(state, { savedAt = new Date().toISOString() } = {}) {
  const human = state.airlines[state.humanAirlineId];
  return JSON.stringify({
    format: SAVE_FORMAT,
    schemaVersion: state.schemaVersion,
    savedAt,
    meta: {
      airlineName: human.name,
      hub: human.hubs[0],
      week: Math.floor(state.now / (7 * 24 * 60)) + 1,
      cash: Math.round(human.cash),
      outcome: state.outcome?.result ?? null,
    },
    state,
  });
}

export function readMeta(text) {
  try {
    const data = JSON.parse(text);
    return data.format === SAVE_FORMAT ? { savedAt: data.savedAt, ...data.meta } : null;
  } catch {
    return null;
  }
}

export function deserialize(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not a valid Kittle Skies save.');
  }
  if (!data || data.format !== SAVE_FORMAT || !data.state) {
    throw new Error('That file is not a Kittle Skies save.');
  }
  let { state } = data;
  let version = state.schemaVersion ?? data.schemaVersion;
  if (version > SCHEMA_VERSION) {
    throw new Error('This save comes from a newer version of Kittle Skies.');
  }
  while (version < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new Error(`No upgrade path for save version ${version}.`);
    state = migrate(state);
    version += 1;
    state.schemaVersion = version;
  }
  const required = ['airlines', 'planes', 'routes', 'queue', 'humanAirlineId', 'epochMs'];
  for (const key of required) {
    if (!(key in state)) throw new Error(`Save is missing "${key}".`);
  }
  return state;
}
