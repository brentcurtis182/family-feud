// ---- State ----
let selectedHostMode = 'host-judge';
let selectedGameId = null;
let selectedGameInfo = null;
let selectedTeam = null;

// ---- Init ----
const socket = SocketClient.connect();

// ---- Screen Navigation ----
function showScreen(screen) {
  document.querySelectorAll('[id^="screen-"]').forEach((el) => {
    el.classList.add('hidden');
  });
  document.getElementById(`screen-${screen}`).classList.remove('hidden');

  if (screen === 'join') {
    refreshGames();
  }
}

// ---- Create Game ----
function selectHostMode(btn) {
  document.querySelectorAll('.toggle-option').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  selectedHostMode = btn.dataset.mode;
}

function createGame() {
  const team1 = document.getElementById('create-team1').value.trim();
  const team2 = document.getElementById('create-team2').value.trim();
  const passcode = document.getElementById('create-passcode').value.trim();

  if (!team1 || !team2) {
    showToast('Please enter both team names.', 'error');
    return;
  }
  if (!passcode) {
    showToast('Please enter a game passcode.', 'error');
    return;
  }

  SocketClient.emit('create-game', {
    hostMode: selectedHostMode,
    team1Name: team1,
    team2Name: team2,
    passcode,
  });
}

SocketClient.on('game-created', ({ gameId, state }) => {
  SocketClient.saveSession(gameId, 'host');
  // Redirect to host page
  window.location.href = `/host.html?gameId=${gameId}`;
});

// ---- Resume Hosting ----
// Show a "Resume Hosting" shortcut on the landing screen if this tab has a saved
// host session AND that game is still active (so the host who hopped back to the
// main menu can reclaim control instead of stranding the game).
function updateResumeButton(games) {
  const btn = document.getElementById('btn-resume-host');
  if (!btn) return;
  const gameId = sessionStorage.getItem('ff_gameId');
  const role = sessionStorage.getItem('ff_role');
  if (role === 'host' && gameId) {
    const g = (games || []).find((x) => x.gameId === gameId);
    if (g) {
      btn.textContent = `▶ Resume Hosting: ${g.team1Name} vs ${g.team2Name}`;
      btn.classList.remove('hidden');
      return;
    }
    SocketClient.clearSession(); // game ended/deleted — drop the stale session
  }
  btn.classList.add('hidden');
}

function resumeHosting() {
  const gameId = sessionStorage.getItem('ff_gameId');
  if (gameId) window.location.href = `/host.html?gameId=${gameId}`;
}

// Check for a resumable host game as soon as we connect (and on landing load).
SocketClient.on('connect', () => SocketClient.emit('list-games', {}));

// ---- Join Game ----
function refreshGames() {
  SocketClient.emit('list-games', {});
}

SocketClient.on('games-list', (games) => {
  // A saved host session (sessionStorage survives the same-tab logo-link hop)
  // lets the host jump straight back into a game they stepped away from.
  updateResumeButton(games);

  const container = document.getElementById('games-list');

  if (!games || games.length === 0) {
    container.innerHTML = '<div class="no-games">No active games found. Ask the host to start one!</div>';
    return;
  }

  container.innerHTML = games
    .map(
      (g) => `
    <div class="game-item">
      <div class="game-item-main" onclick="selectGame('${g.gameId}', '${escapeHtml(g.team1Name)}', '${escapeHtml(g.team2Name)}', '${g.hostMode}')">
        <div class="game-item-teams">
          <span>${escapeHtml(g.team1Name)}</span>
          <span class="game-item-vs">VS</span>
          <span>${escapeHtml(g.team2Name)}</span>
        </div>
        <div class="game-item-players">${g.playerCount} player${g.playerCount !== 1 ? 's' : ''} joined</div>
      </div>
      <button class="game-delete" title="Delete game"
        onclick="askDeleteGame('${g.gameId}', '${escapeHtml(g.team1Name)} vs ${escapeHtml(g.team2Name)}')">&times;</button>
    </div>
  `
    )
    .join('');
});

// ---- Delete game (cleanup) ----
let pendingDeleteId = null;

function askDeleteGame(gameId, label) {
  pendingDeleteId = gameId;
  document.getElementById('delete-modal-text').textContent =
    `"${label}" will be ended for anyone connected. This can't be undone.`;
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  document.getElementById('delete-modal').classList.add('hidden');
}

