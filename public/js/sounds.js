// Lightweight synthesized sound effects (no asset files needed).
// Phase 9 can replace these with real samples behind the same API.
const Sounds = {
  ctx: null,

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    // Browsers suspend audio until a user gesture; resume opportunistically.
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  // Call once from a user gesture (e.g. host button) to unlock audio.
  unlock() {
    this._ensure();
  },

  _tone({ freq, type = 'sine', start = 0, dur = 0.2, gain = 0.3, sweepTo = null }) {
    const ctx = this._ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  // Correct-answer reveal: bright two-note "ding!"
  ding() {
    this._tone({ freq: 880, type: 'sine', dur: 0.12, gain: 0.35 });
    this._tone({ freq: 1320, type: 'sine', start: 0.1, dur: 0.25, gain: 0.3 });
  },

  // Strike: harsh descending buzzer.
  buzzer() {
    this._tone({ freq: 220, type: 'sawtooth', dur: 0.5, gain: 0.35, sweepTo: 110 });
    this._tone({ freq: 160, type: 'square', dur: 0.5, gain: 0.2, sweepTo: 90 });
  },

  // Buzz-in (face-off): short rising blip — used in Phase 4.
  buzz() {
    this._tone({ freq: 440, type: 'square', dur: 0.18, gain: 0.3, sweepTo: 660 });
  },

  // Win fanfare: quick ascending arpeggio — used in Phase 5/9.
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this._tone({ freq: f, type: 'triangle', start: i * 0.12, dur: 0.2, gain: 0.3 })
    );
  },
};
