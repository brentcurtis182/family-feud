const registerLobbyHandlers = require('./handlers/lobbyHandlers');
const registerRoundHandlers = require('./handlers/roundHandlers');
const registerFaceOffHandlers = require('./handlers/faceOffHandlers');
const registerFastMoneyHandlers = require('./handlers/fastMoneyHandlers');

module.exports = function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    registerLobbyHandlers(io, socket);
    registerRoundHandlers(io, socket);
    registerFaceOffHandlers(io, socket);
    registerFastMoneyHandlers(io, socket);
  });
};
