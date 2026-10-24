// Discrete-event queue stored inside the game state (a binary min-heap keyed
// by time, then insertion sequence). Keeping it in state means saves capture
// every pending departure, arrival and settlement exactly.

function before(x, y) {
  return x.t < y.t || (x.t === y.t && x.seq < y.seq);
}

export function schedule(state, t, kind, data = {}) {
  const item = { t, seq: state.nextSeq++, kind, ...data };
  const heap = state.queue;
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!before(heap[i], heap[parent])) break;
    [heap[i], heap[parent]] = [heap[parent], heap[i]];
    i = parent;
  }
  return item;
}

export function peek(state) {
  return state.queue[0] || null;
}

export function pop(state) {
  const heap = state.queue;
  if (heap.length === 0) return null;
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && before(heap[l], heap[m])) m = l;
      if (r < heap.length && before(heap[r], heap[m])) m = r;
      if (m === i) break;
      [heap[i], heap[m]] = [heap[m], heap[i]];
      i = m;
    }
  }
  return top;
}
