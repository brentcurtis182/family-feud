// ---- State ----
let gameState = null;
let selectedTopic = 'random';
let selectedSource = 'bank'; // default to the (now large) real-question bank
let generatingQuestion = false;
let fmSetupOpen = false;
let fmP1 = null, fmP2 = null, fmSource = 'bank';
// Fast Money capture state (host iPad mic)
let fmCapInitedFor = null;   // which phase the capture UI was initialized for
let fmCapPlayer = null;      // 'p1' | 'p2'
let fmCapIndex = 0;          // current question being read (0-4)
let fmDrafts = ['', '', '', '', ''];
let fmRec = null;            // SpeechRecognition instance (fallback engine)
let fmRecording = false;     // SR mic running (best-effort)
let fmCaptureActive = false; // capture session started (independent of mic)
let fmTimerInt = null;
let fmTimerStarted = false;
// Host answer visibility: null until first gameplay render, then defaults to
// hidden in host-only mode (the separate judge reveals) / shown in host+judge
// mode. The "Display Answers" button toggles it; the choice persists this session.
let showHostAnswers = null;
// Cloud STT (MediaRecorder → /api/transcribe) — preferred when configured
let fmUseCloud = false;
let fmStream = null, fmMediaRec = null, fmChunks = [], fmMime = '';
fetch('/api/stt-status').then((r) => r.json()).then((d) => { fmUseCloud = !!(d && d.available); }).catch(() => {});
const gameId = new URLSearchParams(window.location.search).get('gameId');

// ---- Init ----
const socket = SocketClient.connect();
SocketClient.saveSession(gameId, 'host');

// Rejoin the game room on connect
socket.on('connect', () => {
  socket.emit('rejoin', { gameId, role: 'host' });
});

// ---- Event Handlers ----

// Receive full state on join/rejoin
socket.on('game-created', ({ state }) => {
  updateState(state);
});

socket.on('game-state-sync', (state) => {
  updateState(state);
});

// A buzzer device joined — roster/counts come via game-state-sync; just toast.
socket.on('player-joined', ({ teamName }) => {
  showToast(`A buzzer joined ${teamName}!`, 'success');
});
socket.on('player-left', () => {});

// Judge joined/left
socket.on('judge-joined', () => {
  showToast('Judge has joined!', 'success');
});

socket.on('judge-left', () => {
  showToast('Judge disconnected.', 'error');
});

// Face-off buzz result
socket.on('buzz-result', ({ playerName, teamName, reactionMs }) => {
  showToast(`${playerName} (${teamName}) buzzed in — ${reactionMs}ms!`, 'success');
});

// Question generation lifecycle
socket.on('question-generating', () => {
  setGenerating(true);
});
socket.on('question-ready', () => {
  setGenerating(false);
});

// Steal result
socket.on('steal-result', ({ success, teamName }) => {
  showToast(success ? `STEAL! ${teamName} takes the bank.` : `Steal failed — bank stays with ${teamName}.`, success ? 'success' : 'error');
});

// Round / game end
socket.on('round-ended', ({ teamName, points, gameOver, winnerName }) => {
  if (gameOver) showToast(`${winnerName} wins the game! 🏆`, 'success');
  else showToast(`${teamName} wins the round (+${points})`, 'success');
});

// Phase changed
socket.on('phase-changed', ({ phase, round, roundMultiplier }) => {
  if (gameState) {
    gameState.phase = phase;
    gameState.round = round;
    gameState.roundMultiplier = roundMultiplier;
    renderPhase();
  }
});

// ---- Confirm dialog ----
// In-app replacement for native confirm(). The point is the ACTION BUTTON:
// mid-game the host isn't reading paragraphs, so a red "wipe scores" button is
// what actually distinguishes Restart Game from Reset Round sitting next to it.
// `body` is HTML — escape anything that came from a user (team names).
let _confirmAction = null;

function showConfirm({ title, body, okLabel, danger, onConfirm }) {
  _confirmAction = onConfirm;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').innerHTML = body;
  const ok = document.getElementById('confirm-ok');
  ok.textContent = okLabel;
  ok.classList.toggle('btn-danger', !!danger);
  ok.classList.toggle('btn-primary', !danger);
  document.getElementById('confirm-modal').classList.remove('hidden');
}

function closeConfirm() {
  _confirmAction = null;
  document.getElementById('confirm-modal').classList.add('hidden');
}

function acceptConfirm() {
  const fn = _confirmAction;
  closeConfirm();
  if (fn) fn();
}

// Tapping the backdrop (but not the card) cancels, same as Escape.
function confirmBackdrop(e) {
  if (e.target.id === 'confirm-modal') closeConfirm();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const m = document.getElementById('confirm-modal');
  if (m && !m.classList.contains('hidden')) closeConfirm();
});

// ---- Actions ----
// Logo → main menu. Instant from the lobby / game-over; mid-game it confirms
// first (you can always jump back via "Resume Hosting" on the main menu).
function goHome() {
  const midGame = gameState && gameState.phase !== 'LOBBY' && gameState.phase !== 'GAME_OVER';
  if (!midGame) { window.location.href = '/'; return; }
  showConfirm({
    title: 'Go to the main menu?',
    body: '<p>The game keeps running — you can come back any time via <b>Resume Hosting</b> on the main menu.</p>',
    okLabel: 'Go to Main Menu',
    danger: false,
    onConfirm: () => { window.location.href = '/'; },
  });
}

function startGame() {
  socket.emit('start-game');
  // Server auto-plays the theme on the TV — reflect that on the toggle.
  themeOn = true;
  const t = document.getElementById('btn-theme');
  if (t) t.classList.add('active');
}

// Both "Load Question" and "Change Question" open the picker (a hand of cards).
function loadQuestion() { openQuestionPicker(); }
function rerollQuestion() { openQuestionPicker(); }

// ---- Question picker (pick from 5, reshuffle) ----
let questionOptions = [];

function openQuestionPicker() {
  document.getElementById('question-picker-modal').classList.remove('hidden');
  requestQuestionOptions();
}

function requestQuestionOptions() {
  questionOptions = [];
  document.getElementById('qp-list').innerHTML = '<div class="qp-loading">🔀 Shuffling questions…</div>';
  socket.emit('request-question-options', { topic: selectedTopic, source: selectedSource });
}

function reshuffleQuestionOptions() { requestQuestionOptions(); }

function closeQuestionPicker() {
  document.getElementById('question-picker-modal').classList.add('hidden');
}

socket.on('question-options', ({ options }) => {
  setGenerating(false);
  questionOptions = options || [];
  renderQuestionOptions();
});

function renderQuestionOptions() {
  const list = document.getElementById('qp-list');
  if (!list) return;
  if (!questionOptions.length) {
    list.innerHTML = '<div class="qp-loading">No questions found — try Reshuffle.</div>';
    return;
  }
  list.innerHTML = questionOptions
    .map((q, i) => {
      const answers = q.answers
        .map((a) => `<span class="qp-ans">${escapeHtml(a.text)} <b>${a.points}</b></span>`)
        .join('');
      return `<button class="qp-option" onclick="chooseQuestion(${i})">
          <div class="qp-q">${escapeHtml(q.text)}</div>
          <div class="qp-answers">${answers}</div>
        </button>`;
    })
    .join('');
}

function chooseQuestion(i) {
  socket.emit('choose-question', { index: i });
  closeQuestionPicker();
}

function selectTopic(topic) {
  selectedTopic = topic;
  renderRoundSetup();
}

function selectSource(btn) {
  document.querySelectorAll('#q-source-row .toggle-option').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  selectedSource = btn.dataset.source;
  updateLoadButtonLabel();
}

function setGenerating(on) {
  generatingQuestion = on;
  const loading = document.getElementById('q-loading');
  if (loading) loading.classList.toggle('hidden', !on);
  document.getElementById('btn-load-q').disabled = on;
  const reroll = document.getElementById('btn-reroll-q');
  if (reroll) reroll.disabled = on;
}

