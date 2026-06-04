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

// ---- Actions ----
function startGame() {
  socket.emit('start-game');
  // Server auto-plays the theme on the TV — reflect that on the toggle.
  themeOn = true;
  const t = document.getElementById('btn-theme');
  if (t) t.classList.add('active');
}

function loadQuestion() {
  setGenerating(true);
  socket.emit('set-question', { topic: selectedTopic, source: selectedSource });
}

function rerollQuestion() {
  setGenerating(true);
  socket.emit('reroll-question');
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
  btn.textContent = ai ? 'Generate Question (AI)' : 'Load Question';
}

function selectFaceoff(team, playerName) {
  socket.emit('select-faceoff-players', { [`${team}Player`]: playerName });
}

function openBuzzers() {
  socket.emit('open-buzzers');
}

function resetFaceoff() {
  socket.emit('reset-faceoff');
}

function revealAnswer(position) {
  socket.emit('reveal-answer', { position });
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

function resetRound() {
  if (confirm('Reset this round? Clears the question, board, strikes and face-off picks (scores stay).')) {
    socket.emit('reset-round');
  }
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

  // Update round info
  if (gameState.round > 0) {
    const multiplierText = gameState.roundMultiplier > 1 ? ` (${gameState.roundMultiplier}x)` : '';
    document.getElementById('round-info').textContent = `Round ${gameState.round}${multiplierText}`;
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
  // Keep the overlay live if it's open while state changes come in.
  if (rosterEditorOpen) renderRosterEditor();
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
    `<span class="text-yellow">${escapeHtml(winnerName)}</span> wins!`;
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

function startFastMoney() {
  if (!fmP1 || !fmP2) return;
  document.getElementById('fm-gen-loading').classList.remove('hidden');
  document.getElementById('fm-start-btn').disabled = true;
  socket.emit('fastmoney-start', { p1: fmP1, p2: fmP2, source: fmSource });
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

function updateNextBtn() {
  const b = document.getElementById('fmc-next');
  if (!b) return;
  if (!fmTimerStarted) b.textContent = '▶ Start Clock (stay on Q1)';
  else b.textContent = fmCapIndex < 4 ? `▶ Next Question (on Q${fmCapIndex + 1})` : '✓ On Q5 — tap Done above';
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
//   later presses = advance to the next question
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

  if (fmCapIndex < 4) {
    fmCapIndex++;
    if (fmUseCloud) { stopMediaClip(); startMediaClip(); }
    else { startFmRecognition(); }
  }
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

  // Transcript / memory aid — full text, wraps so nothing is cut off
  const transcript = `<div class="fmr-said"><span class="fmr-name">they said:</span>
      <textarea class="input fmr-answer-edit" rows="2" onchange="fmEdit('${player}',${i},this.value)" placeholder="(optional note)">${escapeHtml(said)}</textarea>
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
  // Blank board entry (a dash) — never dump the raw transcript onto the board.
  socket.emit('fastmoney-pick', { player, index, text: '—', points: 0, duplicate: false });
}
function fmPickDup(index) {
  socket.emit('fastmoney-pick', { player: 'p2', index, text: '—', points: 0, duplicate: true });
}

function fmRevealScore(player, index) {
  socket.emit('fastmoney-reveal-score', { player, index });
}

function fmEdit(player, index, text) {
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
      opts.innerHTML = roster
        .map((name) => {
          const sel = name === selected ? ' selected' : '';
          return `<button class="faceoff-option${sel}" onclick="selectFaceoff('${teamKey}', '${escapeHtml(name)}')">${escapeHtml(name)}</button>`;
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
    document.getElementById('btn-load-q').classList.add('hidden');
    document.getElementById('btn-reroll-q').classList.remove('hidden');
  } else {
    qDisplay.classList.add('hidden');
    document.getElementById('btn-load-q').classList.remove('hidden');
    document.getElementById('btn-reroll-q').classList.add('hidden');
  }

  // Open-buzzers readiness
  const ready = fo.team1Player && fo.team2Player && hasQuestion;
  document.getElementById('btn-open-buzzers').disabled = !ready;
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

  const banner = document.getElementById('gp-faceoff-banner');
  if (phase === 'FACE_OFF_ANSWER' && fo.winner) {
    const c = fo[`${fo.winner}Player`];
    const teamName = gameState.teams[fo.winner].name;
    banner.textContent = `⚡ ${c ? c.playerName : teamName} (${teamName}) buzzed first — reveal their answer, then pick who plays`;
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

  // Phase actions (play-or-pass during the face-off answer; Next Round at end)
  const actions = document.getElementById('gp-actions');
  if (phase === 'FACE_OFF_ANSWER') {
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
  if (phase === 'FACE_OFF_ANSWER') {
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

  // Answer list (host sees everything; click an unrevealed answer to reveal it)
  document.getElementById('gp-answers').innerHTML = q.answers
    .map((a, i) => {
      const revealed = a.revealed ? ' revealed' : '';
      const onclick = a.revealed ? '' : ` onclick="revealAnswer(${i})"`;
      const check = a.revealed ? '&#10003;' : '';
      return `
        <div class="gp-answer${revealed}"${onclick}>
          <span class="gp-answer-rank">${i + 1}</span>
          <span class="gp-answer-text">${escapeHtml(a.text)}</span>
          <span class="gp-answer-points">${a.points}</span>
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

// Shared editable roster list (lobby + round-setup). Each player gets
// rename (✎), move-to-other-team (⇄) and remove (✕) controls.
function fillRosterList(list, teamKey, roster) {
  if (!list) return;
  if (roster.length === 0) {
    list.innerHTML = '<li class="player-empty">No players added yet</li>';
    return;
  }
  list.innerHTML = roster.map((name) => rosterRowHtml(teamKey, name)).join('');
}

function rosterRowHtml(teamKey, name) {
  const e = escapeHtml(name);
  return `<li class="player-item roster-item">
      <span class="roster-name">${e}</span>
      <span class="roster-actions">
        <button class="roster-btn" title="Rename" onclick="renameRoster('${teamKey}', '${e}')">✎</button>
        <button class="roster-btn" title="Move to other team" onclick="moveRoster('${teamKey}', '${e}')">⇄</button>
        <button class="roster-btn roster-x" title="Remove" onclick="removeRoster('${teamKey}', '${e}')">✕</button>
      </span>
    </li>`;
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

function restartGame() {
  if (confirm('Run it back? Resets scores & rounds but keeps the same teams and players.')) {
    socket.emit('restart-game');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- Rejoin handler on server ----
// The server needs to handle 'rejoin' to re-add the socket to rooms
// This is handled in lobbyHandlers.js
