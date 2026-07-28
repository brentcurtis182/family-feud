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
    // Won't clobber an answer the host typed or corrected after ending the turn
    // — see applyTranscript.
    if (gameState.applyTranscript(game, player, parseInt(index, 10), text)) {
      broadcastState(io, game);
    }
    res.json({ text });
  } catch (e) {
    console.error('transcribe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Serve static files. Use no-cache (revalidate via ETag) so a deploy takes
// effect immediately — the browser sends a conditional request and gets a tiny
// 304 when nothing changed, or the fresh file when it did. Avoids the "clear
// cache to see the update" problem after each deploy.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Register all socket handlers
registerSocketHandlers(io);

server.listen(config.port, () => {
  console.log(`Family Feud server running on port ${config.port}`);
  console.log(`Open http://localhost:${config.port} in your browser`);
});
