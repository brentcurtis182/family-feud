const gameState = require('../gameState');
const { broadcastState, broadcastEvent } = require('../broadcast');

function isHostOrJudge(game, socket) {
  if (!game) return false;
  return socket.id === game.hostSocketId || socket.id === game.judgeSocketId;
}

module.exports = function registerFaceOffHandlers(io, socket) {
  // Host picks one contestant from each team for the face-off.
  socket.on('select-faceoff-players', ({ team1Player, team2Player }) => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;

    if (team1Player !== undefined) {
      game.faceOff.team1Player = team1Player ? { playerName: team1Player } : null;
    }
    if (team2Player !== undefined) {
      game.faceOff.team2Player = team2Player ? { playerName: team2Player } : null;
    }

    // Once both contestants and a question are set, we're ready to buzz.
    if (game.faceOff.team1Player && game.faceOff.team2Player && game.currentQuestion) {
      game.phase = gameState.PHASES.FACE_OFF_READY;
    }
    broadcastState(io, game);
  });

  // Host opens the buzzers — contestants can now buzz in.
  socket.on('open-buzzers', () => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    if (!game.faceOff.team1Player || !game.faceOff.team2Player) return;
    if (!game.currentQuestion) return;

    game.faceOff.buzzes = [];
    game.faceOff.winner = null;
    game.faceOff.buzzersOpen = true;
    game.faceOff.openTime = Date.now();
    game.phase = gameState.PHASES.FACE_OFF_BUZZER;

    broadcastState(io, game);
    broadcastEvent(io, game, 'buzzers-open', {});
    io.to(`game:${game.gameId}:gamescreen`).emit('camera-angle', { angle: 'faceoff' });
    console.log(`Game ${game.gameId}: buzzers open`);
  });

  // Any buzzer device buzzes for its team (team-based — first team wins).
  socket.on('buzz', () => {
    const game = gameState.getGame(socket.gameId);
    if (!game || !game.faceOff.buzzersOpen) return;

    const team = socket.teamChoice;
    if (team !== 'team1' && team !== 'team2') return;

    // One buzz per team.
    if (game.faceOff.buzzes.some((b) => b.team === team)) return;

    const reactionMs = Date.now() - game.faceOff.openTime;
    game.faceOff.buzzes.push({ team, reactionMs });

    // First buzz wins the face-off.
    if (!game.faceOff.winner) {
      game.faceOff.winner = team;
      game.faceOff.buzzersOpen = false;
      game.phase = gameState.PHASES.FACE_OFF_ANSWER;
      game.activePlay.playingTeam = team; // tentative; play-or-pass refines next

      // Display the host-selected contestant name if there is one.
      const contestant = game.faceOff[`${team}Player`];
      const who = contestant ? contestant.playerName : game.teams[team].name;
      broadcastEvent(io, game, 'buzz-result', {
        winner: team,
        playerName: who,
        teamName: game.teams[team].name,
        reactionMs,
      });
      broadcastState(io, game);
      console.log(`Game ${game.gameId}: ${team} buzzed first in ${reactionMs}ms`);
    }
  });

  // Wrong answer on the face-off buzz-in — flash a strike (transient; does NOT
  // count toward the playing team's 3 strikes).
  socket.on('faceoff-strike', () => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    // Sudden death: a missed top answer hands the game to the other team.
    if (game.suddenDeath && game.phase === gameState.PHASES.FACE_OFF_ANSWER && game.faceOff.winner) {
      const winner = gameState.otherTeam(game.faceOff.winner);
      gameState.endGameWith(game, winner);
      broadcastEvent(io, game, 'game-over', {
        winner,
        winnerName: game.teams[winner].name,
        scores: { team1: game.teams.team1.score, team2: game.teams.team2.score },
        suddenDeath: true,
      });
      broadcastState(io, game);
      return;
    }
    broadcastEvent(io, game, 'faceoff-strike', {});
  });

  // Reset the face-off (host) — e.g. to re-pick contestants.
  socket.on('reset-faceoff', () => {
    const game = gameState.getGame(socket.gameId);
    if (!isHostOrJudge(game, socket)) return;
    gameState.resetFaceOff(game);
    if (game.currentQuestion) game.phase = gameState.PHASES.ROUND_SETUP;
    broadcastState(io, game);
  });
};