function updateLoadButtonLabel() {
  const btn = document.getElementById('btn-load-q');
  const ai = gameState && gameState.aiAvailable && selectedSource === 'ai';
  btn.textContent = ai ? 'Pick a Question (AI)' : 'Pick a Question';
}

function selectFaceoff(team, playerName) {
  socket.emit('select-faceoff-players', { [`${team}Player`]: playerName });
}

function openBuzzers() {
  socket.emit('open-buzzers');
}

// Clicking "Open Buzzers" before it's ready explains exactly what's missing
// (instead of a dead, greyed-out button that confuses everyone).
function tryOpenBuzzers() {
  const fo = (gameState && gameState.faceOff) || {};
  const ready = fo.team1Player && fo.team2Player && gameState && gameState.currentQuestion;
  if (ready) { openBuzzers(); return; }
  const teams = gameState.teams;
  const item = (done, text) =>
    `<li class="bh-item ${done ? 'done' : 'todo'}">${done ? '✅' : '⬜'} ${text}</li>`;
  document.getElementById('bh-list').innerHTML =
    item(!!fo.team1Player, `Pick a contestant from <b>${escapeHtml(teams.team1.name)}</b>`) +
    item(!!fo.team2Player, `Pick a contestant from <b>${escapeHtml(teams.team2.name)}</b>`) +
    item(!!(gameState && gameState.currentQuestion), 'Pick a question');
  document.getElementById('buzzer-help-modal').classList.remove('hidden');
}

function closeBuzzerHelp() {
  document.getElementById('buzzer-help-modal').classList.add('hidden');
}

function resetFaceoff() {
  socket.emit('reset-faceoff');
}

function revealAnswer(position) {
  socket.emit('reveal-answer', { position });
}

// Toggle the host's own answer visibility (does not affect the TV or the judge).
function toggleHostAnswers() {
  showHostAnswers = !showHostAnswers;
  renderGameplay();
}

function addStrike() {
  // During the face-off answer a wrong buzz-in is a transient strike, not a
  // round strike; everywhere else it's a real strike.
  if (gameState && gameState.phase === 'FACE_OFF_ANSWER') socket.emit('faceoff-strike');
  else socket.emit('add-strike');
}

function choosePlay(team) {
  socket.emit('choose-play', { team });
}

function advanceRound() {
  socket.emit('advance-round');
}

function setCamera(angle) {
  socket.emit('set-camera', { angle });
}

// Theme + Applause toggles (play on the TV; click again to stop)
let themeOn = false, applauseOn = false;
function toggleTheme() {
  themeOn = !themeOn;
  socket.emit(themeOn ? 'play-sound' : 'stop-sound', { name: 'theme' });
  document.getElementById('btn-theme').classList.toggle('active', themeOn);
}
function toggleApplause() {
  applauseOn = !applauseOn;
  socket.emit(applauseOn ? 'play-sound' : 'stop-sound', { name: 'clap' });
  document.getElementById('btn-applause').classList.toggle('active', applauseOn);
}

// Mild action — neutral button, since this only redoes the current round.
function resetRound() {
  showConfirm({
    title: 'Reset this round?',
    body:
      '<p>Clears the question, board, strikes and face-off picks so you can replay this round.</p>' +
      '<p class="confirm-safe">✓ Scores are kept, and you stay on the same round.</p>',
    okLabel: '↺ Reset Round',
    danger: false,
    onConfirm: () => socket.emit('reset-round'),
  });
}

// ---- "We asked 100…" host patter suggestion (host-only reminder) ----
const FM_AUDIENCES = [
  '100 people', '100 married women', '100 married men', '100 men', '100 women',
  '100 husbands', '100 wives', '100 moms', '100 dads', '100 grandparents',
  '100 teenagers', '100 newlyweds', '100 single people',
];
let _suggestFor = null, _suggestAudience = null;

// Returns a "We asked 100 X…" reminder for the question, or null if it's already
// framed (a number/scale/we-asked question) and doesn't need one.
function questionSuggestion(qText) {
  if (!qText || /^(we asked|on a scale|how many|what percentage|at what age|according to)/i.test(qText.trim())) {
    return null;
  }
  if (_suggestFor !== qText) {
    _suggestFor = qText;
    _suggestAudience = FM_AUDIENCES[Math.floor(Math.random() * FM_AUDIENCES.length)];
  }
  return `💡 Try reading it as: “We surveyed ${_suggestAudience}…”`;
}

function showQuestionSuggestion(elId, qText) {
  const el = document.getElementById(elId);
  if (!el) return;
  const s = questionSuggestion(qText);
  el.textContent = s || '';
  el.classList.toggle('hidden', !s);
}

// ---- Rendering ----
function updateState(state) {
  gameState = state;

  // Update header
  document.getElementById('game-code').textContent = `Code: ${state.gameId}`;
  document.getElementById('team1-name').textContent = state.teams.team1.name;
  document.getElementById('team2-name').textContent = state.teams.team2.name;
  document.getElementById('team1-score').textContent = state.teams.team1.score;
  document.getElementById('team2-score').textContent = state.teams.team2.score;

  renderPhase();
}

function renderPhase() {
  if (!gameState) return;

  // Update round info (cleared back in the lobby — a restart drops to round 0
  // and the old label would otherwise stick around)
  if (gameState.suddenDeath) {
    document.getElementById('round-info').textContent = '🟥 Sudden Death';
  } else if (gameState.round > 0) {
    const multiplierText = gameState.roundMultiplier > 1 ? ` (${gameState.roundMultiplier}x)` : '';
    document.getElementById('round-info').textContent = `Round ${gameState.round}${multiplierText}`;
  } else {
    document.getElementById('round-info').textContent = '';
  }

  const isFM = gameState.phase.startsWith('FAST_MONEY');

  // Header buttons: available after the game starts
  const resetBtn = document.getElementById('btn-reset-round');
  if (resetBtn) resetBtn.classList.toggle('hidden', gameState.phase === 'LOBBY');
  const fmBtn = document.getElementById('btn-fastmoney');
  if (fmBtn) fmBtn.classList.toggle('hidden', gameState.phase === 'LOBBY' || isFM);
  // Roster editor is reachable in every phase once the game has started.
  const playersBtn = document.getElementById('btn-players');
  if (playersBtn) playersBtn.classList.toggle('hidden', gameState.phase === 'LOBBY');
  // Full restart is available in any phase once started — e.g. people show up
  // mid-game and you want to redo the teams from the lobby. GAME_OVER has its
  // own "Run It Back" button, so it isn't needed there.
  const restartBtn = document.getElementById('btn-restart-game');
  if (restartBtn) {
    restartBtn.classList.toggle('hidden', gameState.phase === 'LOBBY' || gameState.phase === 'GAME_OVER');
  }
  // Logo is always a link back to the main menu (Resume Hosting gets you back).
  const logo = document.getElementById('host-logo');
  if (logo) logo.classList.add('logo-link');
  // Keep the overlay live if it's open while state changes come in.
  if (rosterEditorOpen) renderRosterEditor();
  renderLineup();
  const camRow = document.getElementById('host-camera');
  if (camRow) camRow.classList.toggle('hidden', gameState.phase === 'LOBBY' || isFM);

  // Once Fast Money actually starts, close the local setup overlay
  if (isFM) fmSetupOpen = false;

  // Leaving the capture screen (reveal / reset / etc.) — tear down mic + timer
  if (gameState.phase !== 'FAST_MONEY_P1' && gameState.phase !== 'FAST_MONEY_P2') {
    if (fmTimerInt) { clearInterval(fmTimerInt); fmTimerInt = null; }
    stopFmRecognition();
    fmCapInitedFor = null;
  }

  // Show correct panel
  document.querySelectorAll('.host-panel').forEach((p) => p.classList.add('hidden'));

  // Host-local Fast Money setup overlay (not a server phase)
  if (fmSetupOpen && !isFM) {
    document.getElementById('panel-fastmoney-setup').classList.remove('hidden');
    renderFmSetup();
    return;
  }

  switch (gameState.phase) {
    case 'LOBBY':
      document.getElementById('panel-lobby').classList.remove('hidden');
      renderLobby();
      break;
    case 'ROUND_SETUP':
    case 'FACE_OFF_READY':
      document.getElementById('panel-round-setup').classList.remove('hidden');
      document.getElementById('setup-round-num').textContent = gameState.round;
      renderRoundSetup();
      break;
    case 'FACE_OFF_BUZZER':
      document.getElementById('panel-faceoff-buzzer').classList.remove('hidden');
      document.getElementById('fob-question').textContent =
        gameState.currentQuestion ? gameState.currentQuestion.text : '';
      showQuestionSuggestion('fob-q-suggest', gameState.currentQuestion ? gameState.currentQuestion.text : '');
      break;
    case 'TEAM_PLAY':
    case 'STEAL_ATTEMPT':
    case 'FACE_OFF_ANSWER':
    case 'ROUND_END':
      document.getElementById('panel-gameplay').classList.remove('hidden');
      renderGameplay();
      break;
    case 'GAME_OVER':
      document.getElementById('panel-game-over').classList.remove('hidden');
      renderGameOver();
      break;
    case 'FAST_MONEY_P1':
    case 'FAST_MONEY_P2':
      document.getElementById('panel-fastmoney-capture').classList.remove('hidden');
      initFmCapture();
      updateFmCaptureRemind();
      break;
    case 'FAST_MONEY_P2_WAIT':
      document.getElementById('panel-fastmoney-p2wait').classList.remove('hidden');
      renderFmP2Wait();
      break;
    case 'FAST_MONEY_P1_REVEAL':
    case 'FAST_MONEY_REVEAL':
      document.getElementById('panel-fastmoney-reveal').classList.remove('hidden');
      renderFmReveal();
      break;
    default:
      // Future phases will add more panels
      break;
  }
}

