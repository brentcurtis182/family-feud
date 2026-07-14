// ---- Game Screen (TV display) ----
let gameState = null;
const gameId = new URLSearchParams(window.location.search).get('gameId');
const socket = SocketClient.connect();

// Track the current question signature so we only rebuild the board when the
// question actually changes (not on every state sync).
let renderedQuestionSig = null;

socket.on('connect', () => {
  socket.emit('rejoin', { gameId, role: 'gamescreen' });
});

// ---- 16:9 frame scaling ----
// The stage is a fixed 1920x1080 design canvas (.gs-frame); scale it to fit
// whatever screen we're on. Every device renders the same layout, letterboxed.
const FRAME_W = 1920;
const FRAME_H = 1080;
function fitFrame() {
  const frame = document.getElementById('gs-frame');
  const shell = document.getElementById('game-stage');
  if (!frame || !shell) return;
  // Measure the shell (100dvh-sized), not the window — tracks iOS toolbars.
  const rect = shell.getBoundingClientRect();
  const scale = Math.min(rect.width / FRAME_W, rect.height / FRAME_H);
  frame.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', fitFrame);
window.addEventListener('orientationchange', fitFrame);
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitFrame);
fitFrame();

// ---- Fullscreen toggle (hides browser chrome when casting from iPad/laptop) ----
(function initFullscreenBtn() {
  const btn = document.getElementById('gs-fullscreen-btn');
  if (!btn) return;
  const root = document.documentElement;
  const supported = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  // Hide if unsupported (older iPhones) or already chrome-less (PWA launch).
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
  if (!supported || standalone) {
    btn.classList.add('hidden');
    return;
  }
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  btn.addEventListener('click', () => {
    if (isFs()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    }
  });
  const onFsChange = () => {
    btn.title = isFs() ? 'Exit fullscreen' : 'Fullscreen';
    fitFrame();
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
})();

// Browsers gate audio behind a user gesture — unlock on first interaction.
function unlockAudioOnce() {
  Sounds.unlock();
  document.removeEventListener('click', unlockAudioOnce);
  document.removeEventListener('keydown', unlockAudioOnce);
  const hint = document.getElementById('gs-audio-hint');
  if (hint) hint.classList.add('hidden');
}
document.addEventListener('click', unlockAudioOnce);
document.addEventListener('keydown', unlockAudioOnce);

// Full state (on join / reconnect / broad updates)
socket.on('game-state-sync', (state) => {
  gameState = state;
  renderAll();
});

// Lightweight phase change
socket.on('phase-changed', ({ phase, round, roundMultiplier }) => {
  if (!gameState) return;
  gameState.phase = phase;
  if (round !== undefined) gameState.round = round;
  if (roundMultiplier !== undefined) gameState.roundMultiplier = roundMultiplier;
  renderAll();
});

// Camera shots (wide / faceoff / play-left / play-right)
socket.on('camera-angle', ({ angle }) => {
  const stage = document.getElementById('game-stage');
  stage.className = 'game-screen';
  if (angle) stage.classList.add(`camera-${angle}`);
});

// Animation/sound triggers (state-sync follows for authoritative state)
socket.on('answer-revealed', ({ position, text, points, roundBank }) => {
  const cell = document.querySelector(`.rb-cell[data-position="${position}"]`);
  if (cell && !cell.classList.contains('revealed')) {
    if (text != null) {
      cell.querySelector('.rb-ans').textContent = text;
      cell.style.setProperty('--ans-fs', ansFontCqw(text));
    }
    if (points != null) cell.querySelector('.rb-pts').textContent = points;
    cell.classList.add('revealed');
    Sounds.ding();
  }
  if (roundBank !== undefined) {
    setBank(roundBank);
    const t = document.getElementById('rb-total');
    if (t) t.textContent = roundBank;
  }
});

socket.on('strike-added', ({ strikes }) => {
  flashStrikes(strikes);
  Sounds.buzzer();
});

socket.on('strikes-cleared', () => {
  document.getElementById('gs-strikes').innerHTML = '';
});

// Face-off buzz-in wrong answer: transient X + buzzer (auto-clears).
socket.on('faceoff-strike', () => {
  flashStrikes(1);
  Sounds.buzzer();
});

socket.on('buzzers-open', () => {
  Sounds.stop('theme'); // intro theme ends as the face-off begins
});

socket.on('buzz-result', ({ winner, playerName, teamName }) => {
  Sounds.stop('theme'); // make sure the intro theme isn't still bleeding through
  showBuzzIn(playerName, teamName, winner);
  Sounds.buzz();
});

function showBuzzIn(playerName, teamName, team) {
  const el = document.getElementById('gs-buzzin');
  if (!el) return;
  el.className = 'gs-buzzin ' + (team || '');
  el.textContent = `⚡ ${(playerName || teamName || '').toUpperCase()} — IN!`;
  el.classList.remove('hidden');
}

socket.on('steal-setup', () => {
  // (no extra sound — the strike sound already played on the 3rd strike)
});

socket.on('steal-result', ({ success }) => {
  if (success) {
    Sounds.ding(); // steal success = correct answer
  } else {
    flashStrikes(1); // failed steal — slam an X + buzzer (then the round ends)
    Sounds.buzzer();
  }
});

socket.on('round-ended', () => {
  // Applause; the board stays up so the host can reveal the remaining answers.
  // (The big winner overlay only appears on GAME_OVER — see renderEndState.)
  Sounds.fanfare();
});

socket.on('game-over', () => {
  Sounds.fanfare();
});

// Host can play/stop sounds on the TV (theme, applause, etc.)
socket.on('tv-sound', ({ name }) => { Sounds.play(name); });
socket.on('tv-sound-stop', ({ name }) => { Sounds.stop(name); });

// Fast Money answer reveal — fill the answer cell with a pop + reveal sound
socket.on('fm-answer-revealed', ({ player, index, text, duplicate }) => {
  const cell = document.querySelector(`.fmb-cell[data-slot="${player}-ans-${index}"]`);
  if (cell) {
    cell.textContent = duplicate ? '✗ DUPE' : (text || '');
    cell.classList.toggle('duplicate', !!duplicate);
    cell.classList.add('pop');
    setTimeout(() => cell.classList.remove('pop'), 350);
  }
  Sounds.fmRevealSound();
});

socket.on('fm-score-revealed', ({ player, index, points, duplicate, total, won }) => {
  const cell = document.querySelector(`.fmb-cell[data-slot="${player}-pts-${index}"]`);
  if (cell) {
    cell.textContent = duplicate ? '0' : points;
    cell.classList.add('pop');
    setTimeout(() => cell.classList.remove('pop'), 350);
  }
  // A scoring answer dings; a duplicate OR a "no answer" (— / 0 points) buzzes.
  if (points > 0 && !duplicate) Sounds.fmDingSound(); else Sounds.duplicateSound();
  const totalEl = document.getElementById('fmb-total');
  if (totalEl) totalEl.textContent = total;
  if (won) Sounds.fanfare();
});

socket.on('fm-dup-buzz', () => {
  Sounds.duplicateSound();
  const el = document.getElementById('fm-status');
  if (!el) return;
  const prev = el.textContent;
  el.textContent = '❌ DUPLICATE — try another!';
  el.classList.add('dup-flash');
  setTimeout(() => { el.classList.remove('dup-flash'); el.textContent = prev; }, 1800);
});

let fmTimerInt = null;
socket.on('fm-timer', ({ duration }) => {
  const el = document.getElementById('fm-timer-big');
  el.classList.remove('hidden', 'times-up');
  let left = duration || 25;
  el.textContent = left;
  if (fmTimerInt) clearInterval(fmTimerInt);
  fmTimerInt = setInterval(() => {
    left--;
    el.textContent = Math.max(0, left);
    if (left <= 0) {
      clearInterval(fmTimerInt); fmTimerInt = null;
      el.classList.add('times-up');
      Sounds.buzzer(); // strike sound when the Fast Money timer runs out
    }
  }, 1000);
});

// ---- Rendering ----
function renderAll() {
  if (!gameState) return;
  renderScoreboard();
  renderRoundIndicator();

  // Fast Money takes over the whole stage.
  const isFastMoney = gameState.phase.startsWith('FAST_MONEY');
  document.getElementById('gs-fastmoney').classList.toggle('hidden', !isFastMoney);
  if (!isFastMoney && fmTimerInt) { clearInterval(fmTimerInt); fmTimerInt = null; }
  if (isFastMoney) {
    document.getElementById('gs-waiting').classList.add('hidden');
    document.getElementById('gs-board').classList.add('hidden');
    document.getElementById('gs-question').classList.add('hidden');
    document.getElementById('gs-faceoff').classList.add('hidden');
    document.getElementById('gs-bank-wrap').classList.add('hidden');
    hideOverlay();
    renderFastMoneyBoard();
    return;
  }

  const inGame = gameState.phase !== 'LOBBY';
  document.getElementById('gs-waiting').classList.toggle('hidden', inGame);
  document.getElementById('gs-board').classList.toggle('hidden', !inGame || !gameState.currentQuestion);
  // Question text is NEVER shown on the TV — players listen to the host only.
  document.getElementById('gs-question').classList.add('hidden');

  renderBoard();
  renderFaceoff();
  renderBuzzIn();
  renderPlayOverlay();
  setBank(gameState.roundBank || 0);
  // Strikes are a transient FLASH only (see flashStrikes on the strike event) —
  // the big X covers the whole board, so we must never re-draw it persistently
  // here, or it would sit on top of answers revealed after the strike. Just make
  // sure the overlay is cleared once strikes are gone (reset / new round).
  if (!gameState.activePlay || !gameState.activePlay.strikes) {
    const sEl = document.getElementById('gs-strikes');
    if (sEl) sEl.innerHTML = '';
  }
  renderEndState();
}

// Giant buzz-in banner — shown while the buzz winner answers (FACE_OFF_ANSWER)
function renderBuzzIn() {
  const el = document.getElementById('gs-buzzin');
  if (!el) return;
  const fo = gameState.faceOff || {};
  if (gameState.phase === 'FACE_OFF_ANSWER' && fo.winner) {
    const sd = gameState.suddenDeath;
    // In sudden death the active answerer alternates on a miss.
    const who = sd ? (gameState.suddenDeathTurn || fo.winner) : fo.winner;
    const c = fo[`${who}Player`];
    const name = c ? c.playerName : gameState.teams[who].name;
    el.className = 'gs-buzzin ' + who;
    el.textContent = sd ? `🟥 ${(name || '').toUpperCase()} — ANSWER!` : `⚡ ${(name || '').toUpperCase()} — IN!`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// Play shot: name of the team currently on the board + their roster, shown over
// the studio podiums. Visibility is driven by the camera-play-* class (CSS).
function renderPlayOverlay() {
  const teamEl = document.getElementById('gs-play-team');
  const rosterEl = document.getElementById('gs-play-roster');
  if (!teamEl || !rosterEl) return;
  const ap = gameState.activePlay || {};
  const active = ap.isStealing ? ap.stealingTeam : ap.playingTeam;
  const t = active && gameState.teams ? gameState.teams[active] : null;
  if (!t) { teamEl.textContent = ''; rosterEl.innerHTML = ''; return; }
  teamEl.textContent = (t.name || '').toUpperCase();
  const names = (t.roster || []).slice(0, 5);
  rosterEl.innerHTML = names.map((n) => `<span class="gs-play-name">${escapeHtml(n)}</span>`).join('');
}

// Round-end / game-over overlays (driven by authoritative phase)
function renderEndState() {
  const phase = gameState.phase;
  if (phase === 'GAME_OVER' && gameState.winner) {
    const name = gameState.teams[gameState.winner].name;
    showOverlay(
      `<div class="ov-trophy">🏆</div>` +
      `<div class="ov-team">${escapeHtml(name)}</div>` +
      `<div class="ov-sub">WINS!${gameState.suddenDeath ? ' — SUDDEN DEATH' : ''}</div>` +
      `<div class="ov-scores">${escapeHtml(gameState.teams.team1.name)} ${gameState.teams.team1.score} — ${gameState.teams.team2.name} ${gameState.teams.team2.score}</div>`
    );
  } else {
    // ROUND_END keeps the board visible so the host can reveal the rest.
    hideOverlay();
  }
}

// ---- Fast Money board (single active player, two-stage reveal) ----
let fmGridBuiltKey = '';

// Build a player's 5-row side (answer + points cells) once.
const fmSideBuilt = {};
function buildFmSide(elId, player, slots) {
  const el = document.getElementById(elId);
  if (!el) return;
  const key = `${player}-${slots}`;
  if (fmSideBuilt[elId] === key) return;
  fmSideBuilt[elId] = key;
  let html = '';
  for (let i = 0; i < slots; i++) {
    html += `<div class="fmb-cell fmb-ans" data-slot="${player}-ans-${i}"></div>`;
    html += `<div class="fmb-cell fmb-pts" data-slot="${player}-pts-${i}"></div>`;
  }
  el.innerHTML = html;
}

function renderFastMoneyBoard() {
  const fm = gameState.fastMoney;
  const phase = gameState.phase;
  const statusEl = document.getElementById('fm-status');
  const names = fm ? fm.contestants : { p1: 'Player 1', p2: 'Player 2' };

  // Timer only during capture phases
  const capturing = phase === 'FAST_MONEY_P1' || phase === 'FAST_MONEY_P2';
  if (!capturing) {
    document.getElementById('fm-timer-big').classList.add('hidden');
    if (fmTimerInt) { clearInterval(fmTimerInt); fmTimerInt = null; }
  }

  statusEl.textContent = {
    FAST_MONEY_P1: `${names.p1} — answer all five!`,
    FAST_MONEY_P1_REVEAL: fm && fm.won ? '🎉 WINNER!' : `${names.p1}'s answers…`,
    FAST_MONEY_P2_WAIT: (fm && fm.remindP1) ? `Reminder — ${names.p1}'s answers` : `${names.p2}, get ready!`,
    FAST_MONEY_P2: `${names.p2} — answer all five!`,
    FAST_MONEY_REVEAL: fm && fm.won ? '🎉 WINNERS!' : 'And the answers…',
  }[phase] || '';
  statusEl.classList.toggle('win', !!(fm && fm.won));

  if (!fm) return;
  const slots = fm.questions.length;

  document.getElementById('fmb-name-l').textContent = names.p1;
  document.getElementById('fmb-name-r').textContent = names.p2;

  buildFmSide('fmb-left', 'p1', slots);
  buildFmSide('fmb-right', 'p2', slots);

  // During the hand-off and P2's turn, conceal P1's answers/points so P2 can't
  // peek at the TV — unless the host hits "Remind" (re-reveal) in the room.
  const hideP1 = (phase === 'FAST_MONEY_P2_WAIT' || phase === 'FAST_MONEY_P2') && !fm.remindP1;

  for (const p of ['p1', 'p2']) {
    const conceal = p === 'p1' && hideP1;
    fm.reveal[p].forEach((r, i) => {
      const ans = document.querySelector(`.fmb-cell[data-slot="${p}-ans-${i}"]`);
      const pts = document.querySelector(`.fmb-cell[data-slot="${p}-pts-${i}"]`);
      if (ans) {
        ans.textContent = conceal ? '' : (r.answerRevealed ? (r.duplicate ? '✗ DUPE' : (r.text || '')) : '');
        ans.classList.toggle('duplicate', !conceal && !!r.duplicate);
        // cursor sits on the answer box until the answer is revealed
        ans.classList.toggle('fm-cursor-on', !conceal && !!(r.cursor && !r.answerRevealed));
      }
      if (pts) {
        pts.textContent = conceal ? '' : (r.scoreRevealed ? (r.duplicate ? '0' : r.points) : '');
        // then jumps to the score box until the score is revealed
        pts.classList.toggle('fm-cursor-on', !conceal && !!(r.cursor && r.answerRevealed && !r.scoreRevealed));
      }
    });
  }

  // Hide the running total too while P1's board is concealed (it would give the
  // score away), otherwise show it.
  document.getElementById('fmb-total').textContent = hideP1 ? '' : fm.total;
}

function showOverlay(html) {
  const ov = document.getElementById('gs-overlay');
  document.getElementById('gs-overlay-content').innerHTML = html;
  ov.classList.remove('hidden');
}

function hideOverlay() {
  document.getElementById('gs-overlay').classList.add('hidden');
}

// Face-off status line (contestants + buzz prompt)
function renderFaceoff() {
  const el = document.getElementById('gs-faceoff');
  const fo = gameState.faceOff || {};
  const phase = gameState.phase;
  const n1 = fo.team1Player ? fo.team1Player.playerName : '?';
  const n2 = fo.team2Player ? fo.team2Player.playerName : '?';

  if (phase === 'FACE_OFF_READY') {
    el.className = 'gs-faceoff';
    el.textContent = `Face-Off: ${n1} vs ${n2}`;
  } else if (phase === 'FACE_OFF_BUZZER') {
    el.className = 'gs-faceoff armed';
    el.textContent = 'BUZZ IN!';
  } else if (phase === 'FACE_OFF_ANSWER' && fo.winner) {
    const c = fo[`${fo.winner}Player`];
    const teamName = gameState.teams[fo.winner].name;
    el.className = 'gs-faceoff winner';
    el.textContent = `⚡ ${c ? c.playerName : teamName} (${teamName}) buzzed first!`;
  } else if (phase === 'TEAM_PLAY' && gameState.activePlay && gameState.activePlay.playingTeam) {
    el.className = 'gs-faceoff';
    el.textContent = `▶ ${gameState.teams[gameState.activePlay.playingTeam].name} playing`;
  } else if (phase === 'STEAL_ATTEMPT' && gameState.activePlay && gameState.activePlay.stealingTeam) {
    el.className = 'gs-faceoff winner';
    el.textContent = `🎯 ${gameState.teams[gameState.activePlay.stealingTeam].name} STEAL!`;
  } else {
    el.className = 'gs-faceoff hidden';
    el.textContent = '';
  }
}

// Round bank (running total of revealed points × multiplier)
function setBank(value) {
  const el = document.getElementById('gs-bank');
  if (!el) return;
  el.textContent = value;
  // The board now shows the total in its top panel (rb-total), so keep the
  // old standalone bank chip hidden.
  el.parentElement.classList.add('hidden');
}

// Static strike render (for reconnects); flashStrikes animates a new one.
function renderStrikes(count) {
  const el = document.getElementById('gs-strikes');
  el.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const x = document.createElement('span');
    x.className = 'gs-strike-x show';
    x.textContent = 'X';
    el.appendChild(x);
  }
}

function flashStrikes(count) {
  const el = document.getElementById('gs-strikes');
  // Add only the newest X with the slam animation; keep prior ones.
  const existing = el.querySelectorAll('.gs-strike-x').length;
  for (let i = existing; i < count; i++) {
    const x = document.createElement('span');
    x.className = 'gs-strike-x show';
    x.textContent = 'X';
    el.appendChild(x);
  }
  // Strikes auto-fade after a beat so they don't cover the board permanently.
  clearTimeout(flashStrikes._t);
  flashStrikes._t = setTimeout(() => { el.innerHTML = ''; }, 1500);
}

function renderScoreboard() {
  document.getElementById('gs-team1-name').textContent = gameState.teams.team1.name;
  document.getElementById('gs-team2-name').textContent = gameState.teams.team2.name;
  document.getElementById('gs-team1-score').textContent = gameState.teams.team1.score;
  document.getElementById('gs-team2-score').textContent = gameState.teams.team2.score;
}

function renderRoundIndicator() {
  const el = document.querySelector('.gs-round-text');
  if (gameState.phase === 'LOBBY') {
    el.textContent = 'FAMILY FEUD';
  } else if (gameState.suddenDeath) {
    el.textContent = 'SUDDEN DEATH';
  } else {
    const mult = gameState.roundMultiplier > 1 ? ` — ${gameState.roundMultiplier}x` : '';
    el.textContent = `ROUND ${gameState.round}${mult}`;
  }
}

function renderQuestion() {
  const q = gameState.currentQuestion;
  document.getElementById('gs-question').textContent = q ? q.text : '';
}

function renderBoard() {
  const slots = document.getElementById('rb-slots');
  const q = gameState.currentQuestion;
  if (!q) {
    renderedQuestionSig = null;
    slots.innerHTML = '';
    document.getElementById('rb-total').textContent = '';
    return;
  }

  // Sudden death shows a single slot (the #1 answer), like the show.
  const sd = gameState.suddenDeath;
  const list = sd ? q.answers.slice(0, 1) : q.answers;
  const count = sd ? 1 : (q.answerCount || q.answers.length);
  const sig = `${q.text}|${count}|${sd ? 'sd' : ''}`;

  if (sig !== renderedQuestionSig) {
    renderedQuestionSig = sig;
    slots.innerHTML = list.map((a, i) => rbCell(a, i)).join('');
    // Populate the rank strips one at a time, each with a quick whoosh.
    list.forEach((_, i) => setTimeout(() => Sounds.woosh(), 250 + i * 130));
  } else {
    list.forEach((a, i) => {
      const cell = slots.querySelector(`.rb-cell[data-position="${i}"]`);
      if (cell) syncRbCell(cell, a);
    });
  }

  document.getElementById('rb-total').textContent = sd ? '' : (gameState.roundBank || 0);
}

// Shrink the answer font for longer text so it fits the slot without clipping
// (short answers keep the full size). Returns a cqw string for --ans-fs.
function ansFontCqw(text) {
  const len = Math.max(1, (text || '').trim().length);
  const fs = Math.min(3.3, 38 / len); // ~fits the slot width (condensed display font)
  return Math.max(2.0, fs).toFixed(2) + 'cqw';
}

function rbCell(answer, position) {
  const revealed = answer.revealed;
  return `
    <div class="rb-cell rb-flipin${revealed ? ' revealed' : ''}" data-position="${position}" style="animation-delay:${0.25 + position * 0.13}s; --ans-fs:${ansFontCqw(answer.text)}">
      <span class="rb-rank">${position + 1}</span>
      <span class="rb-ans">${escapeHtml(answer.text || '')}</span>
      <span class="rb-pts">${answer.points != null ? answer.points : ''}</span>
    </div>`;
}

function syncRbCell(cell, answer) {
  cell.querySelector('.rb-ans').textContent = answer.text || '';
  cell.querySelector('.rb-pts').textContent = answer.points != null ? answer.points : '';
  cell.style.setProperty('--ans-fs', ansFontCqw(answer.text));
  cell.classList.toggle('revealed', !!answer.revealed);
}

// ---- Helpers ----
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
