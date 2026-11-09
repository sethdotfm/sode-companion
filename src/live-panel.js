// When a newer saved copy of the panel replaces the one on the keys. Pure: the runtime owns the timers.
// Diverges from Sode's web page (vendor/panelupdate.js): a newer copy applies at once, only a take in flight holds it.
import { createUpdate, noticeRev, applied } from './vendor/panelupdate.js';

export function createLivePanel(rev) {
  let update = createUpdate(rev);
  let latest = null;
  return {
    // Remembers the copy when its rev differs from the one applied.
    notice(panel, now) {
      update = noticeRev(update, panel.rev, now);
      latest = update.since ? panel : null;
    },
    // The copy to apply now, or null. busy: a take is in flight.
    due({ busy }) {
      if (!latest || busy) return null;
      const fresh = latest;
      latest = null;
      update = applied(update, fresh.rev);
      return fresh;
    },
  };
}