function renderRoundEnd() {
  const r = gameState.lastRoundResult;
  const el = document.getElementById('round-end-result');
  if (r) {
    el.innerHTML =
      `<div class="re-team text-yellow">${escapeHtml(r.teamName)}</div>` +
      `<div class="re-points">+${r.points} points</div>` +
      `<div class="re-scores">${escapeHtml(gameState.teams.team1.name)} ${gameState.teams.team1.score} &nbsp;—&nbsp; ${gameState.teams.team2.name} ${gameState.teams.team2.score}</div>`;
  }
  document.getElementById('btn-advance').textContent =
    gameState.round >= gameState.totalRounds ? 'Final Tally' : 'Next Round';
}

function renderGameOver() {
  const w = gameState.winner;
  const winnerName = w ? gameState.teams[w].name : '';
  document.getElementById('game-over-winner').innerHTML =
    `<span class="text-yellow">${escapeHtml(winnerName)}</span> wins!` +
    (gameState.suddenDeath ? ' <span style="color:var(--ff-red-glow)">(Sudden Death)</span>' : '');
  document.getElementById('game-over-scores').innerHTML =
    `${escapeHtml(gameState.teams.team1.name)}: ${gameState.teams.team1.score}<br>` +
    `${escapeHtml(gameState.teams.team2.name)}: ${gameState.teams.team2.score}`;
}

// ---- Fast Money (host) ----
function showFastMoneySetup() {
  fmSetupOpen = true;
  fmP1 = null;
  fmP2 = null;
  renderPhase();
}

function allPlayers() {
  if (!gameState) return [];
  const out = [];
  for (const t of ['team1', 'team2']) {
    for (const name of gameState.teams[t].roster || []) out.push({ playerName: name, team: t });
  }
  return out;
}

function renderFmSetup() {
  const players = allPlayers();
  const render = (containerId, selected, other, pick) => {
    const el = document.getElementById(containerId);
    if (players.length === 0) {
      el.innerHTML = '<div class="faceoff-empty">No players joined</div>';
      return;
    }
    el.innerHTML = players
      .map((p) => {
        const sel = p.playerName === selected ? ' selected' : '';
        const dis = p.playerName === other ? ' disabled' : '';
        return `<button class="faceoff-option${sel}"${dis} onclick="${pick}('${escapeHtml(p.playerName)}')">${escapeHtml(p.playerName)}</button>`;
      })
      .join('');
  };
  render('fm-p1-options', fmP1, fmP2, 'fmSelectP1');
  render('fm-p2-options', fmP2, fmP1, 'fmSelectP2');

  document.getElementById('fm-source-row').classList.toggle('hidden', !gameState.aiAvailable);
  if (!gameState.aiAvailable) fmSource = 'bank';

  const ready = fmP1 && fmP2 && fmP1 !== fmP2;
  document.getElementById('fm-start-btn').disabled = !ready;
  document.getElementById('fm-setup-hint').classList.toggle('hidden', !!ready);
}

function fmSelectP1(name) { fmP1 = name; renderFmSetup(); }
function fmSelectP2(name) { fmP2 = name; renderFmSetup(); }
function fmSelectSource(btn) {
  document.querySelectorAll('#fm-source-row .toggle-option').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  fmSource = btn.dataset.source;
}

// Start Fast Money → open the review modal with 5 questions to vet/swap first.
let fmReviewQuestions = [];
function startFastMoney() {
  if (!fmP1 || !fmP2) return;
  document.getElementById('fm-review-modal').classList.remove('hidden');
  document.getElementById('fm-review-list').innerHTML = '<div class="qp-loading">🔀 Generating 5 questions…</div>';
  socket.emit('fastmoney-prepare', { p1: fmP1, p2: fmP2, source: fmSource });
}

socket.on('fastmoney-options', ({ questions }) => {
  fmReviewQuestions = questions || [];
  renderFmReview();
});

function renderFmReview() {
  const list = document.getElementById('fm-review-list');
  if (!list) return;
  list.innerHTML = fmReviewQuestions
    .map((q, i) => {
      const answers = q.answers
        .map((a) => `<span class="qp-ans">${escapeHtml(a.text)} <b>${a.points}</b></span>`)
        .join('');
      const label = i === 0 ? `${i + 1}. (survey) ` : `${i + 1}. `;
      return `<div class="qp-option fm-review-item">
          <div class="qp-q">${label}${escapeHtml(q.text)}</div>
          <div class="qp-answers">${answers}</div>
          <button class="btn btn-secondary fm-swap-btn" onclick="fmSwap(${i})">🔀 Swap this one</button>
        </div>`;
    })
    .join('');
}

function fmSwap(i) {
  const item = document.querySelectorAll('#fm-review-list .fm-review-item')[i];
  if (item) item.style.opacity = '0.5';
  socket.emit('fastmoney-swap', { index: i });
}

function fmReshuffleAll() {
  document.getElementById('fm-review-list').innerHTML = '<div class="qp-loading">🔀 Reshuffling…</div>';
  socket.emit('fastmoney-reshuffle');
}

function fmConfirmStart() {
  socket.emit('fastmoney-confirm');
  closeFmReview();
}

function closeFmReview() {
  document.getElementById('fm-review-modal').classList.add('hidden');
}

function startFastMoneyP2() {
  socket.emit('fastmoney-start-p2');
}

