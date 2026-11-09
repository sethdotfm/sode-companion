// When a newer saved copy of the panel replaces the one on the keys. Pure: the runtime owns the timers and the clock.
// Sode's countdown and staged-route rules are in vendor/panelupdate.js; this adds the immediate case for an untouched panel.
import { createUpdate, noticeRev, updateStep, applied } from './vendor/panelupdate.js';

export function createLivePanel(rev) {
  let u = createUpdate(rev);
  let latest = null;
  return {
    // A read of the panel from Sode. Remembers the copy when its rev differs from the one applied.
    notice(panel, now) {
      u = noticeRev(u, panel.rev, now);
      latest = u.since ? panel : null;
    },
    // The copy to apply now, or null. busy: a take is in flight. viewed, staged: the operator is mid-plan.
    // A Take in flight blocks it, staged routes hold past the countdown, a viewed destination alone waits it out.
    due({ busy, viewed, staged }, now) {
      if (!latest) return null;
      const untouched = !busy && !viewed && !staged;
      if (!untouched && updateStep(u, { busy, staged }, now).step !== 'apply') return null;
      const fresh = latest;
      latest = null;
      u = applied(u, fresh.rev);
      return fresh;
    },
  };
}
