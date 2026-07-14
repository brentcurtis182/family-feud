// Temp check: load the game screen, click (audio unlock), play a sound,
// and report console errors + audio element state.
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(EDGE) ? EDGE : 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto('http://localhost:3000/game-screen.html', { waitUntil: 'networkidle0' });
  await page.click('body');
  await new Promise((r) => setTimeout(r, 800));

  const result = await page.evaluate(async () => {
    const out = { unlocked: Sounds.unlocked, hintHidden: null, clips: {} };
    const hint = document.getElementById('gs-audio-hint');
    out.hintHidden = hint ? hint.classList.contains('hidden') : 'missing';
    // Try to actually play the ding and inspect state
    Sounds.ding();
    await new Promise((r) => setTimeout(r, 400));
    for (const name of ['ding', 'strike', 'clap']) {
      const a = Sounds.cache[name];
      out.clips[name] = a
        ? { readyState: a.readyState, paused: a.paused, muted: a.muted, error: a.error && a.error.code, src: a.currentSrc.split('/').pop() }
        : 'not-cached';
    }
    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
})();
