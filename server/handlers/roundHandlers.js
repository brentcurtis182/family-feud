const gameState = require('../gameState');
const aiQuestions = require('../aiQuestions');
const questions = require('../questions');
const { resolveQuestion } = require('../questionService');
const { broadcastState, broadcastEvent } = require('../broadcast');

const MAX_STRIKES = 3;
const PHASES = gameState.PHASES;

function signalGenerating(io, game, request) {
  if (request.source === 'bank' || !aiQuestions.isAvailable()) return;
  io.to(`game:${game.gameId}:host`).emit('question-generating', { topic: request.topic });
  io.to(`game:${game.gameId}:judge`).emit('question-generating', { topic: request.topic });
}

// Host always controls; judge controls in host-only mode (host is judge otherwise).
function canControl(game, socket) {
  if (!game) return false;
  if (socket.id === game.hostSocketId) return true;
  if (socket.id === game.judgeSocketId) return true;
  return false;
}

function cameraForTeam(team) {
  return team === 'team1' ? 'play-left' : 'play-right';
}

// Transition into a steal attempt by the opposing team.
function enterSteal(io, game) {
  const stealing = gameState.otherTeam(game.activePlay.playingTeam);
  game.activePlay.stealingTeam = stealing;
  game.activePlay.isStealing = true;
  game.phase = PHASES.STEAL_ATTEMPT;

  io.to(`game:${game.gameId}:gamescreen`).emit('camera-angle', { angle: cameraForTeam(stealing) });
  broadcastEvent(io, game, 'steal-setup', {
    stealingTeam: stealing,
    teamName: game.teams[stealing].name,
  });
  broadcastState(io, game);
  console.log(`Game ${game.gameId}: steal attempt by ${stealing}`);
}

// End the round, awarding the current bank to the winning team.
function endRound(io, game, winningTeam) {
  const points = gameState.calculateRoundBank(game);
  game.teams[winningTeam].score += points;
  game.lastRoundResult = {
    winningTeam,
    teamName: game.teams[winningTeam].name,
    points,
  };

  // Clear strikes so the board is clean — the host reveals any remaining
  // answers one-by-one during ROUND_END, then advances.
  game.activePlay.strikes = 0;

  const winner = gameState.checkWinCondition(game);
  game.phase = winner ? PHASES.GAME_OVER : PHASES.ROUND_END;
  if (winner) game.winner = winner;

  broadcastEvent(io, game, 'round-ended', {
    winningTeam,
    teamName: game.teams[winningTeam].name,
    points,
    scores: { team1: game.teams.team1.score, team2: game.teams.team2.score },
    gameOver: !!winner,
    winner: winner || null,
    winnerName: winner ? game.teams[winner].name : null,
  });
  io.to(`game:${game.gameId}:gamescreen`).emit('camera-angle', { angle: 'wide' });
  broadcastState(io, game);
  console.log(`Game ${game.gameId}: round ${game.round} -> ${winningTeam} +${points}${winner ? ' (GAME OVER)' : ''}`);
}

// Commit a chosen question into the round (shared by set-question + choose-question).
function applyChosenQuestion(io, g, question) {
  g.currentQuestion = question;
  g.questionOptions = null;
  g.usedQuestionHashes.add(question.hash);
  g.recentQuestions.push(question.text);
  g.roundBank = 0;
  gameState.resetActivePlay(g);

  if (g.faceOff.team1Player && g.faceOff.team2Player) {
    g.phase = PHASES.FACE_OFF_READY;
  } else if (g.phase === PHASES.LOBBY) {
    g.phase = PHASES.ROUND_SETUP;
  }

  broadcastEvent(io, g, 'question-ready', { text: question.text });
  broadcastState(io, g);
  broadcastEvent(io, g, 'phase-changed', {
    phase: g.phase,
    round: g.round,
    roundMultiplier: g.roundMultiplier,
  });
  io.to(`game:${g.gameId}:gamescreen`).emit('camera-angle', { angle: 'wide' });
}

// Build N candidate questions for the host to pick from (the "hand of cards").
async function buildQuestionOptions(game, request, count) {
  // Bank (or AI unavailable): distinct unused bank questions — instant & free.
  if (request.source === 'bank' || !aiQuestions.isAvailable()) {
    const seen = new Set(game.usedQuestionHashes);
    const out = [];
    for (let i = 0; i < count; i++) {
      const q = questions.getSampleQuestion(seen, request.topic);
      seen.add(q.hash);
      out.push(q);
    }
    return out;
  }
  // AI: generate `count` in parallel, then de-dupe / backfill from the bank.
  const reqs = Array.from({ length: count }, () =>
    resolveQuestion(game, { ...request, style: 'survey' })
  );
  const settled = await Promise.all(reqs);
  const seen = new Set(game.usedQuestionHashes);
  const out = [];
  for (let q of settled) {
    if (!q || seen.has(q.hash)) q = questions.getSampleQuestion(seen, request.topic);
    seen.add(q.hash);
    out.push(q);
  }
  return out;
}

