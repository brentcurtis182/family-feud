const aiQuestions = require('./aiQuestions');
const questions = require('./questions');

// Game phases
const PHASES = {
  LOBBY: 'LOBBY',
  ROUND_SETUP: 'ROUND_SETUP',
  AWAITING_QUESTION: 'AWAITING_QUESTION',
  FACE_OFF_READY: 'FACE_OFF_READY',
  FACE_OFF_BUZZER: 'FACE_OFF_BUZZER',
  FACE_OFF_ANSWER: 'FACE_OFF_ANSWER',
  PLAY_OR_PASS: 'PLAY_OR_PASS',
  TEAM_PLAY: 'TEAM_PLAY',
  STEAL_ATTEMPT: 'STEAL_ATTEMPT',
  ROUND_END: 'ROUND_END',
  FAST_MONEY_SETUP: 'FAST_MONEY_SETUP',
  FAST_MONEY_P1: 'FAST_MONEY_P1',
  FAST_MONEY_P1_REVEAL: 'FAST_MONEY_P1_REVEAL',
  FAST_MONEY_P2_WAIT: 'FAST_MONEY_P2_WAIT',
  FAST_MONEY_P2: 'FAST_MONEY_P2',
  FAST_MONEY_REVEAL: 'FAST_MONEY_REVEAL',
  GAME_OVER: 'GAME_OVER',
  SUDDEN_DEATH: 'SUDDEN_DEATH',
};

// Round multipliers: rounds 1 & 2 single, round 3 double, round 4 triple.
const ROUND_MULTIPLIERS = { 1: 1, 2: 1, 3: 2, 4: 3 };

// In-memory game store
const games = new Map();

function generateGameId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function createGame({ hostSocketId, hostMode, team1Name, team2Name, passcode }) {
  let gameId;
  do {
    gameId = generateGameId();
  } while (games.has(gameId));

  const game = {
    gameId,
    passcode,
    hostSocketId,
    hostMode, // 'host-only' or 'host-judge'
    createdAt: Date.now(),

    teams: {
      // players = connected buzzer devices (team-based, no names needed);
      // roster = named team members the HOST manages (used for face-off / fast money).
      team1: { name: team1Name, score: 0, players: [], roster: [] },
      team2: { name: team2Name, score: 0, players: [], roster: [] },
    },

    judgeSocketId: null,
    gameScreenSocketIds: [],

    phase: PHASES.LOBBY,
    round: 0,
    roundMultiplier: 1,
    totalRounds: 4,

    currentQuestion: null,
    roundBank: 0,
    lastRoundResult: null, // { winningTeam, teamName, points } for ROUND_END display
    winner: null, // 'team1' | 'team2' once the game is won
    suddenDeath: false,

    faceOff: {
      team1Player: null,
      team2Player: null,
      buzzes: [],
      winner: null,
      buzzersOpen: false,
      openTime: null,
    },

    activePlay: {
      playingTeam: null,
      stealingTeam: null,
      strikes: 0,
      revealedIndices: [],
      isStealing: false,
    },

    fastMoney: null,
    usedQuestionHashes: new Set(),
    recentQuestions: [], // texts of questions already asked this game (to steer AI away from repeats)
  };

  games.set(gameId, game);
  return game;
}

function getGame(gameId) {
  return games.get(gameId) || null;
}

function listGames() {
  const list = [];
  for (const game of games.values()) {
    list.push({
      gameId: game.gameId,
      team1Name: game.teams.team1.name,
      team2Name: game.teams.team2.name,
      hostMode: game.hostMode,
      playerCount:
        game.teams.team1.players.length + game.teams.team2.players.length,
      phase: game.phase,
    });
  }
  return list;
}

function deleteGame(gameId) {
  games.delete(gameId);
}

function addPlayer(gameId, { socketId, playerName, team }) {
  const game = games.get(gameId);
  if (!game) return null;

  const player = { socketId, playerName, joinedAt: Date.now() };
  game.teams[team].players.push(player);
  return player;
}

function removePlayerBySocket(gameId, socketId) {
  const game = games.get(gameId);
  if (!game) return;

  for (const teamKey of ['team1', 'team2']) {
    const idx = game.teams[teamKey].players.findIndex(
      (p) => p.socketId === socketId
    );
    if (idx !== -1) {
      game.teams[teamKey].players.splice(idx, 1);
      return { team: teamKey };
    }
  }
  return null;
}

function setPhase(gameId, phase) {
  const game = games.get(gameId);
  if (!game) return null;
  game.phase = phase;
  return game;
}

function resetFaceOff(game) {
  game.faceOff = {
    team1Player: null,
    team2Player: null,
    buzzes: [],
    winner: null,
    buzzersOpen: false,
    openTime: null,
  };
}

function resetActivePlay(game) {
  game.activePlay = {
    playingTeam: null,
    stealingTeam: null,
    strikes: 0,
    revealedIndices: [],
    isStealing: false,
  };
}