// ---- Fast Money capture (continuous mic, runs until "Done") ----
function initFmCapture() {
  const fm = gameState.fastMoney;
  if (!fm) return;
  const phase = gameState.phase;
  if (fmCapInitedFor === phase) return; // build once per turn

  fmCapInitedFor = phase;
  fmCapPlayer = phase === 'FAST_MONEY_P2' ? 'p2' : 'p1';
  fmCapIndex = 0;
  fmDrafts = ['', '', '', '', ''];
  fmRecording = false;
  fmCaptureActive = false;
  fmTimerStarted = false;
  stopFmRecognition();
  if (fmTimerInt) { clearInterval(fmTimerInt); fmTimerInt = null; }

  const dur = fmCapPlayer === 'p2' ? 30 : 25;
  document.getElementById('fmc-title').textContent =
    `${fm.contestants[fmCapPlayer]} — ${fmCapPlayer === 'p2' ? 'Player 2' : 'Player 1'}`;
  document.getElementById('fmc-timer').textContent = `0:${String(dur).padStart(2, '0')}`;
  document.getElementById('fmc-transcript').textContent = '';
  const recBtn = document.getElementById('fmc-rec-btn');
  recBtn.textContent = '● Start Recording';
  recBtn.classList.remove('recording');
  recBtn.disabled = false;
  updateNextBtn();
  document.getElementById('fmc-mic-status').textContent = Voice.supported()
    ? '🎤 Tap Start, then read Q1. Mic keeps recording until you tap Done. (You can also type.)'
    : '⌨️ Voice not supported here — type each answer in the boxes below.';

  // Player 2's turn: show the duplicate buzzer + P1 answer references
  const isP2 = fmCapPlayer === 'p2';
  document.getElementById('fmc-dup').classList.toggle('hidden', !isP2);
  renderFmDrafts();
  renderFmP1Ref();
}

// On the last question the bottom button turns into the end-of-turn button, so
// the host can finish from where their thumb already is instead of scrolling
// back up to "Done". Jumping back to an earlier slot turns it into Next again.
function fmCaptureFinished() {
  return fmTimerStarted && fmCapIndex >= 4;
}

function updateNextBtn() {
  const b = document.getElementById('fmc-next');
  if (!b) return;
  const done = fmCaptureFinished();
  b.textContent = !fmTimerStarted
    ? '▶ Start Clock (stay on Q1)'
    : done
      ? '✓ Done — Review →'
      : `▶ Next Question (on Q${fmCapIndex + 1})`;
  b.classList.toggle('fmc-next-done', done);
}

// ---- Cloud STT capture (MediaRecorder → /api/transcribe) ----
async function fmEnsureStream() {
  if (fmStream) return fmStream;
  fmStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return fmStream;
}

