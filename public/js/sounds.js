// Real sound effects (MP3 files in /assets/sound-effects).
// Primed on first user gesture so later programmatic playback isn't blocked.
const Sounds = {
  base: '/assets/sound-effects/',
  map: {
    buzzIn: 'buzzer-in-sound.mp3',
    ding: 'correct-answer-ding.mp3',
    clap: 'family-feud-clap.mp3',
    duplicate: 'fast-money-duplicate-answer-sound.mp3',
    strike: 'strike-sound.mp3',
    theme: 'theme-song.mp3',
  },
  cache: {},
  unlocked: false,

  _get(name) {
    const file = this.map[name];
    if (!file) return null;
    if (!this.cache[name]) {
      const a = new Audio(this.base + file);
      a.preload = 'auto';
      this.cache[name] = a;
    }
    return this.cache[name];
  },

  // Call from a user gesture to unlock audio (primes each clip).
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    Object.keys(this.map).forEach((name) => {
      const a = this._get(name);
      if (!a) return;
      a.muted = true;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
    });
  },

  play(name) {
    const a = this._get(name);
    if (!a) return;
    try { a.currentTime = 0; const p = a.play(); if (p) p.catch(() => {}); } catch {}
  },

  stop(name) {
    const a = this.cache[name];
    if (a) { try { a.pause(); a.currentTime = 0; } catch {} }
  },

  // ---- Named helpers (used across the app) ----
  ding() { this.play('ding'); },          // correct answer flip (regular game)
  buzzer() { this.play('strike'); },      // strike / wrong answer
  buzz() { this.play('buzzIn'); },        // face-off buzz-in
  fanfare() { this.play('clap'); },       // round/game win
  duplicateSound() { this.play('duplicate'); }, // fast money duplicate
  themeSong() { this.play('theme'); },    // start of game
  clap() { this.play('clap'); },          // host applause button
};
