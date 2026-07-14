// Temp visual test: render the TEAM_PLAY camera shot with a populated board
// and roster, screenshot at several viewport sizes.
// Usage: node scripts/playshot-test.js <label> [left|right]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(process.env.TEMP || '.', 'ff-shots');
const label = process.argv[2] || 'x';
const side = process.argv[3] === 'right' ? 'right' : 'left';

const SIZES = [
  ['desktop', 1920, 1080],
  ['ipad', 1024, 768],
  ['iphone', 844, 390],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(EDGE) ? EDGE : 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
  });
  const page = await browser.newPage();

  for (const [name, w, h] of SIZES) {
    await page.setViewport({ width: w, height: h });
    await page.goto('http://localhost:3000/game-screen.html', { waitUntil: 'networkidle0' });
    await page.evaluate((side) => {
      const stage = document.getElementById('game-stage');
      stage.className = `game-screen camera-play-${side}`;
      document.getElementById('gs-waiting').classList.add('hidden');
      const hint = document.getElementById('gs-audio-hint');
      if (hint) hint.classList.add('hidden');
      // Populate the board like TEAM_PLAY
      const board = document.getElementById('gs-board');
      board.classList.remove('hidden');
      const answers = [
        ['DOG', 34, true], ['CAT', 22, true], ['FISH', 15, false], ['BIRD', 11, true],
        ['HAMSTER', 8, false], ['SNAKE', 5, false], ['LIZARD', 3, false], ['FERRET', 2, false],
      ];
      document.getElementById('rb-slots').innerHTML = answers.map(([t, p, rev], i) => `
        <div class="rb-cell${rev ? ' revealed' : ''}" data-position="${i}" style="--ans-fs:3.3cqw">
          <span class="rb-rank">${i + 1}</span>
          <span class="rb-ans">${t}</span>
          <span class="rb-pts">${p}</span>
        </div>`).join('');
      document.getElementById('rb-total').textContent = '67';
      // Scoreboard + roster overlay
      document.getElementById('gs-team1-name').textContent = 'SMITHS';
      document.getElementById('gs-team2-name').textContent = 'JONES';
      document.getElementById('gs-team1-score').textContent = '120';
      document.getElementById('gs-team2-score').textContent = '85';
      document.getElementById('gs-play-team').textContent = 'SMITHS';
      document.getElementById('gs-play-roster').innerHTML =
        ['BRENT', 'ALEX', 'SAM'].map((n) => `<span class="gs-play-name">${n}</span>`).join('');
    }, side);
    // Let fonts/backdrop/transitions settle
    await new Promise((r) => setTimeout(r, 1200));
    const file = path.join(OUT, `play-${label}-${name}.png`);
    await page.screenshot({ path: file });
    console.log('saved', file);
  }

  await browser.close();
})();