function fmPickMime() {
  const cands = ['audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
  for (const c of cands) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function startMediaClip() {
  if (!fmStream) return;
  fmChunks = [];
  let rec;
  try { rec = new MediaRecorder(fmStream, fmMime ? { mimeType: fmMime } : undefined); }
  catch { rec = new MediaRecorder(fmStream); }
  const clipIndex = fmCapIndex;
  rec.ondataavailable = (e) => { if (e.data && e.data.size) fmChunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(fmChunks, { type: rec.mimeType || fmMime || 'audio/webm' });
    if (blob.size > 0) uploadClip(clipIndex, blob);
  };
  fmMediaRec = rec;
  rec.start();
}

function stopMediaClip() {
  if (fmMediaRec && fmMediaRec.state !== 'inactive') { try { fmMediaRec.stop(); } catch {} }
  fmMediaRec = null;
}

function uploadClip(index, blob) {
  const status = document.getElementById('fmc-mic-status');
  if (status) status.textContent = `📝 Transcribing answer ${index + 1}…`;
  fetch(`/api/transcribe?gameId=${encodeURIComponent(gameId)}&player=${fmCapPlayer}&index=${index}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  })
    .then((r) => r.json())
    .then((d) => {
      if (d && typeof d.text === 'string') {
        fmDrafts[index] = d.text; // server also stored it in fm.input
        const inp = document.getElementById(`fmc-draft-${index}`);
        if (inp && document.activeElement !== inp) inp.value = d.text;
        if (status) status.textContent = `✓ Answer ${index + 1}: "${d.text}"`;
      } else if (status) {
        status.textContent = d && d.error ? `Transcription error: ${d.error}` : 'Transcription failed — type it.';
      }
    })
    .catch(() => { if (status) status.textContent = 'Transcription failed — type it.'; });
}

function renderFmP1Ref() {
  const ref = document.getElementById('fmc-p1ref');
  if (fmCapPlayer !== 'p2') { ref.classList.add('hidden'); return; }
  const fm = gameState.fastMoney;
  const p1ans = fm.input.p1[fmCapIndex] || '(blank)';
  ref.classList.remove('hidden');
  ref.innerHTML = `${escapeHtml(fm.contestants.p1)} said: <b>"${escapeHtml(p1ans)}"</b> — buzz if duplicated!`;
}

function renderFmDrafts() {
  const fm = gameState.fastMoney;
  const isP2 = fmCapPlayer === 'p2';
  document.getElementById('fmc-list').innerHTML = fm.questions
    .map((q, i) => {
      const p1ref = isP2
        ? `<div class="fmc-p1inline">P1: "${escapeHtml(fm.input.p1[i] || '')}"</div>` : '';
      const active = i === fmCapIndex;
      // Tap the question (or the 🎤) to jump here and record into this slot —
      // handy when a player says "pass" and you circle back to it later.
      const badge = active && fmCaptureActive
        ? '<span class="fmc-rec-here">● recording</span>'
        : '<span class="fmc-tap-hint">🎤 tap to record</span>';
      return `
      <div class="fmc-draft ${active ? 'active' : ''}">
        <div class="fmc-draft-q" onclick="fmRecordSlot(${i})" title="Tap to record this answer">
          <span>${i + 1}. ${escapeHtml(q.text)}</span> ${badge}
        </div>
        ${p1ref}
        <div class="fmc-draft-row">
          <textarea class="input fmc-draft-input" id="fmc-draft-${i}" rows="2"
            oninput="fmDrafts[${i}]=this.value" placeholder="(answer)">${escapeHtml(fmDrafts[i])}</textarea>
          <button class="fmc-slot-mic" onclick="fmRecordSlot(${i})" title="Record / re-record this answer">🎤</button>
        </div>
      </div>`;
    })
    .join('');
}

function fmDupBuzz() {
  socket.emit('fastmoney-dup-buzz');
}

// Record (or re-record) a specific answer slot — e.g. a question the player
// passed on and wants to come back to. Each tap is a fresh gesture session.
async function fmRecordSlot(i) {
  if (!fmCaptureActive) {
    fmCaptureActive = true;
    if (!fmTimerStarted) {
      fmTimerStarted = true;
      const dur = fmCapPlayer === 'p2' ? 30 : 25;
      socket.emit('fastmoney-timer-start', { player: fmCapPlayer, duration: dur });
      startFmTimer(dur);
    }
  }
  fmCapIndex = i;
  if (fmUseCloud) {
    stopMediaClip();
    try { await fmEnsureStream(); fmMime = fmPickMime(); startMediaClip(); }
    catch { document.getElementById('fmc-mic-status').textContent = '🚫 Mic needs HTTPS + permission — type it instead.'; }
  } else {
    startFmRecognition();
  }
  updateNextBtn();
  renderFmDrafts();
  renderFmP1Ref();
  document.getElementById('fmc-mic-status').textContent = `🎤 Recording answer ${i + 1}…`;
}

// TOP button: just start recording the whole turn (no clock, no advancing).
async function fmStartRecording() {
  if (fmCaptureActive) return;
  fmCaptureActive = true;
  fmCapIndex = 0;
  if (fmUseCloud) {
    try { await fmEnsureStream(); fmMime = fmPickMime(); startMediaClip(); }
    catch { document.getElementById('fmc-mic-status').textContent = '🚫 Mic needs HTTPS + permission — type answers below.'; }
  } else {
    startFmRecognition(); // SpeechRecognition fallback (Chrome); typing always works
  }
  const rec = document.getElementById('fmc-rec-btn');
  if (rec) { rec.textContent = '● Recording…'; rec.classList.add('recording'); rec.disabled = true; }
  document.getElementById('fmc-mic-status').textContent =
    '🎤 Recording — read Q1, then tap the big Next Question button.';
  renderFmDrafts();
  renderFmP1Ref();
}

// BOTTOM button:
//   1st press = start the clock, STAY on Q1 (player answers Q1)
//   middle presses = advance to the next question
//   press on the last question = end the turn (same as "Done" up top)
function fmNextQuestion() {
  if (!fmCaptureActive) fmStartRecording(); // safety if they hit Next first

  if (!fmTimerStarted) {
    fmTimerStarted = true;
    const dur = fmCapPlayer === 'p2' ? 30 : 25;
    socket.emit('fastmoney-timer-start', { player: fmCapPlayer, duration: dur });
    startFmTimer(dur);
    updateNextBtn();
    return; // stay on Q1
  }

  if (fmCaptureFinished()) {
    fmSubmitCapture();
    return;
  }

  fmCapIndex++;
  if (fmUseCloud) { stopMediaClip(); startMediaClip(); }
  else { startFmRecognition(); }
  updateNextBtn();
  document.getElementById('fmc-transcript').textContent = fmDrafts[fmCapIndex] || '';
  renderFmDrafts();
  renderFmP1Ref();
}

function startFmRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { document.getElementById('fmc-mic-status').textContent = 'No mic — type answers.'; return; }
  stopFmRecognition();
  const r = new SR();
  r.lang = 'en-US';
  r.interimResults = true;
  r.continuous = true;
  let base = fmDrafts[fmCapIndex] ? fmDrafts[fmCapIndex] + ' ' : '';
  r.onresult = (e) => {
    let chunk = '';
    for (let i = e.resultIndex; i < e.results.length; i++) chunk += e.results[i][0].transcript;
    fmDrafts[fmCapIndex] = (base + chunk).trim();
    const inp = document.getElementById(`fmc-draft-${fmCapIndex}`);
    if (inp) inp.value = fmDrafts[fmCapIndex];
    document.getElementById('fmc-transcript').textContent = fmDrafts[fmCapIndex];
  };
  r.onerror = (e) => {
    const msgs = {
      'not-allowed': '🚫 Mic blocked — allow mic access (or just type the answers below).',
      'service-not-allowed': '🚫 Mic unavailable — type the answers below.',
      'audio-capture': '🎤 No mic found — type the answers below.',
      'no-speech': '',
    };
    const msg = e.error in msgs ? msgs[e.error] : `Mic issue (${e.error}) — you can type answers below.`;
    if (msg) document.getElementById('fmc-mic-status').textContent = msg;
  };
  r.onend = () => {
    // Keep recording until "Done": auto-restart this session if it's still the
    // active one (guard prevents a replaced recognizer from zombie-restarting).
    if (fmRecording && fmRec === r) {
      base = fmDrafts[fmCapIndex] ? fmDrafts[fmCapIndex] + ' ' : ''; // keep prior text
      try { r.start(); }
      catch { document.getElementById('fmc-mic-status').textContent = 'Mic paused — tap the button again, or type answers.'; }
    }
  };
  fmRec = r;
  fmRecording = true;
  Sounds.unlock();
  try { r.start(); } catch {}
  document.getElementById('fmc-mic-status').textContent = `🎤 Recording answer ${fmCapIndex + 1}…`;
}

function stopFmRecognition() {
  fmRecording = false;
  if (fmRec) { try { fmRec.stop(); } catch {} fmRec = null; }
}

function startFmTimer(seconds) {
  let left = seconds;
  const el = document.getElementById('fmc-timer');
  if (fmTimerInt) clearInterval(fmTimerInt);
  fmTimerInt = setInterval(() => {
    left--;
    el.textContent = `0:${String(Math.max(0, left)).padStart(2, '0')}`;
    if (left <= 0) {
      clearInterval(fmTimerInt); fmTimerInt = null;
      el.classList.add('times-up');
      document.getElementById('fmc-mic-status').textContent = "Time! Tap Done when ready.";
    }
  }, 1000);
}

function fmSubmitCapture() {
  stopFmRecognition();
  stopMediaClip();
  if (fmStream) { fmStream.getTracks().forEach((t) => t.stop()); fmStream = null; }
  fmCaptureActive = false;
  if (fmTimerInt) { clearInterval(fmTimerInt); fmTimerInt = null; }
  // Pull final values from the (possibly edited) inputs
  const answers = fmDrafts.map((_, i) => {
    const el = document.getElementById(`fmc-draft-${i}`);
    return el ? el.value.trim() : '';
  });
  socket.emit('fastmoney-submit', { player: fmCapPlayer, answers });
}

// ---- Fast Money player-2 hand-off ----
function renderFmP2Wait() {
  const fm = gameState.fastMoney;
  if (!fm) return;
  document.getElementById('fmw-p1total').textContent = fm.totals.p1;
  document.getElementById('fmw-need').textContent = Math.max(0, fm.target - fm.totals.p1);
  document.getElementById('fmw-p2name').textContent = fm.contestants.p2;
  const remindBtn = document.getElementById('fmw-remind');
  remindBtn.textContent = fm.remindP1 ? '🙈 Hide P1 Answers' : '👀 Remind: Show P1 Answers';
}

function fmToggleRemind() {
  const fm = gameState.fastMoney;
  socket.emit('fastmoney-remind', { show: !(fm && fm.remindP1) });
}

// Keep the P2 capture screen's "Show P1 Answers" toggle visible + labeled, so
// the host can flash P1's answers for the room to spot a duplicate.
function updateFmCaptureRemind() {
  const btn = document.getElementById('fmc-remind');
  if (!btn) return;
  const fm = gameState.fastMoney;
  const isP2 = gameState.phase === 'FAST_MONEY_P2';
  btn.classList.toggle('hidden', !isP2);
  if (isP2 && fm) btn.textContent = fm.remindP1 ? '🙈 Hide P1 Answers' : '👀 Show P1 Answers';
}

function fmToP2() {
  socket.emit('fastmoney-to-p2');
}

// ---- Fast Money reveal (two-click per row, single active player) ----
function renderFmReveal() {
  const fm = gameState.fastMoney;
  if (!fm) return;
  const player = gameState.phase === 'FAST_MONEY_REVEAL' ? 'p2' : 'p1';

  document.getElementById('fmr-title').textContent =
    `Reveal — ${fm.contestants[player]} (${player === 'p2' ? 'Player 2' : 'Player 1'})`;
  document.getElementById('fmr-total').textContent = fm.total;
  document.getElementById('fmr-won').classList.toggle('hidden', !fm.won);

  document.getElementById('fmr-questions').innerHTML = fm.questions
    .map((q, i) => `<div class="fmr-q">
        <div class="fmr-qtext">${i + 1}. ${escapeHtml(q.text)}</div>
        ${fmrRow(player, i, q)}
      </div>`)
    .join('');

  // "Continue to Player 2" only after P1's reveal
  document.getElementById('fmr-to-p2').classList.toggle('hidden', gameState.phase !== 'FAST_MONEY_P1_REVEAL');
  // After the final (P2) reveal, offer Run It Back regardless of win/lose.
  document.getElementById('fmr-runback').classList.toggle('hidden', gameState.phase !== 'FAST_MONEY_REVEAL');
}

function fmrRow(player, i, q) {
  const fm = gameState.fastMoney;
  const said = fm.input[player][i] || '';
  const r = fm.reveal[player][i];

  // Step 2 = pick the matching answer (chips clickable only once the cursor is placed)
  const pickStep = r.cursor && !r.answerRevealed;
  const dis = pickStep ? '' : 'disabled';
  // For P2, grey out the answer P1 already took (that would be a duplicate).
  const p1Took = player === 'p2' ? (fm.reveal.p1[i] && fm.reveal.p1[i].text) : null;
  const chips = q.answers
    .map((a, ai) => {
      const taken = p1Took && a.text === p1Took;
      const cls = taken ? 'fmr-chip taken' : 'fmr-chip';
      const d = (taken || !pickStep) ? 'disabled' : '';
      return `<button class="${cls}" ${d} onclick="fmPickChip('${player}',${i},${ai})">${escapeHtml(a.text)} <b>${a.points}</b></button>`;
    })
    .join('');
  const zero = `<button class="fmr-chip fmr-zero" ${dis} onclick="fmPickNoMatch('${player}',${i})">No match (0)</button>`;
  const dup = player === 'p2'
    ? `<button class="fmr-chip fmr-dup" ${dis} onclick="fmPickDup(${i})">Duplicate</button>` : '';

  // What the player said (transcript / memory aid) is read-only — it's often a
  // rambling sentence, and it used to pre-fill the edit box, so writing a clean
  // board version meant backspacing through the whole thing first. The box now
  // starts empty: type a short version, or leave it blank to put the transcript
  // on the board as-is.
  const heard = said
    ? `<div class="fmr-heard"><span class="fmr-name">they said:</span> “${escapeHtml(said)}”</div>`
    : `<div class="fmr-heard fmr-heard-empty"><span class="fmr-name">nothing captured</span></div>`;
  const transcript = `<div class="fmr-said">${heard}
      <textarea class="input fmr-answer-edit" id="fmr-said-${player}-${i}" rows="2" onchange="fmEdit('${player}',${i},this.value)" placeholder="${said ? '(optional — type a shorter version for the board)' : '(type what to show on the board)'}"></textarea>
    </div>`;

  // 3-beat reveal: ① cursor → ② pick answer (words flip + chase) → ③ score
  let action;
  if (!r.cursor) {
    action = `${transcript}<button class="btn btn-secondary fmr-reveal-btn" onclick="fmCursor('${player}',${i})">① Reveal (place cursor)</button>`;
  } else if (pickStep) {
    action = `${transcript}<div class="fmr-hint">② Click the answer the player gave ↑ (or No match / Duplicate)</div>`;
  } else if (!r.scoreRevealed) {
    action = `<div class="fmr-said">On board: <b>"${escapeHtml(r.text)}"</b></div>
      <button class="btn btn-primary fmr-reveal-btn" onclick="fmRevealScore('${player}',${i})">③ Reveal Score${r.duplicate ? ' (0)' : ' (' + r.points + ')'}</button>`;
  } else {
    const label = r.duplicate ? 'DUPLICATE (0)' : `${r.points} pts`;
    action = `<div class="fmr-said">"${escapeHtml(r.text)}" → <span class="fmr-assigned ${r.duplicate ? 'dup' : ''}">${label}</span>
      <button class="fmr-change" onclick="fmUnassign('${player}',${i})">change</button></div>`;
  }

  return `<div class="fmr-player">
    <div class="fmr-chips">${chips}${zero}${dup}</div>
    <div class="fmr-action">${action}</div>
  </div>`;
}

function fmCursor(player, index) {
  socket.emit('fastmoney-cursor', { player, index });
}

// Pick the survey answer the player matched → reveals the words on the board
function fmPickChip(player, qIndex, ansIndex) {
  const a = gameState.fastMoney.questions[qIndex].answers[ansIndex];
  socket.emit('fastmoney-pick', { player, index: qIndex, text: a.text, points: a.points, duplicate: false });
}
function fmPickNoMatch(player, index) {
  // Board text: the host's typed version if they wrote one, otherwise the
  // transcript as-is — so the audience still sees the player's answer at 0.
  const el = document.getElementById(`fmr-said-${player}-${index}`);
  const typed = ((el && el.value) || '').trim();
  const heard = (gameState.fastMoney.input[player][index] || '').trim();
  socket.emit('fastmoney-pick', { player, index, text: typed || heard || '—', points: 0, duplicate: false });
}
function fmPickDup(index) {
  socket.emit('fastmoney-pick', { player: 'p2', index, text: '—', points: 0, duplicate: true });
}

function fmRevealScore(player, index) {
  socket.emit('fastmoney-reveal-score', { player, index });
}

// Typing in the box replaces the stored answer. An empty box means "no
// override" (fall back to the transcript), so it must not wipe what's stored.
function fmEdit(player, index, text) {
  if (!text || !text.trim()) return;
  socket.emit('fastmoney-edit', { player, index, text });
}

function fmUnassign(player, index) {
  socket.emit('fastmoney-unassign', { player, index });
}

function renderRoundSetup() {
  if (!gameState) return;
  const fo = gameState.faceOff || {};

  // Source toggle (only meaningful when an API key is configured)
  document.getElementById('q-source-row').classList.toggle('hidden', !gameState.aiAvailable);
  if (!gameState.aiAvailable) selectedSource = 'bank';

  // Topic chips: Random + bank topics
  const chips = document.getElementById('topic-chips');
  const topics = ['random', ...(gameState.topics || [])];
  chips.innerHTML = topics
    .map((t) => {
      const sel = t === selectedTopic ? ' selected' : '';
      const label = t === 'random' ? 'Random' : t.charAt(0).toUpperCase() + t.slice(1);
      return `<button class="topic-chip${sel}" onclick="selectTopic('${t}')">${label}</button>`;
    })
    .join('');

  updateLoadButtonLabel();

  // Team names + contestant options (from the host-managed roster)
  for (const teamKey of ['team1', 'team2']) {
    document.getElementById(`fo-${teamKey}-name`).textContent = gameState.teams[teamKey].name;
    const selected = fo[`${teamKey}Player`] ? fo[`${teamKey}Player`].playerName : null;
    const roster = gameState.teams[teamKey].roster || [];
    const opts = document.getElementById(`fo-${teamKey}-options`);

    if (roster.length === 0) {
      opts.innerHTML = '<div class="faceoff-empty">Add players in the lobby first</div>';
    } else {
      // Numbered in line-up order; the pointer's pick comes in pre-selected.
      opts.innerHTML = roster
        .map((name, i) => {
          const sel = name === selected ? ' selected' : '';
          return `<button class="faceoff-option${sel}" onclick="lineupPick('${teamKey}', ${i})">` +
            `<span class="fo-order">${i + 1}</span>${escapeHtml(name)}</button>`;
        })
        .join('');
    }
  }

  // Question display
  const qDisplay = document.getElementById('setup-question-display');
  const hasQuestion = !!gameState.currentQuestion;
  if (hasQuestion) {
    qDisplay.textContent = gameState.currentQuestion.text;
    qDisplay.classList.remove('hidden');
    showQuestionSuggestion('setup-q-suggest', gameState.currentQuestion.text);
    document.getElementById('btn-load-q').classList.add('hidden');
    document.getElementById('btn-reroll-q').classList.remove('hidden');
  } else {
    qDisplay.classList.add('hidden');
    document.getElementById('setup-q-suggest').classList.add('hidden');
    document.getElementById('btn-load-q').classList.remove('hidden');
    document.getElementById('btn-reroll-q').classList.add('hidden');
  }

  // Open-buzzers readiness — keep the button clickable (so it can explain what's
  // missing) but give it the greyed "not ready" look until everything's set.
  const ready = fo.team1Player && fo.team2Player && hasQuestion;
  document.getElementById('btn-open-buzzers').classList.toggle('not-ready', !ready);
  document.getElementById('setup-hint').classList.toggle('hidden', !!ready);
}

function renderGameplay() {
  if (!gameState || !gameState.currentQuestion) return;
  const q = gameState.currentQuestion;
  const phase = gameState.phase;
  const fo = gameState.faceOff || {};
  const ap = gameState.activePlay || {};

  // Phase banner
  // Stakes banner (dramatic late-game / steal scenarios)
  const stakesEl = document.getElementById('gp-stakes');
  if (gameState.stakes) {
    stakesEl.textContent = gameState.stakes;
    stakesEl.classList.remove('hidden');
  } else {
    stakesEl.classList.add('hidden');
  }

  const sd = gameState.suddenDeath;
  const banner = document.getElementById('gp-faceoff-banner');
  banner.classList.remove('fo-duo-mode'); // only the regular face-off uses the 2-cell layout
  if (phase === 'FACE_OFF_ANSWER' && fo.winner && sd) {
    const turn = gameState.suddenDeathTurn || fo.winner;
    const turnName = gameState.teams[turn].name;
    const otherName = gameState.teams[turn === 'team1' ? 'team2' : 'team1'].name;
    banner.textContent = `🟥 SUDDEN DEATH — ${turnName}'s turn. Reveal the #1 answer if they got it (they WIN), or "Missed — pass to ${otherName}".`;
    banner.classList.remove('hidden');
  } else if (phase === 'FACE_OFF_ANSWER' && fo.winner) {
    // Two cells: who buzzed first (active) + the other contestant, so if the
    // buzzer misses the top answer the host can call on the other player.
    const winner = fo.winner;
    const otherT = winner === 'team1' ? 'team2' : 'team1';
    const wC = fo[`${winner}Player`], oC = fo[`${otherT}Player`];
    const wName = wC ? wC.playerName : gameState.teams[winner].name;
    const oName = oC ? oC.playerName : gameState.teams[otherT].name;
    banner.innerHTML =
      `<div class="fo-duo">` +
        `<div class="fo-cell fo-buzzed"><div class="fo-who">⚡ ${escapeHtml(wName)}</div>` +
          `<div class="fo-team">${escapeHtml(gameState.teams[winner].name)}</div>` +
          `<div class="fo-tag">buzzed first — reveal their answer</div></div>` +
        `<div class="fo-cell fo-other"><div class="fo-who">${escapeHtml(oName)}</div>` +
          `<div class="fo-team">${escapeHtml(gameState.teams[otherT].name)}</div>` +
          `<div class="fo-tag">if they miss the top answer, call this player</div></div>` +
      `</div>`;
    banner.classList.add('fo-duo-mode');
    banner.classList.remove('hidden');
  } else if (phase === 'TEAM_PLAY' && ap.playingTeam) {
    banner.textContent = `▶ ${gameState.teams[ap.playingTeam].name} is playing the board`;
    banner.classList.remove('hidden');
  } else if (phase === 'STEAL_ATTEMPT' && ap.stealingTeam) {
    banner.textContent = `🎯 ${gameState.teams[ap.stealingTeam].name} STEAL — reveal if right, or hit "Steal Failed"`;
    banner.classList.remove('hidden');
  } else if (phase === 'ROUND_END' && gameState.lastRoundResult) {
    const r = gameState.lastRoundResult;
    banner.textContent = `🏆 ${r.teamName} won the round (+${r.points})! Reveal any remaining answers, then Next Round.`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  // Phase actions (play-or-pass during the face-off answer; Next Round at end).
  // Sudden death has no play-or-pass — the win is decided by the top answer.
  const actions = document.getElementById('gp-actions');
  if (phase === 'FACE_OFF_ANSWER' && !sd) {
    actions.innerHTML =
      `<button class="btn btn-primary" onclick="choosePlay('team1')">${escapeHtml(gameState.teams.team1.name)} plays</button>` +
      `<button class="btn btn-primary" onclick="choosePlay('team2')">${escapeHtml(gameState.teams.team2.name)} plays</button>`;
    actions.classList.remove('hidden');
  } else if (phase === 'ROUND_END') {
    actions.innerHTML =
      `<button class="btn btn-primary" onclick="advanceRound()">${gameState.round >= gameState.totalRounds ? 'Final Tally →' : 'Next Round →'}</button>`;
    actions.classList.remove('hidden');
  } else {
    actions.innerHTML = '';
    actions.classList.add('hidden');
  }

  // Strike button: face-off wrong answer, normal strike, or steal-fail
  const strikeBtn = document.getElementById('btn-strike');
  if (phase === 'FACE_OFF_ANSWER' && sd) {
    const turn = gameState.suddenDeathTurn || fo.winner;
    const otherName = turn ? gameState.teams[turn === 'team1' ? 'team2' : 'team1'].name : 'other team';
    strikeBtn.textContent = `✗ Missed — pass to ${otherName}`;
    strikeBtn.classList.remove('hidden');
  } else if (phase === 'FACE_OFF_ANSWER') {
    strikeBtn.textContent = '✗ Strike (wrong answer)';
    strikeBtn.classList.remove('hidden');
  } else if (phase === 'TEAM_PLAY') {
    strikeBtn.textContent = 'Strike';
    strikeBtn.classList.remove('hidden');
  } else if (phase === 'STEAL_ATTEMPT') {
    strikeBtn.textContent = 'Steal Failed';
    strikeBtn.classList.remove('hidden');
  } else {
    strikeBtn.classList.add('hidden');
  }

  document.getElementById('gp-question').textContent = q.text;

  // Answers are shown by default; the host can tap "Hide Answers" for the fun
  // suspense aspect (handy with a separate judge handling reveals).
  if (showHostAnswers === null) showHostAnswers = true;
  const toggleBtn = document.getElementById('btn-toggle-answers');
  if (toggleBtn) toggleBtn.textContent = showHostAnswers ? '🙈 Hide Answers' : '👁 Display Answers';

  // Answer list. Revealed answers always show; unrevealed ones are concealed
  // unless the host has chosen to display them (then they're clickable to reveal).
  // Sudden death plays a single slot — only the #1 answer is in play.
  const answerList = sd ? q.answers.slice(0, 1) : q.answers;
  const concealing = !showHostAnswers && answerList.some((a) => !a.revealed);
  const hint = concealing
    ? '<div class="gp-answers-hint">🙈 Answers hidden — tap a row (or “Display Answers”) to show them</div>'
    : '';
  document.getElementById('gp-answers').innerHTML = hint + answerList
    .map((a, i) => {
      const isRev = !!a.revealed;
      const visible = isRev || showHostAnswers;
      // Revealed = no action; visible+unrevealed = reveal it; concealed = a tap
      // un-hides the host's answers (so it's never a dead button).
      const onclick = isRev ? ''
        : (showHostAnswers ? ` onclick="revealAnswer(${i})"` : ` onclick="toggleHostAnswers()"`);
      const check = isRev ? '&#10003;' : '';
      return `
        <div class="gp-answer${isRev ? ' revealed' : ''}${visible ? '' : ' concealed'}"${onclick}>
          <span class="gp-answer-rank">${i + 1}</span>
          <span class="gp-answer-text">${visible ? escapeHtml(a.text) : '• • •'}</span>
          <span class="gp-answer-points">${visible ? a.points : ''}</span>
          <span class="gp-answer-check">${check}</span>
        </div>`;
    })
    .join('');

  // Strikes (filled X up to 3)
  const strikes = gameState.activePlay ? gameState.activePlay.strikes : 0;
  let strikeHtml = '';
  for (let i = 0; i < 3; i++) {
    strikeHtml += `<span class="${i < strikes ? '' : 'strike-empty'}">X</span>`;
  }
  document.getElementById('gp-strikes').innerHTML = strikeHtml;

  // Bank
  document.getElementById('gp-bank').textContent = gameState.roundBank || 0;
}

function renderLobby() {
  if (!gameState) return;

  for (const teamKey of ['team1', 'team2']) {
    const team = gameState.teams[teamKey];
    document.getElementById(`lobby-${teamKey}-name`).textContent = team.name;

    const n = team.buzzerCount || 0;
    document.getElementById(`lobby-${teamKey}-buzzers`).textContent =
      `${n} buzzer${n === 1 ? '' : 's'} connected`;

    const list = document.getElementById(`lobby-${teamKey}-roster`);
    fillRosterList(list, teamKey, team.roster || []);
  }
}

// ---- Line-up strip ----
// Sits under the scoreboard in every in-game phase, so mid-round the host can
// always see both teams' order, who's at the podium and who's up next without
// digging into the roster editor.
let lineupCollapsed = false;

function toggleLineup() {
  lineupCollapsed = !lineupCollapsed;
  renderLineup();
}

function renderLineup() {
  if (!gameState) return;
  const strip = document.getElementById('host-lineup');
  if (!strip) return;

  const phase = gameState.phase;
  const hide = phase === 'LOBBY' || phase === 'GAME_OVER' || phase.startsWith('FAST_MONEY');
  strip.classList.toggle('hidden', hide);
  if (hide) return;

  strip.classList.toggle('lu-collapsed', lineupCollapsed);
  document.getElementById('lu-toggle').textContent = lineupCollapsed ? '▸' : '▾';

  // Only before the buzzers open can the host still swap who's up, so that's
  // the only time rows are tappable.
  const pickable = phase === 'ROUND_SETUP' || phase === 'FACE_OFF_READY';
  document.getElementById('lu-hint').classList.toggle('hidden', !pickable || lineupCollapsed);

  for (const teamKey of ['team1', 'team2']) {
    const team = gameState.teams[teamKey];
    const roster = team.roster || [];
    document.getElementById(`lu-${teamKey}-name`).textContent = team.name;

    const body = document.getElementById(`lu-${teamKey}-list`);
    if (roster.length === 0) {
      body.innerHTML = '<div class="lu-empty">No players — add them with 👥 Players</div>';
      continue;
    }

    // Who's up = this round's actual face-off pick, falling back to the line-up
    // pointer (they only differ briefly while a pick is being changed).
    const pick = (gameState.faceOff || {})[`${teamKey}Player`];
    const turnIdx = Math.min(team.turnIndex || 0, roster.length - 1);
    const curIdx = pick ? roster.indexOf(pick.playerName) : turnIdx;
    const nextIdx = (curIdx + 1 + roster.length) % roster.length;

    body.innerHTML = roster
      .map((name, i) => {
        const isCur = i === curIdx;
        const isNext = !isCur && i === nextIdx && roster.length > 1;
        const cls =
          'lu-row' +
          (isCur ? ' lu-current' : '') +
          (isNext ? ' lu-next' : '') +
          (pickable ? ' lu-pickable' : '');
        const tag = isCur
          ? '<span class="lu-tag lu-tag-up">UP</span>'
          : isNext
            ? '<span class="lu-tag">next</span>'
            : '';
        const click = pickable ? ` onclick="lineupPick('${teamKey}', ${i})"` : '';
        return `<div class="${cls}"${click}>` +
          `<span class="lu-num">${i + 1}</span>` +
          `<span class="lu-name">${escapeHtml(name)}</span>${tag}</div>`;
      })
      .join('');
  }
}

// Index-based so names with quotes/apostrophes can't break the handler.
function lineupPick(teamKey, index) {
  const name = ((gameState.teams[teamKey] || {}).roster || [])[index];
  if (name) selectFaceoff(teamKey, name);
}

// Shared editable roster list (lobby + roster editor). Rows are numbered in
// line-up order and get reorder (↑↓), rename (✎), move-to-other-team (⇄) and
// remove (✕) controls.
function fillRosterList(list, teamKey, roster) {
  if (!list) return;
  if (roster.length === 0) {
    list.innerHTML = '<li class="player-empty">No players added yet</li>';
    return;
  }
  list.innerHTML = roster
    .map((name, i) => rosterRowHtml(teamKey, name, i, roster.length))
    .join('');
}

function rosterRowHtml(teamKey, name, index, total) {
  const e = escapeHtml(name);
  return `<li class="player-item roster-item">
      <span class="roster-order">${index + 1}</span>
      <span class="roster-name">${e}</span>
      <span class="roster-actions">
        <button class="roster-btn" title="Move up in the line" ${index === 0 ? 'disabled' : ''} onclick="reorderRoster('${teamKey}', ${index}, 'up')">↑</button>
        <button class="roster-btn" title="Move down in the line" ${index === total - 1 ? 'disabled' : ''} onclick="reorderRoster('${teamKey}', ${index}, 'down')">↓</button>
        <button class="roster-btn" title="Rename" onclick="renameRoster('${teamKey}', '${e}')">✎</button>
        <button class="roster-btn" title="Move to other team" onclick="moveRoster('${teamKey}', '${e}')">⇄</button>
        <button class="roster-btn roster-x" title="Remove" onclick="removeRoster('${teamKey}', '${e}')">✕</button>
      </span>
    </li>`;
}

function reorderRoster(team, index, direction) {
  socket.emit('roster-reorder', { team, index, direction });
}

function addRoster(team, inputId) {
  const input = document.getElementById(inputId || `roster-input-${team}`);
  const name = input.value.trim();
  if (!name) return;
  socket.emit('roster-add', { team, name });
  input.value = '';
  input.focus();
}

function removeRoster(team, name) {
  socket.emit('roster-remove', { team, name });
}

function renameRoster(team, name) {
  const next = prompt('Rename player:', name);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed || trimmed === name) return;
  socket.emit('roster-rename', { team, oldName: name, newName: trimmed });
}

function moveRoster(team, name) {
  socket.emit('roster-move', { fromTeam: team, name });
}

// Persistent roster editor — open any time after the game starts via the header
// "👥 Players" button. Floats over whatever phase is live; the server broadcasts
// every change, so the TV and all devices update in real time.
let rosterEditorOpen = false;
function toggleRosterEditor() {
  rosterEditorOpen = !rosterEditorOpen;
  const modal = document.getElementById('roster-editor-modal');
  if (modal) modal.classList.toggle('hidden', !rosterEditorOpen);
  if (rosterEditorOpen) renderRosterEditor();
}

function renderRosterEditor() {
  if (!gameState) return;
  for (const teamKey of ['team1', 'team2']) {
    const nameEl = document.getElementById(`editor-${teamKey}-name`);
    if (nameEl) nameEl.textContent = gameState.teams[teamKey].name;
    const list = document.getElementById(`editor-${teamKey}-list`);
    fillRosterList(list, teamKey, gameState.teams[teamKey].roster || []);
  }
}

// Full restart → back to the lobby with scores and rounds wiped, teams, players
// and connected phones kept. Mid-game this throws away a game in progress, so
// the confirm spells out exactly what's being discarded.
function restartGame() {
  const phase = gameState ? gameState.phase : 'LOBBY';
  const midGame = phase !== 'LOBBY' && phase !== 'GAME_OVER';
  const t1 = gameState.teams.team1, t2 = gameState.teams.team2;
  const scoreline =
    `<p class="confirm-scores">${escapeHtml(t1.name)} <b>${t1.score}</b>` +
    `<span>—</span>${escapeHtml(t2.name)} <b>${t2.score}</b></p>`;

  showConfirm({
    title: midGame ? 'Restart the whole game?' : 'Run it back?',
    body: midGame
      ? `<p class="confirm-warn">⚠ Round ${gameState.round} is still in progress. It will be discarded and the score wiped:</p>` +
        scoreline +
        `<p>Teams, players and connected phones are kept. You'll go back to the lobby, where you can add players before starting again.</p>`
      : `<p>Resets scores and rounds back to the lobby.</p>` + scoreline +
        `<p>Teams, players and connected phones are kept.</p>`,
    okLabel: midGame ? '🔄 Yes, restart — wipe scores' : '🔄 Run It Back',
    danger: true,
    onConfirm: () => socket.emit('restart-game'),
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- Rejoin handler on server ----
// The server needs to handle 'rejoin' to re-add the socket to rooms
// This is handled in lobbyHandlers.js
