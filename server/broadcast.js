const gameState = require('./gameState');

// Emit a full state sync to every role with role-appropriate sanitization.
// Host/judge see all answers; players & the TV only see revealed answers.
function broadcastState(io, game) {
  const id = game.gameId;
  io.to(`game:${id}:host`).emit('game-state-sync', gameState.getClientState(game, 'host'));
  io.to(`game:${id}:judge`).emit('game-state-sync', gameState.getClientState(game, 'judge'));
  const playerState = gameState.getClientState(game, 'player');
  io.to(`game:${id}:gamescreen`).emit('game-state-sync', playerState);
  io.to(`game:${id}:team1`).emit('game-state-sync', playerState);
  io.to(`game:${id}:team2`).emit('game-state-sync', playerState);
}

// Emit an arbitrary event to everyone in the game (room-wide, no sanitization).
function broadcastEvent(io, game, event, payload) {
  io.to(`game:${game.gameId}`).emit(event, payload);
}

module.exports = { broadcastState, broadcastEvent };
