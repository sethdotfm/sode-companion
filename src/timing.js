// The runtime's own timers: the pulse clock, and wake-ups for deadlines in the model state. Independent of Companion.
// `timers` is injectable so tests drive time by hand.
import { RESULT_MS, ERROR_MS, GUARD_DOUBLE_MS } from './vendor/panelmodel.js';

export const PULSE_STEPS = 4;
export const PULSE_MS = 333; // 500 ms at 1.5x speed

// Brightness of a pulse phase (1..4) as a fraction of the state colour: breathes between 0.72 and 1.
export const pulseLevel = (phase) => 0.72 + 0.28 * (1 - Math.abs((phase - 1) / (PULSE_STEPS / 2) - 1));

export function createTiming({ timers, now, read, notify }) {
  let phase = 1;
  let pulseTimer = 0;
  let wakeTimer = 0;
  let stopped = false;

  const pulsing = () => read().staged.length > 0;

  function step() {
    pulseTimer = 0;
    phase = (phase % PULSE_STEPS) + 1;
    notify();
  }

  // The next moment the state changes by itself: a Result or an error expires, or a double-press window lapses.
  function nextDeadline() {
    const st = read();
    const at = [];
    for (const r of Object.values(st.results)) at.push(r.at + RESULT_MS);
    if (st.error) at.push(st.error.at + ERROR_MS);
    if (st.guard === 'double' && st.guardAt) at.push(st.guardAt + GUARD_DOUBLE_MS);
    // The model shows a value through its limit inclusive, so it goes 1 ms later.
    return at
      .map((t) => t + 1)
      .filter((t) => t > now())
      .sort((a, b) => a - b)[0];
  }

  function wake() {
    wakeTimer = 0;
    notify();
  }

  return {
    // Called after every state change: runs the pulse clock only while something is staged.
    sync() {
      if (stopped) return;
      if (pulsing() && !pulseTimer) pulseTimer = timers.setTimeout(step, PULSE_MS);
      timers.clearTimeout(wakeTimer);
      wakeTimer = 0;
      const next = nextDeadline();
      if (next) wakeTimer = timers.setTimeout(wake, next - now());
      if (!pulsing() && pulseTimer) {
        timers.clearTimeout(pulseTimer);
        pulseTimer = 0;
        phase = 1;
      }
    },
    phase: () => phase,
    stop() {
      stopped = true;
      timers.clearTimeout(pulseTimer);
      timers.clearTimeout(wakeTimer);
    },
  };
}
