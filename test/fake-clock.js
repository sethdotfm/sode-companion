// A manual clock for the runtime's `now` and `timers` options. advance() runs due timers in order.
export function fakeClock(start = 1_000_000) {
  let t = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    timers: {
      setTimeout(fn, ms) {
        const id = ++seq;
        timers.set(id, { at: t + ms, fn });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    pending: () => timers.size,
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        t = Math.max(t, due[1].at);
        due[1].fn();
      }
      t = end;
    },
  };
}
