// Timers behind the Take hold guard. The model owns the guard rules; this only wakes the runtime
// when the hold is due and while the fill grows, since Companion sends no event during a hold.
export function createHold({ ms, tickMs = 100, due, tick }) {
  let timer = 0;
  let ticker = 0;
  const stop = () => {
    clearTimeout(timer);
    clearInterval(ticker);
    timer = ticker = 0;
  };
  return {
    start() {
      stop();
      timer = setTimeout(due, ms);
      ticker = setInterval(tick, tickMs);
    },
    stop,
  };
}