function confirmDelete() {
  if (pendingDeleteId) SocketClient.emit('delete-game', { gameId: pendingDeleteId });
  closeDeleteModal();
}

SocketClient.on('game-deleted-ok', () => {
  showToast('Game deleted.', 'success');
  refreshGames();
});

function selectGame(gameId, team1Name, team2Name, hostMode) {
  selectedGameId = gameId;
  selectedGameInfo = { team1Name, team2Name, hostMode };

  document.getElementById('passcode-game-title').innerHTML =
    `<span class="text-yellow">${team1Name}</span> <span style="color:var(--ff-gray)">VS</span> <span class="text-yellow">${team2Name}</span>`;

  showScreen('passcode');
  document.getElementById('join-passcode').focus();
}

function submitPasscode() {
  const passcode = document.getElementById('join-passcode').value.trim();
  if (!passcode) {
    showToast('Please enter the game passcode.', 'error');
    return;
  }
  // Verify with the server BEFORE moving on, so a wrong code stops here.
  SocketClient.emit('verify-passcode', { gameId: selectedGameId, passcode });
}

SocketClient.on('passcode-result', ({ ok, reason }) => {
  if (ok) {
    selectedGameInfo.passcode = document.getElementById('join-passcode').value.trim();
    buildRoleSelection();
    showScreen('role');
  } else {
    showToast(reason || 'Incorrect passcode.', 'error');
  }
});

// ---- Role Selection ----
function buildRoleSelection() {
  const container = document.getElementById('role-buttons');
  let html = '';

  // Player option (always available)
  html += `
    <div class="role-btn" onclick="selectRole('player')">
      <div class="role-btn-title">Player</div>
      <div class="role-btn-desc">Join a team and use the buzzer</div>
    </div>
  `;

  // Game Screen option (always available)
  html += `
    <div class="role-btn" onclick="selectRole('gamescreen')">
      <div class="role-btn-title">Game Screen</div>
      <div class="role-btn-desc">Display the game board on a TV</div>
    </div>
  `;

  // Judge option (only if host chose host-only mode)
  if (selectedGameInfo.hostMode === 'host-only') {
    html += `
      <div class="role-btn" onclick="selectRole('judge')">
        <div class="role-btn-title">Judge</div>
        <div class="role-btn-desc">Control answer reveals and strikes</div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function selectRole(role) {
  if (role === 'player') {
    buildTeamSelection();
    showScreen('player-setup');
    document.getElementById('player-name').focus();
  } else if (role === 'gamescreen') {
    joinGame('gamescreen');
  } else if (role === 'judge') {
    joinGame('judge');
  }
}

// ---- Team Selection (tapping a team joins immediately as a buzzer) ----
function buildTeamSelection() {
  const container = document.getElementById('team-buttons');
  container.innerHTML = `
    <div class="team-btn" onclick="joinAsPlayer('team1')">${escapeHtml(selectedGameInfo.team1Name)}</div>
    <div class="team-btn" onclick="joinAsPlayer('team2')">${escapeHtml(selectedGameInfo.team2Name)}</div>
  `;
}

// Stable per-device id so reconnects don't create duplicate buzzers.
function getDeviceId() {
  let id = localStorage.getItem('ff_deviceId');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('ff_deviceId', id);
  }
  return id;
}

function joinAsPlayer(team) {
  sessionStorage.setItem('ff_teamChoice', team);
  joinGame('player', team, getDeviceId());
}

// ---- Join Game (send to server) ----
function joinGame(role, teamChoice, playerName) {
  SocketClient.emit('join-game', {
    gameId: selectedGameId,
    passcode: selectedGameInfo.passcode,
    role,
    teamChoice,
    playerName,
  });
}

SocketClient.on('game-joined', ({ gameId, role, state }) => {
  SocketClient.saveSession(gameId, role);

  if (role === 'player') {
    window.location.href = `/player.html?gameId=${gameId}`;
  } else if (role === 'gamescreen') {
    window.location.href = `/game-screen.html?gameId=${gameId}`;
  } else if (role === 'judge') {
    window.location.href = `/judge.html?gameId=${gameId}`;
  }
});

// ---- Helpers ----
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Handle enter key on passcode input
document.addEventListener('DOMContentLoaded', () => {
  const passcodeInput = document.getElementById('join-passcode');
  if (passcodeInput) {
    passcodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitPasscode();
    });
  }
});
