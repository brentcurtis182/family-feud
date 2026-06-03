const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config');
const registerSocketHandlers = require('./socketHandlers');
const gameState = require('./gameState');
const { broadcastState } = require('./broadcast');
const transcribe = require('./transcribe');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 10000,
});

// Whether cloud transcription is configured (host UI checks this)
app.get('/api/stt-status', (req, res) => {
  res.json({ available: transcribe.isAvailable(), provider: transcribe.provider() });
});

// Fast Money audio transcription: accept an audio clip, transcribe it, and
// store the text into the game's Fast Money slot (so the host's reveal sees it).
app.post('/api/transcribe', express.raw({ type: () => true, limit: '15mb' }), async (req, res) => {
  try {
    if (!transcribe.isAvailable()) return res.status(503).json({ error: 'STT not configured' });
    const buf = req.body;
    if (!buf || !buf.length) return res.status(400).json({ error: 'no audio' });

    const text = await transcribe.transcribeAudio(buf, req.headers['content-type'] || 'audio/webm');

    const { gameId, player, index } = req.query;
    const game = gameState.getGame(gameId);
    const idx = parseInt(index, 10);
    if (game && game.fastMoney && (player === 'p1' || player === 'p2') && idx >= 0 && idx < 5) {
      game.fastMoney.input[player][idx] = text;
      broadcastState(io, game);
    }
    res.json({ text });
  } catch (e) {
    console.error('transcribe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Register all socket handlers
registerSocketHandlers(io);

server.listen(config.port, () => {
  console.log(`Family Feud server running on port ${config.port}`);
  console.log(`Open http://localhost:${config.port} in your browser`);
});
