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
socket.on('answer-revealed', ({ position, roundBank }) => {
  const cell = document.querySelector(`.rb-cell[data-position="${position}"]`);
  if (cell && !cell.classList.contains('revealed')) {
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
  Sounds.unlock();
});

socket.on('buzz-result', ({ winner, playerName, teamName }) => {
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
  if (success) Sounds.ding(); // steal success = correct answer; failure already struck
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
  if (duplicate) Sounds.duplicateSound(); else Sounds.fmDingSound();
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
  let left = duration || 20;
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
  renderStrikes(gameState.activePlay ? gameState.activePlay.strikes : 0);
  renderEndState();
}

// Giant buzz-in banner — shown while the buzz winner answers (FACE_OFF_ANSWER)
function renderBuzzIn() {
  const el = document.getElementById('gs-buzzin');
  if (!el) return;
  const fo = gameState.faceOff || {};
  if (gameState.phase === 'FACE_OFF_ANSWER' && fo.winner) {
    const c = fo[`${fo.winner}Player`];
    const who = c ? c.playerName : gameState.teams[fo.winner].name;
    el.className = 'gs-buzzin ' + fo.winner;
    el.textContent = `⚡ ${(who || '').toUpperCase()} — IN!`;
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
      `<div class="ov-sub">WINS!</div>` +
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

  for (const p of ['p1', 'p2']) {
    fm.reveal[p].forEach((r, i) => {
      const ans = document.querySelector(`.fmb-cell[data-slot="${p}-ans-${i}"]`);
      const pts = document.querySelector(`.fmb-cell[data-slot="${p}-pts-${i}"]`);
      if (ans) {
        ans.textContent = r.answerRevealed ? (r.duplicate ? '✗ DUPE' : (r.text || '')) : '';
        ans.classList.toggle('duplicate', !!r.duplicate);
      }
      if (pts) pts.textContent = r.scoreRevealed ? (r.duplicate ? '0' : r.points) : '';
    });
  }

  document.getElementById('fmb-total').textContent = fm.total;
}

// Pink cursor sweeps left→right across the answer as the words wipe in.
function chaseReveal(cell, text) {
  const ansEl = cell.querySelector('.fm-cell-ans');
  const cursor = cell.querySelector('.fm-cursor');
  if (!ansEl || !cursor) return;

  ansEl.textContent = text;
  cell.classList.add('revealed');

  const dur = 650;
  const w = ansEl.getBoundingClientRect().width;
  const startX = ansEl.offsetLeft;

  // Clip the words and park the cursor at the answer's left edge
  ansEl.style.clipPath = 'inset(0 100% 0 0)';
  ansEl.style.transition = 'none';
  cursor.style.position = 'absolute';
  cursor.style.left = startX + 'px';
  cursor.style.transform = 'translateX(0)';
  cursor.style.opacity = '1';
  cursor.style.animation = 'none';
  void cell.offsetWidth; // reflow

  // Wipe the words open and chase the cursor across (chunky, like the board)
  ansEl.style.transition = `clip-path ${dur}ms steps(16)`;
  ansEl.style.clipPath = 'inset(0 0 0 0)';
  cursor.style.transition = `transform ${dur}ms steps(16)`;
  cursor.style.transform = `translateX(${w}px)`;

  clearTimeout(chaseReveal._t);
  chaseReveal._t = setTimeout(() => {
    // Clear inline styles; let state-driven render restore the score-side cursor
    ansEl.style.clipPath = '';
    ansEl.style.transition = '';
    cursor.style.position = '';
    cursor.style.left = '';
    cursor.style.transform = '';
    cursor.style.transition = '';
    cursor.style.animation = '';
    cursor.style.opacity = '';
    renderAll();
  }, dur + 80);
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

  const count = q.answerCount || q.answers.length;
  const sig = `${q.text}|${count}`;

  if (sig !== renderedQuestionSig) {
    renderedQuestionSig = sig;
    slots.innerHTML = q.answers.map((a, i) => rbCell(a, i)).join('');
    // Populate the rank strips one at a time, each with a quick whoosh.
    q.answers.forEach((_, i) => setTimeout(() => Sounds.woosh(), 250 + i * 130));
  } else {
    q.answers.forEach((a, i) => {
      const cell = slots.querySelector(`.rb-cell[data-position="${i}"]`);
      if (cell) syncRbCell(cell, a);
    });
  }

  document.getElementById('rb-total').textContent = gameState.roundBank || 0;
}

function rbCell(answer, position) {
  const revealed = answer.revealed;
  return `
    <div class="rb-cell rb-flipin${revealed ? ' revealed' : ''}" data-position="${position}" style="animation-delay:${0.25 + position * 0.13}s">
      <span class="rb-rank">${position + 1}</span>
      <span class="rb-ans">${escapeHtml(answer.text || '')}</span>
      <span class="rb-pts">${answer.points != null ? answer.points : ''}</span>
    </div>`;
}

function syncRbCell(cell, answer) {
  cell.querySelector('.rb-ans').textContent = answer.text || '';
  cell.querySelector('.rb-pts').textContent = answer.points != null ? answer.points : '';
  cell.classList.toggle('revealed', !!answer.revealed);
}

// ---- Helpers ----
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
