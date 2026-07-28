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
      // roster = named team members the HOST manages, in line-up order (used for
      //   face-off / fast money);
      // turnIndex = who in that line is up for the next face-off.
      team1: { name: team1Name, score: 0, players: [], roster: [], turnIndex: 0 },
      team2: { name: team2Name, score: 0, players: [], roster: [], turnIndex: 0 },
    },

    judgeSocketId: null,
    gameScreenSocketIds: [],

    phase: PHASES.LOBBY,
    round: 0,
    roundMultiplier: 1,
    totalRounds: 4,

    currentQuestion: null,
    questionOptions: null, // candidate questions the host is choosing from (the "hand of cards")
    roundBank: 0,
    lastRoundResult: null, // { winningTeam, teamName, points } for ROUND_END display
    winner: null, // 'team1' | 'team2' once the game is won
    suddenDeath: false,
    suddenDeathTurn: null, // whose turn to answer in sudden death (alternates on a miss)

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

// ---- Line-up / turn order ----
// Each team's roster doubles as a line-up: `turnIndex` points at whoever is up
// for the next face-off and moves one down the line each round (wrapping), so
// everybody gets a turn at the podium instead of the host guessing.

function turnName(game, teamKey) {
  const team = game.teams[teamKey];
  return team.roster[team.turnIndex] || null;
}

function advanceTurn(game, teamKey) {
  const team = game.teams[teamKey];
  team.turnIndex = team.roster.length ? (team.turnIndex + 1) % team.roster.length : 0;
}

// Point a line-up at a specific player — the host tapped someone out of order,
// so the rotation should carry on from them next round.
function setTurnTo(game, teamKey, name) {
  const idx = game.teams[teamKey].roster.indexOf(name);
  if (idx !== -1) game.teams[teamKey].turnIndex = idx;
}

// Pre-fill both face-off picks from the line-ups, so each round opens with the
// next pair already selected and the host only has to confirm.
function applyTurnPicks(game) {
  for (const teamKey of ['team1', 'team2']) {
    const name = turnName(game, teamKey);
    game.faceOff[`${teamKey}Player`] = name ? { playerName: name } : null;
  }
}

// Mutate a roster (add / remove / move / reorder) without silently changing
// whose turn it is: the pointer follows the same person across the edit, and
// falls back to a valid index if that person is gone.
function editRoster(game, teamKey, mutate) {
  const team = game.teams[teamKey];
  const anchor = team.roster[team.turnIndex] || null;
  mutate(team);
  const idx = anchor ? team.roster.indexOf(anchor) : -1;
  team.turnIndex =
    idx !== -1 ? idx : Math.min(team.turnIndex, Math.max(0, team.roster.length - 1));
}

// Drop face-off picks for players who are no longer on the team, and — while
// we're still before the buzzers — refill any empty slot from the line-up, so
// the host is never left staring at a blank contestant.
function syncFaceOffPicks(game) {
  for (const teamKey of ['team1', 'team2']) {
    const pick = game.faceOff[`${teamKey}Player`];
    if (pick && !game.teams[teamKey].roster.includes(pick.playerName)) {
      game.faceOff[`${teamKey}Player`] = null;
    }
  }
  if (game.phase !== PHASES.ROUND_SETUP && game.phase !== PHASES.FACE_OFF_READY) return;
  for (const teamKey of ['team1', 'team2']) {
    if (game.faceOff[`${teamKey}Player`]) continue;
    const name = turnName(game, teamKey);
    if (name) game.faceOff[`${teamKey}Player`] = { playerName: name };
  }
}

