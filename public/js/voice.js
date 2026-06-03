// Thin wrapper over the browser SpeechRecognition API (Web Speech).
// Falls back silently to typed input where unsupported (e.g. Firefox).
const Voice = {
  rec: null,

  supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  // Start listening. onText(text, isFinal) fires with interim + final results.
  // onEnd(finalText) fires when recognition stops. Returns false if unsupported.
  listen(onText, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      if (onEnd) onEnd('');
      return false;
    }
    this.stop();
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.continuous = false;

    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      if (onText) onText((finalText + ' ' + interim).trim(), !!finalText);
    };
    r.onerror = () => {};
    r.onend = () => {
      this.rec = null;
      if (onEnd) onEnd(finalText.trim());
    };

    this.rec = r;
    try { r.start(); } catch { return false; }
    return true;
  },

  stop() {
    if (this.rec) {
      try { this.rec.stop(); } catch {}
      this.rec = null;
    }
  },
};
