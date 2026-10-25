// LocalHost runs the game entirely in this browser tab: it owns the game
// state, the real-time clock, and the save store, and it is the only thing the
// UI talks to.
//
// The UI depends on this small interface, not on the engine directly:
//   state, localAirlineId, speedIndex, paused
//   subscribe(fn) -> unsubscribe
//   dispatch(command) -> { ok, error?, ... }
//   setSpeed(i) / pause() / resume() / togglePause()
//   newGame(opts) / loadSlot(slot) / saveSlot(slot) / listSaves() / exportSave() / importSave(text)
//
// An online version would add a RemoteHost with the same interface that sends
// commands to a server and receives state updates (see ARCHITECTURE.md).

import { advance, createGame, dispatch as engineDispatch } from '../engine/index.js';
import { GAME_MINUTES_PER_REAL_SECOND, SPEEDS } from '../engine/constants.js';
import { deserialize, serialize } from '../storage/saveFormat.js';

const MAX_FRAME_SECONDS = 0.25; // a backgrounded tab doesn't fast-forward

export class LocalHost {
  constructor({ store, requestFrame = globalThis.requestAnimationFrame?.bind(globalThis), clock = () => performance.now() } = {}) {
    this.store = store;
    this.requestFrame = requestFrame;
    this.clock = clock;
    this.listeners = new Set();
    this._state = null;
    this._speedIndex = 0;
    this._lastSpeed = 1;
    this._lastFrame = null;
    this._running = false;
    this.settings = { autoPauseWeekly: true, autoPauseDecisions: true };
  }

  get state() { return this._state; }
  get localAirlineId() { return this._state?.humanAirlineId ?? null; }
  get speedIndex() { return this._speedIndex; }
  get paused() { return this._speedIndex === 0; }
  get speeds() { return SPEEDS; }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error('Listener failed', err);
      }
    }
  }

  // ---- game lifecycle ------------------------------------------------------

  newGame(options) {
    this._state = createGame(options);
    this.pause();
    this.emit({ type: 'loaded', reason: 'new' });
    this.saveSlot('auto');
  }

  replaceState(state, reason) {
    this._state = state;
    this.pause();
    this.emit({ type: 'loaded', reason });
  }

  async saveSlot(slot) {
    if (!this._state || !this.store) return false;
    try {
      await this.store.save(slot, serialize(this._state));
      this.emit({ type: 'saved', slot });
      return true;
    } catch (err) {
      this.emit({ type: 'error', message: err.message });
      return false;
    }
  }

  async loadSlot(slot) {
    const text = await this.store.load(slot);
    if (!text) throw new Error('That save slot is empty.');
    this.replaceState(deserialize(text), 'load');
  }

  async listSaves() {
    return this.store ? this.store.list() : [];
  }

  exportSave() {
    return serialize(this._state);
  }

  importSave(text) {
    this.replaceState(deserialize(text), 'import');
  }

  // ---- commands ------------------------------------------------------------

  dispatch(command) {
    if (!this._state) return { ok: false, error: 'No game loaded.' };
    const airlineId = command.airlineId ?? this.localAirlineId;
    // A server would do this check against the authenticated player.
    if (airlineId !== this.localAirlineId) return { ok: false, error: 'You can only manage your own airline.' };
    const { result, notes } = engineDispatch(this._state, { ...command, airlineId });
    if (notes.length) this.handleNotes(notes);
    if (result.ok) this.emit({ type: 'changed', command });
    return result;
  }

  // ---- clock ---------------------------------------------------------------

  setSpeed(index) {
    const i = Math.max(0, Math.min(SPEEDS.length - 1, index));
    if (i > 0 && this._state?.outcome && !this._state.dynasty) return;
    if (i > 0 && this._state?.outcome?.result === 'lost') return;
    if (i > 0) this._lastSpeed = i;
    this._speedIndex = i;
    this._lastFrame = null;
    this.emit({ type: 'speed', speedIndex: i, paused: i === 0 });
  }

  pause() { this.setSpeed(0); }
  resume() { this.setSpeed(this._lastSpeed || 1); }
  togglePause() { if (this.paused) this.resume(); else this.pause(); }

  setSetting(key, value) {
    if (key in this.settings) this.settings[key] = value;
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this.tick(this.clock());
      this.requestFrame(loop);
    };
    this.requestFrame(loop);
  }

  stop() {
    this._running = false;
  }

  tick(realMs) {
    if (!this._state) return;
    const last = this._lastFrame;
    this._lastFrame = realMs;
    if (this.paused || last === null) {
      this.emit({ type: 'frame' });
      return;
    }
    const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (realMs - last) / 1000));
    const minutes = seconds * GAME_MINUTES_PER_REAL_SECOND * SPEEDS[this._speedIndex];
    const notes = advance(this._state, this._state.now + minutes);
    if (notes.length) this.handleNotes(notes);
    this.emit({ type: 'frame' });
  }

  handleNotes(notes) {
    for (const note of notes) {
      if (note.type === 'weekReport') {
        this.saveSlot('auto');
        if (this.settings.autoPauseWeekly) this.pause();
      } else if (note.type === 'decision' && this.settings.autoPauseDecisions) {
        this.pause();
      } else if (note.type === 'outcome') {
        this.pause();
        this.saveSlot('auto');
      }
    }
    this.emit({ type: 'notes', notes });
  }
}
