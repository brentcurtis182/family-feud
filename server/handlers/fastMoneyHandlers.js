const gameState = require('../gameState');
const questions = require('../questions');
const { resolveQuestion } = require('../questionService');
const { broadcastState, broadcastEvent } = require('../broadcast');

const PHASES = gameState.PHASES;
const SLOTS = gameState.FAST_MONEY_SLOTS;

function isHostOrJudge(game, socket) {
  if (!game) return false;
  return socket.id === game.hostSocketId || socket.id === game.judgeSocketId;
}

module.exports = function registerFastMoneyHandlers(io, socket) {
  // Host starts Fast Money: pick two contestants, generate the 5 questions.
  socket.on('fastmoney-start', async ({ p1, p2, source, topic } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    if (!p1 || !p2) {
      socket.emit('error', { message: 'Pick two Fast Money contestants.' });
      return;
    }

    broadcastEvent(io, game, 'fastmoney-generating', {});

    // Generate all 5 in PARALLEL (was sequential — this is the big speedup),
    // then de-dupe the batch (and against questions already used this game).
    const reqs = Array.from({ length: SLOTS }, (_, i) =>
      resolveQuestion(game, {
        topic: topic || 'random',
        source: source || 'ai',
        style: i === 0 ? 'survey' : 'fastmoney', // first FM question is the long survey one
      })
    );
    const settled = await Promise.all(reqs);

    const g = gameState.getGame(socket.gameId);
    if (!g) return;

    const seen = new Set(g.usedQuestionHashes);
    const qs = [];
    for (let q of settled) {
      if (!q || seen.has(q.hash)) q = questions.getSampleQuestion(seen); // replace dup/null
      seen.add(q.hash);
      qs.push(q);
    }
    qs.forEach((q) => g.usedQuestionHashes.add(q.hash));

    gameState.initFastMoney(g, p1, p2, qs);
    g.phase = PHASES.FAST_MONEY_P1;
    broadcastEvent(io, g, 'phase-changed', { phase: g.phase, round: g.round, roundMultiplier: g.roundMultiplier });
    io.to(`game:${g.gameId}:gamescreen`).emit('camera-angle', { angle: 'wide' });
    broadcastState(io, g);
    console.log(`Game ${g.gameId}: Fast Money started (${p1} & ${p2})`);
  });

  // Host's first mic-press starts the on-screen countdown for this player's turn.
  socket.on('fastmoney-timer-start', ({ player, duration } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    broadcastEvent(io, game, 'fm-timer', { player, duration: duration || (player === 'p2' ? 25 : 20) });
  });

  // Live duplicate buzz during P2's turn (P2 repeated one of P1's answers).
  socket.on('fastmoney-dup-buzz', () => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    broadcastEvent(io, game, 'fm-dup-buzz', {});
  });

  // Host submits the captured (and possibly edited) 5 answers for a player.
  socket.on('fastmoney-submit', ({ player, answers } = {}) => {
    const game = gameState.getGame(socket.gameId);
    const fm = game && game.fastMoney;
    if (!fm) return;
    if (player !== 'p1' && player !== 'p2') return;
    const allowed = isHostOrJudge(game, socket) || socket.playerName === fm.contestants[player];
    if (!allowed) return;

    // Merge: a non-empty submitted answer wins; otherwise keep what's already
    // stored (e.g. a transcription that landed via /api/transcribe).
    if (Array.isArray(answers)) {
      for (let i = 0; i < SLOTS; i++) {
        const a = answers[i];
        if (typeof a === 'string' && a.trim()) fm.input[player][i] = a.trim();
      }
    }
    fm.submitted[player] = true;

    game.phase = player === 'p1' ? PHASES.FAST_MONEY_P1_REVEAL : PHASES.FAST_MONEY_REVEAL;
    broadcastEvent(io, game, 'phase-changed', { phase: game.phase, round: game.round, roundMultiplier: game.roundMultiplier });
    broadcastState(io, game);
    console.log(`Game ${game.gameId}: Fast Money ${player} answers submitted`);
  });

  // Host edits a captured answer (fix a mis-hear) before revealing it.
  socket.on('fastmoney-edit', ({ player, index, text } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    const fm = game && game.fastMoney;
    if (!fm || (player !== 'p1' && player !== 'p2') || index < 0 || index >= SLOTS) return;
    fm.input[player][index] = typeof text === 'string' ? text.trim() : '';
    broadcastState(io, game);
  });

  // Reveal step ①: put the blinking pink cursor at the answer slot (no text yet).
  socket.on('fastmoney-cursor', ({ player, index } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    const fm = game && game.fastMoney;
    if (!fm || (player !== 'p1' && player !== 'p2') || index < 0 || index >= SLOTS) return;
    fm.reveal[player][index].cursor = true;
    broadcastEvent(io, game, 'fm-cursor', { player, index });
    broadcastState(io, game);
  });

  // Reveal step ②: host picks the matching answer → flip the WORDS (cursor chases),
  // store the score but don't show it yet.
  socket.on('fastmoney-pick', ({ player, index, text, points, duplicate } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    const fm = game && game.fastMoney;
    if (!fm || (player !== 'p1' && player !== 'p2') || index < 0 || index >= SLOTS) return;

    const isDup = !!duplicate;
    const cell = fm.reveal[player][index];
    cell.cursor = true;
    cell.answerRevealed = true;
    cell.scoreRevealed = false;
    cell.text = typeof text === 'string' && text.trim() ? text.trim() : '—';
    cell.points = isDup ? 0 : Math.max(0, parseInt(points, 10) || 0);
    cell.duplicate = isDup;
    gameState.recomputeFastMoneyTotal(game); // score not shown yet, so no change

    broadcastEvent(io, game, 'fm-answer-revealed', { player, index, text: cell.text });
    broadcastState(io, game);
  });

  // Reveal step ③: flip the SCORE for the picked answer.
  socket.on('fastmoney-reveal-score', ({ player, index } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    const fm = game && game.fastMoney;
    if (!fm || (player !== 'p1' && player !== 'p2') || index < 0 || index >= SLOTS) return;
    const cell = fm.reveal[player][index];
    if (!cell.answerRevealed) return; // must pick the answer first
    cell.scoreRevealed = true;
    gameState.recomputeFastMoneyTotal(game);

    broadcastEvent(io, game, 'fm-score-revealed', {
      player, index, points: cell.points, duplicate: cell.duplicate,
      totals: fm.totals, total: fm.total, won: fm.won,
    });
    broadcastState(io, game);
  });

  // Un-reveal a row (correction).
  socket.on('fastmoney-unassign', ({ player, index } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    const fm = game && game.fastMoney;
    if (!fm || (player !== 'p1' && player !== 'p2') || index < 0 || index >= SLOTS) return;
    fm.reveal[player][index] = { cursor: false, answerRevealed: false, scoreRevealed: false, text: '', points: 0, duplicate: false };
    gameState.recomputeFastMoneyTotal(game);
    broadcastState(io, game);
  });

  // After revealing P1, move on: hide P1's rows (keep their total), wait for P2.
  socket.on('fastmoney-to-p2', () => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    if (!game.fastMoney || game.phase !== PHASES.FAST_MONEY_P1_REVEAL) return;
    game.fastMoney.remindP1 = false;
    game.phase = PHASES.FAST_MONEY_P2_WAIT;
    broadcastEvent(io, game, 'phase-changed', { phase: game.phase, round: game.round, roundMultiplier: game.roundMultiplier });
    broadcastState(io, game);
  });

  // Toggle the "remind everyone of P1's answers" re-reveal (P2 faces away).
  socket.on('fastmoney-remind', ({ show } = {}) => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    if (!game.fastMoney) return;
    game.fastMoney.remindP1 = !!show;
    broadcastState(io, game);
  });

  // Start player 2's capture turn.
  socket.on('fastmoney-start-p2', () => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    if (!game.fastMoney || game.phase !== PHASES.FAST_MONEY_P2_WAIT) return;
    game.fastMoney.remindP1 = false;
    game.phase = PHASES.FAST_MONEY_P2;
    broadcastEvent(io, game, 'phase-changed', { phase: game.phase, round: game.round, roundMultiplier: game.roundMultiplier });
    broadcastState(io, game);
  });
};
