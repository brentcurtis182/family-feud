// ---- Player phone (team buzzer) ----
const gameId = new URLSearchParams(window.location.search).get('gameId');
const socket = SocketClient.connect();

const myTeam = sessionStorage.getItem('ff_teamChoice') || 'team1';
const deviceId = localStorage.getItem('ff_deviceId') || 'dev-unknown';

let state = null;
let buzzedLocally = false;

socket.on('connect', () => {
  socket.emit('rejoin', { gameId, role: 'player', teamChoice: myTeam, playerName: deviceId });
});

socket.on('game-state-sync', (st) => { state = st; render(); });

socket.on('buzzers-open', () => { buzzedLocally = false; render(); });
socket.on('buzz-result', () => render());

// ---- Buzz (team-based: any teammate's tap buzzes for the team) ----
function buzz() {
  if (buzzedLocally) return;
  if (!state || !state.faceOff || !state.faceOff.buzzersOpen) return;
  buzzedLocally = true;
  Sounds.unlock();
  Sounds.buzz();
  socket.emit('buzz');
  render();
}

function iWon() {
  return state && state.faceOff && state.faceOff.winner === myTeam;
}

// ---- Render ----
function render() {
  if (!state) return;
  const team = state.teams[myTeam];
  document.getElementById('team-badge').textContent = team.name;
  document.getElementById('player-name').textContent = 'Team Buzzer';
  document.getElementById('team-score').textContent = team.score;

  const phase = state.phase;
  const fo = state.faceOff || {};

  if (phase.startsWith('FAST_MONEY')) {
    showView('status');
    setStatus(state.fastMoney && state.fastMoney.won
      ? '🎉 Watch the screen — they hit 200!'
      : '🏁 Fast Money — watch the screen!');
    return;
  }

  if (phase === 'FACE_OFF_READY') {
    showView('buzzer');
    setBuzzer(false, 'Get Ready…');
  } else if (phase === 'FACE_OFF_BUZZER') {
    showView('buzzer');
    if (buzzedLocally) setBuzzer(false, 'Buzzed! ⚡');
    else setBuzzer(true, 'BUZZ!');
  } else if (phase === 'FACE_OFF_ANSWER') {
    showView('status');
    setStatus(iWon() ? '⚡ Your team buzzed first!' : 'Other team buzzed first.');
  } else {
    showView('status');
    setStatus(spectatorStatus());
  }
}

function spectatorStatus() {
  const ap = state.activePlay || {};
  const teamName = (t) => state.teams[t].name;
  switch (state.phase) {
    case 'GAME_OVER':
      return state.winner ? `🏆 ${teamName(state.winner)} wins!` : 'Game over!';
    case 'ROUND_END': {
      const r = state.lastRoundResult;
      return r ? `${r.teamName} won the round (+${r.points})!` : 'Round over!';
    }
    case 'TEAM_PLAY':
      return ap.playingTeam === myTeam
        ? '▶ Your team is up — call out answers!'
        : `${teamName(ap.playingTeam)} is playing. Watch the screen!`;
    case 'STEAL_ATTEMPT':
      return ap.stealingTeam === myTeam
        ? '🎯 STEAL chance! One answer to take it.'
        : `${teamName(ap.stealingTeam)} is trying to steal…`;
    case 'LOBBY':
      return 'Waiting for the host to start…';
    default:
      return `Round ${state.round} — get ready!`;
  }
}

function showView(view) {
  document.getElementById('view-status').classList.toggle('hidden', view !== 'status');
  document.getElementById('view-buzzer').classList.toggle('hidden', view !== 'buzzer');
  const fm = document.getElementById('view-fastmoney');
  if (fm) fm.classList.add('hidden');
}

function setStatus(text) {
  document.getElementById('player-status').textContent = text;
}

function setBuzzer(active, label) {
  const btn = document.getElementById('buzz-btn');
  btn.textContent = label;
  btn.disabled = !active;
  btn.classList.toggle('armed', active);
}