module.exports = function registerRoundHandlers(io, socket) {
  // Load a single question directly (legacy / quick path).
  socket.on('set-question', async (opts = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;

    const request = { topic: opts.topic || 'random', source: opts.source || 'ai' };
    game.questionRequest = request;
    signalGenerating(io, game, request);

    const question = await resolveQuestion(game, { ...request, style: 'survey', suddenDeath: game.suddenDeath });

    const g = gameState.getGame(socket.gameId);
    if (!g) return;
    applyChosenQuestion(io, g, question);
    console.log(`Game ${g.gameId}: question loaded ("${question.text}") [${request.source}/${request.topic}]`);
  });

  // Hand the host a set of candidate questions to choose from (+ reshuffle).
  socket.on('request-question-options', async (opts = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;

    const request = { topic: opts.topic || 'random', source: opts.source || 'ai' };
    game.questionRequest = request;
    signalGenerating(io, game, request);

    const options = await buildQuestionOptions(game, request, 5);

    const g = gameState.getGame(socket.gameId);
    if (!g) return;
    g.questionOptions = options;
    // Full options (with answers) go only to the controllers so they can judge quality.
    const payload = { options: options.map((q) => ({ text: q.text, topic: q.topic, answers: q.answers })) };
    io.to(`game:${g.gameId}:host`).emit('question-options', payload);
    io.to(`game:${g.gameId}:judge`).emit('question-options', payload);
  });

  // Host picked one of the candidates.
  socket.on('choose-question', ({ index } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    const opts = game.questionOptions;
    if (!Array.isArray(opts) || index < 0 || index >= opts.length) return;
    const question = opts[index];
    applyChosenQuestion(io, game, question);
    console.log(`Game ${game.gameId}: question chosen ("${question.text}")`);
  });

  // Re-roll the current question, reusing the last topic/source request.
  socket.on('reroll-question', async () => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;

    const request = game.questionRequest || { topic: 'random', source: 'ai' };
    signalGenerating(io, game, request);

    const question = await resolveQuestion(game, { ...request, style: 'survey', suddenDeath: game.suddenDeath });

    const g = gameState.getGame(socket.gameId);
    if (!g) return;

    g.currentQuestion = question;
    g.usedQuestionHashes.add(question.hash);
    g.recentQuestions.push(question.text);
    g.roundBank = 0;
    gameState.resetActivePlay(g);
    broadcastEvent(io, g, 'question-ready', { text: question.text });
    broadcastState(io, g);
  });

  // Host chooses which team plays the board (play-or-pass decision).
  socket.on('choose-play', ({ team }) => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    if (team !== 'team1' && team !== 'team2') return;

    game.activePlay.playingTeam = team;
    game.activePlay.stealingTeam = null;
    game.activePlay.isStealing = false;
    game.activePlay.strikes = 0; // team play starts clean (face-off strikes were transient)
    game.phase = PHASES.TEAM_PLAY;

    io.to(`game:${game.gameId}:gamescreen`).emit('camera-angle', { angle: cameraForTeam(team) });
    io.to(`game:${game.gameId}:gamescreen`).emit('strikes-cleared', {});
    broadcastEvent(io, game, 'phase-changed', {
      phase: game.phase,
      round: game.round,
      roundMultiplier: game.roundMultiplier,
    });
    broadcastState(io, game);
    console.log(`Game ${game.gameId}: ${team} chose to play`);
  });

  // Reveal one answer (flow-aware).
  socket.on('reveal-answer', ({ position }) => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    if (!game.currentQuestion) return;

    const answer = game.currentQuestion.answers[position];
    if (!answer || answer.revealed) return;

    answer.revealed = true;
    if (!game.activePlay.revealedIndices.includes(position)) {
      game.activePlay.revealedIndices.push(position);
    }
    game.roundBank = gameState.calculateRoundBank(game);

    broadcastEvent(io, game, 'answer-revealed', {
      position,
      text: answer.text,
      points: answer.points,
      roundBank: game.roundBank,
    });

    // Sudden death: the team whose turn it is revealing the #1 answer wins.
    if (game.suddenDeath && game.phase === PHASES.FACE_OFF_ANSWER) {
      if (position === 0 && game.faceOff.winner) {
        const winner = game.suddenDeathTurn || game.faceOff.winner;
        gameState.endGameWith(game, winner);
        broadcastEvent(io, game, 'game-over', {
          winner,
          winnerName: game.teams[winner].name,
          scores: { team1: game.teams.team1.score, team2: game.teams.team2.score },
          suddenDeath: true,
        });
        broadcastState(io, game);
      } else {
        broadcastState(io, game); // a non-top answer doesn't win; just show it
      }
      return;
    }

    // A correct answer during a steal wins the whole bank for the stealing team.
    if (game.phase === PHASES.STEAL_ATTEMPT) {
      broadcastEvent(io, game, 'steal-result', {
        success: true,
        team: game.activePlay.stealingTeam,
        teamName: game.teams[game.activePlay.stealingTeam].name,
      });
      endRound(io, game, game.activePlay.stealingTeam);
      return;
    }

    // Clearing the whole board ends the round for the playing team.
    if (game.phase === PHASES.TEAM_PLAY && gameState.allAnswersRevealed(game)) {
      endRound(io, game, game.activePlay.playingTeam);
      return;
    }

    broadcastState(io, game);
  });

  // Hide an answer again (host correction).
  socket.on('hide-answer', ({ position }) => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    if (!game.currentQuestion) return;

    const answer = game.currentQuestion.answers[position];
    if (!answer || !answer.revealed) return;

    answer.revealed = false;
    game.activePlay.revealedIndices = game.activePlay.revealedIndices.filter(
      (i) => i !== position
    );
    game.roundBank = gameState.calculateRoundBank(game);
    broadcastState(io, game);
  });

  // Add a strike (flow-aware).
  socket.on('add-strike', () => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;

    // A wrong steal hands the bank to the team that played the board.
    if (game.phase === PHASES.STEAL_ATTEMPT) {
      broadcastEvent(io, game, 'steal-result', {
        success: false,
        team: game.activePlay.playingTeam,
        teamName: game.teams[game.activePlay.playingTeam].name,
      });
      endRound(io, game, game.activePlay.playingTeam);
      return;
    }

    if (game.activePlay.strikes >= MAX_STRIKES) return;
    game.activePlay.strikes += 1;
    broadcastEvent(io, game, 'strike-added', { strikes: game.activePlay.strikes });

    // Three strikes during team play opens the steal.
    if (game.phase === PHASES.TEAM_PLAY && game.activePlay.strikes >= MAX_STRIKES) {
      enterSteal(io, game);
      return;
    }
    broadcastState(io, game);
  });

  // Clear all strikes (host correction).
  socket.on('clear-strikes', () => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    game.activePlay.strikes = 0;
    broadcastEvent(io, game, 'strikes-cleared', {});
    broadcastState(io, game);
  });

  // Host plays/stops a sound on the TV (theme, applause).
  socket.on('play-sound', ({ name } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    io.to(`game:${game.gameId}:gamescreen`).emit('tv-sound', { name });
  });
  socket.on('stop-sound', ({ name } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    io.to(`game:${game.gameId}:gamescreen`).emit('tv-sound-stop', { name });
  });

  // Manual camera control — host cuts the TV to any shot on demand.
  socket.on('set-camera', ({ angle } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    const allowed = ['wide', 'faceoff', 'play-left', 'play-right'];
    if (!allowed.includes(angle)) return;
    io.to(`game:${game.gameId}:gamescreen`).emit('camera-angle', { angle });
  });

  // Reset the CURRENT round back to setup (clears question/board/strikes/face-off).
  // Keeps scores and the round number — handy for testing questions quickly.
  socket.on('reset-round', () => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    if (game.phase === PHASES.LOBBY) return;

    game.currentQuestion = null;
    game.roundBank = 0;
    game.lastRoundResult = null;
    game.winner = null;
    game.fastMoney = null;
    game.usedQuestionHashes.clear(); // fresh questions after a reset
    game.recentQuestions = [];
    gameState.resetActivePlay(game);
    gameState.resetFaceOff(game);
    game.phase = PHASES.ROUND_SETUP;
    // A reset replays the same round, so put the same pair back up rather than
    // burning their turn.
    gameState.applyTurnPicks(game);

    broadcastEvent(io, game, 'strikes-cleared', {});
    broadcastEvent(io, game, 'phase-changed', {
      phase: game.phase,
      round: game.round,
      roundMultiplier: game.roundMultiplier,
    });
    io.to(`game:${game.gameId}:gamescreen`).emit('camera-angle', { angle: 'wide' });
    broadcastState(io, game);
    console.log(`Game ${game.gameId}: round reset by host`);
  });

  // Advance from ROUND_END to the next round (or finish the game).
  socket.on('advance-round', () => {
    const game = gameState.getGame(socket.gameId);
    if (!canControl(game, socket)) return;
    if (game.winner) return;
    if (game.phase !== PHASES.ROUND_END) return;

    // Reaching 300 ends the game during play (checkWinCondition), so if we're
    // at the end of the final round with no winner yet, BOTH teams are under 300
    // → go to Sudden Death (regardless of who's ahead; no tie special-case).
    if (game.round >= game.totalRounds) game.suddenDeath = true;

    gameState.startNextRound(game);
    broadcastEvent(io, game, 'phase-changed', {
      phase: game.phase,
      round: game.round,
      roundMultiplier: game.roundMultiplier,
    });
    io.to(`game:${game.gameId}:gamescreen`).emit('camera-angle', { angle: 'wide' });
    broadcastState(io, game);
  });
};
