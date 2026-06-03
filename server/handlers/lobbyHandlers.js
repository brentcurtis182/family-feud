const gameState = require('../gameState');
const { broadcastState } = require('../broadcast');

module.exports = function registerLobbyHandlers(io, socket) {
  // Create a new game
  socket.on('create-game', ({ hostMode, team1Name, team2Name, passcode }) => {
    if (!team1Name || !team2Name || !passcode) {
      socket.emit('error', { message: 'Team names and passcode are required.' });
      return;
    }

    const game = gameState.createGame({
      hostSocketId: socket.id,
      hostMode: hostMode || 'host-judge',
      team1Name: team1Name.trim(),
      team2Name: team2Name.trim(),
      passcode: passcode.trim(),
    });

    // Store game info on the socket for disconnect handling
    socket.gameId = game.gameId;
    socket.role = 'host';

    // Join game rooms
    socket.join(`game:${game.gameId}`);
    socket.join(`game:${game.gameId}:host`);

    // If host-judge mode, also join judge room
    if (hostMode === 'host-judge') {
      socket.join(`game:${game.gameId}:judge`);
    }

    socket.emit('game-created', {
      gameId: game.gameId,
      state: gameState.getClientState(game, 'host'),
    });

    console.log(`Game ${game.gameId} created by ${socket.id} (${hostMode})`);
  });

  // List active games
  socket.on('list-games', () => {
    const list = gameState.listGames().filter(
      (g) => g.phase !== gameState.PHASES.GAME_OVER
    );
    socket.emit('games-list', list);
  });

  // Delete a game (cleanup of unfinished games during testing)
  socket.on('delete-game', ({ gameId }) => {
    const game = gameState.getGame(gameId);
    if (!game) {
      socket.emit('game-deleted-ok', { gameId });
      return;
    }
    // Tell anyone still connected to that game it's gone, then remove it.
    io.to(`game:${gameId}`).emit('game-deleted', {});
    gameState.deleteGame(gameId);
    socket.emit('game-deleted-ok', { gameId });
    console.log(`Game ${gameId} deleted`);
  });

  // Verify a passcode up front (so we can stop the user before role selection)
  socket.on('verify-passcode', ({ gameId, passcode }) => {
    const game = gameState.getGame(gameId);
    const ok = !!game && game.passcode === (passcode || '').trim();
    socket.emit('passcode-result', {
      gameId,
      ok,
      reason: !game ? 'Game not found.' : ok ? null : 'Incorrect passcode.',
    });
  });

  // Host manages each team's named roster (used for face-off / fast money picks)
  socket.on('roster-add', ({ team, name }) => {
    const game = gameState.getGame(socket.gameId);
    if (!game || socket.id !== game.hostSocketId) return;
    if ((team === 'team1' || team === 'team2') && name && name.trim()) {
      game.teams[team].roster.push(name.trim());
      broadcastState(io, game);
    }
  });

  socket.on('roster-remove', ({ team, name }) => {
    const game = gameState.getGame(socket.gameId);
    if (!game || socket.id !== game.hostSocketId) return;
    if (team === 'team1' || team === 'team2') {
      game.teams[team].roster = game.teams[team].roster.filter((n) => n !== name);
      broadcastState(io, game);
    }
  });

  // "Run it back" — full reset keeping teams, rosters and connected devices
  socket.on('restart-game', () => {
    const game = gameState.getGame(socket.gameId);
    if (!game || socket.id !== game.hostSocketId) return;
    gameState.resetForNewGame(game);
    io.to(`game:${game.gameId}`).emit('phase-changed', {
      phase: game.phase,
      round: game.round,
      roundMultiplier: game.roundMultiplier,
    });
    io.to(`game:${game.gameId}:gamescreen`).emit('camera-angle', { angle: 'wide' });
    broadcastState(io, game);
    console.log(`Game ${game.gameId} restarted (run it back)`);
  });

  // Join an existing game
  socket.on('join-game', ({ gameId, passcode, role, teamChoice, playerName }) => {
    const game = gameState.getGame(gameId);

    if (!game) {
      socket.emit('error', { message: 'Game not found.' });
      return;
    }

    if (game.passcode !== passcode.trim()) {
      socket.emit('error', { message: 'Incorrect passcode.' });
      return;
    }

    // Store game info on socket
    socket.gameId = gameId;
    socket.role = role;

    // Join the main game room
    socket.join(`game:${gameId}`);

    if (role === 'player') {
      if (teamChoice !== 'team1' && teamChoice !== 'team2') {
        socket.emit('error', { message: 'Pick a team to join.' });
        return;
      }

      // Players are nameless team buzzers; `playerName` is a persistent device id.
      const deviceId = (playerName && playerName.trim()) || `dev-${socket.id.slice(0, 6)}`;
      gameState.addPlayer(gameId, { socketId: socket.id, playerName: deviceId, team: teamChoice });

      socket.teamChoice = teamChoice;
      socket.playerName = deviceId;
      socket.join(`game:${gameId}:${teamChoice}`);

      io.to(`game:${gameId}`).emit('player-joined', {
        team: teamChoice,
        teamName: game.teams[teamChoice].name,
      });
      broadcastState(io, game);

      console.log(`Buzzer joined game ${gameId} on ${teamChoice}`);
    } else if (role === 'judge') {
      if (game.hostMode !== 'host-only') {
        socket.emit('error', { message: 'Judge role not available — host is also judging.' });
        return;
      }

      if (game.judgeSocketId) {
        socket.emit('error', { message: 'A judge has already joined.' });
        return;
      }

      game.judgeSocketId = socket.id;
      socket.join(`game:${gameId}:judge`);

      io.to(`game:${gameId}`).emit('judge-joined', {});
      console.log(`Judge joined game ${gameId}`);
    } else if (role === 'gamescreen') {
      game.gameScreenSocketIds.push(socket.id);
      socket.join(`game:${gameId}:gamescreen`);
      console.log(`Game screen joined game ${gameId}`);
    }

    // Send full state to the joining client
    const clientRole = role === 'gamescreen' ? 'player' : role;
    socket.emit('game-joined', {
      gameId,
      role,
      state: gameState.getClientState(game, clientRole),
    });
  });

  // Start the game (host only)
  socket.on('start-game', () => {
    const game = gameState.getGame(socket.gameId);
    if (!game) return;
    if (socket.id !== game.hostSocketId) return;

    if (game.phase !== gameState.PHASES.LOBBY) {
      socket.emit('error', { message: 'Game already started.' });
      return;
    }

    gameState.startNextRound(game);

    io.to(`game:${game.gameId}`).emit('phase-changed', {
      phase: game.phase,
      round: game.round,
      roundMultiplier: game.roundMultiplier,
    });

    io.to(`game:${game.gameId}:gamescreen`).emit('camera-angle', {
      angle: 'wide',
    });
    // Kick off the theme song on the TV at game start.
    io.to(`game:${game.gameId}:gamescreen`).emit('tv-sound', { name: 'theme' });

    console.log(`Game ${game.gameId} started — Round ${game.round}`);
  });

  // Rejoin a game after page redirect or reconnect
  socket.on('rejoin', ({ gameId, role, teamChoice, playerName }) => {
    const game = gameState.getGame(gameId);
    if (!game) {
      socket.emit('error', { message: 'Game not found.' });
      return;
    }

    socket.gameId = gameId;
    socket.role = role;
    socket.join(`game:${gameId}`);

    if (role === 'host') {
      game.hostSocketId = socket.id;
      socket.join(`game:${gameId}:host`);
      if (game.hostMode === 'host-judge') {
        socket.join(`game:${gameId}:judge`);
      }
    } else if (role === 'player') {
      socket.teamChoice = teamChoice;
      socket.playerName = playerName;
      socket.join(`game:${gameId}:${teamChoice}`);

      // Find this player anywhere in the roster (handles re-pick / stale team).
      let existing = null;
      for (const team of ['team1', 'team2']) {
        const found = game.teams[team].players.find((p) => p.playerName === playerName);
        if (found) { existing = found; break; }
      }

      if (existing) {
        // Reconnect: refresh socket id.
        existing.socketId = socket.id;
      } else if (teamChoice === 'team1' || teamChoice === 'team2') {
        // Navigation churn removed them between pages — re-add to the roster.
        gameState.addPlayer(gameId, { socketId: socket.id, playerName, team: teamChoice });
      }
      // Keep everyone's roster (esp. host contestant pickers) in sync.
      broadcastState(io, game);
    } else if (role === 'judge') {
      game.judgeSocketId = socket.id;
      socket.join(`game:${gameId}:judge`);
    } else if (role === 'gamescreen') {
      if (!game.gameScreenSocketIds.includes(socket.id)) {
        game.gameScreenSocketIds.push(socket.id);
      }
      socket.join(`game:${gameId}:gamescreen`);
    }

    const clientRole = role === 'gamescreen' ? 'player' : role;
    socket.emit('game-state-sync', gameState.getClientState(game, clientRole));
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const gameId = socket.gameId;
    if (!gameId) return;

    const game = gameState.getGame(gameId);
    if (!game) return;

    if (socket.role === 'player') {
      const removed = gameState.removePlayerBySocket(gameId, socket.id);
      if (removed) {
        io.to(`game:${gameId}`).emit('player-left', {
          socketId: socket.id,
          team: removed.team,
        });
        broadcastState(io, game);
      }
    } else if (socket.role === 'judge') {
      game.judgeSocketId = null;
      io.to(`game:${gameId}`).emit('judge-left', {});
    } else if (socket.role === 'gamescreen') {
      game.gameScreenSocketIds = game.gameScreenSocketIds.filter(
        (id) => id !== socket.id
      );
    } else if (socket.role === 'host') {
      // Host disconnected — notify everyone
      io.to(`game:${gameId}`).emit('host-disconnected', {});
      console.log(`Host disconnected from game ${gameId}`);
    }
  });
};