function startNextRound(game) {
  game.round += 1;
  game.roundMultiplier = ROUND_MULTIPLIERS[game.round] || 3;
  game.currentQuestion = null;
  game.roundBank = 0;
  game.lastRoundResult = null;
  resetFaceOff(game);
  resetActivePlay(game);
  game.phase = PHASES.ROUND_SETUP;
}

function calculateRoundBank(game) {
  if (!game.currentQuestion) return 0;
  let total = 0;
  for (const idx of game.activePlay.revealedIndices) {
    total += game.currentQuestion.answers[idx].points;
  }
  return total * game.roundMultiplier;
}

function awardPoints(game, team) {
  const points = calculateRoundBank(game);
  game.teams[team].score += points;
  return points;
}

function checkWinCondition(game) {
  if (game.teams.team1.score >= 300) return 'team1';
  if (game.teams.team2.score >= 300) return 'team2';
  return null;
}

function otherTeam(team) {
  return team === 'team1' ? 'team2' : 'team1';
}

function allAnswersRevealed(game) {
  return (
    !!game.currentQuestion &&
    game.currentQuestion.answers.every((a) => a.revealed)
  );
}

// ---- Fast Money ----
const FAST_MONEY_TARGET = 200;
const FAST_MONEY_SLOTS = 5;

function initFastMoney(game, p1Name, p2Name, questionList) {
  const blankReveal = () =>
    Array.from({ length: FAST_MONEY_SLOTS }, () => ({
      cursor: false,         // ① pink cursor blinking at the answer slot
      answerRevealed: false, // ② answer words shown (the picked survey answer)
      scoreRevealed: false,  // ③ score shown
      text: '',              // what to display on the board (picked answer)
      points: 0,
      duplicate: false,
    }));
  game.fastMoney = {
    contestants: { p1: p1Name, p2: p2Name },
    questions: questionList.slice(0, FAST_MONEY_SLOTS).map((q) => ({
      text: q.text,
      answers: q.answers.map((a) => ({ text: a.text, points: a.points })),
    })),
    input: { p1: Array(FAST_MONEY_SLOTS).fill(''), p2: Array(FAST_MONEY_SLOTS).fill('') },
    submitted: { p1: false, p2: false },
    reveal: { p1: blankReveal(), p2: blankReveal() },
    remindP1: false,           // host "remind everyone of P1's answers" toggle
    totals: { p1: 0, p2: 0, combined: 0 },
    total: 0,
    target: FAST_MONEY_TARGET,
    won: false,
  };
}

function recomputeFastMoneyTotal(game) {
  const fm = game.fastMoney;
  if (!fm) return 0;
  const sub = (slot) =>
    fm.reveal[slot].reduce((sum, r) => sum + (r.scoreRevealed && !r.duplicate ? r.points : 0), 0);
  fm.totals = { p1: sub('p1'), p2: sub('p2'), combined: sub('p1') + sub('p2') };
  fm.total = fm.totals.combined;
  fm.won = fm.total >= fm.target;
  return fm.total;
}

// Role-aware view of Fast Money: host/judge see everything; players & the TV
// see questions (no survey answers) and only what's been revealed so far.
function sanitizeFastMoney(game, role) {
  const fm = game.fastMoney;
  if (!fm) return null;
  if (role === 'host' || role === 'judge') return fm;

  const cell = (slot, i) => {
    const r = fm.reveal[slot][i];
    return {
      text: r.answerRevealed ? r.text : null,
      points: r.scoreRevealed ? r.points : null,
      cursor: r.cursor,
      answerRevealed: r.answerRevealed,
      scoreRevealed: r.scoreRevealed,
      duplicate: r.duplicate,
    };
  };
  return {
    contestants: fm.contestants,
    questions: fm.questions.map((q) => ({ text: q.text })),
    submitted: fm.submitted,
    remindP1: fm.remindP1,
    reveal: {
      p1: fm.reveal.p1.map((_, i) => cell('p1', i)),
      p2: fm.reveal.p2.map((_, i) => cell('p2', i)),
    },
    totals: fm.totals,
    total: fm.total,
    target: fm.target,
    won: fm.won,
  };
}

const WIN_SCORE = 300;

// Full reset for "run it back": keep teams, names, rosters and connected
// buzzer devices; wipe scores/rounds/round state so a new game can start.
function resetForNewGame(game) {
  game.teams.team1.score = 0;
  game.teams.team2.score = 0;
  game.round = 0;
  game.roundMultiplier = 1;
  game.currentQuestion = null;
  game.roundBank = 0;
  game.lastRoundResult = null;
  game.winner = null;
  game.suddenDeath = false;
  game.fastMoney = null;
  game.usedQuestionHashes.clear();
  game.recentQuestions = [];
  resetFaceOff(game);
  resetActivePlay(game);
  game.phase = PHASES.LOBBY;
}