function startNextRound(game) {
  game.round += 1;
  game.roundMultiplier = ROUND_MULTIPLIERS[game.round] || 3;
  game.currentQuestion = null;
  game.questionOptions = null;
  game.roundBank = 0;
  game.lastRoundResult = null;
  game.suddenDeathTurn = null; // set on the first buzz of a sudden-death round
  resetFaceOff(game);
  resetActivePlay(game);
  // Round 1 opens with the top of each line; every round after moves one down.
  if (game.round > 1) {
    advanceTurn(game, 'team1');
    advanceTurn(game, 'team2');
  }
  applyTurnPicks(game);
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

// End the game outright with a declared winner (used by sudden death, where the
// win is decided by the top answer rather than crossing 300).
function endGameWith(game, winner) {
  game.winner = winner;
  game.phase = PHASES.GAME_OVER;
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

// Store a transcription clip into a Fast Money slot. Uploads are async, so a
// clip can land after the host has already ended the turn.
//
// Before the turn is submitted, a later clip replacing an earlier one is the
// point — that's how re-recording a slot with the 🎤 button works. After it's
// submitted, the host has typed or corrected these answers by hand, so a
// straggler may only fill a slot that's still blank; otherwise it would
// silently overwrite their work on the reveal screen.
//
// Returns true if the slot changed (so the caller knows to broadcast).
function applyTranscript(game, player, index, text) {
  const fm = game && game.fastMoney;
  if (!fm) return false;
  if (player !== 'p1' && player !== 'p2') return false;
  if (!Number.isInteger(index) || index < 0 || index >= FAST_MONEY_SLOTS) return false;
  if (fm.submitted[player] && fm.input[player][index]) return false;
  fm.input[player][index] = text;
  return true;
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
  game.teams.team1.turnIndex = 0; // fresh game → both line-ups back to the top
  game.teams.team2.turnIndex = 0;
  game.round = 0;
  game.roundMultiplier = 1;
  game.currentQuestion = null;
  game.roundBank = 0;
  game.lastRoundResult = null;
  game.winner = null;
  game.suddenDeath = false;
  game.suddenDeathTurn = null;
  game.fastMoney = null;
  game.usedQuestionHashes.clear();
  game.recentQuestions = [];
  resetFaceOff(game);
  resetActivePlay(game);
  game.phase = PHASES.LOBBY;
}

// Produce a short, host-readable "stakes" line for the dramatic moments — in
// plain outcome language (who wins / sudden death) rather than point math.
// Recomputed on every state broadcast, so it tracks the bank live as answers
// reveal during the final round.
function computeStakes(game) {
  if (!game.currentQuestion) return null;
  const ap = game.activePlay;
  const phase = game.phase;
  const bank = calculateRoundBank(game);
  const final = game.round >= game.totalRounds;
  const nm = (t) => game.teams[t].name;
  const sc = (t) => game.teams[t].score;

  // What it means if `winner` ends up banking the current `bank` this round.
  // Returns a plain phrase, or null when nothing is decided yet (early rounds).
  function outcome(winner) {
    const other = otherTeam(winner);
    const wTotal = sc(winner) + bank;
    if (wTotal >= WIN_SCORE) return `${nm(winner)} wins the game`;
    if (!final) return null;                       // not the last round → no verdict yet
    if (wTotal > sc(other)) return `${nm(winner)} wins`;
    if (wTotal === sc(other)) return `it's a tie → SUDDEN DEATH`;
    return `${nm(other)} still wins`;
  }

  if (phase === PHASES.TEAM_PLAY && ap.playingTeam && bank > 0) {
    const P = ap.playingTeam, O = otherTeam(P);
    const oP = outcome(P), oO = outcome(O);
    if (!oP && !oO) return null;
    let s = oP ? `🏆 If ${nm(P)} banks this round, ${oP}.` : '';
    if (oO) s += ` If they strike out, ${nm(O)} can steal → ${oO}.`;
    return s.trim() || null;
  }

  if (phase === PHASES.STEAL_ATTEMPT && ap.stealingTeam) {
    const O = ap.stealingTeam, P = ap.playingTeam;
    const oO = outcome(O), oP = outcome(P);
    let s = `🎯 If ${nm(O)} steals, ${oO || 'they take the bank'}.`;
    s += ` If they fail, ${oP || `${nm(P)} keeps it`}.`;
    return s;
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
        turnIndex: game.teams.team1.turnIndex,
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
        turnIndex: game.teams.team2.turnIndex,
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
    suddenDeathTurn: game.suddenDeathTurn,
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
  turnName,
  advanceTurn,
  setTurnTo,
  applyTurnPicks,
  editRoster,
  syncFaceOffPicks,
  startNextRound,
  calculateRoundBank,
  awardPoints,
  checkWinCondition,
  endGameWith,
  otherTeam,
  allAnswersRevealed,
  resetForNewGame,
  computeStakes,
  initFastMoney,
  applyTranscript,
  recomputeFastMoneyTotal,
  FAST_MONEY_SLOTS,
  FAST_MONEY_TARGET,
  getClientState,
};
