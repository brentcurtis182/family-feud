// ---- Judge panel (host-only mode) ----
// The judge adjudicates answers: reveals correct ones, calls strikes.
// The host still runs flow (picks players, loads questions, opens buzzers,
// chooses who plays, advances rounds).
let gameState = null;
const gameId = new URLSearchParams(window.location.search).get('gameId');
const socket = SocketClient.connect();
SocketClient.saveSession(gameId, 'judge');

socket.on('connect', () => {
  socket.emit('rejoin', { gameId, role: 'judge' });
});

socket.on('game-state-sync', (state) => {
  gameState = state;
  render();
});

// ---- Actions (authorized server-side via canControl) ----
function revealAnswer(position) {
  socket.emit('reveal-answer', { position });
}
function addStrike() {
  socket.emit('add-strike');
}

// ---- Render ----
const PLAY_PHASES = ['FACE_OFF_ANSWER', 'TEAM_PLAY', 'STEAL_ATTEMPT'];

function render() {
  if (!gameState) return;

  // Header bits
  document.getElementById('game-code').textContent = `Code: ${gameState.gameId}`;
  const mult = gameState.roundMultiplier > 1 ? ` (${gameState.roundMultiplier}x)` : '';
  document.getElementById('round-info').textContent =
    gameState.round > 0 ? `Round ${gameState.round}${mult}` : '';

  // Scores
  document.getElementById('j-team1-name').textContent = gameState.teams.team1.name;
  document.getElementById('j-team2-name').textContent = gameState.teams.team2.name;
  document.getElementById('j-team1-score').textContent = gameState.teams.team1.score;
  document.getElementById('j-team2-score').textContent = gameState.teams.team2.score;

  const phase = gameState.phase;
  const inPlay = PLAY_PHASES.includes(phase) && gameState.currentQuestion;

  show('judge-waiting', !inPlay && phase !== 'ROUND_END' && phase !== 'GAME_OVER');
  show('judge-gameplay', inPlay);
  show('judge-end', phase === 'ROUND_END' || phase === 'GAME_OVER');

  if (inPlay) renderGameplay();
  else if (phase === 'ROUND_END' || phase === 'GAME_OVER') renderEnd();
  else renderWaiting();
}

function renderWaiting() {
  const msg = {
    LOBBY: 'Waiting for the host to start the game…',
    ROUND_SETUP: 'Host is setting up the round…',
    FACE_OFF_READY: 'Face-off ready — waiting for the host to open the buzzers.',
    FACE_OFF_BUZZER: 'Buzzers are open — waiting for a buzz…',
  }[gameState.phase] || 'Waiting for the host…';
  document.getElementById('judge-waiting').textContent = msg;
}

function renderGameplay() {
  const q = gameState.currentQuestion;
  const phase = gameState.phase;
  const ap = gameState.activePlay || {};

  // Banner
  const banner = document.getElementById('j-banner');
  if (phase === 'FACE_OFF_ANSWER' && gameState.faceOff.winner) {
    const w = gameState.faceOff.winner;
    const c = gameState.faceOff[`${w}Player`];
    banner.textContent = `⚡ ${c ? c.playerName : ''} (${gameState.teams[w].name}) answers first — reveal if it's on the board`;
    banner.classList.remove('hidden');
  } else if (phase === 'TEAM_PLAY' && ap.playingTeam) {
    banner.textContent = `▶ ${gameState.teams[ap.playingTeam].name} is playing`;
    banner.classList.remove('hidden');
  } else if (phase === 'STEAL_ATTEMPT' && ap.stealingTeam) {
    banner.textContent = `🎯 ${gameState.teams[ap.stealingTeam].name} STEAL — reveal if right, or hit "Steal Failed"`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  document.getElementById('j-question').textContent = q.text;

  document.getElementById('j-answers').innerHTML = q.answers
    .map((a, i) => {
      const revealed = a.revealed ? ' revealed' : '';
      const onclick = a.revealed ? '' : ` onclick="revealAnswer(${i})"`;
      const check = a.revealed ? '&#10003;' : '';
      return `<div class="gp-answer${revealed}"${onclick}>
        <span class="gp-answer-rank">${i + 1}</span>
        <span class="gp-answer-text">${escapeHtml(a.text)}</span>
        <span class="gp-answer-points">${a.points}</span>
        <span class="gp-answer-check">${check}</span>
      </div>`;
    })
    .join('');

  // Strikes
  const strikes = ap.strikes || 0;
  let sh = '';
  for (let i = 0; i < 3; i++) sh += `<span class="${i < strikes ? '' : 'strike-empty'}">X</span>`;
  document.getElementById('j-strikes').innerHTML = sh;

  document.getElementById('j-bank').textContent = gameState.roundBank || 0;

  // Strike button label
  const strikeBtn = document.getElementById('j-strike');
  strikeBtn.textContent = phase === 'STEAL_ATTEMPT' ? 'Steal Failed' : 'Strike';
}

function renderEnd() {
  const el = document.getElementById('judge-end');
  if (gameState.phase === 'GAME_OVER' && gameState.winner) {
    el.innerHTML = `<div class="judge-end-title">🏆 ${escapeHtml(gameState.teams[gameState.winner].name)} wins!</div>
      <div class="judge-end-sub">Game over.</div>`;
  } else {
    const r = gameState.lastRoundResult;
    el.innerHTML = `<div class="judge-end-title">${r ? escapeHtml(r.teamName) + ' +' + r.points : 'Round over'}</div>
      <div class="judge-end-sub">Waiting for the host to continue…</div>`;
  }
}

// ---- Helpers ----
function show(id, on) {
  document.getElementById(id).classList.toggle('hidden', !on);
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