// Produce a short, host-readable "stakes" line for the dramatic moments
// (mainly late game / steal): what each outcome means for winning.
function computeStakes(game) {
  if (!game.currentQuestion) return null;
  const ap = game.activePlay;
  const phase = game.phase;
  const bank = calculateRoundBank(game);
  const nameOf = (t) => game.teams[t].name;
  const scoreOf = (t) => game.teams[t].score;

  if (phase === PHASES.TEAM_PLAY && ap.playingTeam) {
    const t = ap.playingTeam;
    const projected = scoreOf(t) + bank;
    if (projected >= WIN_SCORE && bank > 0) {
      return `🏆 ${nameOf(t)} is at ${scoreOf(t)} (+${bank} banked = ${projected}). Banking this round WINS the game.`;
    }
    if (scoreOf(t) + bank >= WIN_SCORE) {
      const need = WIN_SCORE - scoreOf(t);
      return `${nameOf(t)} needs ${need} more this round to win — they're at ${bank} so far.`;
    }
    return null;
  }

  if (phase === PHASES.STEAL_ATTEMPT && ap.stealingTeam) {
    const steal = ap.stealingTeam;
    const play = ap.playingTeam;
    const stealProj = scoreOf(steal) + bank;
    const playProj = scoreOf(play) + bank;
    const lines = [];
    lines.push(
      stealProj >= WIN_SCORE
        ? `🎯 STEAL to WIN: if ${nameOf(steal)} steals, they take ${bank} → ${stealProj} and win the game.`
        : `🎯 If ${nameOf(steal)} steals, they get ${bank} → ${stealProj}.`
    );
    lines.push(
      playProj >= WIN_SCORE
        ? `Otherwise ${nameOf(play)} keeps ${bank} → ${playProj} and WINS.`
        : `Otherwise ${nameOf(play)} keeps ${bank} → ${playProj}.`
    );
    if (stealProj < WIN_SCORE && playProj < WIN_SCORE && game.round >= game.totalRounds) {
      lines.push('Neither reaches 300 → SUDDEN DEATH.');
    }
    return lines.join(' ');
  }

  return null;
}

// Get a sanitized game state safe to send to clients
// Strips out answer details for non-host/judge roles
function getClientState(game, role) {
  const state = {
    gameId: game.gameId,
    hostMode: game.hostMode,
    phase: game.phase,
    round: game.round,
    roundMultiplier: game.roundMultiplier,
    totalRounds: game.totalRounds,
    teams: {
      team1: {
        name: game.teams.team1.name,
        score: game.teams.team1.score,
        roster: game.teams.team1.roster,
        buzzerCount: game.teams.team1.players.length,
        players: game.teams.team1.players.map((p) => ({
          playerName: p.playerName,
          socketId: p.socketId,
        })),
      },
      team2: {
        name: game.teams.team2.name,
        score: game.teams.team2.score,
        roster: game.teams.team2.roster,
        buzzerCount: game.teams.team2.players.length,
        players: game.teams.team2.players.map((p) => ({
          playerName: p.playerName,
          socketId: p.socketId,
        })),
      },
    },
    faceOff: {
      team1Player: game.faceOff.team1Player,
      team2Player: game.faceOff.team2Player,
      winner: game.faceOff.winner,
      buzzersOpen: game.faceOff.buzzersOpen,
      buzzes: game.faceOff.buzzes,
    },
    activePlay: { ...game.activePlay },
    roundBank: game.roundBank,
    lastRoundResult: game.lastRoundResult,
    winner: game.winner,
    suddenDeath: game.suddenDeath,
    stakes: computeStakes(game),
    aiAvailable: aiQuestions.isAvailable(),
    topics: questions.TOPICS,
  };

  // Include question info based on role
  if (game.currentQuestion) {
    if (role === 'host' || role === 'judge') {
      // Host and judge see all answers
      state.currentQuestion = { ...game.currentQuestion };
    } else {
      // Players and game screen only see revealed answers
      state.currentQuestion = {
        text: game.currentQuestion.text,
        answerCount: game.currentQuestion.answers.length,
        answers: game.currentQuestion.answers.map((a, i) => ({
          revealed: a.revealed,
          text: a.revealed ? a.text : null,
          points: a.revealed ? a.points : null,
          position: i,
        })),
      };
    }
  }

  if (game.fastMoney) {
    state.fastMoney = sanitizeFastMoney(game, role);
  }

  return state;
}

module.exports = {
  PHASES,
  ROUND_MULTIPLIERS,
  createGame,
  getGame,
  listGames,
  deleteGame,
  addPlayer,
  removePlayerBySocket,
  setPhase,
  resetFaceOff,
  resetActivePlay,
  startNextRound,
  calculateRoundBank,
  awardPoints,
  checkWinCondition,
  otherTeam,
  allAnswersRevealed,
  resetForNewGame,
  computeStakes,
  initFastMoney,
  recomputeFastMoneyTotal,
  FAST_MONEY_SLOTS,
  FAST_MONEY_TARGET,
  getClientState,
};
